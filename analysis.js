/* analysis.js — Phase 3A
 * Renders the Analysis Result page using the live risk engine for
 * features + contributions. Recommendations / explanations are filled
 * in by Phase 3C; this page leaves clearly-marked placeholders for them.
 */
(() => {
  window.RAPages = window.RAPages || {};

  const REF = { // display reference ranges (gender-specific where applicable handled at runtime)
    creatinine: { M:[0.7, 1.3], F:[0.6, 1.1], unit:'mg/dL' },
    urea:       { M:[7,   20],  F:[7,   20],  unit:'mg/dL' },
    egfr:       { ALL:[60, 120], unit:'mL/min/1.73m²' },
    uricAcid:   { M:[3.4, 7.0], F:[2.4, 6.0], unit:'mg/dL' },
    urinaryProtein: { ALL:[0, 0.15], unit:'g/24h' },
  };

  const FEATURES_ORDER = ['egfr','urinaryProtein','creatinine','urea','uricAcid','age'];

  RAPages.analysis = async function(){
    const root = document.getElementById('page-analysis');
    const u = await RAStorage.currentUser();

    // Drill-in support: history.js sets window._raAnalysisId before navigating.
    // Sidebar nav clears it (in app.js), so direct nav always shows latest.
    const drillId = window._raAnalysisId;
    const latest = drillId
      ? await RAStorage.db.analyses.get(drillId)
      : await RAStorage.getLatestAnalysis(u.id);

    if (!latest){
      root.innerHTML = `
        <div class="page-header">
          <div>
            <div class="page-title">${RAi18n.t('analysis.title')}</div>
            <div class="page-sub">${RAi18n.t('common.noData')}</div>
          </div>
        </div>
        <div class="card">
          <div class="empty-state">
            <div class="empty-icon">◎</div>
            <div class="empty-title">${RAi18n.t('analysis.emptyTitle')}</div>
            <div class="empty-body">${RAi18n.t('analysis.emptyBody')}</div>
            <div style="display:flex;gap:var(--s-2);justify-content:center;flex-wrap:wrap">
              <button class="btn btn-primary btn-sm" onclick="RANavigate('upload')">↑ ${RAi18n.t('dashboard.uploadNew')}</button>
              <button class="btn btn-secondary btn-sm" onclick="RANavigate('nephra')">◐ ${RAi18n.t('dashboard.testNow')}</button>
            </div>
          </div>
        </div>`;
      return;
    }

    const bundle = await RAStorage.getReportBundle(latest.reportId);
    const bio = bundle.biomarkers || {};

    // Re-run engine to get features + contributions (score itself is the stored value)
    const live = RARisk.score({
      creatinine: bio.creatinine,
      urea: bio.urea,
      egfr: bio.egfr,
      uricAcid: bio.uricAcid,
      urinaryProtein: bio.urinaryProtein,
      age: u.age,
      gender: u.gender,
    });

    const score = latest.riskScore;
    const cat   = latest.riskCategory;
    const conf  = latest.modelConfidence ?? live.modelConfidence;
    const color = catColor(cat);
    const dateStr = new Date(latest.analyzedAt).toLocaleDateString();

    root.innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">${RAi18n.t('analysis.title')}${drillId ? ` <span class="badge badge-info" style="font-size:11px;vertical-align:middle;margin-inline-start:8px">Historical view</span>` : ''}</div>
          <div class="page-sub">${dateStr}${bundle.report?.lab ? ' · ' + bundle.report.lab : ''} · ${RAi18n.t('analysis.modelConf', { pct: Math.round(conf) })}</div>
        </div>
        <div style="display:flex;gap:8px">
          ${drillId ? `<button class="btn btn-secondary btn-sm" id="show-latest">↻ Show latest</button>` : ''}
          <button class="btn btn-secondary btn-sm" id="export-pdf">⇩ ${RAi18n.t('analysis.exportPdf')}</button>
          <button class="btn btn-secondary btn-sm" onclick="RANavigate('doctors')">✦ ${RAi18n.t('dashboard.shareDoc')}</button>
        </div>
      </div>

      <div class="grid-2 mb-12">
        <div class="card">
          <div class="risk-gauge-wrap">
            <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;justify-content:center">
              ${categoryBadge(cat)}
              <span class="badge badge-info">${RAi18n.t('analysis.modelConf', { pct: Math.round(conf) })}</span>
              ${live.features.kdigoG ? `<span class="badge badge-muted">${live.features.kdigoG}${live.features.kdigoA ? '/' + live.features.kdigoA : ''}</span>` : ''}
            </div>
            <div class="gauge-score" style="color:${color}">${score}</div>
            <div class="gauge-label">${RAi18n.t('dashboard.ckdRiskScore')}</div>
            <div style="width:100%;padding:0 8px;margin-top:16px">
              <div class="risk-bar"><div class="risk-needle" style="left:calc(${score}% - 1px)"></div></div>
              <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text3);margin-top:4px">
                <span>${RAi18n.t('risk.labels.low')}</span>
                <span>${RAi18n.t('risk.labels.mid')}</span>
                <span>${RAi18n.t('risk.labels.high')}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="section-title mb-12">${RAi18n.t('analysis.extracted')}</div>
          ${biomarkerRow('creatinine', bio.creatinine, u.gender)}
          ${biomarkerRow('egfr',       liveEgfr(bio.egfr, live), u.gender, live.features.egfrSource)}
          ${biomarkerRow('urea',       bio.urea, u.gender)}
          ${biomarkerRow('uricAcid',   bio.uricAcid, u.gender)}
          ${biomarkerRow('urinaryProtein', bio.urinaryProtein, u.gender)}
          ${live.features.bunCrRatio != null ? `<div class="info-row"><span class="info-key">BUN/Cr ratio</span><span class="info-val text-mono">${live.features.bunCrRatio}</span></div>` : ''}
        </div>
      </div>

      <div class="grid-2 mb-12">
        <div class="card">
          <div class="section-title mb-12">Why this score</div>
          <div class="muted mb-12" style="font-size:11px">Per-feature contribution to the 0–100 risk total. Re-weighted to ignore missing inputs.</div>
          ${renderContributions(live.contributions)}
        </div>
        <div class="card" id="explanation-card">
          ${renderExplanation(latest, bio, u, live)}
        </div>
      </div>

      <div class="card mb-12" id="recommendations-card">
        ${renderRecommendations(latest, bio, u, live)}
      </div>

      <div class="card" style="background:var(--bg3);border-style:dashed">
        <div class="muted" style="font-size:11px;line-height:1.5">${RAi18n.t('analysis.disclaimer')}</div>
      </div>
    `;

    // EN/UR explanation toggle (in-place, no full re-render)
    const flipBtn = document.getElementById('lang-flip');
    if (flipBtn){
      flipBtn.onclick = () => {
        const next = (flipBtn.dataset.show || RAi18n.currentLang()) === 'en' ? 'ur' : 'en';
        flipBtn.dataset.show = next;
        const para = document.getElementById('explanation-text');
        if (para){
          const recs = window._raLastRecs;
          // Build the explanation in the requested language by temporarily resolving from that locale dict
          para.textContent = resolveExplanation(next, recs);
          para.lang = next;
          para.style.fontFamily = next === 'ur' ? 'var(--urdu)' : '';
          para.style.lineHeight = next === 'ur' ? '2' : '1.7';
          para.style.direction = next === 'ur' ? 'rtl' : 'ltr';
          para.style.textAlign = next === 'ur' ? 'right' : 'start';
        }
        flipBtn.textContent = next === 'en' ? 'اردو' : 'EN';
      };
    }
    if (drillId){
      document.getElementById('show-latest').onclick = () => {
        window._raAnalysisId = null;
        RANavigate('analysis');
      };
    }
    document.getElementById('export-pdf').onclick = async () => {
      const btn = document.getElementById('export-pdf');
      btn.disabled = true;
      const orig = btn.textContent;
      btn.textContent = '⏳ Generating…';
      try {
        await RAExport.exportAnalysis(latest.id);
      } catch(e){
        RAToast('PDF export failed: ' + e.message, 'err', 5000);
      } finally {
        btn.disabled = false;
        btn.textContent = orig;
      }
    };
  };

  /* --------------------------- helpers --------------------------- */

  function renderExplanation(latest, bio, user, live){
    const recs = RARecs.build({
      analysis: latest, biomarkers: bio, user,
      features: live.features, contributions: live.contributions,
    });
    window._raLastRecs = recs;
    const text = RAi18n.t('explanation.'+recs.explanationKey, recs.explanationParams);
    const isUr = RAi18n.currentLang() === 'ur';
    return `
      <div class="flex-between mb-12">
        <div class="section-title" style="margin:0">${RAi18n.t('analysis.explanation')}</div>
        <button class="lang-btn" id="lang-flip" data-show="${RAi18n.currentLang()}">${isUr ? 'EN' : 'اردو'}</button>
      </div>
      <p id="explanation-text"
         lang="${RAi18n.currentLang()}"
         style="font-size:13px;color:var(--text2);line-height:${isUr?'2':'1.7'};${isUr?'font-family:var(--urdu);direction:rtl;text-align:right':''}">
        ${escapeHtml(text)}
      </p>
      ${live.features.egfrSource === 'computed' ? `
        <div class="muted mt-8" style="font-size:11px">eGFR auto-calculated from creatinine via CKD-EPI 2021.</div>` : ''}
    `;
  }

  function resolveExplanation(lang, recs){
    if (!recs) return '';
    return RAi18n.t('explanation.'+recs.explanationKey, recs.explanationParams, lang);
  }

  function renderRecommendations(latest, bio, user, live){
    const recs = RARecs.build({
      analysis: latest, biomarkers: bio, user,
      features: live.features, contributions: live.contributions,
    });
    window._raLastRecs = recs;
    const items = recs.actions.map((a, i) => {
      const t = RAi18n.t('recommendations.'+a.key+'.t');
      const s = RAi18n.t('recommendations.'+a.key+'.s');
      const stateClass = a.key === 'urgent' ? 'active' : '';
      return `
        <div class="step" style="padding:8px 0">
          <div class="step-num ${stateClass}" style="${a.key==='urgent' ? 'background:var(--red-dim);border-color:rgba(248,113,113,0.4);color:var(--red)' : ''}">${i+1}</div>
          <div class="step-content">
            <div class="step-title">${escapeHtml(t)}</div>
            <div class="step-sub">${escapeHtml(s)}</div>
          </div>
        </div>`;
    }).join('');
    return `
      <div class="section-title mb-12">${RAi18n.t('analysis.recommendations')}</div>
      <div class="steps">${items}</div>
      <div class="muted mt-16" style="font-size:11px">${RAi18n.t('analysis.disclaimer')}</div>
    `;
  }

  function escapeHtml(s){
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function liveEgfr(stored, live){
    // Prefer stored value if present; otherwise fall back to engine's CKD-EPI computation
    return Number.isFinite(stored) ? stored : live.features.egfr;
  }

  function biomarkerRow(key, value, gender, source){
    const range = REF[key];
    const refs  = range[gender] || range.ALL || range.M;
    const unit  = range.unit;
    let badge   = '';
    if (Number.isFinite(value)){
      const [lo, hi] = refs;
      // Special case: eGFR — *low* is bad, not high
      const isLowBetter = (key === 'urinaryProtein' || key === 'urea' || key === 'creatinine' || key === 'uricAcid');
      let abnormal = false, severity = 'normal';
      if (isLowBetter){
        if (value > hi)        { abnormal = true; severity = value > hi*1.6 ? 'critical' : 'risk'; }
        else if (value < lo*0.5) { abnormal = true; severity = 'risk'; }
      } else if (key === 'egfr'){
        if (value < 60)        { abnormal = true; severity = value < 30 ? 'critical' : 'risk'; }
      }
      const cls = severity === 'critical' ? 'badge-critical' : severity === 'risk' ? 'badge-risk' : 'badge-normal';
      const label = severity === 'critical' ? RAi18n.t('analysis.elevated')
                   : severity === 'risk' ? RAi18n.t('analysis.slightlyHigh')
                   : RAi18n.t('analysis.normal');
      badge = `<span class="badge ${cls}" style="font-size:10px;padding:2px 6px">${label}</span>`;
    }
    const valDisplay = Number.isFinite(value) ? value : '—';
    const refDisplay = (key === 'urinaryProtein') ? `<${refs[1]}` : (key === 'egfr') ? `>${refs[0]}` : `${refs[0]}–${refs[1]}`;
    const sourceTag = source === 'computed' ? ' <span class="badge badge-info" style="font-size:10px;padding:1px 6px">[CALCULATED]</span>' : '';
    return `
      <div class="biomarker-row">
        <div>
          <div class="bio-name">${RAi18n.t('biomarker.'+key)}${sourceTag}</div>
          <div class="bio-sub">ref: ${refDisplay} ${unit}</div>
        </div>
        <div style="text-align:end">
          <div class="bio-val" style="color:${valColor(key, value, gender)}">${valDisplay}</div>
          ${badge}
        </div>
      </div>`;
  }

  function valColor(key, value, gender){
    if (!Number.isFinite(value)) return 'var(--text3)';
    const range = REF[key];
    const refs  = range[gender] || range.ALL || range.M;
    if (key === 'egfr') return value >= 60 ? 'var(--green)' : value >= 30 ? 'var(--amber)' : 'var(--red)';
    if (key === 'urinaryProtein') return value < 0.15 ? 'var(--green)' : value < 0.5 ? 'var(--amber)' : 'var(--red)';
    return value > refs[1]*1.6 ? 'var(--red)' : value > refs[1] ? 'var(--amber)' : 'var(--green)';
  }

  function renderContributions(contribs){
    const total = Object.values(contribs).reduce((s,v) => s + v, 0) || 1;
    const rows = FEATURES_ORDER
      .filter(k => contribs[k] != null && contribs[k] > 0)
      .sort((a,b) => contribs[b] - contribs[a]);
    if (!rows.length){
      return `<div class="muted" style="font-size:13px">No abnormal contributors detected — all features within normal range.</div>`;
    }
    return rows.map(k => {
      const v = contribs[k];
      const pct = (v / total) * 100;
      const label = labelFor(k);
      return `
        <div style="margin-bottom:10px">
          <div class="flex-between" style="font-size:12px">
            <span>${label}</span>
            <span class="text-mono">+${v.toFixed(1)}</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${barColor(v)}"></div></div>
        </div>`;
    }).join('');
  }

  function labelFor(k){
    if (k === 'age') return RAi18n.t('settings.age');
    return RAi18n.t('biomarker.'+k);
  }
  function barColor(v){
    return v >= 20 ? 'var(--red)' : v >= 10 ? 'var(--amber)' : 'var(--green)';
  }
  function catColor(cat){
    return cat === 'CRITICAL' ? 'var(--red)' : cat === 'AT_RISK' ? 'var(--amber)' : 'var(--green)';
  }
  function categoryBadge(cat){
    const map = { NORMAL:'badge-normal', AT_RISK:'badge-risk', CRITICAL:'badge-critical' };
    return `<span class="badge ${map[cat]||'badge-muted'}">${RAi18n.t('risk.'+cat)}</span>`;
  }
})();
