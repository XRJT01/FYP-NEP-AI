/* share.js — Phase 4A
 * ------------------------------------------------------------------
 * Sharing + clinical-note business logic. Pure orchestration on top
 * of RAStorage — UI lives in pages/doctors.js.
 *
 * Public API (window.RAShare):
 *   shareWithDoctor({ reportId, doctorIdInput, message })
 *      doctorIdInput:  user-facing ID like "DOC-2A8F-TK91"
 *      Throws { code, message } on validation failure.
 *      Returns the created share record.
 *   listMyDoctors()                     -> doctors that have ever received any share
 *   listIncomingNotes()                 -> notes attached to my shared reports
 *   listInboxFor(doctorInternalId)      -> reports shared *to* this doctor (active only)
 *   addClinicalNote({ shareId, text, isUrgent })
 *   revokeShare(shareId)
 *
 * Constants:
 *   MAX_ACTIVE_SHARES_PER_PATIENT = 3   (mirrors BR-02 in the FYP report)
 * ------------------------------------------------------------------ */
(() => {

  const MAX_ACTIVE = 3;

  const ERR = {
    NO_DOCTOR:      'NO_DOCTOR',
    NOT_VERIFIED:   'NOT_VERIFIED',
    NO_REPORT:      'NO_REPORT',
    DUPLICATE:      'DUPLICATE',
    LIMIT_REACHED:  'LIMIT_REACHED',
    NO_TEXT:        'NO_TEXT',
    NO_SHARE:       'NO_SHARE',
  };

  function err(code, message){ const e = new Error(message); e.code = code; return e; }

  async function findDoctorByPublicId(publicId){
    if (!publicId) return null;
    const target = String(publicId).trim().toUpperCase();
    const all = await RAStorage.listDoctors();
    return all.find(d => (d.doctorId || '').toUpperCase() === target) || null;
  }

  async function shareWithDoctor({ reportId, doctorIdInput, message='' }){
    const me = await RAStorage.currentUser();
    if (!me) throw err(ERR.NO_DOCTOR, 'Not authenticated');
    const doctor = await findDoctorByPublicId(doctorIdInput);
    if (!doctor) throw err(ERR.NO_DOCTOR,    RAi18n.t('doctors.shareNotFound'));
    if (!doctor.verified) throw err(ERR.NOT_VERIFIED, RAi18n.t('doctors.notVerified'));

    const report = await RAStorage.getReport(reportId);
    if (!report) throw err(ERR.NO_REPORT, RAi18n.t('doctors.reportMissing'));

    // Dedupe: existing active share to same doctor for same report
    const existing = await RAStorage.listShares({ patientId: me.id, doctorId: doctor.id });
    if (existing.some(s => s.reportId === reportId && s.status !== 'REVOKED')){
      throw err(ERR.DUPLICATE, RAi18n.t('doctors.alreadyShared'));
    }

    // 3-active-share cap
    const activeCount = (await RAStorage.listShares({ patientId: me.id }))
      .filter(s => s.status !== 'REVOKED').length;
    if (activeCount >= MAX_ACTIVE){
      throw err(ERR.LIMIT_REACHED, RAi18n.t('doctors.limitReached', { max: MAX_ACTIVE }));
    }

    return RAStorage.addShare({
      patientId: me.id, doctorId: doctor.id, reportId, message,
    });
  }

  async function listMyDoctors(){
    const me = await RAStorage.currentUser();
    const [shares, doctors] = await Promise.all([
      RAStorage.listShares({ patientId: me.id }),
      RAStorage.listDoctors(),
    ]);
    const byDocId = new Map(doctors.map(d => [d.id, d]));
    const doctorsTouched = new Map();
    for (const s of shares){
      const d = byDocId.get(s.doctorId);
      if (!d) continue;
      if (!doctorsTouched.has(d.id)){
        doctorsTouched.set(d.id, { doctor: d, shares: [] });
      }
      doctorsTouched.get(d.id).shares.push(s);
    }
    return Array.from(doctorsTouched.values()).map(({ doctor, shares }) => {
      // Sort newest first
      shares.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
      const active = shares.filter(s => s.status !== 'REVOKED');
      const status = active.length === 0
        ? 'REVOKED'
        : active.some(s => s.status === 'REVIEWED') ? 'REVIEWED' : 'PENDING';
      return { doctor, shares, latest: shares[0], activeCount: active.length, status };
    });
  }

  async function listIncomingNotes(){
    const me = await RAStorage.currentUser();
    const myShares = await RAStorage.listShares({ patientId: me.id });
    const doctors  = await RAStorage.listDoctors();
    const docMap   = new Map(doctors.map(d => [d.id, d]));
    const notes = [];
    for (const s of myShares){
      const ns = await RAStorage.listNotes(s.id);
      for (const n of ns){
        notes.push({ note: n, share: s, doctor: docMap.get(s.doctorId) });
      }
    }
    notes.sort((a,b) => new Date(b.note.createdAt) - new Date(a.note.createdAt));
    return notes;
  }

  async function listInboxFor(doctorInternalId){
    const shares = await RAStorage.listShares({ doctorId: doctorInternalId });
    const active = shares.filter(s => s.status !== 'REVOKED');
    const out = [];
    for (const s of active){
      const [bundle, notes] = await Promise.all([
        RAStorage.getReportBundle(s.reportId),
        RAStorage.listNotes(s.id),
      ]);
      const patient = await RAStorage.db.users.get(s.patientId);
      out.push({ share: s, bundle, notes, patient });
    }
    out.sort((a,b) => new Date(b.share.createdAt) - new Date(a.share.createdAt));
    return out;
  }

  async function addClinicalNote({ shareId, text, isUrgent=false, doctorId }){
    const share = await RAStorage.db.shares.get(shareId);
    if (!share || share.status === 'REVOKED') throw err(ERR.NO_SHARE, RAi18n.t('doctors.shareGone'));
    if (!text || !text.trim()) throw err(ERR.NO_TEXT, RAi18n.t('doctors.noteEmpty'));
    return RAStorage.addNote({
      shareId, doctorId: doctorId || share.doctorId,
      text: text.trim(), isUrgent: !!isUrgent,
    });
  }

  async function revokeShare(shareId){
    const share = await RAStorage.db.shares.get(shareId);
    if (!share) throw err(ERR.NO_SHARE, RAi18n.t('doctors.shareGone'));
    return RAStorage.revokeShare(shareId);
  }

  window.RAShare = {
    shareWithDoctor, listMyDoctors, listIncomingNotes, listInboxFor,
    addClinicalNote, revokeShare,
    MAX_ACTIVE_SHARES_PER_PATIENT: MAX_ACTIVE, ERR,
  };
})();
