/* settings.js — Phase 4C
 * ------------------------------------------------------------------
 * Five sections in a 2-column grid:
 *   1. Profile          — name / email / age / sex
 *   2. Language         — UI language (synced to i18n + user record)
 *   3. Privacy & Data   — info rows + Export / Wipe buttons
 *   4. Notifications    — three persisted toggles (per-user)
 *   5. Recent Activity  — audit-log viewer with action filter
 * ------------------------------------------------------------------ */
(() => {
  window.RAPages = window.RAPages || {};

  let auditFilter = 'ALL';

  RAPages.settings = async function(){
    const u = await RAStorage.currentUser();
    const notif = u.notifPrefs || { deterioration:true, doctorNotes:true, monthly:false };
    const audit = await RAStorage.listAudit({ limit: 200 });

    document.getElementById('page-settings').innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">${RAi18n.t('settings.title')}</div>
          <div class="page-sub">${RAi18n.t('settings.subtitle')}</div>
        </div>
      </div>

      <div class="grid-2 mb-12">
        ${renderProfileCard(u)}
        ${renderLanguageCard(u)}
      </div>

      <div class="grid-2 mb-12">
        ${renderPrivacyCard()}
        ${renderNotificationsCard(notif)}
      </div>

      <div class="card">
        ${renderAuditCard(audit)}
      </div>
    `;

    /* ---- Profile ---- */
    document.getElementById('save-profile').onclick = async () => {
      await RAStorage.updateUser({
        name:   document.getElementById('set-name').value,
        email:  document.getElementById('set-email').value,
        age:    +document.getElementById('set-age').value || null,
        gender: document.getElementById('set-sex').value,
      });
      RAToast(RAi18n.t('settings.saved'), 'ok');
      await window.RARefreshAvatar?.();   // refresh top-bar avatar (added below)
    };

    /* ---- Language ---- */
    document.getElementById('set-ui-lang').onchange = async (e) => {
      const lang = e.target.value;
      await RAStorage.updateUser({ languagePref: lang });
      RAi18n.setLang(lang);
      RAToast(RAi18n.t('settings.langSaved'), 'ok');
    };

    /* ---- Privacy ---- */
    document.getElementById('export-data').onclick = () => exportUserData(u);
    document.getElementById('wipe-all').onclick    = async () => {
      const ok = await RAModal({
        title: RAi18n.t('settings.deleteAccount'),
        body:  RAi18n.t('settings.deleteConfirm'),
        danger: true,
        confirmLabel: RAi18n.t('settings.deleteAccount'),
      });
      if (ok) await RAStorage.wipeAll();
    };

    /* ---- Notifications ---- */
    document.querySelectorAll('[data-notif]').forEach(input => {
      input.addEventListener('change', async () => {
        const key = input.dataset.notif;
        const next = { ...(u.notifPrefs || notif), [key]: input.checked };
        await RAStorage.updateUser({ notifPrefs: next });
        u.notifPrefs = next;
        RAToast(RAi18n.t('settings.notifSaved'), 'ok');
      });
    });

    /* ---- Audit filter ---- */
    document.getElementById('audit-filter').addEventListener('change', (e) => {
      auditFilter = e.target.value;
      RAPages.settings();   // re-render with new filter
    });
  };

  /* ----------------------- card builders ----------------------- */

  function renderProfileCard(u){
    return `
      <div class="card">
        <div class="section-title mb-12">${RAi18n.t('settings.profile')}</div>
        <div class="form-group">
          <label class="form-label">${RAi18n.t('settings.fullName')}</label>
          <input id="set-name" value="${escapeAttr(u.name || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">${RAi18n.t('settings.email')}</label>
          <input id="set-email" type="email" value="${escapeAttr(u.email || '')}">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">${RAi18n.t('settings.age')}</label>
            <input id="set-age" type="number" min="0" max="120" value="${u.age ?? ''}">
          </div>
          <div class="form-group">
            <label class="form-label">${RAi18n.t('settings.sex')}</label>
            <select id="set-sex">
              <option value="M" ${u.gender==='M'?'selected':''}>${RAi18n.t('settings.male')}</option>
              <option value="F" ${u.gender==='F'?'selected':''}>${RAi18n.t('settings.female')}</option>
            </select>
          </div>
        </div>
        <button class="btn btn-primary" id="save-profile">${RAi18n.t('common.save')}</button>
      </div>`;
  }

  function renderLanguageCard(u){
    const cur = u.languagePref || RAi18n.currentLang();
    return `
      <div class="card">
        <div class="section-title mb-12">${RAi18n.t('settings.language')}</div>
        <div class="form-group">
          <label class="form-label">${RAi18n.t('settings.uiLanguage')}</label>
          <select id="set-ui-lang">
            <option value="en" ${cur==='en'?'selected':''}>${RAi18n.t('settings.english')}</option>
            <option value="ur" ${cur==='ur'?'selected':''}>${RAi18n.t('settings.urdu')}</option>
          </select>
        </div>
        <div class="muted" style="font-size:11px;line-height:1.6">
          The interface flips to RTL automatically when Urdu is selected. PDF exports always include both languages regardless of this setting.
        </div>
      </div>`;
  }

  function renderPrivacyCard(){
    return `
      <div class="card">
        <div class="section-title mb-12">${RAi18n.t('settings.privacy')}</div>
        <div class="info-row"><span class="info-key">${RAi18n.t('settings.imageRetention')}</span><span class="info-val text-green">${RAi18n.t('settings.imageRetentionVal')}</span></div>
        <div class="info-row"><span class="info-key">${RAi18n.t('settings.piiExport')}</span><span class="info-val text-green">${RAi18n.t('settings.piiExportVal')}</span></div>
        <div class="info-row"><span class="info-key">${RAi18n.t('settings.encryption')}</span><span class="info-val">${RAi18n.t('settings.encryptionVal')}</span></div>
        <div class="info-row"><span class="info-key">${RAi18n.t('settings.audit')}</span><span class="info-val">${RAi18n.t('settings.auditEnabled')}</span></div>
        <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" id="export-data">⇩ ${RAi18n.t('settings.exportData')}</button>
          <button class="btn btn-danger btn-sm"    id="wipe-all">✕ ${RAi18n.t('settings.deleteAccount')}</button>
        </div>
      </div>`;
  }

  function renderNotificationsCard(n){
    const sw = (key, label, checked) => `
      <div class="info-row">
        <span class="info-key">${label}</span>
        <label class="switch" title="${label}">
          <input type="checkbox" data-notif="${key}" ${checked?'checked':''}>
          <span class="switch-slider"></span>
        </label>
      </div>`;
    return `
      <div class="card">
        <div class="section-title mb-12">${RAi18n.t('settings.notifications')}</div>
        ${sw('deterioration', RAi18n.t('settings.deteriorationAlerts'), !!n.deterioration)}
        ${sw('doctorNotes',   RAi18n.t('settings.doctorNotes'),         !!n.doctorNotes)}
        ${sw('monthly',       RAi18n.t('settings.monthlyReminder'),     !!n.monthly)}
        <div class="muted mt-16" style="font-size:11px">Toggles persist locally. In a deployed build these would gate Firebase Cloud Messaging and email triggers.</div>
      </div>`;
  }

  function renderAuditCard(audit){
    const filtered = auditFilter === 'ALL' ? audit : audit.filter(e => e.action === auditFilter);
    const distinctActions = Array.from(new Set(audit.map(e => e.action))).sort();

    const rows = filtered.length === 0
      ? `<tr><td colspan="3" class="muted">${RAi18n.t('settings.auditEmpty')}</td></tr>`
      : filtered.slice(0, 100).map(rowHTML).join('');

    return `
      <div class="flex-between mb-12">
        <div class="section-title" style="margin:0">${RAi18n.t('settings.auditViewer')}</div>
        <div style="display:flex;gap:8px;align-items:center">
          <span class="muted" style="font-size:11px">${RAi18n.t('settings.auditFilter')}:</span>
          <select id="audit-filter" style="width:auto;min-width:160px">
            <option value="ALL" ${auditFilter==='ALL'?'selected':''}>${RAi18n.t('settings.auditAll')}</option>
            ${distinctActions.map(a => `<option value="${a}" ${auditFilter===a?'selected':''}>${RAi18n.t('settings.auditAction.'+a)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>${RAi18n.t('settings.auditTimestamp')}</th>
            <th>Action</th>
            <th>${RAi18n.t('settings.auditMeta')}</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${filtered.length > 100 ? `<div class="muted mt-8" style="font-size:11px">Showing first 100 of ${filtered.length} matching entries.</div>` : ''}
    `;
  }

  function rowHTML(e){
    const when = new Date(e.ts);
    const meta = e.meta && Object.keys(e.meta).length
      ? Object.entries(e.meta).map(([k,v]) => `<code style="font-size:11px;color:var(--text3)">${escapeHtml(k)}=${escapeHtml(formatVal(v))}</code>`).join(' · ')
      : '<span class="muted" style="font-size:11px">—</span>';
    const actionLabel = RAi18n.t('settings.auditAction.'+e.action);
    return `
      <tr>
        <td class="text-mono" style="font-size:12px">${when.toLocaleDateString()} ${when.toLocaleTimeString()}</td>
        <td>${actionLabel}${e.entity ? ` <span class="muted" style="font-size:11px">(${e.entity})</span>` : ''}</td>
        <td>${meta}</td>
      </tr>`;
  }

  /* ----------------------- helpers ----------------------- */

  async function exportUserData(user){
    const [allReports, allBio, allAnalyses, allShares, allNotes, allAudit, doctors] = await Promise.all([
      RAStorage.listReports({ userId: user.id, limit: 10000 }),
      RAStorage.db.biomarkers.toArray(),
      RAStorage.listAnalyses({ userId: user.id }),
      RAStorage.listShares({ patientId: user.id }),
      Promise.all((await RAStorage.listShares({ patientId: user.id })).map(s => RAStorage.listNotes(s.id))),
      RAStorage.listAudit({ limit: 1000 }),
      RAStorage.listDoctors(),
    ]);
    const myBio = allBio.filter(b => allReports.some(r => r.id === b.reportId));
    const bundle = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      user: { ...user, _note: 'Exported from RenalAI prototype — anonymize before sharing' },
      reports: allReports,
      biomarkers: myBio,
      analyses: allAnalyses,
      shares: allShares,
      notes: allNotes.flat(),
      doctors,
      audit: allAudit,
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `RenalAI-export-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    RAStorage.audit('EXPORT_DATA', 'user', user.id, { records: allReports.length + allAnalyses.length + allShares.length });
    RAToast(RAi18n.t('settings.exported'), 'ok');
  }

  function formatVal(v){
    if (v == null) return '—';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }
  function escapeHtml(s){
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function escapeAttr(s){
    return String(s ?? '').replace(/"/g, '&quot;');
  }
})();
