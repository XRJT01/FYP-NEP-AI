/* doctors.js — Phase 4A
 * ------------------------------------------------------------------
 * Tabbed Doctor Portal:
 *   • "My Sharing"  — patient view: share form + my doctors + incoming notes
 *   • "Inbox"       — doctor impersonation: pick a registered doctor and
 *                     review the reports patients have shared with them.
 *
 * All persistence runs through RAShare; no direct RAStorage CRUD here. */
(() => {
  window.RAPages = window.RAPages || {};

  let activeTab    = 'patient';
  let actingDoctor = null;   // for the inbox tab

  RAPages.doctors = async function(){
    const root = document.getElementById('page-doctors');
    root.innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">${RAi18n.t('doctors.title')}</div>
          <div class="page-sub">${RAi18n.t('doctors.subtitle')}</div>
        </div>
        <div class="tab-bar" role="tablist">
          <button class="tab ${activeTab==='patient'?'active':''}" data-tab="patient" role="tab" aria-selected="${activeTab==='patient'}">${RAi18n.t('doctors.tabPatient')}</button>
          <button class="tab ${activeTab==='doctor'?'active':''}"  data-tab="doctor"  role="tab" aria-selected="${activeTab==='doctor'}">${RAi18n.t('doctors.tabDoctor')}</button>
        </div>
      </div>
      <div id="doctors-body"></div>
    `;
    root.querySelectorAll('[data-tab]').forEach(b => {
      b.addEventListener('click', () => { activeTab = b.dataset.tab; RAPages.doctors(); });
    });
    if (activeTab === 'patient') await renderPatientTab();
    else                          await renderDoctorTab();
  };

  /* ---------------------------------------------------------------- */
  /* PATIENT TAB                                                      */
  /* ---------------------------------------------------------------- */

  async function renderPatientTab(){
    const u = await RAStorage.currentUser();
    const [analyses, doctorRows, notes, allShares] = await Promise.all([
      RAStorage.listAnalyses({ userId: u.id }),
      RAShare.listMyDoctors(),
      RAShare.listIncomingNotes(),
      RAStorage.listShares({ patientId: u.id }),
    ]);
    analyses.sort((a,b) => new Date(b.analyzedAt) - new Date(a.analyzedAt));
    const reports = await Promise.all(analyses.map(a => RAStorage.getReport(a.reportId)));
    const activeShareCount = allShares.filter(s => s.status !== 'REVOKED').length;

    document.getElementById('doctors-body').innerHTML = `
      <div class="grid-2">
        <div>
          <div class="card mb-12" id="share-card">
            <div class="flex-between mb-12">
              <div class="section-title" style="margin:0">${RAi18n.t('doctors.shareReport')}</div>
              <span class="badge badge-muted">${RAi18n.t('doctors.limitNotice', { used: activeShareCount, max: RAShare.MAX_ACTIVE_SHARES_PER_PATIENT })}</span>
            </div>
            <div class="form-group">
              <label class="form-label">${RAi18n.t('doctors.doctorId')}</label>
              <input type="text" id="share-doctor-id" placeholder="${RAi18n.t('doctors.doctorIdHint')}" autocomplete="off" list="doctor-id-list">
              <datalist id="doctor-id-list">
                ${(await RAStorage.listDoctors()).map(d => `<option value="${d.doctorId}">${d.name}</option>`).join('')}
              </datalist>
            </div>
            <div class="form-group">
              <label class="form-label">${RAi18n.t('doctors.selectReport')}</label>
              <select id="share-report-id">
                ${analyses.map((a, i) => `
                  <option value="${a.reportId}">${new Date(a.analyzedAt).toLocaleDateString()} — ${RAi18n.t('history.score')} ${a.riskScore} (${RAi18n.t('risk.'+a.riskCategory)})${reports[i]?.lab ? ' · ' + reports[i].lab : ''}</option>
                `).join('') || `<option disabled>${RAi18n.t('common.noData')}</option>`}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">${RAi18n.t('doctors.message')}</label>
              <textarea id="share-message" rows="2" placeholder="${RAi18n.t('doctors.messageHint')}"></textarea>
            </div>
            <button class="btn btn-primary w-full" id="share-submit" ${analyses.length===0?'disabled':''}>${RAi18n.t('doctors.shareBtn')}</button>
            <div id="share-error" class="text-red mt-8" style="font-size:12px;display:none"></div>
          </div>

          <div class="card">
            <div class="section-title mb-12">${RAi18n.t('doctors.myDoctors')}</div>
            ${doctorRows.length === 0
              ? `<div class="muted">${RAi18n.t('doctors.noShares')}</div>`
              : doctorRows.map(row => doctorRowHTML(row, reports, analyses)).join('')
            }
          </div>
        </div>

        <div class="card">
          <div class="flex-between mb-12">
            <div class="section-title" style="margin:0">${RAi18n.t('doctors.clinicalNotes')}</div>
            ${notes.length ? `<span class="badge badge-info">${RAi18n.t('doctors.noteCount', { n: notes.length })}</span>` : ''}
          </div>
          ${notes.length === 0
            ? `<div class="muted">${RAi18n.t('doctors.noNotes')}</div>`
            : notes.map(n => noteCardHTML(n)).join('')
          }
        </div>
      </div>
    `;

    // Bind share form
    document.getElementById('share-submit').onclick = async () => {
      const errEl = document.getElementById('share-error');
      errEl.style.display = 'none';
      try {
        const share = await RAShare.shareWithDoctor({
          reportId: document.getElementById('share-report-id').value,
          doctorIdInput: document.getElementById('share-doctor-id').value.trim(),
          message: document.getElementById('share-message').value.trim(),
        });
        const docRec = (await RAStorage.listDoctors()).find(d => d.id === share.doctorId);
        RAToast(RAi18n.t('doctors.shareSuccess', { doctor: docRec?.name || 'doctor' }), 'ok');
        renderPatientTab();
      } catch (e){
        errEl.textContent = e.message;
        errEl.style.display = 'block';
      }
    };

    // Bind revoke buttons
    document.querySelectorAll('[data-revoke]').forEach(btn => {
      btn.onclick = async () => {
        const ok = await RAModal({
          title: RAi18n.t('doctors.revoke'),
          body: RAi18n.t('doctors.revokeConfirm'),
          danger: true,
          confirmLabel: RAi18n.t('doctors.revoke'),
        });
        if (!ok) return;
        await RAShare.revokeShare(btn.dataset.revoke);
        RAToast(RAi18n.t('doctors.revoked'), 'ok');
        renderPatientTab();
      };
    });
  }

  function doctorRowHTML(row, reports, analyses){
    const initials = row.doctor.name.split(' ').slice(1,3).map(p => p[0]).join('').toUpperCase();
    const badgeCls = row.status === 'REVIEWED' ? 'badge-normal' : row.status === 'PENDING' ? 'badge-info' : 'badge-muted';
    const badgeTxt = RAi18n.t('doctors.' + row.status.toLowerCase()) || row.status;
    return `
      <div class="doctor-card">
        <div class="doctor-avatar">${initials}</div>
        <div class="doctor-info">
          <div class="doctor-name">${row.doctor.name}</div>
          <div class="doctor-spec">${row.doctor.specialty} · ${row.doctor.doctorId}</div>
          <div class="muted" style="font-size:11px;margin-top:2px">
            ${row.shares.length} share(s) · ${row.activeCount} active
            ${row.latest ? ` · ${RAi18n.t('doctors.shareCreated', { when: new Date(row.latest.createdAt).toLocaleDateString() })}` : ''}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;align-items:end">
          <span class="badge ${badgeCls}">${badgeTxt}</span>
          ${row.latest && row.latest.status !== 'REVOKED'
            ? `<button class="btn btn-secondary btn-sm" data-revoke="${row.latest.id}" style="font-size:11px">${RAi18n.t('doctors.revoke')}</button>`
            : ''}
        </div>
      </div>`;
  }

  function noteCardHTML({ note, share, doctor }){
    const urgent = note.isUrgent;
    const meta = [
      doctor?.name || 'Doctor',
      doctor?.specialty || '',
      new Date(note.createdAt).toLocaleDateString(),
      urgent ? RAi18n.t('doctors.urgent') : RAi18n.t('doctors.routine'),
    ].filter(Boolean).join(' · ');
    const shareDate = new Date(share.createdAt).toLocaleDateString();
    return `
      <div style="font-size:12px;color:var(--text3);margin-top:14px;margin-bottom:6px">${shareDate} · ${RAi18n.t('doctors.sharedBy')} ${RAi18n.t('settings.male')==='Male' ? 'you' : 'آپ'}</div>
      <div class="note-card ${urgent?'urgent':''}">
        <div class="note-text">${escapeHtml(note.text)}</div>
        <div class="note-meta">${escapeHtml(meta)}</div>
      </div>`;
  }

  /* ---------------------------------------------------------------- */
  /* DOCTOR INBOX TAB                                                 */
  /* ---------------------------------------------------------------- */

  async function renderDoctorTab(){
    const doctors = await RAStorage.listDoctors();
    if (!actingDoctor) actingDoctor = doctors[0]?.id || null;
    const inbox = actingDoctor ? await RAShare.listInboxFor(actingDoctor) : [];

    document.getElementById('doctors-body').innerHTML = `
      <div class="card mb-12">
        <div class="flex-between">
          <div>
            <div class="section-title" style="margin:0;margin-bottom:4px">${RAi18n.t('doctors.viewAs')}</div>
            <div class="muted" style="font-size:11px">Prototype impersonation — pick a registered doctor to see their inbox.</div>
          </div>
          <select id="acting-doctor" style="width:auto;min-width:240px">
            ${doctors.map(d => `<option value="${d.id}" ${d.id===actingDoctor?'selected':''}>${d.name} · ${d.doctorId}</option>`).join('')}
          </select>
        </div>
      </div>

      ${inbox.length === 0
        ? `<div class="card muted">${RAi18n.t('doctors.noInbox')}</div>`
        : inbox.map(row => inboxRowHTML(row)).join('')
      }
    `;

    document.getElementById('acting-doctor').addEventListener('change', (e) => {
      actingDoctor = e.target.value;
      renderDoctorTab();
    });

    // Bind add-note buttons
    document.querySelectorAll('[data-add-note]').forEach(btn => {
      btn.onclick = async () => {
        const card = btn.closest('[data-share-id]');
        const text = card.querySelector('textarea').value;
        const isUrgent = card.querySelector('input[type=checkbox]').checked;
        try {
          await RAShare.addClinicalNote({
            shareId: card.dataset.shareId,
            text, isUrgent, doctorId: actingDoctor,
          });
          RAToast(RAi18n.t('doctors.noteAdded'), 'ok');
          renderDoctorTab();
        } catch (e){
          RAToast(e.message, 'err');
        }
      };
    });
  }

  function inboxRowHTML({ share, bundle, notes, patient }){
    const cat = bundle.analysis?.riskCategory || 'NORMAL';
    const score = bundle.analysis?.riskScore ?? '—';
    const catCls = cat === 'CRITICAL' ? 'badge-critical' : cat === 'AT_RISK' ? 'badge-risk' : 'badge-normal';
    const bio = bundle.biomarkers || {};
    return `
      <div class="card mb-12" data-share-id="${share.id}">
        <div class="flex-between mb-12">
          <div>
            <div class="section-title" style="margin:0">${RAi18n.t('doctors.patient')}: ${escapeHtml(patient?.name || 'Unknown')}</div>
            <div class="muted" style="font-size:12px">${RAi18n.t('doctors.shareCreated', { when: new Date(share.createdAt).toLocaleDateString() })}${share.message ? ' · "' + escapeHtml(share.message) + '"' : ''}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <span class="badge ${catCls}">${RAi18n.t('risk.'+cat)} · ${score}</span>
            <button class="btn btn-secondary btn-sm" onclick="RANavigate('analysis')">${RAi18n.t('doctors.openReport')}</button>
          </div>
        </div>

        <div class="grid-3" style="margin-bottom:12px">
          <div class="card-sm"><div class="metric-label">${RAi18n.t('biomarker.creatinine')}</div><div class="metric-val">${fmt(bio.creatinine,2)} <span style="font-size:12px;color:var(--text3)">mg/dL</span></div></div>
          <div class="card-sm"><div class="metric-label">${RAi18n.t('biomarker.egfr')}</div><div class="metric-val">${fmt(bio.egfr,1)} <span style="font-size:12px;color:var(--text3)">mL/min</span></div></div>
          <div class="card-sm"><div class="metric-label">${RAi18n.t('biomarker.urea')}</div><div class="metric-val">${fmt(bio.urea,0)} <span style="font-size:12px;color:var(--text3)">mg/dL</span></div></div>
        </div>

        ${notes.length ? `
          <div class="section-title mb-12">${RAi18n.t('doctors.clinicalNotes')}</div>
          ${notes.map(n => `
            <div class="note-card ${n.isUrgent?'urgent':''}" style="margin-top:0;margin-bottom:8px">
              <div class="note-text">${escapeHtml(n.text)}</div>
              <div class="note-meta">${new Date(n.createdAt).toLocaleString()} · ${n.isUrgent ? RAi18n.t('doctors.urgent') : RAi18n.t('doctors.routine')}</div>
            </div>`).join('')}
        ` : ''}

        <div class="form-group" style="margin-top:12px;margin-bottom:8px">
          <label class="form-label">${RAi18n.t('doctors.noteText')}</label>
          <textarea rows="2" placeholder="..."></textarea>
        </div>
        <div class="flex-between">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text2);cursor:pointer">
            <input type="checkbox"> ${RAi18n.t('doctors.markUrgent')}
          </label>
          <button class="btn btn-primary btn-sm" data-add-note>${RAi18n.t('doctors.addNote')}</button>
        </div>
      </div>`;
  }

  /* ---------------------------------------------------------------- */
  function fmt(v, d){ return Number.isFinite(v) ? v.toFixed(d) : '—'; }
  function escapeHtml(s){ return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
})();
