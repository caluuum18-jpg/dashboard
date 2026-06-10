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

function updateMode(data) {
  const el = document.getElementById('mode-status');
  const mode = String(data.system?.mode || 'UNKNOWN').toUpperCase();
  el.textContent = mode;
  el.className = 'mode-pill';
  if (mode === 'LIVE DEMO') {
    el.classList.add('mode-live');
  } else if (mode === 'DRY RUN') {
    el.classList.add('mode-dry');
  } else {
    el.classList.add('mode-other');
  }
}

function updateStatus(data) {
  const el = document.getElementById('data-status');
  const exportAge = ageSeconds(data.generated_at);
  const scanAge = ageSeconds(data.system?.last_scan_at);
  el.className = 'status-pill';
  if (exportAge > data.stale_red_seconds || scanAge > data.stale_red_seconds) {
    el.classList.add('status-bad');
    el.textContent = 'Dashboard stale';
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
  const newsStatus = s.news_guard.status === 'not_checked' ? 'Not checked yet' : (s.news_guard.status || 'unknown');
  document.getElementById('health-grid').innerHTML = [
    metric('Last VPS scan', s.last_scan_at_display || s.last_scan_at || 'missing'),
    metric('Last scan status', s.last_scan_status || 'unknown'),
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

function melbourneHour() {
  try {
    const parts = new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Melbourne',
      hour: '2-digit',
      hour12: false
    }).formatToParts(new Date());
    const raw = Number(parts.find(p => p.type === 'hour')?.value || NaN);
    return raw === 24 ? 0 : raw;
  } catch (err) {
    return new Date().getHours();
  }
}

function renderSchedule(data) {
  const target = document.getElementById('hours-calendar');
  const schedule = data.schedule || {};
  const hours = schedule.hours || Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  const rows = schedule.rows || [];
  if (!rows.length) {
    target.innerHTML = '<p class="muted">No active strategy hours configured.</p>';
    return;
  }
  const currentHour = melbourneHour();
  const header = ['<div></div>', ...hours.map(h => {
    const cls = Number(h) === currentHour ? 'hour-label current' : 'hour-label';
    return `<div class="${cls}">${esc(h)}</div>`;
  })].join('');
  const body = rows.map(row => {
    const cells = (row.cells || []).map(cell => {
      const strategies = cell.strategies || [];
      const label = strategies.join('+');
      let cls = 'hour-cell';
      if (strategies.length > 1) cls += ' active combo';
      else if (strategies[0] === 'FVG') cls += ' active fvg';
      else if (strategies[0] === 'ORB') cls += ' active orb';
      if (Number(cell.hour) === currentHour) cls += ' current';
      return `<div class="${cls}" title="${esc(row.instrument)} ${String(cell.hour).padStart(2, '0')}:00 ${esc(label || 'inactive')}">${esc(label)}</div>`;
    }).join('');
    return `<div class="instrument-label">${esc(row.instrument)}</div>${cells}`;
  }).join('');
  target.innerHTML = `<div class="schedule-legend">
      <span>${esc(schedule.timezone || 'Australia/Melbourne')}</span>
      <span class="legend-chip"><span class="legend-dot fvg"></span>FVG</span>
      <span class="legend-chip"><span class="legend-dot orb"></span>ORB</span>
      <span class="legend-chip"><span class="legend-dot combo"></span>Both</span>
    </div>
    <div class="hours-calendar"><div class="hours-grid">${header}${body}</div></div>`;
}

function renderAccount(data) {
  const a = data.account;
  document.getElementById('account-grid').innerHTML = [
    metric('Balance', fmtMoney(a.balance)),
    metric('Equity', fmtMoney(a.equity)),
    metric('Floating PnL', fmtMoney(a.floating_pnl), '', clsPnL(a.floating_pnl)),
    metric('Net PnL', fmtMoney(a.net_pnl), '', clsPnL(a.net_pnl)),
    metric('Max DD from $100k', fmtPct(a.drawdown_from_initial_pct)),
    metric('Daily DD', fmtPct(a.daily_drawdown_pct)),
    metric('Daily loss room', fmtMoney(a.daily_loss_remaining), '', clsPnL(a.daily_loss_remaining)),
    metric('Max loss left', fmtMoney(a.max_loss_remaining), '', clsPnL(a.max_loss_remaining)),
  ].join('');
  drawLineChart('equity-chart', data.charts.equity.map(x => x.equity), '#1f5eff');
  renderSchedule(data);
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

async function loadDashboard() {
  try {
    const res = await fetch(`dashboard_data.json?v=${Date.now()}`, { cache: 'no-store' });
    const data = await res.json();
    state.refreshSeconds = Number(data.refresh_seconds || 45);
    updateMode(data);
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
