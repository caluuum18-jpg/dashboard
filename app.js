const state = { refreshSeconds: 45 };

const fmtMoney = value => {
  const n = Number(value || 0);
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
};
const fmtPct = value => `${(Number(value || 0) * 100).toFixed(2)}%`;
const fmtNum = value => Number(value || 0).toFixed(2);
const clsPnL = value => Number(value || 0) >= 0 ? 'positive' : 'negative';
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

function ageSeconds(ts) {
  const t = Date.parse(ts || '');
  if (!Number.isFinite(t)) return Infinity;
  return Math.max(0, (Date.now() - t) / 1000);
}

function metric(label, value, note = '', className = '') {
  return `<div class="metric"><div class="metric-label">${esc(label)}</div><div class="metric-value ${className}">${esc(value)}</div>${note ? `<div class="metric-note">${esc(note)}</div>` : ''}</div>`;
}

function updateStatus(data) {
  const el = document.getElementById('data-status');
  const exportAge = ageSeconds(data.generated_at);
  const scanAge = ageSeconds(data.system?.last_scan_at);
  el.className = 'status-pill';
  if (exportAge > data.stale_red_seconds || scanAge > data.stale_red_seconds) {
    el.classList.add('status-bad');
    el.textContent = 'Scanner stale';
  } else if (exportAge > data.stale_amber_seconds || scanAge > data.stale_amber_seconds) {
    el.classList.add('status-warn');
    el.textContent = 'Stale';
  } else {
    el.classList.add('status-ok');
    el.textContent = 'Live';
  }
}

function renderHealth(data) {
  const s = data.system;
  const weekend = s.scanner_stale ? `Stale: last reported ${s.weekend_guard ? 'Active' : 'Inactive'}` : (s.weekend_guard ? 'Active' : 'Inactive');
  const newsStatus = s.news_guard.status === 'not_checked' ? 'Not checked yet' : (s.news_guard.status || 'unknown');
  document.getElementById('health-grid').innerHTML = [
    metric('Mode', s.mode),
    metric('Last VPS scan', s.last_scan_at_display || s.last_scan_at || 'missing'),
    metric('Last scan status', s.last_scan_status || 'unknown'),
    metric('Weekend guard', weekend),
    metric('News guard', newsStatus, s.news_guard.reason || ''),
    metric('Account guard', s.account_guard.status || 'clear', s.account_guard.reason || ''),
    metric('Open orders', s.open_orders_count),
    metric('Open positions', s.open_positions_count),
  ].join('');
}

function progressCard(title, phase) {
  const pct = Math.max(0, Math.min(1, Number(phase.progress || 0)));
  return `<div class="phase-card">
    <h3>${esc(title)}</h3>
    <div class="progress-bar"><div class="progress-fill" style="width:${(pct * 100).toFixed(1)}%"></div></div>
    <div><strong>${(pct * 100).toFixed(1)}%</strong> complete</div>
    <div class="metric-note">Target ${fmtMoney(phase.target_dollars)} (${fmtPct(phase.target_pct)}), remaining ${fmtMoney(phase.remaining_dollars)}</div>
  </div>`;
}

function renderPhase(data) {
  const p = data.phase_monitor;
  document.getElementById('phase-grid').innerHTML = [
    progressCard('Phase 1', p.phase1),
    progressCard('Phase 2', p.phase2),
    `<div class="phase-card"><h3>Profitable Days</h3><div class="progress-bar"><div class="progress-fill" style="width:${(Number(p.profitable_day_progress || 0) * 100).toFixed(1)}%"></div></div><div><strong>${p.profitable_days}/3</strong> days</div><div class="metric-note">Threshold ${fmtMoney(p.profitable_day_threshold)} closed profit</div></div>`,
    `<div class="phase-card"><h3>Inactivity</h3><div><strong>${p.days_since_last_trade == null ? 'No closed trade' : fmtNum(p.days_since_last_trade) + ' days'}</strong></div><div class="metric-note">Limit ${p.inactivity_limit_days} days</div></div>`
  ].join('');
}

function renderAccount(data) {
  const a = data.account;
  document.getElementById('account-grid').innerHTML = [
    metric('Balance', fmtMoney(a.balance), a.warning || ''),
    metric('Equity', fmtMoney(a.equity), a.source ? `Source: ${a.source}` : ''),
    metric('Floating PnL', fmtMoney(a.floating_pnl), '', clsPnL(a.floating_pnl)),
    metric('Net PnL', fmtMoney(a.net_pnl), '', clsPnL(a.net_pnl)),
    metric('Max DD from $100k', fmtPct(a.drawdown_from_initial_pct)),
    metric('Daily DD', fmtPct(a.daily_drawdown_pct)),
    metric('Daily loss left', fmtMoney(a.daily_loss_remaining), '', clsPnL(a.daily_loss_remaining)),
    metric('Max loss left', fmtMoney(a.max_loss_remaining), '', clsPnL(a.max_loss_remaining)),
  ].join('');
  drawLineChart('equity-chart', data.charts.equity.map(x => x.equity), '#1f5eff');
  drawBarChart('daily-chart', data.charts.daily.map(x => x.realized_pnl));
}

function renderPerformance(data) {
  const s = data.performance.summary;
  document.getElementById('performance-grid').innerHTML = [
    metric('Closed trades', s.closed_trades),
    metric('Win rate', fmtPct(s.win_rate)),
    metric('Profit factor', s.profit_factor == null ? 'inf' : fmtNum(s.profit_factor)),
    metric('Expectancy', fmtMoney(s.expectancy_dollars)),
    metric('Expectancy R', fmtNum(s.expectancy_r)),
    metric('Avg win/loss', fmtNum(s.average_win_loss_ratio)),
    metric('Max losing streak', s.max_losing_streak),
    metric('Trades / month', fmtNum(s.trades_per_month)),
  ].join('');
  document.getElementById('breakdown-wrap').innerHTML = table('Breakdown', ['Name','Trades','WR','PF','ExpR'], data.performance.by_strategy.concat(data.performance.by_instrument).map(r => [r.name, r.closed_trades, fmtPct(r.win_rate), r.profit_factor == null ? 'inf' : fmtNum(r.profit_factor), fmtNum(r.expectancy_r)]));
}

function table(title, headers, rows) {
  if (!rows.length) return `<h3>${esc(title)}</h3><p class="muted">No rows yet.</p>`;
  return `<h3>${esc(title)}</h3><table><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map((c, i) => `<td class="${i > 0 ? 'num' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function renderTrades(data) {
  const openRows = data.trades.open.positions.map(p => [p.symbol, p.volume, fmtMoney(p.price_open), fmtMoney(p.profit), fmtMoney(p.sl), fmtMoney(p.tp)]);
  document.getElementById('open-trades').innerHTML = table('Open Positions', ['Symbol','Volume','Entry','Floating','SL','TP'], openRows);
  const tradeRows = data.trades.recent.map(t => [t.created_at, t.strategy, t.instrument, t.direction, fmtMoney(t.realized_pnl), fmtNum(t.realized_r), t.exit_reason || t.status]);
  document.getElementById('recent-trades').innerHTML = table('Recent Trades', ['Created','Strategy','Instrument','Dir','PnL','R','Exit'], tradeRows);
  const cancelRows = data.trades.cancellations.map(c => [c.time, c.strategy, c.instrument, c.status, c.reason]);
  document.getElementById('recent-cancellations').innerHTML = table('Recent Cancellations', ['Time','Strategy','Instrument','Status','Reason'], cancelRows);
}

function drawLineChart(id, values, color) {
  const svg = document.getElementById(id);
  svg.innerHTML = '';
  if (!values.length) return;
  const min = Math.min(...values), max = Math.max(...values);
  const span = Math.max(1, max - min);
  const pts = values.map((v, i) => {
    const x = values.length === 1 ? 0 : (i / (values.length - 1)) * 640;
    const y = 200 - ((v - min) / span) * 180 + 10;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  svg.innerHTML = `<polyline fill="none" stroke="${color}" stroke-width="3" points="${pts}"></polyline>`;
}

function drawBarChart(id, values) {
  const svg = document.getElementById(id);
  svg.innerHTML = '';
  if (!values.length) return;
  const maxAbs = Math.max(1, ...values.map(v => Math.abs(v)));
  const w = 640 / values.length;
  const bars = values.map((v, i) => {
    const h = Math.abs(v) / maxAbs * 90;
    const x = i * w;
    const y = v >= 0 ? 110 - h : 110;
    const color = v >= 0 ? '#0b7a3b' : '#b42318';
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, w - 2).toFixed(1)}" height="${h.toFixed(1)}" fill="${color}"></rect>`;
  }).join('');
  svg.innerHTML = `<line x1="0" y1="110" x2="640" y2="110" stroke="#d9e0e7"></line>${bars}`;
}

async function loadDashboard() {
  try {
    const res = await fetch(`dashboard_data.json?v=${Date.now()}`, { cache: 'no-store' });
    const data = await res.json();
    state.refreshSeconds = Number(data.refresh_seconds || 45);
    updateStatus(data);
    renderHealth(data);
    renderPhase(data);
    renderAccount(data);
    renderPerformance(data);
    renderTrades(data);
  } catch (err) {
    const el = document.getElementById('data-status');
    el.className = 'status-pill status-bad';
    el.textContent = 'Error';
    console.error(err);
  }
}

loadDashboard();
setInterval(loadDashboard, Math.max(15, state.refreshSeconds) * 1000);
