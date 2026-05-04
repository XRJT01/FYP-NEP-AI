/* biomarker-extractor.js — Phase 2B
 * ------------------------------------------------------------------
 * Pattern library + value normalization for kidney panel biomarkers.
 *
 * Public API (window.RABiomarker):
 *   parseRawText(text, words?) -> {
 *     values:      { creatinine?, urea?, egfr?, uricAcid?, urinaryProtein? },
 *     confidences: { creatinine?, urea?, egfr?, uricAcid?, urinaryProtein? },
 *     matches:     { <key>: { rawValue, unit, patternId, snippet } },
 *     rawText
 *   }
 *
 * Design:
 *  - Each biomarker has a list of regex patterns ordered by specificity.
 *    The first match wins. Each pattern carries a baseline confidence (60–95).
 *  - Captured values are unit-normalized to the system's canonical unit
 *    (creatinine/urea/uric acid: mg/dL; eGFR: mL/min/1.73m²; urine protein: g/24h).
 *  - Values outside physiological plausibility ranges are dropped.
 *  - If `words` (Tesseract per-word output) is provided, we anchor confidence
 *    to the word-level OCR confidence of the matched value.
 * ------------------------------------------------------------------ */
(() => {

  /** Canonical biomarkers + plausible ranges (after normalization).
   *  Anything outside the range is rejected as an OCR/extraction error. */
  const RANGES = {
    creatinine:     { min: 0.1,  max: 30,  unit: 'mg/dL' },
    urea:           { min: 1,    max: 200, unit: 'mg/dL' },   // BUN
    egfr:           { min: 1,    max: 200, unit: 'mL/min/1.73m²' },
    uricAcid:       { min: 0.5,  max: 25,  unit: 'mg/dL' },
    urinaryProtein: { min: 0,    max: 25,  unit: 'g/24h' },
  };

  /** Unit converters → canonical. Returns null if unsupported. */
  function normalize(key, value, unitRaw){
    const u = (unitRaw || '').toLowerCase().replace(/\s+/g,'');
    switch (key){
      case 'creatinine':
        if (!u || u.startsWith('mg')) return value;
        if (u.startsWith('umol') || u.startsWith('µmol') || u.startsWith('micromol')) return +(value / 88.4).toFixed(2);
        return value;
      case 'urea':
        if (!u || u.startsWith('mg')) return value;
        if (u.startsWith('mmol')) return +(value * 6.005).toFixed(1); // BUN-equivalent
        return value;
      case 'egfr':
        return value; // always mL/min/1.73m²
      case 'uricAcid':
        if (!u || u.startsWith('mg')) return value;
        if (u.startsWith('umol') || u.startsWith('µmol')) return +(value / 59.48).toFixed(2);
        return value;
      case 'urinaryProtein':
        if (!u) return value;
        if (u.includes('24') || u === 'g' || u === 'g/d' || u === 'g/day') return value;       // already g/24h-ish
        if (u === 'mg' || u === 'mg/24h' || u === 'mg/d' || u === 'mg/day') return +(value / 1000).toFixed(3);
        if (u === 'g/l') return value;   // ambiguous without urine volume; pass through with low conf
        return value;
    }
    return value;
  }

  /** Pattern library. Order matters: most specific first.
   *  Each entry: { id, re, conf, unitGroup?, valueGroup }
   *  All patterns operate on whitespace-collapsed lowercase text.
   *
   *  The "separator" between a biomarker label and its value is intentionally
   *  flexible: any run of whitespace/punctuation, optionally containing a
   *  parenthetical annotation (e.g. "Blood Urea Nitrogen (BUN)  29",
   *  "eGFR (CKD-EPI 2021)  67.8"). The closing `)` is allowed in the
   *  separator class so labels that themselves sit *inside* parens
   *  (like "(BUN) 29") are also matched. */
  const SEP = String.raw`[\s:.\-)]+(?:\s*\([^)\n]{0,60}\)[\s:.\-)]*)?`;
  const NUM = String.raw`([0-9]+(?:\.[0-9]+)?)`;
  const re  = (parts) => new RegExp(parts.join(''), 'i');

  const PATTERNS = {
    creatinine: [
      { id:'cr_serum_unit', conf:96, valueGroup:1, unitGroup:2,
        re: re([String.raw`(?:s(?:erum)?\.?|plasma\.?)?\s*creatinine`, SEP, NUM, String.raw`\s*(mg\/?dl|mg\/?d|umol\/?l|µmol\/?l|micromol\/?l)?`]) },
      { id:'cr_short',      conf:88, valueGroup:1, unitGroup:2,
        re: re([String.raw`\bs\.?\s*creat(?:\.|inine)?`, SEP, NUM, String.raw`\s*(mg\/?dl|umol\/?l)?`]) },
      { id:'cr_alone',      conf:75, valueGroup:1, unitGroup:2,
        re: re([String.raw`\bcreat(?:\.|inine)?\b`, SEP, NUM, String.raw`\s*(mg\/?dl|umol\/?l)?`]) },
    ],
    urea: [
      { id:'bun',                 conf:96, valueGroup:1, unitGroup:2,
        re: re([String.raw`\bb\.?u\.?n\.?\b`, SEP, NUM, String.raw`\s*(mg\/?dl)?`]) },
      { id:'urea_long',           conf:94, valueGroup:1, unitGroup:2,
        re: re([String.raw`(?:blood\s+)?urea(?:\s+nitrogen)?\b`, SEP, NUM, String.raw`\s*(mg\/?dl|mmol\/?l)?`]) },
      { id:'serum_urea',          conf:90, valueGroup:1, unitGroup:2,
        re: re([String.raw`\bs\.?\s*urea\b`, SEP, NUM, String.raw`\s*(mg\/?dl|mmol\/?l)?`]) },
    ],
    egfr: [
      { id:'egfr_explicit', conf:96, valueGroup:1,
        re: re([String.raw`\b(?:e\s*[\-\.]?\s*gfr|estimated\s+gfr|gfr\s*\(?\s*estimated\s*\)?)\b`, SEP, NUM]) },
      { id:'gfr_unit',      conf:90, valueGroup:1,
        re: re([String.raw`\bgfr\b`, SEP, NUM, String.raw`\s*(?:ml\/?min)`]) },
      { id:'gfr_loose',     conf:78, valueGroup:1,
        re: re([String.raw`\bgfr\b`, SEP, NUM]) },
    ],
    uricAcid: [
      { id:'uric_acid',  conf:95, valueGroup:1, unitGroup:2,
        re: re([String.raw`\buric\s+acid\b`, SEP, NUM, String.raw`\s*(mg\/?dl|umol\/?l|µmol\/?l)?`]) },
      { id:'sua_short',  conf:80, valueGroup:1, unitGroup:2,
        re: re([String.raw`\bs\.?\s*u\.?\s*a\.?\b`, SEP, NUM, String.raw`\s*(mg\/?dl)?`]) },
    ],
    urinaryProtein: [
      { id:'urine_24h',     conf:94, valueGroup:1, unitGroup:2,
        re: re([String.raw`(?:24[\s\-]?h(?:our|r)?|24[\s\-]?hr)\s*(?:urine\s+)?(?:total\s+)?protein\b`, SEP, NUM, String.raw`\s*(g\/?24h?|g\/?day|g\/?d|mg\/?24h?|mg\/?day|g|mg)?`]) },
      { id:'urine_protein', conf:88, valueGroup:1, unitGroup:2,
        re: re([String.raw`(?:urin(?:e|ary)|total)\s+protein\b`, SEP, NUM, String.raw`\s*(g\/?24h?|g\/?l|g|mg)?`]) },
      { id:'proteinuria',   conf:82, valueGroup:1, unitGroup:2,
        re: re([String.raw`\bproteinuria\b`, SEP, NUM, String.raw`\s*(g\/?24h?|g\/?l|g|mg)?`]) },
    ],
  };

  /** Try to find the per-word OCR confidence of the value token.
   *  We approximate by looking up the token in the words array. */
  function wordConfidenceFor(value, words){
    if (!Array.isArray(words) || !words.length) return null;
    const target = String(value);
    let best = 0;
    for (const w of words){
      if (!w?.text) continue;
      const t = String(w.text).replace(/[^\d.]/g, '');
      if (t === target || t.startsWith(target) || target.startsWith(t)){
        if (w.confidence > best) best = w.confidence;
      }
    }
    return best > 0 ? best : null;
  }

  function combineConfidence(patternConf, wordConf){
    if (wordConf == null) return patternConf;
    return Math.round(Math.min(99, patternConf * (wordConf/100)));
  }

  function extractOne(key, text, words){
    const patterns = PATTERNS[key];
    for (const p of patterns){
      const m = text.match(p.re);
      if (!m) continue;
      const rawValue = parseFloat(m[p.valueGroup]);
      if (!Number.isFinite(rawValue)) continue;
      const unit = p.unitGroup ? (m[p.unitGroup] || '') : '';
      const value = normalize(key, rawValue, unit);
      const range = RANGES[key];
      if (value < range.min || value > range.max){
        continue; // implausible — try next pattern
      }
      const wordConf = wordConfidenceFor(rawValue, words);
      const conf = combineConfidence(p.conf, wordConf);
      return {
        value: round(value, key),
        confidence: conf,
        match: { rawValue, unit, patternId: p.id, snippet: m[0] },
      };
    }
    return null;
  }

  function round(value, key){
    // Sensible display precision per biomarker
    if (key === 'urea')           return Math.round(value);
    if (key === 'egfr')           return +value.toFixed(1);
    if (key === 'urinaryProtein') return +value.toFixed(2);
    return +value.toFixed(2);     // creatinine, uricAcid
  }

  function preclean(text){
    if (!text) return '';
    // Common OCR artefacts in numeric values
    return String(text)
      .replace(/[–—]/g, '-')                       // en/em dashes → hyphen
      .replace(/[Oo](?=\d)|(?<=\d)[Oo]/g, '0')    // O→0 next to digits
      .replace(/[Il](?=\d|\.)|(?<=\d)[Il]/g, '1') // I/l → 1 next to digits
      .replace(/(\d)\s*[,]\s*(\d{1,2})\b/g, '$1.$2') // "1,42" → "1.42" (some labs use comma decimals)
      .replace(/(\d)\s+\.\s*(\d)/g, '$1.$2')       // "1 .42" → "1.42"
      .replace(/(\d)\s*\.\s+(\d)/g, '$1.$2')       // "1. 42" → "1.42"
      .replace(/\s+/g, ' ')                        // collapse whitespace
      .trim();
  }

  function parseRawText(rawText, words = []){
    const text = preclean(rawText);
    const values = {};
    const confidences = {};
    const matches = {};

    for (const key of Object.keys(PATTERNS)){
      const hit = extractOne(key, text, words);
      if (hit){
        values[key]      = hit.value;
        confidences[key] = hit.confidence;
        matches[key]     = hit.match;
      }
    }

    return { values, confidences, matches, rawText };
  }

  // Helper exposed for unit testing in DevTools
  window.RABiomarker = { parseRawText, _patterns: PATTERNS, _ranges: RANGES };
})();
