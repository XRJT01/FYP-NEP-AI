/* storage.js — IndexedDB persistence layer (Dexie)
 * ------------------------------------------------------------------
 * Public API on window.RAStorage:
 *   init()                       -> bootstraps DB + seeds first-run
 *   currentUser()                -> the active user record (auto-created on first run)
 *   updateUser(patch)
 *   addReport(report)            -> {id, userId, fileName, mime, uploadedAt, ocrStatus}
 *   updateReport(id, patch)
 *   getReport(id)
 *   listReports({userId, from, to, limit, offset})
 *   addBiomarkers(biomarkers)    -> measurement record tied to a report
 *   addAnalysis(analysis)        -> risk result tied to a report+biomarkers
 *   listAnalyses({userId, from, to})
 *   addShare(share); listShares({patientId|doctorId, status}); revokeShare(id)
 *   addNote(note); listNotes(shareId)
 *   listDoctors()
 *   audit(action, entity, entityId, meta)
 *   wipeAll()
 * ------------------------------------------------------------------ */
(() => {
  const DB_NAME = 'renalai_v1';

  const db = new Dexie(DB_NAME);
  db.version(1).stores({
    users:          'id, email, role',
    reports:        'id, userId, uploadedAt, ocrStatus',
    biomarkers:     'id, reportId',
    analyses:       'id, reportId, userId, analyzedAt, riskCategory',
    shares:         'id, patientId, doctorId, reportId, status, createdAt',
    notes:          'id, shareId, doctorId, createdAt',
    doctors:        'id, name, specialty, verified',
    audit:          '++id, ts, actorId, action, entity, entityId',
    settings:       'key',
  });

  const uid = (prefix='') => prefix + crypto.randomUUID().slice(0,8);

  /** Trivial password hash for the prototype — just SHA-256 hex.
   *  In production this is bcrypt cost 12 server-side (see PRODUCTION_PLAN §17).
   *  Client-side hashing is NEVER a substitute for server-side hashing,
   *  it just keeps casual DevTools snooping at bay during the demo. */
  async function hashPassword(plain){
    const enc = new TextEncoder().encode(plain);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function ensureDoctors(){
    const docCount = await db.doctors.count();
    if (docCount > 0) return;
    const docs = [
      { id:'doc_tayyab', name:'Dr. Tayyab Khushnood', specialty:'Nephrologist — Lahore', verified:true, doctorId:'DOC-2A8F-TK91' },
      { id:'doc_sara',   name:'Dr. Sara Malik',       specialty:'General Physician — Lahore', verified:true, doctorId:'DOC-9B3C-SM47' },
      { id:'doc_ahmed',  name:'Dr. Ahmed Raza',       specialty:'Nephrologist — Karachi', verified:true, doctorId:'DOC-7E2D-AR18' },
    ];
    await db.doctors.bulkAdd(docs);
  }

  /** Original "ensureSeed" was a first-run autoload of demo data.
   *  Now it's gated behind explicit user choice via loginAsDemo() so a
   *  fresh signup gets a clean empty workspace, while "Try Demo" still
   *  lands on the rich seeded experience. */
  async function ensureSeed(){
    await ensureDoctors();   // doctors exist for everyone, demo or signup

    // Legacy: if there's an old single-user install with `currentUserId` already
    // pointing at a real user, leave it alone. Only auto-seed if storage is
    // pristine AND that legacy flag has been explicitly opted into (set by
    // loginAsDemo()).
    return;
  }

  /** Build the demo workspace (Sami + 7 historical reports + 2 shared) under
   *  a known user id; called only via auth.loginAsDemo(). Idempotent. */
  async function seedDemoWorkspace(){
    await ensureDoctors();
    const existing = await db.users.where('email').equals('sami@example.com').first();
    if (existing) return existing;

    const me = {
      id: uid('u_'),
      email: 'sami@example.com',
      passwordHash: await hashPassword('demo'),
      name: 'Muhammad Sami Afzal',
      role: 'PATIENT',
      age: 24,
      gender: 'M',
      languagePref: 'en',
      notifPrefs: { deterioration: true, doctorNotes: true, monthly: false },
      isDemoSeed: true,
      createdAt: new Date().toISOString(),
    };
    await db.users.add(me);

    const docs = [
      { id:'doc_tayyab', name:'Dr. Tayyab Khushnood', specialty:'Nephrologist — Lahore', verified:true, doctorId:'DOC-2A8F-TK91' },
      { id:'doc_sara',   name:'Dr. Sara Malik',       specialty:'General Physician — Lahore', verified:true, doctorId:'DOC-9B3C-SM47' },
      { id:'doc_ahmed',  name:'Dr. Ahmed Raza',       specialty:'Nephrologist — Karachi', verified:true, doctorId:'DOC-7E2D-AR18' },
    ];
    await db.doctors.bulkAdd(docs);

    // Seed historical reports + analyses (Oct 2025 → Apr 2026).
    // Scores are computed by the live risk engine when available so seeded
    // data and new uploads land on the same scale.
    const history = [
      { d:'2025-10-18', cr:1.08, bun:15, egfr:82.4, ua:5.4, prot:0.08, lab:'Chughtai Labs' },
      { d:'2025-11-12', cr:1.12, bun:17, egfr:79.5, ua:5.6, prot:0.09, lab:'Chughtai Labs' },
      { d:'2025-12-05', cr:1.18, bun:20, egfr:77.0, ua:5.8, prot:0.11, lab:'Dr. Essa Lab' },
      { d:'2026-01-10', cr:1.26, bun:22, egfr:74.3, ua:5.9, prot:0.13, lab:'Chughtai Labs' },
      { d:'2026-02-02', cr:1.31, bun:24, egfr:72.1, ua:6.0, prot:0.15, lab:'Agha Khan Lab' },
      { d:'2026-03-15', cr:1.38, bun:26, egfr:69.4, ua:6.1, prot:0.17, lab:'Chughtai Labs' },
      { d:'2026-04-27', cr:1.42, bun:29, egfr:67.8, ua:6.2, prot:0.18, lab:'Chughtai Labs' },
    ];
    // Demo shares + clinical notes keyed off specific report dates so the
    // Doctor Portal has content on first load.
    const seedSharesByDate = {
      '2026-04-27': {
        doctorId: 'doc_tayyab',
        message:  'Please review my creatinine trend over the past quarter.',
        sharedAt: '2026-04-27T15:00:00Z',
        note: {
          isUrgent: true,
          createdAt: '2026-04-28T11:30:00Z',
          text: 'The creatinine trend over the past quarter is clinically significant. I recommend a 24-hour urine creatinine clearance test and a renal ultrasound to rule out structural abnormality. Reduce dietary protein to <0.8 g/kg/day and ensure adequate hydration. Book a follow-up appointment in 2 weeks.',
        },
      },
      '2026-03-15': {
        doctorId: 'doc_sara',
        message:  '',
        sharedAt: '2026-03-16T09:00:00Z',
        note: {
          isUrgent: false,
          createdAt: '2026-03-18T14:20:00Z',
          text: 'Results show mild kidney stress but no immediate cause for alarm. Continue current medications, increase water intake, and reduce NSAIDs usage if possible. Retest in 30 days.',
        },
      },
    };

    const profile = { age: me.age, gender: me.gender };
    for (const r of history){
      const reportId = uid('r_');
      const bioId = uid('b_');
      const analysisId = uid('a_');
      const reportDate = new Date(r.d + 'T09:00:00Z').toISOString();
      const scored = window.RARisk?.score
        ? RARisk.score({ creatinine:r.cr, urea:r.bun, egfr:r.egfr, uricAcid:r.ua, urinaryProtein:r.prot, ...profile })
        : { riskScore: 0, riskCategory: 'NORMAL', modelConfidence: 0 };
      await db.reports.add({
        id: reportId, userId: me.id, lab: r.lab, fileName:'(seeded)', mime:'image/jpeg',
        uploadedAt: reportDate, ocrStatus: 'COMPLETE', deletedAt: reportDate,
      });
      await db.biomarkers.add({
        id: bioId, reportId,
        creatinine: r.cr, urea: r.bun, egfr: r.egfr, uricAcid: r.ua, urinaryProtein: r.prot,
        ocrConfidence: 95.0, manuallyCorrected: false,
      });
      await db.analyses.add({
        id: analysisId, reportId, userId: me.id, biomarkerId: bioId,
        riskScore: scored.riskScore, riskCategory: scored.riskCategory, modelConfidence: scored.modelConfidence,
        analyzedAt: reportDate,
      });

      const seedShare = seedSharesByDate[r.d];
      if (seedShare){
        const shareId = uid('s_');
        await db.shares.add({
          id: shareId, patientId: me.id, doctorId: seedShare.doctorId, reportId,
          message: seedShare.message, status: 'REVIEWED',
          createdAt: seedShare.sharedAt,
        });
        await db.notes.add({
          id: uid('n_'), shareId, doctorId: seedShare.doctorId,
          text: seedShare.note.text, isUrgent: seedShare.note.isUrgent,
          createdAt: seedShare.note.createdAt,
        });
      }
    }

    await db.audit.add({ ts:new Date().toISOString(), actorId: me.id, action:'SEED', entity:'system', entityId:null, meta:{ seeded: history.length } });
  }

  async function currentUser(){
    const ref = await db.settings.get('currentUserId');
    if (!ref) return null;
    return db.users.get(ref.value);
  }

  async function updateUser(patch){
    const u = await currentUser();
    if (!u) return null;
    await db.users.update(u.id, patch);
    return db.users.get(u.id);
  }

  /* --------------------- Auth flows --------------------- */

  async function signup({ email, password, name, age, gender }){
    if (!email || !password) throw new Error('Email and password are required');
    const norm = email.trim().toLowerCase();
    const existing = await db.users.where('email').equals(norm).first();
    if (existing) throw new Error('An account with this email already exists');
    const user = {
      id: uid('u_'),
      email: norm,
      passwordHash: await hashPassword(password),
      name: (name || '').trim() || norm.split('@')[0],
      role: 'PATIENT',
      age: Number.isFinite(+age) ? +age : null,
      gender: gender === 'F' ? 'F' : 'M',
      languagePref: 'en',
      notifPrefs: { deterioration: true, doctorNotes: true, monthly: false },
      createdAt: new Date().toISOString(),
    };
    await db.users.add(user);
    await ensureDoctors();
    await db.settings.put({ key:'currentUserId', value: user.id });
    await audit('SIGNUP', 'users', user.id, { email: norm });
    return user;
  }

  async function login({ email, password }){
    const norm = (email || '').trim().toLowerCase();
    const found = await db.users.where('email').equals(norm).first();
    if (!found) throw new Error('No account found for this email');
    const hash = await hashPassword(password || '');
    if (found.passwordHash !== hash) throw new Error('Incorrect password');
    await db.settings.put({ key:'currentUserId', value: found.id });
    await audit('LOGIN', 'users', found.id);
    return found;
  }

  async function loginAsDemo(){
    const me = await seedDemoWorkspace();
    await db.settings.put({ key:'currentUserId', value: me.id });
    await audit('LOGIN_DEMO', 'users', me.id);
    return me;
  }

  async function signOut(){
    const u = await currentUser();
    if (u) await audit('SIGNOUT', 'users', u.id);
    await db.settings.delete('currentUserId');
  }

  async function listAllUsers(){
    return db.users.toArray();
  }

  async function addReport(report){
    const id = uid('r_');
    const rec = {
      id, ocrStatus:'PENDING', uploadedAt:new Date().toISOString(),
      ...report,
    };
    await db.reports.add(rec);
    audit('UPLOAD_REPORT', 'reports', id, { mime: rec.mime, size: rec.size });
    return rec;
  }
  const updateReport = (id, patch) => db.reports.update(id, patch);
  const getReport    = (id) => db.reports.get(id);

  async function listReports({ userId, from, to, limit=100, offset=0 }={}){
    let coll = db.reports.orderBy('uploadedAt').reverse();
    if (userId) coll = coll.filter(r => r.userId === userId);
    if (from)   coll = coll.filter(r => r.uploadedAt >= from);
    if (to)     coll = coll.filter(r => r.uploadedAt <= to);
    return coll.offset(offset).limit(limit).toArray();
  }

  async function addBiomarkers(b){
    const id = uid('b_');
    const rec = { id, ...b };
    await db.biomarkers.add(rec);
    return rec;
  }

  async function addAnalysis(a){
    const id = uid('a_');
    const rec = { id, analyzedAt:new Date().toISOString(), ...a };
    await db.analyses.add(rec);
    audit('ANALYZE_REPORT', 'analyses', id, { riskCategory: rec.riskCategory, riskScore: rec.riskScore });
    return rec;
  }

  async function listAnalyses({ userId, from, to }={}){
    let coll = db.analyses.orderBy('analyzedAt');
    if (userId) coll = coll.filter(a => a.userId === userId);
    if (from)   coll = coll.filter(a => a.analyzedAt >= from);
    if (to)     coll = coll.filter(a => a.analyzedAt <= to);
    return coll.toArray();
  }

  async function getLatestAnalysis(userId){
    const all = await listAnalyses({ userId });
    return all[all.length - 1] || null;
  }

  async function getReportBundle(reportId){
    const [report, biomarkers, analysis] = await Promise.all([
      db.reports.get(reportId),
      db.biomarkers.where('reportId').equals(reportId).first(),
      db.analyses.where('reportId').equals(reportId).first(),
    ]);
    return { report, biomarkers, analysis };
  }

  /* Sharing */
  async function addShare(s){
    const id = uid('s_');
    const rec = { id, status:'PENDING', createdAt:new Date().toISOString(), ...s };
    await db.shares.add(rec);
    audit('SHARE_REPORT', 'shares', id, { doctorId: rec.doctorId, reportId: rec.reportId });
    return rec;
  }
  async function listShares({ patientId, doctorId, status }={}){
    let coll = db.shares.orderBy('createdAt').reverse();
    if (patientId) coll = coll.filter(s => s.patientId === patientId);
    if (doctorId)  coll = coll.filter(s => s.doctorId === doctorId);
    if (status)    coll = coll.filter(s => s.status === status);
    return coll.toArray();
  }
  async function revokeShare(id){
    await db.shares.update(id, { status:'REVOKED' });
    audit('REVOKE_SHARE', 'shares', id);
  }
  async function addNote(n){
    const id = uid('n_');
    const rec = { id, createdAt:new Date().toISOString(), ...n };
    await db.notes.add(rec);
    await db.shares.update(rec.shareId, { status:'REVIEWED' });
    audit('ADD_CLINICAL_NOTE', 'notes', id, { shareId: rec.shareId, urgent: !!rec.isUrgent });
    return rec;
  }
  const listNotes  = (shareId) => db.notes.where('shareId').equals(shareId).toArray();
  const listDoctors = () => db.doctors.toArray();

  /* Audit */
  async function audit(action, entity, entityId, meta={}){
    const u = await currentUser();
    return db.audit.add({
      ts:new Date().toISOString(),
      actorId: u ? u.id : null,
      action, entity, entityId, meta,
    });
  }
  const listAudit = ({ limit=200 }={}) => db.audit.orderBy('ts').reverse().limit(limit).toArray();

  async function wipeAll(){
    await db.delete();
    location.reload();
  }

  async function init(){
    await db.open();
    await ensureSeed();
    return currentUser();
  }

  window.RAStorage = {
    db, init, currentUser, updateUser,
    signup, login, loginAsDemo, signOut, listAllUsers,
    addReport, updateReport, getReport, listReports, getReportBundle,
    addBiomarkers, addAnalysis, listAnalyses, getLatestAnalysis,
    addShare, listShares, revokeShare, addNote, listNotes, listDoctors,
    audit, listAudit, wipeAll,
  };
})();
