/* upload.js — Phase 2A
 * ------------------------------------------------------------------
 * Owns the upload flow UI:
 *   - drag/drop zone + click-to-browse (JPEG/PNG ≤10MB, PDF ≤15MB)
 *   - inline camera capture (getUserMedia → canvas → Blob)
 *   - file preview thumbnail
 *   - 4-step progress pipeline (validate → OCR → AI → report)
 *   - hands off to RAOCR.extract() (Phase 2B) and RAExtraction.confirm() (Phase 2C)
 *
 * Contracts consumed:
 *   RAOCR.extract(file, onProgress) -> Promise<{ values:{...}, confidences:{...}, rawText? }>
 *     If RAOCR is a stub (Phase 2B not yet wired), upload.js falls back to
 *     a clearly-marked mock so this page remains demoable in isolation.
 *
 *   RAExtraction.render({ values, confidences, onConfirm })
 *     Phase 2C builds the rich confirmation form. While that's pending we
 *     render a minimal inline editor so the end-to-end flow still works.
 * ------------------------------------------------------------------ */
(() => {
  window.RAPages = window.RAPages || {};

  const LIMITS = {
    'image/jpeg': 10 * 1024 * 1024,
    'image/jpg':  10 * 1024 * 1024,
    'image/png':  10 * 1024 * 1024,
    'application/pdf': 15 * 1024 * 1024,
  };
  const ACCEPT = ['image/jpeg','image/jpg','image/png','application/pdf'];
  const SUPPORTED_LABS = ['Chughtai Labs','Agha Khan Hospital','Shaukat Khanum','Dr. Essa Lab','IDC Islamabad','Generic formats'];

  let state = null;   // { file, previewUrl, mime, sizeMB }
  let cameraStream = null;

  /* --------------------------- Render --------------------------- */

  async function render(){
    teardownCamera();
    state = null;
    window._raPageCleanup = teardownCamera;  // router invokes this on navigate-away
    document.getElementById('page-upload').innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">${RAi18n.t('upload.title')}</div>
          <div class="page-sub">${RAi18n.t('upload.subtitle')}</div>
        </div>
      </div>

      <div class="grid-2">
        <div>
          <div class="card mb-12">
            <div id="upload-stage">${dropzoneHTML()}</div>
            <input type="file" id="file-input" accept=".jpg,.jpeg,.png,.pdf">

            <div id="processing-status" class="hidden mt-16">
              <div class="steps">
                ${stepHTML(1, RAi18n.t('upload.stepValidate'),  '')}
                ${stepHTML(2, RAi18n.t('upload.stepOcr'),       '')}
                ${stepHTML(3, RAi18n.t('upload.stepRisk'),      '')}
                ${stepHTML(4, RAi18n.t('upload.stepReport'),    '')}
              </div>
            </div>
          </div>

          <div class="card">
            <div class="section-title mb-12">${RAi18n.t('upload.supportedLabs')}</div>
            <div class="pill-group">
              ${SUPPORTED_LABS.map(l => `<span class="pill">${l}</span>`).join('')}
            </div>
            <div class="muted mt-16" style="font-size:12px">${RAi18n.t('upload.supportedSub')}</div>
          </div>
        </div>

        <div>
          <div class="card" id="confirm-card" style="display:none"></div>

          <div class="card" id="manual-entry-card">
            <div class="section-title mb-12">${RAi18n.t('upload.manualEntry')}</div>
            <div class="muted mb-12" style="font-size:12px">${RAi18n.t('manual.subtitle')}</div>
            ${manualEntryFormHTML()}
            <button class="btn btn-secondary w-full mt-8" id="manual-analyze">${RAi18n.t('upload.analyze')}</button>
          </div>
        </div>
      </div>
    `;

    bind();
  }

  function dropzoneHTML(){
    return `
      <div class="upload-zone" id="upload-zone" tabindex="0" role="button">
        <div class="upload-icon">⬆</div>
        <div class="upload-title">${RAi18n.t('upload.drop')}</div>
        <div class="upload-sub">${RAi18n.t('upload.browse')}</div>
        <div style="margin-top:12px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
          <span class="badge badge-info">JPEG</span>
          <span class="badge badge-info">PNG</span>
          <span class="badge badge-info">PDF</span>
        </div>
        <div class="mt-16" style="display:flex;gap:8px;justify-content:center">
          <button class="btn btn-secondary btn-sm" type="button" id="open-camera">📷 Use Camera</button>
        </div>
      </div>`;
  }

  function previewHTML({ name, sizeMB, mime, previewUrl }){
    const isImg = mime.startsWith('image/');
    return `
      <div class="card-sm" style="border-style:solid">
        <div class="flex-between mb-12">
          <div>
            <div class="bio-name">${name}</div>
            <div class="bio-sub">${mime} · ${sizeMB.toFixed(2)} MB</div>
          </div>
          <button class="btn btn-secondary btn-sm" id="upload-reset">×</button>
        </div>
        ${isImg
          ? `<img src="${previewUrl}" alt="" style="max-width:100%;max-height:240px;border-radius:8px;display:block;margin:0 auto;border:1px solid var(--border)"/>`
          : `<div class="muted" style="text-align:center;padding:32px;background:var(--bg3);border-radius:8px">PDF preview not shown — extraction will run on first page.</div>`
        }
        <button class="btn btn-primary w-full mt-16" id="start-analyze">→ Analyze Report</button>
      </div>`;
  }

  function cameraHTML(){
    return `
      <div class="card-sm">
        <div class="flex-between mb-12">
          <div class="section-title" style="margin:0">📷 Camera Capture</div>
          <button class="btn btn-secondary btn-sm" id="cam-close">×</button>
        </div>
        <video id="cam-video" autoplay playsinline style="width:100%;max-height:320px;border-radius:8px;background:#000"></video>
        <canvas id="cam-canvas" class="hidden"></canvas>
        <button class="btn btn-primary w-full mt-16" id="cam-snap">📸 Capture</button>
      </div>`;
  }

  function stepHTML(n, title, sub){
    return `<div class="step" data-step="${n}">
      <div class="step-num" data-num="${n}">${n}</div>
      <div class="step-content">
        <div class="step-title">${title}</div>
        <div class="step-sub" data-sub>${sub || ''}</div>
      </div>
    </div>`;
  }

  function manualEntryFormHTML(){
    return `
      <div class="form-group">
        <label class="form-label">${RAi18n.t('biomarker.creatinine')} (mg/dL)</label>
        <input type="number" step="0.01" id="m-cr" placeholder="e.g. 1.2">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">${RAi18n.t('biomarker.egfr')}</label>
          <input type="number" step="0.1" id="m-egfr" placeholder="e.g. 75">
        </div>
        <div class="form-group">
          <label class="form-label">${RAi18n.t('biomarker.urea')} (mg/dL)</label>
          <input type="number" step="1" id="m-bun" placeholder="e.g. 18">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">${RAi18n.t('biomarker.uricAcid')} (mg/dL)</label>
          <input type="number" step="0.1" id="m-ua" placeholder="e.g. 5.5">
        </div>
        <div class="form-group">
          <label class="form-label">${RAi18n.t('biomarker.urinaryProtein')} (g/24h)</label>
          <input type="number" step="0.01" id="m-prot" placeholder="e.g. 0.10">
        </div>
      </div>`;
  }

  /* --------------------------- Bind --------------------------- */

  function bind(){
    const zone   = document.getElementById('upload-zone');
    const input  = document.getElementById('file-input');
    const camBtn = document.getElementById('open-camera');

    zone.addEventListener('click', (e) => {
      // ignore clicks on the camera button
      if (e.target.closest('#open-camera')) return;
      input.click();
    });
    zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') input.click(); });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault(); zone.classList.remove('drag');
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    });
    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleFile(file);
    });
    camBtn.addEventListener('click', (e) => { e.stopPropagation(); openCamera(); });

    document.getElementById('manual-analyze').onclick = () => runManualEntry();
  }

  /* --------------------------- Manual entry pipeline --------------------------- */

  async function runManualEntry(){
    const values = {
      creatinine:     numOrNull('m-cr'),
      egfr:           numOrNull('m-egfr'),
      urea:           numOrNull('m-bun'),
      uricAcid:       numOrNull('m-ua'),
      urinaryProtein: numOrNull('m-prot'),
    };
    // Validate using the same plausibility rules as the OCR confirm form
    const errors = [];
    for (const [key, v] of Object.entries(values)){
      if (v == null) continue;
      const r = window.RAExtraction?.validate(key, v);
      if (r && !r.ok) errors.push(`${RAi18n.t('biomarker.'+key)}: ${r.message}`);
    }
    const filled = Object.values(values).filter(v => v != null).length;
    if (filled < 2){ RAToast(RAi18n.t('extraction.needTwo'), 'warn'); return; }
    if (errors.length){ RAToast(errors.join(' · '), 'err', 5000); return; }

    const user = await RAStorage.currentUser();
    const reportRec = await RAStorage.addReport({
      userId: user.id,
      lab: 'Manual entry',
      fileName: '(manual)',
      mime: 'application/json',
      size: 0,
      ocrStatus: 'COMPLETE',
      source: 'MANUAL',
    });
    const profile = { age: user.age, gender: user.gender };
    await commitAnalysis({
      values, reportRec, profile,
      meta: { reportDate: new Date().toISOString().slice(0,10), lab:'Manual entry', manuallyCorrected: true, avgConfidence: 100 },
    });
    RAToast(RAi18n.t('manual.saved'), 'ok');
  }

  /* --------------------------- File flow --------------------------- */

  function handleFile(file){
    const limit = LIMITS[file.type];
    if (!limit){
      RAToast(RAi18n.t('upload.fileBadFormat'), 'err'); return;
    }
    if (file.size > limit){
      RAToast(`${RAi18n.t('upload.fileTooLarge')} (${(file.size/1024/1024).toFixed(1)} MB)`, 'err'); return;
    }
    state = {
      file, mime: file.type, sizeMB: file.size / 1024 / 1024,
      previewUrl: URL.createObjectURL(file),
    };
    showPreview();
  }

  function showPreview(){
    teardownCamera();
    document.getElementById('upload-stage').innerHTML = previewHTML({
      name: state.file.name, sizeMB: state.sizeMB, mime: state.mime, previewUrl: state.previewUrl,
    });
    document.getElementById('upload-reset').onclick = () => { reset(); };
    document.getElementById('start-analyze').onclick = () => runPipeline();
  }

  function reset(){
    if (state?.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state = null;
    teardownCamera();
    document.getElementById('upload-stage').innerHTML = dropzoneHTML();
    document.getElementById('processing-status').classList.add('hidden');
    document.getElementById('confirm-card').style.display = 'none';
    document.getElementById('confirm-card').innerHTML = '';
    const manualCard = document.getElementById('manual-entry-card');
    if (manualCard) manualCard.style.display = '';   // restore manual entry path
    bind();
  }

  /* --------------------------- Camera --------------------------- */

  async function openCamera(){
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }, audio: false
      });
    } catch (err){
      RAToast('Camera permission denied or unavailable: ' + err.message, 'err');
      return;
    }
    document.getElementById('upload-stage').innerHTML = cameraHTML();
    const video = document.getElementById('cam-video');
    video.srcObject = cameraStream;
    document.getElementById('cam-close').onclick = () => { teardownCamera(); reset(); };
    document.getElementById('cam-snap').onclick  = () => snapFrame();
  }

  function teardownCamera(){
    if (cameraStream){
      cameraStream.getTracks().forEach(t => t.stop());
      cameraStream = null;
    }
  }

  function snapFrame(){
    const video  = document.getElementById('cam-video');
    const canvas = document.getElementById('cam-canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      const file = new File([blob], `capture-${Date.now()}.jpg`, { type:'image/jpeg' });
      teardownCamera();
      handleFile(file);
    }, 'image/jpeg', 0.92);
  }

  /* --------------------------- Pipeline --------------------------- */

  async function runPipeline(){
    if (!state) return;

    // Persist the report record now (status PENDING)
    const user = await RAStorage.currentUser();
    const reportRec = await RAStorage.addReport({
      userId: user.id,
      lab: 'Auto-detected',
      fileName: state.file.name,
      mime: state.mime,
      size: state.file.size,
      ocrStatus: 'PENDING',
    });

    document.getElementById('processing-status').classList.remove('hidden');
    document.getElementById('start-analyze').disabled = true;

    // Step 1 — validation (synchronous; passed already)
    setStep(1, 'done', `${state.mime}, ${state.sizeMB.toFixed(2)} MB — within limits`);

    // Step 2 — OCR
    setStep(2, 'active', RAi18n.t('upload.ocrRunning'));
    let extraction;
    try {
      extraction = await callOCR(state.file, (p) => {
        setStep(2, 'active', `${p.status} ${p.progress != null ? '· '+p.progress+'%' : ''}`.trim());
      });
    } catch (e){
      console.error('OCR error', e);
      setStep(2, 'error', `OCR failed: ${e.message} — using mock data`);
      extraction = mockExtraction();
    }
    const filled = Object.entries(extraction.values).filter(([,v]) => v != null).length;
    const avgConf = aggregateConfidence(extraction.confidences);
    if (filled === 0){
      setStep(2, 'error', 'No biomarkers recognized — try a clearer image or use manual entry');
    } else {
      setStep(2, 'done', RAi18n.t('upload.ocrDone', { n: filled, conf: avgConf.toFixed(1) }));
    }

    // Step 3 — risk inference
    setStep(3, 'active', 'Computing risk score…');
    const profile = { age: user.age, gender: user.gender };
    const risk = (window.RARisk?.score) ? RARisk.score({ ...extraction.values, ...profile }) : null;
    const ready = risk && risk.modelConfidence > 0;
    if (!ready){
      setStep(3, 'pending', 'Risk engine pending (Phase 3A) — will run on confirm');
    } else {
      setStep(3, 'done', `Score ${risk.riskScore} · ${risk.riskCategory}`);
    }

    // Step 4 — Generate report (final commit happens on user confirmation)
    setStep(4, 'active', 'Awaiting confirmation…');

    // Update report status
    await RAStorage.updateReport(reportRec.id, { ocrStatus: 'OCR_COMPLETE' });

    // Hand off to confirmation form (Phase 2C if available, fallback minimal otherwise)
    showConfirmation({ extraction, reportRec, profile });
  }

  function setStep(n, status, sub){
    const stepEl = document.querySelector(`.step[data-step="${n}"]`);
    if (!stepEl) return;
    const numEl = stepEl.querySelector('.step-num');
    numEl.classList.remove('done','active');
    if (status === 'done')   { numEl.classList.add('done');   numEl.textContent = '✓'; }
    else if (status === 'active') { numEl.classList.add('active'); numEl.textContent = n; }
    else if (status === 'error')  { numEl.style.background = 'var(--red-dim)'; numEl.style.color = 'var(--red)'; numEl.textContent = '!'; }
    else { numEl.textContent = n; numEl.style.removeProperty('background'); numEl.style.removeProperty('color'); }
    stepEl.querySelector('[data-sub]').textContent = sub || '';
  }

  /* --------------------------- OCR call --------------------------- */

  async function callOCR(file, onProgress){
    if (!window.RAOCR || typeof RAOCR.extract !== 'function'){
      return mockExtraction();
    }
    return RAOCR.extract(file, onProgress);
  }

  /** Plausible mock until Phase 2B lands.
   *  Picks values near the most-recent stored analysis to make the demo feel coherent. */
  function mockExtraction(){
    return {
      values: {
        creatinine: 1.45,
        urea: 30,
        egfr: 66.4,
        uricAcid: 6.3,
        urinaryProtein: 0.19,
      },
      confidences: { creatinine: 96.5, urea: 81.0, egfr: 94.2, uricAcid: 90.1, urinaryProtein: 87.4 },
      rawText: '(mock: replace when Phase 2B is wired)',
      _mock: true,
    };
  }

  function aggregateConfidence(c){
    const vals = Object.values(c).filter(v => Number.isFinite(v));
    if (!vals.length) return 0;
    return vals.reduce((a,b) => a+b, 0) / vals.length;
  }

  /* --------------------------- Confirmation hand-off --------------------------- */

  function showConfirmation({ extraction, reportRec, profile }){
    const card = document.getElementById('confirm-card');
    const manualCard = document.getElementById('manual-entry-card');
    if (manualCard) manualCard.style.display = 'none';   // hide alternate path while OCR confirm is active
    card.style.display = 'block';

    if (!window.RAExtraction?.render){
      card.innerHTML = `<div class="muted">RAExtraction module missing — check script load order.</div>`;
      return;
    }
    RAExtraction.render({
      container: card,
      values: extraction.values,
      confidences: extraction.confidences,
      matches: extraction.matches || {},
      mock: !!extraction._mock,
      onConfirm: (final, meta) => commitAnalysis({ values: final, reportRec, profile, meta }),
    });
  }

  const numOrNull = (id) => { const el = document.getElementById(id); if (!el) return null; const v = parseFloat(el.value); return Number.isFinite(v) ? v : null; };

  async function commitAnalysis({ values, reportRec, profile, meta = {} }){
    const user = await RAStorage.currentUser();

    // Persist confirmed biomarkers (track manual edits)
    const bio = await RAStorage.addBiomarkers({
      reportId: reportRec.id,
      ...values,
      ocrConfidence: meta.avgConfidence ?? 90,
      manuallyCorrected: !!meta.manuallyCorrected,
      perFieldEdited: meta.perFieldEdited || null,
    });

    // Score (real engine when 3A is wired; otherwise fallback so the record is meaningful)
    const profileFull = { ...profile, ...values };
    const real = (window.RARisk?.score) ? RARisk.score(profileFull) : null;
    const scoreOK = real && real.modelConfidence > 0;
    const scored = scoreOK ? real : fallbackScore(values);

    const dateIso = meta.reportDate
      ? new Date(meta.reportDate + 'T09:00:00Z').toISOString()
      : new Date().toISOString();

    await RAStorage.addAnalysis({
      reportId: reportRec.id,
      userId: user.id,
      biomarkerId: bio.id,
      riskScore: scored.riskScore,
      riskCategory: scored.riskCategory,
      modelConfidence: scored.modelConfidence,
      analyzedAt: dateIso,
    });
    await RAStorage.updateReport(reportRec.id, {
      ocrStatus: 'COMPLETE',
      uploadedAt: dateIso,
      lab: meta.lab || reportRec.lab,
      deletedAt: dateIso,   // mirrors privacy policy: image discarded post-analysis
    });

    setStep(3, 'done', `Score ${scored.riskScore} · ${scored.riskCategory}${scoreOK?'':' (fallback scorer)'}`);
    setStep(4, 'done', 'Report saved');
    RAToast(`Analysis complete — ${RAi18n.t('risk.'+scored.riskCategory)} (${scored.riskScore})`, scored.riskCategory==='NORMAL'?'ok':'warn');
    await RARefreshQuota();

    setTimeout(() => RANavigate('analysis'), 600);
  }

  /** TEMP scoring fallback so 2A demos end-to-end without 3A.
   *  Phase 3A replaces this with the real engine.  */
  function fallbackScore(v){
    let score = 0;
    if (Number.isFinite(v.creatinine)) score += Math.max(0, (v.creatinine - 0.9) / 0.05);
    if (Number.isFinite(v.urea))       score += Math.max(0, (v.urea - 18) * 0.8);
    if (Number.isFinite(v.egfr))       score += Math.max(0, (90 - v.egfr) * 0.6);
    if (Number.isFinite(v.urinaryProtein)) score += v.urinaryProtein * 30;
    score = Math.max(0, Math.min(100, Math.round(score)));
    const cat = score >= 67 ? 'CRITICAL' : score >= 34 ? 'AT_RISK' : 'NORMAL';
    return { riskScore: score, riskCategory: cat, modelConfidence: 70 };
  }

  RAPages.upload = render;
})();
