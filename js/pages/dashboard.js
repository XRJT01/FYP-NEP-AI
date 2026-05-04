/* dashboard.js — Phase 1A
 * Reads from RAStorage and renders the dashboard with live data. */
(() => {
  window.RAPages = window.RAPages || {};

  const fmt = (n, d=1) => Number.isFinite(n) ? n.toFixed(d) : '—';

  function timeAgo(iso){
    if (!iso) return '—';
    const diff = Date.now() - new Date(iso).getTime();
    const days = Math.round(diff / 86400000);
    if (days < 1) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days} days ago`;
    const months = Math.round(days/30);
    return `${months} month${months>1?'s':''} ago`;
  }

  function bioBar(value, lo, hi){
    if (!Number.isFinite(value)) return { pct:0, color:'var(--text3)' };
    const pct = Math.max(5, Math.min(100, (value / hi) * 100));
    let color = 'var(--green)';
    if (value > hi || value < lo) color = 'var(--amber)';
    if (value > hi*1.5) color = 'var(--red)';
    return { pct, color };
  }

  function categoryBadge(cat){
    const map = { NORMAL:'badge-normal', AT_RISK:'badge-risk', CRITICAL:'badge-critical' };
    return `<span class="badge ${map[cat]||'badge-muted'}">${RAi18n.t('risk.'+cat)}</span>`;
  }

  async function render(opts = {}){
    const root = document.getElementById('page-dashboard');
    const user = await RAStorage.currentUser();
    if (!user){ root.innerHTML = ''; return; }
    const analyses = await RAStorage.listAnalyses({ userId: user.id });
    const latest = analyses[analyses.length - 1];
    const prev   = analyses[analyses.length - 2];
    const firstName = (user.name || user.email || 'there').split(/[\s@]/)[0];

    if (!latest) {
      // Empty state — fresh signup or after data wipe.
      // Show a welcome banner (if this is the first ever visit) plus
      // four onboarding cards walking through the main entry points.
      root.innerHTML = `
        <div class="page-header">
          <div>
            <div class="page-title">${opts.isFreshSignup
              ? RAi18n.t('onboarding.welcomeTitle', { name: firstName })
              : RAi18n.t('nav.dashboard')}</div>
            <div class="page-sub">${opts.isFreshSignup
              ? RAi18n.t('onboarding.welcomeSub')
              : RAi18n.t('dashboard.noReports')}</div>
          </div>
        </div>
        <div class="onboard-grid">
          <button class="onboard-card" type="button" onclick="RANavigate('upload')">
            <div class="onboard-icon">↑</div>
            <div class="onboard-title">${RAi18n.t('onboarding.card1Title')}</div>
            <div class="onboard-sub">${RAi18n.t('onboarding.card1Sub')}</div>
          </button>
          <button class="onboard-card" type="button" onclick="RANavigate('nephra')">
            <div class="onboard-icon">◐</div>
            <div class="onboard-title">${RAi18n.t('onboarding.card2Title')}</div>
            <div class="onboard-sub">${RAi18n.t('onboarding.card2Sub')}</div>
          </button>
          <button class="onboard-card" type="button" onclick="RANavigate('upload')">
            <div class="onboard-icon">⌨</div>
            <div class="onboard-title">${RAi18n.t('onboarding.card3Title')}</div>
            <div class="onboard-sub">${RAi18n.t('onboarding.card3Sub')}</div>
          </button>
          <button class="onboard-card" type="button" onclick="RANavigate('doctors')">
            <div class="onboard-icon">✦</div>
            <div class="onboard-title">${RAi18n.t('onboarding.card4Title')}</div>
            <div class="onboard-sub">${RAi18n.t('onboarding.card4Sub')}</div>
          </button>
        </div>`;
      return;
    }

    const bio = await RAStorage.db.biomarkers.get(latest.biomarkerId);
    const scoreDelta = prev ? latest.riskScore - prev.riskScore : 0;
    const cr = bio?.creatinine, egfr = bio?.egfr;

    const sparkPath = buildSparkline(analyses.map(a => a.riskScore), 0, 100);

    root.innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">${RAi18n.t('nav.dashboard')}</div>
          <div class="page-sub">${RAi18n.t('dashboard.welcome', { name: user.name.split(' ')[0] })} — ${RAi18n.t('dashboard.lastAnalysis', { when: timeAgo(latest.analyzedAt) })}</div>
        </div>
      </div>

      <div class="grid-4 mb-12">
        <div class="card-sm">
          <div class="metric-label">${RAi18n.t('dashboard.ckdRiskScore')}</div>
          <div class="metric-val text-amber" style="color:${categoryColor(latest.riskCategory)}">${latest.riskScore}</div>
          <div class="metric-delta ${scoreDelta>0?'delta-up':scoreDelta<0?'delta-down':'delta-stable'}">${
            scoreDelta>0 ? RAi18n.t('dashboard.deltaUp', { delta: '+'+scoreDelta }) :
            scoreDelta<0 ? RAi18n.t('dashboard.deltaDown', { delta: scoreDelta }) :
            RAi18n.t('dashboard.stable')
          }</div>
        </div>
        <div class="card-sm">
          <div class="metric-label">${RAi18n.t('dashboard.creatinine')}</div>
          <div class="metric-val">${fmt(cr,2)} <span style="font-size:14px;color:var(--text3)">mg/dL</span></div>
          <div class="metric-delta ${cr>1.3?'delta-up':'delta-stable'}">${cr>1.3 ? RAi18n.t('dashboard.aboveNormal') : RAi18n.t('dashboard.stable')}</div>
        </div>
        <div class="card-sm">
          <div class="metric-label">${RAi18n.t('dashboard.egfr')}</div>
          <div class="metric-val">${fmt(egfr,1)} <span style="font-size:14px;color:var(--text3)">mL/min</span></div>
          <div class="metric-delta delta-stable">→ ${RAi18n.t('dashboard.g2Stage')}</div>
        </div>
        <div class="card-sm">
          <div class="metric-label">${RAi18n.t('dashboard.reportsAnalyzed')}</div>
          <div class="metric-val">${analyses.length}</div>
          <div class="metric-delta delta-stable muted">${analyses.length} total</div>
        </div>
      </div>

      <div class="grid-2 mb-12">
        <div class="card">
          <div class="flex-between mb-12">
            <div class="section-title">${RAi18n.t('dashboard.kidneyTrend')}</div>
            ${categoryBadge(latest.riskCategory)}
          </div>
          <div class="chart-wrap" style="height:160px"><svg viewBox="0 0 300 140" preserveAspectRatio="none" style="width:100%;height:100%">${sparkPath}</svg></div>
        </div>
        <div class="card">
          <div class="section-title mb-12">${RAi18n.t('dashboard.currentBiomarkers')}</div>
          ${biomarkerRow(RAi18n.t('biomarker.creatinine'), RAi18n.t('biomarker.creatinineSub'), cr, 'mg/dL', '0.7–1.3', bioBar(cr, 0.7, 1.3))}
          ${biomarkerRow(RAi18n.t('biomarker.egfr'), RAi18n.t('biomarker.egfrSub'), egfr, 'mL/min', '>60', bioBar(egfr, 60, 120))}
          ${biomarkerRow(RAi18n.t('biomarker.urea'), RAi18n.t('biomarker.ureaSub'), bio?.urea, 'mg/dL', '7–20', bioBar(bio?.urea, 7, 20))}
          ${biomarkerRow(RAi18n.t('biomarker.uricAcid'), RAi18n.t('biomarker.uricAcidSub'), bio?.uricAcid, 'mg/dL', '<7.0', bioBar(bio?.uricAcid, 3.4, 7.0))}
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="section-title mb-12">${RAi18n.t('dashboard.alerts')}</div>
          <div id="dash-alerts"><div class="muted">${RAi18n.t('common.loading')}</div></div>
        </div>
        <div class="card">
          <div class="section-title mb-12">${RAi18n.t('dashboard.quickActions')}</div>
          <div style="display:flex;flex-direction:column;gap:var(--s-2)">
            <button class="btn btn-primary"   onclick="RANavigate('nephra')">◐ ${RAi18n.t('dashboard.testNow')}</button>
            <button class="btn btn-secondary" onclick="RANavigate('upload')">↑ ${RAi18n.t('dashboard.uploadNew')}</button>
            <button class="btn btn-secondary" onclick="RANavigate('trends')">∿ ${RAi18n.t('dashboard.viewTrends')}</button>
            <button class="btn btn-secondary" onclick="RANavigate('doctors')">✦ ${RAi18n.t('dashboard.shareDoc')}</button>
          </div>
          <div class="divider"></div>
          <div class="section-title">${RAi18n.t('dashboard.nextTest')}</div>
          <div style="font-size:13px;color:var(--text2)">${RAi18n.t('dashboard.nextTestSub')}</div>
        </div>
      </div>
    `;

    // Inject trend-driven alerts asynchronously
    const alertsHtml = await renderAlerts();
    const slot = document.getElementById('dash-alerts');
    if (slot) slot.innerHTML = alertsHtml || '';
  }

  function biomarkerRow(name, sub, value, unit, refRange, bar){
    return `
      <div class="biomarker-row">
        <div><div class="bio-name">${name}</div><div class="bio-sub">${sub}</div></div>
        <div style="display:flex;align-items:center;gap:12px">
          <div class="bio-bar-wrap"><div class="bio-bar" style="width:${bar.pct}%;background:${bar.color}"></div></div>
          <div style="text-align:end">
            <div class="bio-val" style="color:${bar.color}">${Number.isFinite(value)?value:'—'}</div>
            <div class="bio-ref">${unit} | ${refRange}</div>
          </div>
        </div>
      </div>`;
  }

  function categoryColor(cat){
    return cat === 'CRITICAL' ? 'var(--red)' : cat === 'AT_RISK' ? 'var(--amber)' : 'var(--green)';
  }

  function buildSparkline(values, min, max){
    if (!values || values.length < 2) return '';
    const w = 300, h = 140, pad = 10;
    const x = i => pad + i * (w - 2*pad) / (values.length - 1);
    const y = v => pad + (1 - (v - min)/(max - min)) * (h - 2*pad);
    const d = values.map((v,i) => `${i?'L':'M'}${x(i)},${y(v)}`).join(' ');
    const area = `${d} L${x(values.length-1)},${h-pad} L${x(0)},${h-pad} Z`;
    const last = values[values.length-1];
    const tok = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const color = last >= 67 ? tok('--crit') : last >= 34 ? tok('--warn') : tok('--ok');
    const gridColor = 'rgba(255,255,255,0.05)';
    return `
      <defs>
        <linearGradient id="g_dash" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="${color}" stop-opacity="0.16"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <line x1="0" y1="${pad + (h-2*pad)*0.25}" x2="${w}" y2="${pad + (h-2*pad)*0.25}" stroke="${gridColor}" stroke-width="1"/>
      <line x1="0" y1="${pad + (h-2*pad)*0.50}" x2="${w}" y2="${pad + (h-2*pad)*0.50}" stroke="${gridColor}" stroke-width="1"/>
      <line x1="0" y1="${pad + (h-2*pad)*0.75}" x2="${w}" y2="${pad + (h-2*pad)*0.75}" stroke="${gridColor}" stroke-width="1"/>
      <path d="${area}" fill="url(#g_dash)"/>
      <path d="${d}" fill="none" stroke="${color}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${x(values.length-1)}" cy="${y(last)}" r="3" fill="${color}"/>
      <circle cx="${x(values.length-1)}" cy="${y(last)}" r="6" fill="${color}" fill-opacity="0.18"/>`;
  }

  /** Renders dashboard alerts using the live trend analyzer.
   *  Falls back to a simple "all clear" message when fewer than 2 reports exist. */
  async function renderAlerts(){
    if (!window.RATrend?.analyze) return '';
    const u = await RAStorage.currentUser();
    const all = await RAStorage.listAnalyses({ userId: u.id });
    if (all.length < 2){
      return `<div class="alert-banner alert-info">
        <div class="alert-icon">ℹ</div>
        <div><div class="alert-title">Need more data</div><div class="alert-sub">Upload another report to start tracking trends.</div></div>
      </div>`;
    }
    // Build timeline with biomarkers
    const ids  = all.map(a => a.biomarkerId).filter(Boolean);
    const bios = await RAStorage.db.biomarkers.bulkGet(ids);
    const idx  = {}; bios.forEach((b,i) => { if (b) idx[ids[i]] = b; });
    const timeline = all.map(a => ({
      analyzedAt: a.analyzedAt, riskScore: a.riskScore, riskCategory: a.riskCategory,
      biomarkers: idx[a.biomarkerId] || {},
    }));
    const t = RATrend.analyze(timeline);

    // Cap to top-3 alerts on the dashboard
    const top = t.alerts.slice(0, 3);
    return top.map(a => {
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
          <div><div class="alert-title">${a.title}</div><div class="alert-sub">${a.description}</div></div>
        </div>`;
    }).join('');
  }

  RAPages.dashboard = render;
})();
