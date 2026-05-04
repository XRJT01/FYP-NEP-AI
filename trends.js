/* trends.js — Phase 3B
 * Renders the Trend Analysis page using RATrend + Chart.js with three
 * synchronised line charts (risk score, creatinine, eGFR), a date-range
 * filter, an alert banner, and a numeric summary card.
 */
(() => {
  window.RAPages = window.RAPages || {};

  const FILTERS = [
    { key:'6mo',  months:6,   label:'trends.filter6mo' },
    { key:'3mo',  months:3,   label:'trends.filter3mo' },
    { key:'1y',   months:12,  label:'trends.filter1y' },
    { key:'all',  months:Infinity, label:'trends.filterAll' },
  ];

  // Resolve palette from CSS tokens at render-time so chart colors
  // always match the active design system.
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const COLORS = {
    risk:       () => cssVar('--warn') || '#e6b85f',
    creatinine: () => cssVar('--info') || '#6a9bea',
    egfr:       () => cssVar('--ok')   || '#5dd2a0',
    crit:       () => cssVar('--crit') || '#e8736f',
    grid:       () => 'rgba(255,255,255,0.05)',
    tickInk:    () => cssVar('--ink-3') || '#62626a',
  };

  // Shared chart options
  const baseOpts = (extra={}) => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        mode:'index', intersect:false,
        backgroundColor: 'rgba(19,19,24,0.96)',
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        titleColor: cssVar('--ink-1') || '#ededee',
        bodyColor:  cssVar('--ink-2') || '#9c9ca5',
        titleFont:  { family: 'DM Sans', weight: '500', size: 12 },
        bodyFont:   { family: 'DM Mono', size: 11 },
        padding: 10,
        cornerRadius: 6,
        displayColors: true,
        boxPadding: 4,
      },
    },
    interaction: { mode:'index', intersect:false },
    scales: {
      x: {
        ticks: { color: COLORS.tickInk(), font: { family: 'DM Mono', size: 10 } },
        grid:  { color: COLORS.grid(), drawBorder: false, drawTicks: false },
        border:{ display: false },
      },
      y: {
        ticks: { color: COLORS.tickInk(), font: { family: 'DM Mono', size: 10 } },
        grid:  { color: COLORS.grid(), drawBorder: false, drawTicks: false },
        border:{ display: false },
      },
    },
    ...extra,
  });

  let charts = {};   // active Chart instances
  let activeFilter = '6mo';

  RAPages.trends = async function(){
    destroyCharts();
    window._raPageCleanup = destroyCharts;

    const u = await RAStorage.currentUser();
    const all = await RAStorage.listAnalyses({ userId: u.id });
    const biosById = await loadBiomarkersIndex(all);

    // Build full timeline (used by analyzer; filter applied at render)
    const fullTimeline = all.map(a => ({
      analyzedAt: a.analyzedAt,
      riskScore:  a.riskScore,
      riskCategory: a.riskCategory,
      biomarkers: biosById[a.biomarkerId] || {},
    })).sort((a,b) => new Date(a.analyzedAt) - new Date(b.analyzedAt));

    // First render with default filter
    renderInto(fullTimeline);

    function renderInto(timeline){
      const filtered = applyFilter(timeline, activeFilter);
      const t = RATrend.analyze(filtered);
      drawPage(timeline, filtered, t);
    }

    function drawPage(fullTimeline, filtered, t){
      const root = document.getElementById('page-trends');
      const dirColor = t.direction === 'worsening' ? 'var(--amber)'
                     : t.direction === 'improving' ? 'var(--green)'
                     : 'var(--text2)';

      root.innerHTML = `
        <div class="page-header">
          <div>
            <div class="page-title">${RAi18n.t('trends.title')}</div>
            <div class="page-sub">
              ${RAi18n.t('trends.summary', {
                  n: t.summary.reportsUsed,
                  span: t.summary.timeSpanMonths ? t.summary.timeSpanMonths.toFixed(1) + ' mo' : '—',
                  dir: RAi18n.t('trends.'+t.direction)
                })}
            </div>
          </div>
          <select id="trend-filter" style="width:auto;min-width:160px">
            ${FILTERS.map(f => `<option value="${f.key}" ${f.key===activeFilter?'selected':''}>${RAi18n.t(f.label)}</option>`).join('')}
          </select>
        </div>

        ${renderAlerts(t)}

        ${filtered.length < 2 ? `
          <div class="card">
            <div class="empty-state">
              <div class="empty-icon">∿</div>
              <div class="empty-title">${RAi18n.t('trends.noTrend')}</div>
              <div class="empty-body">${RAi18n.t('trends.noTrendBody')}</div>
              <div style="display:flex;gap:var(--s-2);justify-content:center;flex-wrap:wrap">
                <button class="btn btn-primary btn-sm" onclick="RANavigate('upload')">↑ ${RAi18n.t('dashboard.uploadNew')}</button>
                <button class="btn btn-secondary btn-sm" onclick="RANavigate('nephra')">◐ ${RAi18n.t('dashboard.testNow')}</button>
              </div>
            </div>
          </div>
        ` : `
          <div class="grid-2 mb-12">
            <div class="card">
              <div class="flex-between mb-12">
                <div class="section-title" style="margin:0">${RAi18n.t('trends.scoreOverTime')}</div>
                <span class="badge ${dirBadgeClass(t.direction)}">${RAi18n.t('trends.'+t.direction)}</span>
              </div>
              <div class="chart-wrap"><canvas id="chart-risk"></canvas></div>
            </div>
            <div class="card">
              <div class="flex-between mb-12">
                <div class="section-title" style="margin:0">${RAi18n.t('trends.creatinineTrend')}</div>
                <span class="text-mono muted" style="font-size:11px">slope ${signed(t.slope.creatinine)} / mo</span>
              </div>
              <div class="chart-wrap"><canvas id="chart-cr"></canvas></div>
            </div>
          </div>

          <div class="grid-2">
            <div class="card">
              <div class="flex-between mb-12">
                <div class="section-title" style="margin:0">${RAi18n.t('trends.egfrTrend')}</div>
                <span class="text-mono muted" style="font-size:11px">slope ${signed(t.slope.egfr)} / mo</span>
              </div>
              <div class="chart-wrap"><canvas id="chart-egfr"></canvas></div>
            </div>

            <div class="card">
              <div class="section-title mb-12">${RAi18n.t('trends.summaryCard')}</div>
              ${summaryCard(t, dirColor)}
            </div>
          </div>
        `}
      `;

      document.getElementById('trend-filter').addEventListener('change', (e) => {
        activeFilter = e.target.value;
        destroyCharts();
        const next = applyFilter(fullTimeline, activeFilter);
        drawPage(fullTimeline, next, RATrend.analyze(next));
      });

      if (filtered.length >= 2) drawCharts(filtered, t);
    }
  };

  /* --------------------------- charts --------------------------- */

  function drawCharts(timeline, t){
    const labels = timeline.map(x => new Date(x.analyzedAt).toLocaleDateString(undefined, { month:'short', day:'numeric' }));

    const tickInk = COLORS.tickInk();
    const grid    = COLORS.grid();
    const yTitle  = (text) => ({ display: true, text, color: tickInk, font: { size: 10, family: 'DM Mono' } });

    charts.risk = new Chart(document.getElementById('chart-risk').getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'CKD Risk',
          data: timeline.map(x => x.riskScore),
          borderColor: COLORS.risk(),
          backgroundColor: hexToRgba(COLORS.risk(), 0.08),
          borderWidth: 2, tension: 0.32, fill: true,
          pointRadius: 3, pointHoverRadius: 5,
          pointBorderWidth: 0,
          pointBackgroundColor: timeline.map(x => x.riskCategory==='CRITICAL' ? COLORS.crit() : COLORS.risk()),
        }],
      },
      options: baseOpts({
        scales: {
          x: { ticks:{ color:tickInk, font:{ family:'DM Mono', size:10 } }, grid:{ color:grid, drawBorder:false } },
          y: { min:0, max:100,
                ticks:{ color:tickInk, font:{ family:'DM Mono', size:10 } },
                grid:{ color:grid, drawBorder:false },
                title: yTitle('Risk') },
        },
      }),
    });

    charts.cr = new Chart(document.getElementById('chart-cr').getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Creatinine',
            data: timeline.map(x => x.biomarkers.creatinine ?? null),
            borderColor: COLORS.creatinine(),
            backgroundColor: hexToRgba(COLORS.creatinine(), 0.08),
            borderWidth: 2, tension: 0.32, fill: true,
            pointRadius: 3, pointHoverRadius: 5, spanGaps: true,
            pointBorderWidth: 0,
          },
          {
            label: 'Upper limit',
            data: timeline.map(() => 1.3),
            borderColor: hexToRgba(COLORS.crit(), 0.35), borderDash:[3,3],
            borderWidth: 1, pointRadius: 0, fill: false,
          },
        ],
      },
      options: baseOpts({
        scales: {
          x: { ticks:{ color:tickInk, font:{ family:'DM Mono', size:10 } }, grid:{ color:grid, drawBorder:false } },
          y: { ticks:{ color:tickInk, font:{ family:'DM Mono', size:10 } }, grid:{ color:grid, drawBorder:false },
                title: yTitle('mg/dL') },
        },
      }),
    });

    charts.egfr = new Chart(document.getElementById('chart-egfr').getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'eGFR',
            data: timeline.map(x => x.biomarkers.egfr ?? null),
            borderColor: COLORS.egfr(),
            backgroundColor: hexToRgba(COLORS.egfr(), 0.08),
            borderWidth: 2, tension: 0.32, fill: true,
            pointRadius: 3, pointHoverRadius: 5, spanGaps: true,
            pointBorderWidth: 0,
          },
          {
            label: 'G3 threshold',
            data: timeline.map(() => 60),
            borderColor: hexToRgba(COLORS.crit(), 0.35), borderDash:[3,3],
            borderWidth: 1, pointRadius: 0, fill: false,
          },
        ],
      },
      options: baseOpts({
        scales: {
          x: { ticks:{ color:tickInk, font:{ family:'DM Mono', size:10 } }, grid:{ color:grid, drawBorder:false } },
          y: { ticks:{ color:tickInk, font:{ family:'DM Mono', size:10 } }, grid:{ color:grid, drawBorder:false },
                title: yTitle('mL/min/1.73m²') },
        },
      }),
    });
  }

  function hexToRgba(hex, a){
    const m = (hex || '').trim().match(/^#?([0-9a-f]{6})$/i);
    if (!m) return `rgba(255,255,255,${a})`;
    const n = parseInt(m[1], 16);
    return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;
  }

  function destroyCharts(){
    Object.values(charts).forEach(c => { try { c.destroy(); } catch(e){} });
    charts = {};
  }

  /* --------------------------- helpers --------------------------- */

  async function loadBiomarkersIndex(analyses){
    const ids = analyses.map(a => a.biomarkerId).filter(Boolean);
    const all = await RAStorage.db.biomarkers.bulkGet(ids);
    const idx = {};
    all.forEach((b, i) => { if (b) idx[ids[i]] = b; });
    return idx;
  }

  function applyFilter(timeline, key){
    const f = FILTERS.find(x => x.key === key) || FILTERS[0];
    if (!Number.isFinite(f.months)) return timeline;
    const cutoff = Date.now() - f.months * 30.4375 * 86400000;
    return timeline.filter(x => new Date(x.analyzedAt).getTime() >= cutoff);
  }

  function renderAlerts(t){
    if (!t.alerts.length) return '';
    return t.alerts.map(a => {
      const cls = a.type === 'CRITICAL' ? 'alert-crit'
                : a.type === 'WARN'     ? 'alert-warn'
                : a.type === 'INFO'     ? 'alert-info'
                : 'alert-ok';
      const color = a.type === 'CRITICAL' ? 'var(--red)'
                  : a.type === 'WARN'     ? 'var(--amber)'
                  : a.type === 'INFO'     ? 'var(--blue)'
                  : 'var(--green)';
      const icon = a.type === 'CRITICAL' ? '✕'
                 : a.type === 'WARN'     ? '⚠'
                 : a.type === 'INFO'     ? 'ℹ'
                 : '✓';
      return `
        <div class="alert-banner ${cls}">
          <div class="alert-icon" style="color:${color}">${icon}</div>
          <div>
            <div class="alert-title">${a.title}</div>
            <div class="alert-sub">${a.description}</div>
          </div>
        </div>`;
    }).join('');
  }

  function summaryCard(t, dirColor){
    const proj = t.projection;
    const projText = !proj || proj.monthsToG3 == null
      ? RAi18n.t('trends.noProjection')
      : (proj.monthsToG3 === 0 ? `Already in ${proj.stage || 'G3'}` : RAi18n.t('trends.g3In', { months: proj.monthsToG3 }));
    return `
      <div class="info-row">
        <span class="info-key">${RAi18n.t('trends.direction')}</span>
        <span class="info-val" style="color:${dirColor}">${arrow(t.direction)} ${RAi18n.t('trends.'+t.direction)}</span>
      </div>
      <div class="info-row">
        <span class="info-key">${RAi18n.t('trends.slope')}</span>
        <span class="info-val text-mono">${signed(t.slope.riskScore)} pts/mo (R²=${t.r2.riskScore.toFixed(2)})</span>
      </div>
      <div class="info-row">
        <span class="info-key">${RAi18n.t('trends.severity')}</span>
        <span class="info-val" style="color:${severityColor(t.severity)}">${t.severity}</span>
      </div>
      <div class="info-row">
        <span class="info-key">${RAi18n.t('trends.egfrStatus')}</span>
        <span class="info-val">${t.summary.latestEgfr ?? '—'} · ${t.projection.stage || '—'}</span>
      </div>
      <div class="info-row">
        <span class="info-key">${RAi18n.t('trends.alertThreshold')}</span>
        <span class="info-val text-mono">${t.summary.maxCreatinineDelta != null ? signed(t.summary.maxCreatinineDelta)+' mg/dL max Δ' : '—'}</span>
      </div>
      <div class="info-row">
        <span class="info-key">${RAi18n.t('trends.reportsUsed')}</span>
        <span class="info-val">${t.summary.reportsUsed} · ${formatRange(t.summary.dateFrom, t.summary.dateTo)}</span>
      </div>
      <div class="info-row">
        <span class="info-key">${RAi18n.t('trends.projection')}</span>
        <span class="info-val">${projText}</span>
      </div>`;
  }

  function dirBadgeClass(dir){
    if (dir === 'worsening')   return 'badge-risk';
    if (dir === 'improving')   return 'badge-normal';
    if (dir === 'insufficient')return 'badge-muted';
    return 'badge-info';
  }
  function severityColor(s){
    if (s === 'SEVERE')   return 'var(--red)';
    if (s === 'MODERATE') return 'var(--amber)';
    if (s === 'MILD')     return 'var(--amber)';
    return 'var(--green)';
  }
  function arrow(dir){
    if (dir === 'worsening') return '↑';
    if (dir === 'improving') return '↓';
    return '→';
  }
  function signed(n){
    if (!Number.isFinite(n)) return '—';
    const sign = n > 0 ? '+' : (n < 0 ? '' : '±');
    return sign + n.toFixed(2);
  }
  function formatRange(a, b){
    if (!a || !b) return '—';
    const fa = new Date(a).toLocaleDateString(undefined, { month:'short', year:'2-digit' });
    const fb = new Date(b).toLocaleDateString(undefined, { month:'short', year:'2-digit' });
    return `${fa} → ${fb}`;
  }
})();
