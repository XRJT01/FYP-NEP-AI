/* history.js — Phase 4B
 * ------------------------------------------------------------------
 * Full report-history table:
 *   • Sortable column headers (click to toggle asc/desc)
 *   • Date-range filter (3mo / 6mo / 1y / all)
 *   • Category filter (Normal / At Risk / Critical) as toggleable chips
 *   • Click any row to drill into that specific analysis
 *   • Per-row "↓ PDF" button for single-report export
 *   • "Export All as PDF" toolbar button
 * ------------------------------------------------------------------ */
(() => {
  window.RAPages = window.RAPages || {};

  // Persistent UI state across re-renders
  let sortKey  = 'date';
  let sortDir  = 'desc';   // 'asc' | 'desc'
  let dateFilter = 'all';
  let catFilter  = new Set(['NORMAL','AT_RISK','CRITICAL']);

  const FILTERS = [
    { key:'all',  months: Infinity, labelKey:'trends.filterAll' },
    { key:'1y',   months: 12,       labelKey:'trends.filter1y' },
    { key:'6mo',  months: 6,        labelKey:'trends.filter6mo' },
    { key:'3mo',  months: 3,        labelKey:'trends.filter3mo' },
  ];

  RAPages.history = async function(){
    const u = await RAStorage.currentUser();
    const all = await RAStorage.listAnalyses({ userId: u.id });
    const ids = all.map(a => a.biomarkerId).filter(Boolean);
    const bios = await RAStorage.db.biomarkers.bulkGet(ids);
    const reports = await Promise.all(all.map(a => RAStorage.getReport(a.reportId)));

    // Augment each row with its biomarker + report so we can sort/filter on them
    const rows = all.map((a, i) => ({
      ...a, _bio: bios[i] || {}, _report: reports[i] || {},
    }));

    renderInto(rows);

    function renderInto(rows){
      // Zero-data empty state: skip filters/table entirely, show illustrated empty card
      if (rows.length === 0){
        document.getElementById('page-history').innerHTML = `
          <div class="page-header">
            <div>
              <div class="page-title">${RAi18n.t('history.title')}</div>
              <div class="page-sub">${RAi18n.t('history.subtitle', { n: 0 })}</div>
            </div>
          </div>
          <div class="card">
            <div class="empty-state">
              <div class="empty-icon">≡</div>
              <div class="empty-title">${RAi18n.t('history.emptyTitle')}</div>
              <div class="empty-body">${RAi18n.t('history.emptyBody')}</div>
              <div style="display:flex;gap:var(--s-2);justify-content:center;flex-wrap:wrap">
                <button class="btn btn-primary btn-sm" onclick="RANavigate('upload')">↑ ${RAi18n.t('dashboard.uploadNew')}</button>
                <button class="btn btn-secondary btn-sm" onclick="RANavigate('nephra')">◐ ${RAi18n.t('dashboard.testNow')}</button>
              </div>
            </div>
          </div>`;
        return;
      }

      const filtered = applyFilters(rows);
      const sorted   = applySort(filtered);

      document.getElementById('page-history').innerHTML = `
        <div class="page-header">
          <div>
            <div class="page-title">${RAi18n.t('history.title')}</div>
            <div class="page-sub">${RAi18n.t('history.subtitle', { n: rows.length })}${
              filtered.length !== rows.length ? ` · showing ${filtered.length}` : ''
            }</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <select id="hist-date-filter" style="width:auto;min-width:140px">
              ${FILTERS.map(f => `<option value="${f.key}" ${f.key===dateFilter?'selected':''}>${RAi18n.t(f.labelKey)}</option>`).join('')}
            </select>
            <button class="btn btn-primary btn-sm" id="hist-export-all" ${rows.length===0?'disabled':''}>⇩ ${RAi18n.t('history.exportAll')}</button>
          </div>
        </div>

        <div class="card mb-12" style="padding:12px 16px">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <span class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em">${RAi18n.t('history.category')}:</span>
            ${['NORMAL','AT_RISK','CRITICAL'].map(c => {
              const on = catFilter.has(c);
              const cls = c==='CRITICAL'?'badge-critical':c==='AT_RISK'?'badge-risk':'badge-normal';
              return `<button class="badge ${on?cls:'badge-muted'}" data-cat-toggle="${c}" style="border:none;cursor:pointer;${on?'':'opacity:0.6'}">${RAi18n.t('risk.'+c)}</button>`;
            }).join('')}
            <span class="muted" style="margin-inline-start:auto;font-size:11px">${sorted.length} of ${rows.length}</span>
          </div>
        </div>

        <div class="card">
          <div class="table-wrap">
            <table>
              <thead><tr>
                ${header('date',     'history.date')}
                ${header('lab',      'history.lab')}
                ${header('cr',       'biomarker.creatinine')}
                ${header('egfr',     'biomarker.egfr')}
                ${header('bun',      'biomarker.urea')}
                ${header('score',    'history.score')}
                ${header('cat',      'history.category', false)}
                <th></th>
              </tr></thead>
              <tbody>
                ${sorted.length === 0
                  ? `<tr><td colspan="8" class="muted">${RAi18n.t('common.noData')}</td></tr>`
                  : sorted.map(rowHTML).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;

      // Bind sort headers
      document.querySelectorAll('[data-sort]').forEach(h => {
        h.addEventListener('click', () => {
          const k = h.dataset.sort;
          if (sortKey === k){
            sortDir = sortDir === 'asc' ? 'desc' : 'asc';
          } else {
            sortKey = k;
            sortDir = (k === 'date' || k === 'score') ? 'desc' : 'asc';
          }
          renderInto(rows);
        });
      });

      // Bind category toggles
      document.querySelectorAll('[data-cat-toggle]').forEach(b => {
        b.addEventListener('click', () => {
          const c = b.dataset.catToggle;
          if (catFilter.has(c)) catFilter.delete(c); else catFilter.add(c);
          if (catFilter.size === 0){
            // disallow empty filter — restore all
            ['NORMAL','AT_RISK','CRITICAL'].forEach(x => catFilter.add(x));
          }
          renderInto(rows);
        });
      });

      // Bind date filter
      document.getElementById('hist-date-filter').addEventListener('change', (e) => {
        dateFilter = e.target.value;
        renderInto(rows);
      });

      // Bind drill-in
      document.querySelectorAll('[data-drill]').forEach(tr => {
        tr.addEventListener('click', (e) => {
          if (e.target.closest('[data-row-action]')) return;  // ignore button clicks
          window._raAnalysisId = tr.dataset.drill;
          RANavigate('analysis');
        });
      });

      // Bind per-row export
      document.querySelectorAll('[data-export]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          btn.disabled = true; const orig = btn.textContent; btn.textContent = '⏳';
          try { await RAExport.exportAnalysis(btn.dataset.export); }
          catch(err){ RAToast('Export failed: ' + err.message, 'err'); }
          finally   { btn.disabled = false; btn.textContent = orig; }
        });
      });

      // Bind export-all
      const exportAllBtn = document.getElementById('hist-export-all');
      if (exportAllBtn){
        exportAllBtn.addEventListener('click', async () => {
          exportAllBtn.disabled = true;
          const orig = exportAllBtn.textContent;
          exportAllBtn.textContent = '⏳ Generating…';
          try { await RAExport.exportAllHistory(); RAToast('History exported', 'ok'); }
          catch(err){ RAToast('Export failed: ' + err.message, 'err', 5000); }
          finally   { exportAllBtn.disabled = false; exportAllBtn.textContent = orig; }
        });
      }
    }

    function header(key, labelKey, sortable=true){
      if (!sortable) return `<th>${RAi18n.t(labelKey)}</th>`;
      const arrow = sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';
      return `<th data-sort="${key}" style="cursor:pointer;user-select:none">${RAi18n.t(labelKey)}${arrow}</th>`;
    }

    function rowHTML(r){
      const cls = r.riskCategory === 'CRITICAL' ? 'text-red'
                : r.riskCategory === 'AT_RISK'  ? 'text-amber'
                : 'text-green';
      const catBadge = r.riskCategory === 'CRITICAL' ? 'badge-critical'
                     : r.riskCategory === 'AT_RISK'  ? 'badge-risk'
                     : 'badge-normal';
      return `
        <tr data-drill="${r.id}" style="cursor:pointer">
          <td>${new Date(r.analyzedAt).toLocaleDateString()}</td>
          <td>${escapeHtml(r._report?.lab || '—')}</td>
          <td class="text-mono">${r._bio?.creatinine?.toFixed(2) ?? '—'}</td>
          <td class="text-mono">${r._bio?.egfr?.toFixed(1) ?? '—'}</td>
          <td class="text-mono">${r._bio?.urea ?? '—'}</td>
          <td class="text-mono ${cls}">${r.riskScore}</td>
          <td><span class="badge ${catBadge}">${RAi18n.t('risk.'+r.riskCategory)}</span></td>
          <td style="text-align:end">
            <button class="btn btn-secondary btn-sm" data-row-action data-export="${r.id}" title="${RAi18n.t('analysis.exportPdf')}">⇩</button>
          </td>
        </tr>`;
    }
  };

  /* --------------------- filter / sort --------------------- */

  function applyFilters(rows){
    const f = FILTERS.find(x => x.key === dateFilter) || FILTERS[0];
    const cutoff = Number.isFinite(f.months)
      ? Date.now() - f.months * 30.4375 * 86400000
      : -Infinity;
    return rows.filter(r =>
      catFilter.has(r.riskCategory) &&
      new Date(r.analyzedAt).getTime() >= cutoff
    );
  }

  function applySort(rows){
    const dirMul = sortDir === 'asc' ? 1 : -1;
    const get = {
      date:  r => new Date(r.analyzedAt).getTime(),
      lab:   r => (r._report?.lab || '').toLowerCase(),
      cr:    r => r._bio?.creatinine ?? -1,
      egfr:  r => r._bio?.egfr ?? -1,
      bun:   r => r._bio?.urea ?? -1,
      score: r => r.riskScore ?? -1,
      cat:   r => r.riskCategory || '',
    };
    return [...rows].sort((a, b) => {
      const va = get[sortKey](a), vb = get[sortKey](b);
      if (va < vb) return -1 * dirMul;
      if (va > vb) return  1 * dirMul;
      return 0;
    });
  }

  function escapeHtml(s){
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
})();
