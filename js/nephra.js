/* nephra.js — Nephra tube colorimetric engine
 * ------------------------------------------------------------------
 * Calibrated against the FYP creatinine-wavelength dataset
 * (0.5 mg/dL → 480.0 nm  …  4.0 mg/dL → 520.0 nm), with the band
 * table from the FYP spec used for risk classification.
 *
 * Public API (window.RANephra):
 *   sampleRegion(canvas, opts)        → { rgb, hsv, depth, samples, … }
 *   inferCreatinine({ rgb, depth, hsv }) → full result object
 *   creatinineFromWavelength(nm)      → mg/dL (linear interp + extrapolate)
 *   wavelengthFromCreatinine(cr)      → nm
 *   liveSampleVideo(video, opts)      → { rgb, depth, wavelength, creatinine }
 *                                       — single frame sample, used for the
 *                                       live wavelength bar in the viewfinder
 *   BANDS                              → public 6-band table for the UI
 * ------------------------------------------------------------------ */
(() => {

  /** 6-band classification — matches FYP spec table exactly. */
  const BANDS = [
    { id:'NORMAL_LIGHT',     wavelength:[470,490], cr:[0.4,0.8],   label:'Very light / clear',       riskCategory:'NORMAL'   },
    { id:'NORMAL',           wavelength:[490,510], cr:[0.9,1.3],   label:'Light yellow-orange',      riskCategory:'NORMAL'   },
    { id:'AT_RISK',          wavelength:[510,530], cr:[1.4,2.0],   label:'Medium orange',            riskCategory:'AT_RISK'  },
    { id:'DARK_ORANGE',      wavelength:[530,545], cr:[2.1,3.5],   label:'Dark orange',              riskCategory:'AT_RISK'  },
    { id:'DEEP_ORANGE_RED',  wavelength:[545,560], cr:[3.6,5.0],   label:'Deep orange-red',          riskCategory:'CRITICAL' },
    { id:'CRITICAL',         wavelength:[560,700], cr:[5.1,15.0],  label:'Very dark red',            riskCategory:'CRITICAL' },
  ];

  /** Sample swatches for the reference table — RGB tuples (no opacity). */
  const SWATCHES = {
    NORMAL_LIGHT:    '#f5e9c8',
    NORMAL:          '#f3c585',
    AT_RISK:         '#e89a4b',
    DARK_ORANGE:     '#c97232',
    DEEP_ORANGE_RED: '#9d3a22',
    CRITICAL:        '#6e1611',
  };

  /** FYP calibration: paired (creatinine mg/dL, wavelength nm) data.
   *  Linear, slope ≈ +11.43 nm per +1 mg/dL across the working range.
   *  Used directly for cr↔wavelength conversion via interpolation. */
  const CALIBRATION = [
    [0.5, 480.0], [0.6, 481.1], [0.7, 482.3], [0.8, 483.4], [0.9, 484.6],
    [1.0, 485.7], [1.1, 486.9], [1.2, 488.0], [1.3, 489.1], [1.4, 490.3],
    [1.5, 491.4], [1.6, 492.6], [1.7, 493.7], [1.8, 494.9], [1.9, 496.0],
    [2.0, 497.1], [2.1, 498.3], [2.2, 499.4], [2.3, 500.6], [2.4, 501.7],
    [2.5, 502.9], [2.6, 504.0], [2.7, 505.1], [2.8, 506.3], [2.9, 507.4],
    [3.0, 508.6], [3.1, 509.7], [3.2, 510.9], [3.3, 512.0], [3.4, 513.1],
    [3.5, 514.3], [3.6, 515.4], [3.7, 516.6], [3.8, 517.7], [3.9, 518.9],
    [4.0, 520.0],
  ];
  const CAL_SLOPE = (520.0 - 480.0) / (4.0 - 0.5);     // ≈ 11.4286 nm / mg·dL⁻¹
  const CAL_BASE_CR = 0.5, CAL_BASE_WL = 480.0;

  /** Convert creatinine → wavelength via the calibration line. Extrapolates
   *  monotonically below 0.5 and above 4.0 so the spec's full range maps
   *  smoothly even though the calibration set only spans 0.5–4.0 mg/dL. */
  function wavelengthFromCreatinine(cr){
    if (!Number.isFinite(cr)) return null;
    return +(CAL_BASE_WL + (cr - CAL_BASE_CR) * CAL_SLOPE).toFixed(1);
  }

  /** Inverse: wavelength → creatinine. Above 520 nm we leave the linear
   *  range and switch to the spec's wider per-band ranges, mapping the
   *  wavelength position within the band to a creatinine value within
   *  the band's stated cr range (so 545→3.5, 560→5.0, >560→>5.0). */
  function creatinineFromWavelength(wl){
    if (!Number.isFinite(wl)) return null;
    if (wl <= 520) {
      return +(CAL_BASE_CR + (wl - CAL_BASE_WL) / CAL_SLOPE).toFixed(2);
    }
    // Out of calibration range — interpolate within the appropriate band
    const band = BANDS.find(b => wl >= b.wavelength[0] && wl < b.wavelength[1]) || BANDS[BANDS.length - 1];
    const [w0, w1] = band.wavelength;
    const span = Math.max(1, w1 - w0);
    const t = Math.min(1, Math.max(0, (wl - w0) / span));
    const [cr0, cr1] = band.cr;
    return +(cr0 + t * (cr1 - cr0)).toFixed(2);
  }

  /** Sample a circular region in the centre of the canvas, return mean RGB,
   *  HSV, and a "color depth" metric calibrated against tube samples. */
  function sampleRegion(canvas, { radiusFrac = 0.18 } = {}){
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const cx = w / 2, cy = h / 2;
    const r  = Math.min(w, h) * radiusFrac;
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor(cx - r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const sw = Math.min(w - x0, Math.ceil(r * 2));
    const sh = Math.min(h - y0, Math.ceil(r * 2));

    let img;
    try { img = ctx.getImageData(x0, y0, sw, sh); }
    catch (e){ throw new Error('Could not read pixels (image may be cross-origin)'); }

    const pixels = [];
    for (let py = 0; py < sh; py++){
      for (let px = 0; px < sw; px++){
        const dx = (x0 + px) - cx;
        const dy = (y0 + py) - cy;
        if (dx*dx + dy*dy > r2) continue;
        const i = (py * sw + px) * 4;
        const R = img.data[i], G = img.data[i+1], B = img.data[i+2];
        const luma = 0.2126*R + 0.7152*G + 0.0722*B;
        pixels.push([R, G, B, luma]);
      }
    }
    if (pixels.length === 0) throw new Error('Empty sample region');

    // Reject 10% darkest (shadows) + 10% brightest (specular highlights)
    pixels.sort((a, b) => a[3] - b[3]);
    const q = Math.floor(pixels.length * 0.10);
    const trimmed = pixels.slice(q, pixels.length - q);

    let rs=0, gs=0, bs=0;
    for (const [R,G,B] of trimmed){ rs += R; gs += G; bs += B; }
    const n = trimmed.length;
    const meanR = Math.round(rs / n);
    const meanG = Math.round(gs / n);
    const meanB = Math.round(bs / n);
    const hsv = rgbToHsv(meanR, meanG, meanB);

    const lightness = (meanR + meanG + meanB) / (3 * 255);
    const redness   = Math.max(0, (meanR - meanB) / 255);
    const depth     = redness * (1.4 - lightness);

    return {
      rgb: [meanR, meanG, meanB], hsv,
      samples: n,
      depth: +depth.toFixed(3),
      sampleRadius: r,
      sampleCenter: [cx, cy],
    };
  }

  /** Map color depth → wavelength (empirical curve from observed transmitted
   *  color of Jaffe-product samples photographed under typical phone-camera
   *  lighting). Anchored so the calibration data's range (480–520 nm) is hit
   *  in the depth ranges we observe in practice (0.0–0.5). */
  function depthToWavelength(depth){
    // Piecewise-linear control points: depth → wavelength
    const PTS = [
      [0.00, 470], [0.03, 478], [0.08, 486], [0.16, 495],
      [0.26, 506], [0.36, 518], [0.50, 540], [0.65, 555],
      [0.80, 568], [1.00, 600],
    ];
    if (depth <= PTS[0][0]) return PTS[0][1];
    for (let i = 1; i < PTS.length; i++){
      const [d0, w0] = PTS[i-1], [d1, w1] = PTS[i];
      if (depth <= d1){
        const t = (depth - d0) / (d1 - d0);
        return Math.round((w0 + t * (w1 - w0)) * 10) / 10;
      }
    }
    return PTS[PTS.length - 1][1];
  }

  function rgbToHsv(r, g, b){
    r/=255; g/=255; b/=255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const d = mx - mn;
    let h = 0;
    if (d){
      if      (mx === r) h = 60 * (((g - b) / d) % 6);
      else if (mx === g) h = 60 * ((b - r) / d + 2);
      else                h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
    const s = mx === 0 ? 0 : d / mx;
    return { h: +h.toFixed(1), s: +s.toFixed(2), v: +mx.toFixed(2) };
  }

  /** Full result with band classification + confidence. */
  function inferCreatinine({ rgb, depth, hsv }){
    const wavelength = depthToWavelength(depth);
    const cr         = creatinineFromWavelength(wavelength);
    const band       = BANDS.find(b => wavelength >= b.wavelength[0] && wavelength < b.wavelength[1]) || BANDS[BANDS.length - 1];

    let conf = 80;
    if (hsv){
      const inOrange = (hsv.h <= 60 || hsv.h >= 350);
      if (!inOrange)  conf -= 30;
      if (hsv.s < 0.10) conf -= 20;
      if (hsv.v < 0.05) conf -= 25;
    }
    conf = Math.max(15, Math.min(95, conf));

    const explanation =
      band.id === 'NORMAL_LIGHT'    ? 'Solution is very light — creatinine is low.' :
      band.id === 'NORMAL'          ? 'Light yellow-orange — creatinine within healthy range.' :
      band.id === 'AT_RISK'         ? 'Medium orange — creatinine borderline elevated.' :
      band.id === 'DARK_ORANGE'     ? 'Dark orange — creatinine elevated, doctor consultation advised.' :
      band.id === 'DEEP_ORANGE_RED' ? 'Deep orange-red — creatinine significantly high, doctor visit required.' :
                                       'Very dark red — creatinine critical, seek urgent medical attention.';

    return {
      creatinine: cr,
      wavelength,
      band: band.id,
      label: band.label,
      riskCategory: band.riskCategory,
      confidence: conf,
      explanation,
    };
  }

  /** Single-frame sample of a live <video> element, returns the wavelength
   *  + creatinine estimate. Cheap enough to call ~5 Hz for the live readout. */
  function liveSampleVideo(video, opts = {}){
    if (!video || !video.videoWidth) return null;
    const c = document.createElement('canvas');
    c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);
    const s = sampleRegion(c, opts);
    const wavelength = depthToWavelength(s.depth);
    const cr         = creatinineFromWavelength(wavelength);
    const band       = BANDS.find(b => wavelength >= b.wavelength[0] && wavelength < b.wavelength[1]) || BANDS[BANDS.length - 1];
    return { rgb: s.rgb, depth: s.depth, wavelength, creatinine: cr, bandId: band.id };
  }

  window.RANephra = {
    sampleRegion, inferCreatinine,
    creatinineFromWavelength, wavelengthFromCreatinine,
    liveSampleVideo,
    BANDS, SWATCHES, CALIBRATION,
  };
})();
