/* export.js — Phase 4B
 * ------------------------------------------------------------------
 * PDF export via html2pdf.js. We render bilingual (EN + UR) print-friendly
 * HTML into a hidden off-screen container, wait for fonts to load (so
 * Noto Nastaliq Urdu rasterizes correctly), then hand off to html2pdf.
 *
 * Public API (window.RAExport):
 *   exportAnalysis(analysisId)        -> Promise<void>   single-report PDF
 *   exportAllHistory()                -> Promise<void>   patient cover + per-report
 *
 * Notes:
 *  - Print sheet uses light theme (white bg / dark text). Looks nothing
 *    like the dashboard, but PDF readability beats brand fidelity.
 *  - Inserts `.pagebreak` divs before each per-report section.
 * ------------------------------------------------------------------ */
(() => {

  const PRINT_CSS = `
    .ra-print { background:#fff; color:#1a1a1a; font-family:'DM Sans', sans-serif; padding:14mm 14mm 14mm 14mm; max-width:185mm; }
    .ra-print h1 { font-size:20pt; margin:0 0 4pt; font-weight:600; letter-spacing:-0.5pt; }
    .ra-print h2 { font-size:13pt; margin:14pt 0 6pt; font-weight:600; border-bottom:1px solid #ccc; padding-bottom:3pt; }
    .ra-print h3 { font-size:11pt; margin:8pt 0 4pt; font-weight:600; color:#333; }
    .ra-print p, .ra-print li { font-size:10pt; line-height:1.6; }
    .ra-print .meta { font-size:9pt; color:#666; }
    .ra-print .gauge { font-family:'DM Mono', monospace; font-size:38pt; font-weight:600; line-height:1; }
    .ra-print .badge { display:inline-block; padding:2pt 8pt; border-radius:10pt; font-size:9pt; font-weight:500; }
    .ra-print .b-normal   { background:#dcfce7; color:#166534; }
    .ra-print .b-risk     { background:#fef3c7; color:#92400e; }
    .ra-print .b-critical { background:#fee2e2; color:#991b1b; }
    .ra-print .b-info     { background:#dbeafe; color:#1e40af; }
    .ra-print table { width:100%; border-collapse:collapse; font-size:10pt; margin:6pt 0; }
    .ra-print th, .ra-print td { padding:5pt 6pt; border-bottom:1px solid #e5e5e5; text-align:left; }
    .ra-print th { font-size:9pt; text-transform:uppercase; letter-spacing:0.4pt; color:#666; font-weight:600; }
    .ra-print .urdu { font-family:'Noto Nastaliq Urdu','Traditional Arabic', serif; font-size:11pt; line-height:2; direction:rtl; text-align:right; }
    .ra-print .disclaimer { background:#fff7ed; border:1px solid #fed7aa; padding:8pt 10pt; border-radius:4pt; font-size:9pt; color:#7c2d12; margin-top:10pt; }
    .ra-print .row { display:flex; justify-content:space-between; gap:12pt; align-items:flex-start; }
    .ra-print .col { flex:1; min-width:0; }
    .ra-print .pagebreak { page-break-before:always; break-before:page; }
    .ra-print .footer { font-size:8pt; color:#999; margin-top:12pt; border-top:1px solid #e5e5e5; padding-top:6pt; }
    .ra-print .contrib-bar { background:#e5e5e5; height:5pt; border-radius:2pt; overflow:hidden; }
    .ra-print .contrib-fill { height:100%; background:#fbbf24; }
    .ra-print .footnote { font-size:8pt; color:#888; margin-top:4pt; }
  `;

  function injectStylesheet(){
    if (document.getElementById('ra-print-css')) return;
    const s = document.createElement('style');
    s.id = 'ra-print-css';
    s.textContent = PRINT_CSS;
    document.head.appendChild(s);
  }

  /* ---------- Per-report HTML builder ---------- */
  function buildReportSection({ analysis, bundle, user, live, recs, explEn, explUr }){
    const bio = bundle.biomarkers || {};
    const cat = analysis.riskCategory;
    const catCls = cat === 'CRITICAL' ? 'b-critical' : cat === 'AT_RISK' ? 'b-risk' : 'b-normal';
    const reportDate = new Date(analysis.analyzedAt).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });
    const lab = bundle.report?.lab || '—';
    const stage = live.features.kdigoG ? `${live.features.kdigoG}${live.features.kdigoA ? '/' + live.features.kdigoA : ''}` : '—';

    const totalContrib = Object.values(live.contributions).reduce((s,v) => s+v, 0) || 1;
    const contribRows = Object.entries(live.contributions)
      .filter(([,v]) => v > 0)
      .sort((a,b) => b[1]-a[1])
      .map(([k,v]) => {
        const pct = (v / totalContrib) * 100;
        const lbl = k === 'age' ? 'Age' : (k === 'urea' ? 'BUN' : k.replace(/^./, c => c.toUpperCase()).replace(/([A-Z])/g, ' $1').trim());
        return `<tr><td style="width:30%">${lbl}</td><td style="width:50%"><div class="contrib-bar"><div class="contrib-fill" style="width:${pct.toFixed(0)}%"></div></div></td><td style="width:20%;text-align:right;font-family:'DM Mono',monospace">+${v.toFixed(1)}</td></tr>`;
      }).join('');

    const recRows = recs.actions.map((a, i) => {
      const t = RAi18n.t('recommendations.'+a.key+'.t', {}, 'en');
      const s = RAi18n.t('recommendations.'+a.key+'.s', {}, 'en');
      return `<li><strong>${esc(t)}</strong> — ${esc(s)}</li>`;
    }).join('');

    const bioRow = (key, value, unit, refLabel) => {
      const num = Number.isFinite(value) ? value : '—';
      return `<tr><td>${RAi18n.t('biomarker.'+key, {}, 'en')}</td><td style="font-family:'DM Mono',monospace">${num}</td><td>${unit}</td><td class="meta">${refLabel}</td></tr>`;
    };
    const refs = {
      creatinine: user.gender==='F' ? '0.6 – 1.1' : '0.7 – 1.3',
      urea: '7 – 20',
      egfr: '> 60',
      uricAcid: user.gender==='F' ? '2.4 – 6.0' : '3.4 – 7.0',
      urinaryProtein: '< 0.15',
    };

    return `
      <div>
        <h1>RenalAI Analysis Report</h1>
        <div class="meta">
          ${reportDate} · ${esc(lab)} · ${esc(user.name || '—')} · ${user.age ? user.age+' y/o' : ''} ${user.gender || ''}
        </div>

        <h2>Risk Assessment</h2>
        <div class="row" style="align-items:flex-end">
          <div class="col">
            <span class="gauge">${analysis.riskScore}</span>
            <span class="badge ${catCls}" style="margin-left:8pt">${RAi18n.t('risk.'+cat, {}, 'en')}</span>
            <div class="meta" style="margin-top:4pt">KDIGO ${stage} · model confidence ${Math.round(analysis.modelConfidence)}%</div>
          </div>
          <div class="col" style="font-size:10pt;text-align:right">
            <div>BUN/Cr ratio: <strong>${live.features.bunCrRatio ?? '—'}</strong></div>
            <div>eGFR source: <strong>${live.features.egfrSource}</strong></div>
          </div>
        </div>

        <h2>Extracted Biomarkers</h2>
        <table>
          <thead><tr><th>Biomarker</th><th>Value</th><th>Unit</th><th>Reference</th></tr></thead>
          <tbody>
            ${bioRow('creatinine',     bio.creatinine,     'mg/dL',     refs.creatinine)}
            ${bioRow('egfr',           Number.isFinite(bio.egfr) ? bio.egfr : live.features.egfr, 'mL/min/1.73m²', refs.egfr)}
            ${bioRow('urea',           bio.urea,           'mg/dL',     refs.urea)}
            ${bioRow('uricAcid',       bio.uricAcid,       'mg/dL',     refs.uricAcid)}
            ${bioRow('urinaryProtein', bio.urinaryProtein, 'g/24h',     refs.urinaryProtein)}
          </tbody>
        </table>

        ${contribRows ? `
          <h2>Why this score</h2>
          <table>${contribRows}</table>
        ` : ''}

        <h2>AI Explanation</h2>
        <h3>English</h3>
        <p>${esc(explEn)}</p>
        <h3>اردو</h3>
        <p class="urdu">${esc(explUr)}</p>

        <h2>Personalized Recommendations</h2>
        <ol>${recRows}</ol>

        <div class="disclaimer">
          ⚠ This is AI-generated decision support, not a clinical diagnosis. Always consult a qualified healthcare provider before making medical decisions.
        </div>

        <div class="footer">
          Generated by RenalAI · ${new Date().toLocaleString('en-GB')} · Report ID ${analysis.id}
        </div>
      </div>
    `;
  }

  /* ---------- Cover page for full-history export ---------- */
  function buildCoverSection({ user, analyses, trend }){
    const dateFrom = analyses[0] ? new Date(analyses[0].analyzedAt).toLocaleDateString('en-GB') : '—';
    const dateTo   = analyses.at(-1) ? new Date(analyses.at(-1).analyzedAt).toLocaleDateString('en-GB') : '—';
    const dirCol = trend.direction === 'worsening' ? 'b-risk' : trend.direction === 'improving' ? 'b-normal' : 'b-info';
    return `
      <div>
        <h1>RenalAI Patient History Report</h1>
        <div class="meta">${esc(user.name || '—')} · ${user.age ? user.age+' y/o' : ''} ${user.gender || ''} · Generated ${new Date().toLocaleDateString('en-GB')}</div>

        <h2>Summary</h2>
        <table>
          <tr><td>Reports analyzed</td><td><strong>${analyses.length}</strong></td></tr>
          <tr><td>Date range</td><td><strong>${dateFrom} → ${dateTo}</strong></td></tr>
          <tr><td>Trend direction</td><td><span class="badge ${dirCol}">${trend.direction}</span></td></tr>
          <tr><td>Risk-score slope</td><td><strong>${trend.slope.riskScore.toFixed(2)} pts/month</strong> (R²=${trend.r2.riskScore.toFixed(2)})</td></tr>
          <tr><td>eGFR slope</td><td><strong>${trend.slope.egfr.toFixed(2)} mL/min·month</strong></td></tr>
          <tr><td>Severity</td><td><strong>${trend.severity}</strong></td></tr>
          <tr><td>Latest KDIGO stage</td><td><strong>${trend.projection.stage || '—'}</strong></td></tr>
          ${trend.projection.monthsToG3 != null ? `<tr><td>Projected months → G3</td><td><strong>${trend.projection.monthsToG3}</strong></td></tr>` : ''}
        </table>

        <h2>All reports</h2>
        <table>
          <thead><tr><th>Date</th><th>Lab</th><th>Cr</th><th>eGFR</th><th>BUN</th><th>Score</th><th>Category</th></tr></thead>
          <tbody>
            ${analyses.map(a => `
              <tr>
                <td>${new Date(a.analyzedAt).toLocaleDateString('en-GB')}</td>
                <td>${esc(a._report?.lab || '—')}</td>
                <td style="font-family:'DM Mono',monospace">${a._bio?.creatinine?.toFixed(2) ?? '—'}</td>
                <td style="font-family:'DM Mono',monospace">${a._bio?.egfr?.toFixed(1) ?? '—'}</td>
                <td style="font-family:'DM Mono',monospace">${a._bio?.urea ?? '—'}</td>
                <td style="font-family:'DM Mono',monospace">${a.riskScore}</td>
                <td><span class="badge ${a.riskCategory==='CRITICAL'?'b-critical':a.riskCategory==='AT_RISK'?'b-risk':'b-normal'}">${RAi18n.t('risk.'+a.riskCategory, {}, 'en')}</span></td>
              </tr>`).join('')}
          </tbody>
        </table>

        <div class="footer">
          Detailed analyses follow on subsequent pages. Generated by RenalAI · Report ID ${user.id}-${Date.now()}
        </div>
      </div>
    `;
  }

  /* ---------- Public API ---------- */

  async function ensureFontsLoaded(){
    if (document.fonts && document.fonts.ready){
      try { await document.fonts.ready; } catch(e){}
    }
  }

  async function getAnalysisFull(analysisId){
    const analysis = await RAStorage.db.analyses.get(analysisId);
    if (!analysis) throw new Error('Analysis not found');
    const bundle = await RAStorage.getReportBundle(analysis.reportId);
    const user   = await RAStorage.currentUser();
    const live   = RARisk.score({
      creatinine: bundle.biomarkers?.creatinine, urea: bundle.biomarkers?.urea,
      egfr: bundle.biomarkers?.egfr, uricAcid: bundle.biomarkers?.uricAcid,
      urinaryProtein: bundle.biomarkers?.urinaryProtein,
      age: user.age, gender: user.gender,
    });
    const recs = RARecs.build({ analysis, biomarkers: bundle.biomarkers, user, features: live.features, contributions: live.contributions });
    const explEn = RAi18n.t('explanation.'+recs.explanationKey, recs.explanationParams, 'en');
    const explUr = RAi18n.t('explanation.'+recs.explanationKey, recs.explanationParams, 'ur');
    return { analysis, bundle, user, live, recs, explEn, explUr };
  }

  async function exportAnalysis(analysisId){
    if (typeof html2pdf === 'undefined') throw new Error('html2pdf not loaded');
    injectStylesheet();
    await ensureFontsLoaded();

    const data = await getAnalysisFull(analysisId);
    const wrap = document.createElement('div');
    wrap.className = 'ra-print';
    wrap.style.cssText = 'position:absolute;left:-99999px;top:0;width:185mm;background:#fff;';
    wrap.innerHTML = buildReportSection(data);
    document.body.appendChild(wrap);

    const filename = `RenalAI-${new Date(data.analysis.analyzedAt).toISOString().slice(0,10)}.pdf`;
    try {
      await html2pdf().set({
        margin: 0,
        filename,
        image: { type:'jpeg', quality:0.95 },
        html2canvas: { scale:2, useCORS:true, backgroundColor:'#ffffff' },
        jsPDF: { unit:'mm', format:'a4', orientation:'portrait' },
        pagebreak: { mode:['css','legacy'] },
      }).from(wrap).save();
      RAStorage.audit('EXPORT_PDF', 'analyses', analysisId, { type:'single' });
    } finally {
      document.body.removeChild(wrap);
    }
  }

  async function exportAllHistory(){
    if (typeof html2pdf === 'undefined') throw new Error('html2pdf not loaded');
    injectStylesheet();
    await ensureFontsLoaded();

    const user = await RAStorage.currentUser();
    const analyses = await RAStorage.listAnalyses({ userId: user.id });
    if (!analyses.length) throw new Error('No analyses to export');
    analyses.sort((a,b) => new Date(a.analyzedAt) - new Date(b.analyzedAt));

    // Pre-load reports + biomarkers for the cover-page table
    const ids = analyses.map(a => a.biomarkerId).filter(Boolean);
    const bios = await RAStorage.db.biomarkers.bulkGet(ids);
    const reports = await Promise.all(analyses.map(a => RAStorage.getReport(a.reportId)));
    analyses.forEach((a, i) => { a._bio = bios[i]; a._report = reports[i]; });

    // Build trend summary
    const timeline = analyses.map(a => ({
      analyzedAt: a.analyzedAt, riskScore: a.riskScore, riskCategory: a.riskCategory,
      biomarkers: a._bio || {},
    }));
    const trend = RATrend.analyze(timeline);

    // Compose document
    const wrap = document.createElement('div');
    wrap.className = 'ra-print';
    wrap.style.cssText = 'position:absolute;left:-99999px;top:0;width:185mm;background:#fff;';
    wrap.innerHTML = buildCoverSection({ user, analyses, trend });

    // Append per-analysis sections (reverse-chronological feels more useful in a clinical handover)
    const reverse = [...analyses].reverse();
    for (const a of reverse){
      const data = await getAnalysisFull(a.id);
      wrap.insertAdjacentHTML('beforeend', `<div class="pagebreak"></div>${buildReportSection(data)}`);
    }
    document.body.appendChild(wrap);

    const filename = `RenalAI-History-${new Date().toISOString().slice(0,10)}.pdf`;
    try {
      await html2pdf().set({
        margin: 0,
        filename,
        image: { type:'jpeg', quality:0.95 },
        html2canvas: { scale:2, useCORS:true, backgroundColor:'#ffffff' },
        jsPDF: { unit:'mm', format:'a4', orientation:'portrait' },
        pagebreak: { mode:['css','legacy'], before: '.pagebreak' },
      }).from(wrap).save();
      RAStorage.audit('EXPORT_PDF', 'analyses', null, { type:'history', count: analyses.length });
    } finally {
      document.body.removeChild(wrap);
    }
  }

  function esc(s){ return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  window.RAExport = { exportAnalysis, exportAllHistory };
})();
