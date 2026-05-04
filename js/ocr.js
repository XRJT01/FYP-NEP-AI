/* ocr.js — Phase 2B
 * ------------------------------------------------------------------
 * Tesseract.js wrapper for in-browser OCR + thin pdf.js shim for PDFs.
 *
 * Public API (window.RAOCR):
 *   init({ onProgress })    -> Promise<void>      lazy worker init
 *   extract(file, onProgress)
 *      file:        File | Blob (image/jpeg, image/png, application/pdf)
 *      onProgress:  optional ({phase, progress, status}) callback
 *      returns:     Promise<{ values, confidences, rawText, durationMs, words }>
 *      values/confidences come from RABiomarker.parseRawText() with the
 *      Tesseract output passed in for word-level confidence anchoring.
 *   terminate()             -> Promise<void>     dispose worker
 *
 * Notes:
 *   - Worker is created once on first extract() and cached for subsequent calls.
 *   - PDF: page 1 is rendered to a canvas via pdf.js before OCR.
 *   - Image preprocessing (canvas grayscale + light contrast bump) is applied to
 *     all raster inputs to improve recognition on phone photos.
 * ------------------------------------------------------------------ */
(() => {
  let worker = null;
  let initPromise = null;
  const PDF_RENDER_DPI = 200;   // sufficient for printed labs without huge files

  async function init({ onProgress } = {}){
    if (worker) return worker;
    if (initPromise) return initPromise;

    if (typeof Tesseract === 'undefined'){
      throw new Error('Tesseract.js not loaded');
    }

    onProgress?.({ phase:'init', progress:0, status:'Initializing OCR engine…' });

    initPromise = (async () => {
      const w = await Tesseract.createWorker('eng', 1, {
        logger: (m) => {
          // m: { status, progress }; progress is 0..1
          if (!onProgress) return;
          onProgress({ phase: m.status, progress: Math.round((m.progress || 0)*100), status: m.status });
        },
      });
      worker = w;
      return w;
    })();
    return initPromise;
  }

  async function extract(file, onProgress){
    const t0 = performance.now();
    if (!file) throw new Error('No file');
    const w = await init({ onProgress });

    onProgress?.({ phase:'preprocess', progress:5, status:'Preparing image…' });
    const canvas = await fileToCanvas(file, onProgress);

    // Light preprocessing: grayscale + threshold-ish contrast
    preprocess(canvas);

    onProgress?.({ phase:'recognize', progress:10, status:'Running OCR…' });
    const { data } = await w.recognize(canvas);
    // data: { text, confidence, words: [{text, confidence, bbox}], lines, blocks }

    onProgress?.({ phase:'extract', progress:90, status:'Extracting biomarkers…' });
    const parsed = window.RABiomarker.parseRawText(data.text, data.words || []);

    const durationMs = performance.now() - t0;
    onProgress?.({ phase:'done', progress:100, status:`Done in ${(durationMs/1000).toFixed(1)}s` });
    return {
      values: parsed.values,
      confidences: parsed.confidences,
      rawText: data.text,
      words: data.words,
      ocrConfidence: data.confidence,
      durationMs,
    };
  }

  async function terminate(){
    if (worker){
      try { await worker.terminate(); } catch(e){}
      worker = null; initPromise = null;
    }
  }

  /* -------------------- file → canvas -------------------- */

  async function fileToCanvas(file, onProgress){
    if (file.type === 'application/pdf') return pdfToCanvas(file, onProgress);
    return imageToCanvas(file);
  }

  async function imageToCanvas(file){
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      // Cap at ~2000px on the long side to keep OCR memory in check
      const MAX = 2000;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      return canvas;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function loadImage(src){
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Image decode failed'));
      img.src = src;
    });
  }

  async function pdfToCanvas(file, onProgress){
    if (typeof pdfjsLib === 'undefined') throw new Error('pdf.js not loaded');
    onProgress?.({ phase:'pdf', progress:5, status:'Reading PDF…' });
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: PDF_RENDER_DPI / 72 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width; canvas.height = viewport.height;
    onProgress?.({ phase:'pdf', progress:8, status:`Rendering page 1 (${pdf.numPages} total)…` });
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return canvas;
  }

  /* -------------------- preprocessing --------------------
   * Grayscale + light contrast — runs in-place on the canvas.
   * Skipped automatically on very small images. */
  function preprocess(canvas){
    if (canvas.width * canvas.height > 4_000_000) return;  // too large; skip to avoid jank
    const ctx = canvas.getContext('2d');
    let img;
    try { img = ctx.getImageData(0, 0, canvas.width, canvas.height); }
    catch(e){ return; }   // tainted (cross-origin) — bail
    const d = img.data;
    for (let i = 0; i < d.length; i += 4){
      // Rec.709 luma
      let g = 0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2];
      // Mild S-curve contrast bump
      g = g < 96 ? g*0.85 : g > 160 ? Math.min(255, g*1.1) : g;
      d[i] = d[i+1] = d[i+2] = g;
    }
    ctx.putImageData(img, 0, 0);
  }

  // Tear down on hard unload (best-effort)
  window.addEventListener('beforeunload', () => terminate());

  window.RAOCR = { init, extract, terminate };
})();
