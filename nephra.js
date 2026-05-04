/* nephra.js (page) — Phase 6
 * ------------------------------------------------------------------
 * Tube-scanner UI:
 *   • Live camera with a centred alignment ring
 *   • OR upload a tube photo (drag/drop / file picker)
 *   • Captured image → centre-region pixel sample → creatinine estimate
 *   • "Save as Analysis" persists a report+biomarkers+analysis record
 *     so the result lands in dashboard, trends, history, and PDF export.
 * ------------------------------------------------------------------ */
(() => {
  window.RAPages = window.RAPages || {};

  let stream = null;
  let lastCanvas = null;       // canvas with the captured frame
  let lastResult = null;       // RANephra.inferCreatinine output
  let lastSample = null;       // RANephra.sampleRegion output
  let liveTimer = null;        // setInterval id for the live wavelength readout

  RAPages.nephra = function(){
    teardown();
    window._raPageCleanup = teardown;

    const root = document.getElementById('page-nephra');
    root.innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">${RAi18n.t('nephra.title')}</div>
          <div class="page-sub">${RAi18n.t('nephra.subtitle')}</div>
        </div>
      </div>

      <div class="grid-2 mb-12">
        <div class="card" id="capture-card">
          <div class="section-title mb-12">${RAi18n.t('nephra.capture')}</div>
          <div id="capture-stage">${dropzoneHTML()}</div>
          <input type="file" id="nephra-file" accept="image/jpeg,image/png">
        </div>

        <div class="card" id="result-card">
          <div class="section-title mb-12">${RAi18n.t('nephra.result')}</div>
          <div id="result-body" class="muted" style="padding:var(--s-6) 0;text-align:center;font-size:13px">
            ${RAi18n.t('nephra.resultPlaceholder')}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="section-title mb-12">${RAi18n.t('nephra.howItWorks')}</div>
        <div class="muted mb-12" style="font-size:12px;line-height:1.6">${RAi18n.t('nephra.howSub')}</div>
        ${bandTableHTML()}
        <div class="alert-banner alert-info" style="margin-top:var(--s-4)">
          <div class="alert-icon" style="color:var(--info)">ℹ</div>
          <div>
            <div class="alert-title">${RAi18n.t('nephra.disclaimerT')}</div>
            <div class="alert-sub">${RAi18n.t('nephra.disclaimerS')}</div>
          </div>
        </div>
      </div>
    `;
    bindStage();
  };

  /* ----------------------- HTML builders ----------------------- */

  function dropzoneHTML(){
    return `
      <div class="upload-zone" id="nephra-zone" tabindex="0" role="button">
        <div class="upload-icon">●</div>
        <div class="upload-title">${RAi18n.t('nephra.drop')}</div>
        <div class="upload-sub">${RAi18n.t('nephra.dropSub')}</div>
        <div class="mt-16" style="display:flex;gap:var(--s-2);justify-content:center">
          <button class="btn btn-primary btn-sm" type="button" id="open-cam">📷 ${RAi18n.t('nephra.openCamera')}</button>
          <button class="btn btn-secondary btn-sm" type="button" id="pick-file">${RAi18n.t('nephra.uploadPhoto')}</button>
        </div>
      </div>`;
  }

  function cameraHTML(){
    return `
      <div style="position:relative">
        <div class="flex-between mb-12">
          <div class="muted" style="font-size:12px">${RAi18n.t('nephra.alignTube')}</div>
          <button class="btn btn-secondary btn-sm" id="cam-cancel">${RAi18n.t('common.cancel')}</button>
        </div>
        <div style="position:relative;border-radius:var(--r-md);overflow:hidden;background:#000">
          <video id="nephra-video" autoplay playsinline style="width:100%;display:block;max-height:420px;object-fit:cover"></video>
          ${overlaySVG()}
          <div id="live-readout" style="
              position:absolute; left:var(--s-3); right:var(--s-3); bottom:var(--s-3);
              padding:var(--s-2) var(--s-3); border-radius:var(--r-md);
              background:rgba(12,12,14,0.78); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);
              border:1px solid rgba(255,255,255,0.08); pointer-events:none;
              display:flex; align-items:center; gap:var(--s-3); font-size:11px; color:var(--ink-2)">
            <span id="live-swatch" style="width:14px; height:14px; border-radius:50%; background:#222;
                 box-shadow:inset 0 0 0 1px rgba(255,255,255,0.12); flex-shrink:0"></span>
            <span class="text-mono" id="live-wl" style="color:var(--ink-1); font-weight:500">— nm</span>
            <span class="muted" style="opacity:0.5">·</span>
            <span class="text-mono" id="live-cr" style="color:var(--ink-2)">— mg/dL</span>
            <div style="flex:1; min-width:0; height:3px; background:rgba(255,255,255,0.08);
                 border-radius:var(--r-pill); overflow:hidden; margin-inline-start:var(--s-2); position:relative">
              <div id="live-bar" style="position:absolute; inset:0;
                   background:linear-gradient(to right, #f5e9c8 0%, #f3c585 20%, #e89a4b 40%, #c97232 60%, #9d3a22 80%, #6e1611 100%);
                   clip-path:inset(0 100% 0 0); transition:clip-path 200ms var(--ease-out)"></div>
            </div>
            <span id="live-band" class="badge badge-muted" style="font-size:10px">—</span>
          </div>
        </div>
        <button class="btn btn-primary w-full mt-16" id="cam-snap">📸 ${RAi18n.t('nephra.capture')}</button>
      </div>`;
  }

  function previewHTML(canvas){
    // Render the capture into the DOM for review
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    return `
      <div>
        <div class="flex-between mb-12">
          <div class="muted" style="font-size:12px">${RAi18n.t('nephra.captured')}</div>
          <button class="btn btn-secondary btn-sm" id="capture-reset">×</button>
        </div>
        <div style="position:relative;border-radius:var(--r-md);overflow:hidden;background:#000">
          <img src="${dataUrl}" style="width:100%;display:block"/>
          ${overlaySVG()}
        </div>
        <button class="btn btn-primary w-full mt-16" id="analyze-btn">${RAi18n.t('nephra.analyze')}</button>
      </div>`;
  }

  function overlaySVG(){
    // Centred ring + crosshair to guide alignment, sized to ~36% of the smaller dimension
    return `
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet"
           style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none">
        <defs>
          <mask id="hole">
            <rect width="100" height="100" fill="white"/>
            <circle cx="50" cy="50" r="18" fill="black"/>
          </mask>
        </defs>
        <rect width="100" height="100" fill="rgba(0,0,0,0.35)" mask="url(#hole)"/>
        <circle cx="50" cy="50" r="18" fill="none" stroke="rgba(236,233,226,0.9)" stroke-width="0.4" stroke-dasharray="2 1.5"/>
        <line x1="50" y1="46" x2="50" y2="54" stroke="rgba(236,233,226,0.5)" stroke-width="0.3"/>
        <line x1="46" y1="50" x2="54" y2="50" stroke="rgba(236,233,226,0.5)" stroke-width="0.3"/>
      </svg>`;
  }

  function bandTableHTML(){
    return `
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>${RAi18n.t('nephra.colorSeen')}</th>
            <th>${RAi18n.t('nephra.wavelength')}</th>
            <th>${RAi18n.t('nephra.crValue')}</th>
            <th>${RAi18n.t('nephra.interp')}</th>
          </tr></thead>
          <tbody>
            ${RANephra.BANDS.map(b => {
              const swatch = RANephra.SWATCHES[b.id] || '#888';
              const cls = b.riskCategory==='CRITICAL' ? 'badge-critical'
                        : b.riskCategory==='AT_RISK'  ? 'badge-risk'
                        : 'badge-normal';
              const [w0, w1] = b.wavelength;
              const wlText = b.id === 'CRITICAL' ? '> 560 nm' : `${w0}–${w1} nm`;
              const [cr0, cr1] = b.cr;
              const crText = b.id === 'CRITICAL' ? '> 5.0 mg/dL' : `${cr0}–${cr1} mg/dL`;
              return `<tr>
                <td>
                  <span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${swatch};vertical-align:middle;margin-inline-end:8px;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.12)"></span>${b.label}
                </td>
                <td class="text-mono" style="font-size:12px">${wlText}</td>
                <td class="text-mono" style="font-size:12px">${crText}</td>
                <td><span class="badge ${cls}">${RAi18n.t('nephra.band.'+b.id)}</span></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>

      <!-- Calibration strip: visual mapping from Jaffe color → creatinine,
           anchored to the FYP calibration data points. -->
      <div class="muted mt-16 mb-12" style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em">
        ${RAi18n.t('nephra.calibrationStrip')}
      </div>
      ${calibrationStripHTML()}`;
  }

  /** SVG color strip showing the Jaffe gradient from low → high creatinine,
   *  with calibration ticks at every 0.5 mg/dL across the working range. */
  function calibrationStripHTML(){
    const swatches = ['#f5e9c8','#f3c585','#e89a4b','#c97232','#9d3a22','#6e1611'];
    const stops = swatches.map((c, i) => `<stop offset="${(i / (swatches.length - 1) * 100).toFixed(0)}%" stop-color="${c}"/>`).join('');
    const ticks = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0];
    const tickXs = ticks.map(cr => {
      const wl = RANephra.wavelengthFromCreatinine(cr);
      const pct = Math.max(0, Math.min(100, ((wl - 470) / 130) * 100));
      return { cr, wl, pct };
    });
    const tickHtml = tickXs.map(t =>
      `<g transform="translate(${t.pct}, 0)">
         <line x1="0" y1="14" x2="0" y2="22" stroke="rgba(255,255,255,0.4)" stroke-width="0.4"/>
         <text x="0" y="32" text-anchor="middle" font-family="DM Mono" font-size="3" fill="#9c9ca5">${t.cr}</text>
       </g>`).join('');
    return `
      <svg viewBox="0 0 100 36" preserveAspectRatio="none" style="width:100%;height:88px;display:block;border-radius:var(--r-md);overflow:hidden">
        <defs>
          <linearGradient id="nephra-cal" x1="0" y1="0" x2="1" y2="0">${stops}</linearGradient>
        </defs>
        <rect x="0" y="0" width="100" height="14" fill="url(#nephra-cal)"/>
        ${tickHtml}
        <text x="0"   y="36" text-anchor="start" font-family="DM Mono" font-size="2.6" fill="#62626a">mg/dL</text>
        <text x="100" y="36" text-anchor="end"   font-family="DM Mono" font-size="2.6" fill="#62626a">→ 5.0+</text>
      </svg>`;
  }

  /* ----------------------- behaviour ----------------------- */

  function bindStage(){
    const zone   = document.getElementById('nephra-zone');
    const camBtn = document.getElementById('open-cam');
    const pickBtn= document.getElementById('pick-file');
    const input  = document.getElementById('nephra-file');
    if (!zone) return;

    zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('drag');
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    });
    pickBtn.onclick = (e) => { e.stopPropagation(); input.click(); };
    input.onchange  = (e) => { const f = e.target.files[0]; if (f) handleFile(f); };
    camBtn.onclick  = (e) => { e.stopPropagation(); openCamera(); };
  }

  async function openCamera(){
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
        audio: false,
      });
    } catch (err){
      RAToast(RAi18n.t('nephra.camDenied') + ': ' + err.message, 'err');
      return;
    }
    document.getElementById('capture-stage').innerHTML = cameraHTML();
    const video = document.getElementById('nephra-video');
    video.srcObject = stream;
    document.getElementById('cam-cancel').onclick = () => { teardown(); RAPages.nephra(); };
    document.getElementById('cam-snap').onclick   = () => snap(video);
    startLiveReadout(video);
  }

  /** Live wavelength readout — samples the centre region of the video
   *  at 5 Hz and updates the bar/swatch/labels overlaid on the viewfinder. */
  function startLiveReadout(video){
    stopLiveReadout();
    const wlEl    = document.getElementById('live-wl');
    const crEl    = document.getElementById('live-cr');
    const bandEl  = document.getElementById('live-band');
    const barEl   = document.getElementById('live-bar');
    const swatchEl= document.getElementById('live-swatch');

    liveTimer = setInterval(() => {
      const r = RANephra.liveSampleVideo(video, { radiusFrac: 0.14 });
      if (!r || !wlEl) return;
      const [R,G,B] = r.rgb;
      swatchEl.style.background = `rgb(${R},${G},${B})`;
      wlEl.textContent = `${r.wavelength.toFixed(0)} nm`;
      crEl.textContent = `${r.creatinine.toFixed(2)} mg/dL`;
      // bar fill: 470 nm → 0%, 600 nm → 100%
      const pct = Math.max(0, Math.min(100, ((r.wavelength - 470) / 130) * 100));
      barEl.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
      const bandCls = r.bandId === 'CRITICAL' || r.bandId === 'DEEP_ORANGE_RED' ? 'badge-critical'
                    : r.bandId === 'AT_RISK' || r.bandId === 'DARK_ORANGE'      ? 'badge-risk'
                    : 'badge-normal';
      bandEl.className = 'badge ' + bandCls;
      bandEl.textContent = RAi18n.t('nephra.band.' + r.bandId);
    }, 200);
  }
  function stopLiveReadout(){
    if (liveTimer){ clearInterval(liveTimer); liveTimer = null; }
  }

  function snap(video){
    const canvas = document.createElement('canvas');
    canvas.width  = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext('2d').drawImage(video, 0, 0);
    stopLiveReadout();
    teardown();   // close camera stream
    lastCanvas = canvas;
    document.getElementById('capture-stage').innerHTML = previewHTML(canvas);
    document.getElementById('capture-reset').onclick = () => { resetStage(); };
    document.getElementById('analyze-btn').onclick   = () => analyze();
  }

  async function handleFile(file){
    if (!/^image\/(jpeg|png)$/.test(file.type)){
      RAToast(RAi18n.t('upload.fileBadFormat'), 'err'); return;
    }
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const MAX = 1600;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      lastCanvas = canvas;
      document.getElementById('capture-stage').innerHTML = previewHTML(canvas);
      document.getElementById('capture-reset').onclick = () => { resetStage(); };
      document.getElementById('analyze-btn').onclick   = () => analyze();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function loadImage(src){
    return new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('Image decode failed'));
      i.src = src;
    });
  }

  function resetStage(){
    lastCanvas = null;
    lastResult = null;
    lastSample = null;
    document.getElementById('capture-stage').innerHTML = dropzoneHTML();
    document.getElementById('result-body').className = 'muted';
    document.getElementById('result-body').setAttribute('style', 'padding:var(--s-6) 0;text-align:center;font-size:13px');
    document.getElementById('result-body').textContent = RAi18n.t('nephra.resultPlaceholder');
    bindStage();
  }

  function analyze(){
    if (!lastCanvas) return;
    try {
      lastSample = RANephra.sampleRegion(lastCanvas, { radiusFrac: 0.16 });
    } catch (e){
      RAToast(e.message, 'err'); return;
    }
    lastResult = RANephra.inferCreatinine(lastSample);
    renderResult();
  }

  function renderResult(){
    const body = document.getElementById('result-body');
    body.removeAttribute('style');
    body.className = '';
    const r = lastResult;
    const s = lastSample;
    const [R, G, B] = s.rgb;
    const swatch = `rgb(${R},${G},${B})`;
    const cls = r.riskCategory === 'CRITICAL' ? 'badge-critical'
              : r.riskCategory === 'AT_RISK'  ? 'badge-risk'
              : 'badge-normal';
    body.innerHTML = `
      <div style="display:flex;align-items:center;gap:var(--s-4);margin-bottom:var(--s-4)">
        <div style="width:64px;height:64px;border-radius:var(--r-md);background:${swatch};box-shadow:inset 0 0 0 1px rgba(255,255,255,0.08);flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div class="metric-label">${RAi18n.t('nephra.detectedColor')}</div>
          <div style="font-size:14px;font-weight:500;color:var(--ink-1)">${r.label}</div>
          <div class="text-mono muted" style="font-size:11px;margin-top:2px">RGB ${R}, ${G}, ${B} · HSV ${s.hsv.h}°,${Math.round(s.hsv.s*100)}%,${Math.round(s.hsv.v*100)}%</div>
        </div>
      </div>

      <div class="info-row">
        <span class="info-key">${RAi18n.t('nephra.estWavelength')}</span>
        <span class="info-val text-mono">~${r.wavelength} nm</span>
      </div>
      <div class="info-row">
        <span class="info-key">${RAi18n.t('nephra.estCreatinine')}</span>
        <span class="info-val text-mono" style="font-size:18px">${r.creatinine.toFixed(2)} <span class="muted" style="font-size:11px;font-family:var(--font-body)">mg/dL</span></span>
      </div>
      <div class="info-row">
        <span class="info-key">${RAi18n.t('nephra.band')}</span>
        <span class="info-val"><span class="badge ${cls}">${RAi18n.t('nephra.band.'+r.band)}</span></span>
      </div>
      <div class="info-row">
        <span class="info-key">${RAi18n.t('nephra.confidence')}</span>
        <span class="info-val text-mono">${r.confidence}%</span>
      </div>

      <div class="muted mt-16" style="font-size:12px;line-height:1.6">${r.explanation}</div>

      <button class="btn btn-primary w-full mt-16" id="save-result">${RAi18n.t('nephra.saveAnalysis')}</button>
      <button class="btn btn-secondary w-full mt-8" id="rescan">${RAi18n.t('nephra.rescan')}</button>
    `;
    document.getElementById('save-result').onclick = saveAsAnalysis;
    document.getElementById('rescan').onclick = resetStage;
  }

  async function saveAsAnalysis(){
    const me = await RAStorage.currentUser();
    const r = lastResult;
    const reportRec = await RAStorage.addReport({
      userId: me.id,
      lab: 'Nephra Tube Scanner',
      fileName: `nephra-${Date.now()}.jpg`,
      mime: 'image/jpeg',
      size: 0,
      ocrStatus: 'COMPLETE',
      source: 'NEPHRA',
      nephra: { wavelength: r.wavelength, band: r.band, depth: lastSample.depth, rgb: lastSample.rgb },
    });
    const bio = await RAStorage.addBiomarkers({
      reportId: reportRec.id,
      creatinine: r.creatinine,
      ocrConfidence: r.confidence,
      manuallyCorrected: false,
      source: 'NEPHRA',
    });
    // Risk engine will auto-fill eGFR via CKD-EPI from creatinine + age + gender
    const scored = RARisk.score({
      creatinine: r.creatinine,
      age: me.age, gender: me.gender,
    });
    await RAStorage.addAnalysis({
      reportId: reportRec.id,
      userId: me.id,
      biomarkerId: bio.id,
      riskScore: scored.riskScore,
      riskCategory: scored.riskCategory,
      modelConfidence: scored.modelConfidence,
      analyzedAt: new Date().toISOString(),
    });
    await RAStorage.updateReport(reportRec.id, {
      uploadedAt: new Date().toISOString(),
      deletedAt:  new Date().toISOString(),
    });
    RAStorage.audit('NEPHRA_SCAN', 'analyses', null, {
      band: r.band, wavelength: r.wavelength, creatinine: r.creatinine, confidence: r.confidence,
    });
    RAToast(RAi18n.t('nephra.saved'), 'ok');
    await RARefreshQuota?.();
    setTimeout(() => RANavigate('analysis'), 600);
  }

  function teardown(){
    stopLiveReadout();
    if (stream){
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
  }
})();
