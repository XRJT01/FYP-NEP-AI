/* risk-engine.js — Phase 3A
 * ------------------------------------------------------------------
 * CKD risk classifier. Modelled as a transparent weighted ensemble that
 * mirrors the KDIGO 2022 G/A staging logic (eGFR + albuminuria), with
 * additional contributions from creatinine, BUN, uric acid, and age.
 * The behaviour approximates the Random Forest described in the FYP
 * report; we keep the scoring deterministic and explainable so the
 * recommendations engine (3C) can show *why* a score was assigned.
 *
 * Public API (window.RARisk):
 *   score(input)                     -> ScoreResult
 *   egfrCKDEPI(creatinine, age, sex) -> Number | null   (mL/min/1.73m²)
 *   kdigoStage(egfr)                 -> 'G1'|'G2'|'G3a'|'G3b'|'G4'|'G5'|null
 *   proteinStage(g24h)               -> 'A1'|'A2'|'A3'|null
 *
 * Input shape:
 *   { creatinine, urea, egfr, uricAcid, urinaryProtein, age, gender }
 *   All numeric; gender is 'M' | 'F'. Any field may be null/undefined.
 *
 * ScoreResult:
 *   {
 *     riskScore,        // 0..100 integer
 *     riskCategory,     // NORMAL (0-33) | AT_RISK (34-66) | CRITICAL (67-100)
 *     modelConfidence,  // 0..100
 *     features: { egfr, egfrSource, kdigoG, kdigoA, bunCrRatio, creatinineZ },
 *     contributions: { egfr, urinaryProtein, creatinine, urea, uricAcid, age }
 *   }
 * ------------------------------------------------------------------ */
(() => {

  /* ---------- Reference ranges (Pakistan-calibrated, gender-specific) ---------- */
  const REF = {
    creatinine: { M:[0.7, 1.3], F:[0.6, 1.1] },
    urea:       { M:[7,   20],  F:[7,   20]  },     // BUN
    uricAcid:   { M:[3.4, 7.0], F:[2.4, 6.0] },
  };

  /* ---------- KDIGO 2022 G stages (eGFR mL/min/1.73m²) ---------- */
  function kdigoStage(egfr){
    if (egfr == null || !Number.isFinite(egfr)) return null;
    if (egfr >= 90) return 'G1';
    if (egfr >= 60) return 'G2';
    if (egfr >= 45) return 'G3a';
    if (egfr >= 30) return 'G3b';
    if (egfr >= 15) return 'G4';
    return 'G5';
  }

  /* ---------- KDIGO A stages (24-hour urinary protein, g/day) ---------- */
  function proteinStage(g24h){
    if (g24h == null || !Number.isFinite(g24h)) return null;
    if (g24h < 0.15) return 'A1';
    if (g24h < 0.5)  return 'A2';
    return 'A3';
  }

  /* ---------- CKD-EPI 2021 (race-free) ----------
   * Reference: NEJM 2021;385:1737. Returns mL/min/1.73m². */
  function egfrCKDEPI(creatinine, age = 40, gender = 'M'){
    if (!Number.isFinite(creatinine) || creatinine <= 0) return null;
    const female = gender === 'F';
    const k     = female ? 0.7   : 0.9;
    const alpha = female ? -0.241 : -0.302;
    const ratio = creatinine / k;
    const minTerm = Math.pow(Math.min(ratio, 1), alpha);
    const maxTerm = Math.pow(Math.max(ratio, 1), -1.200);
    let egfr = 142 * minTerm * maxTerm * Math.pow(0.9938, age);
    if (female) egfr *= 1.012;
    return +egfr.toFixed(1);
  }

  /* ---------- Per-feature components, each 0..100 ---------- */

  function egfrComponent(egfr){
    if (egfr == null) return null;
    // Piecewise linear over KDIGO bands so the score climbs smoothly.
    if (egfr >= 90) return 0;
    if (egfr >= 60) return interp(egfr, 90, 60, 0,   33);
    if (egfr >= 45) return interp(egfr, 60, 45, 34,  50);
    if (egfr >= 30) return interp(egfr, 45, 30, 51,  66);
    if (egfr >= 15) return interp(egfr, 30, 15, 67,  89);
    return interp(egfr, 15, 0, 90, 100);
  }

  function proteinComponent(p){
    if (p == null) return null;
    if (p < 0.15)  return 0;
    if (p < 0.5)   return interp(p, 0.15, 0.5, 0,  50);
    if (p < 3.5)   return interp(p, 0.5,  3.5, 50, 90);
    return Math.min(100, interp(p, 3.5, 10, 90, 100));
  }

  function creatinineComponent(cr, gender){
    if (cr == null) return null;
    const [, hi] = REF.creatinine[gender] || REF.creatinine.M;
    if (cr <= hi) return 0;
    // Each +0.5 mg/dL above normal contributes ~25 points (full range at 2.5 above normal)
    return Math.min(100, ((cr - hi) / 0.1) * 5);
  }

  function bunComponent(urea){
    if (urea == null) return null;
    if (urea <= 20) return 0;
    if (urea <= 50) return interp(urea, 20, 50, 0, 60);
    return Math.min(100, interp(urea, 50, 100, 60, 100));
  }

  function uricAcidComponent(ua, gender){
    if (ua == null) return null;
    const [, hi] = REF.uricAcid[gender] || REF.uricAcid.M;
    if (ua <= hi) return 0;
    return Math.min(100, ((ua - hi) / 0.5) * 20);
  }

  function ageComponent(age){
    if (age == null) return 0;          // age missing → treat as median adult
    if (age < 40)   return 0;
    if (age <= 65)  return interp(age, 40, 65, 0, 30);
    return Math.min(50, interp(age, 65, 90, 30, 50));
  }

  /* ---------- Weights (sum to 1.0; eGFR + protein dominate per KDIGO) ---------- */
  const WEIGHTS = {
    egfr:           0.40,
    urinaryProtein: 0.25,
    creatinine:     0.15,
    urea:           0.10,
    uricAcid:       0.05,
    age:            0.05,
  };

  /* ---------- Confidence model ---------- */
  function confidence(input, derivedEgfrUsed){
    const fields = ['creatinine','urea','egfr','uricAcid','urinaryProtein'];
    const provided = fields.filter(k => Number.isFinite(input[k])).length;
    let conf = 55 + provided * 8;            // 63 → 95 by raw count
    if (provided >= 4) conf += 2;
    if (derivedEgfrUsed) conf -= 4;          // computed eGFR is less certain than measured
    if (input.creatinine == null && input.egfr == null) conf = Math.min(conf, 35);
    return Math.max(20, Math.min(96, Math.round(conf)));
  }

  /* ---------- Main scorer ---------- */
  function score(rawInput = {}){
    // Defensive parsing
    const input = {
      creatinine:     toNum(rawInput.creatinine),
      urea:           toNum(rawInput.urea),
      egfr:           toNum(rawInput.egfr),
      uricAcid:       toNum(rawInput.uricAcid),
      urinaryProtein: toNum(rawInput.urinaryProtein),
      age:            Number.isFinite(rawInput.age) ? rawInput.age : null,
      gender:         (rawInput.gender === 'F') ? 'F' : 'M',
    };

    // eGFR auto-calc when missing (CKD-EPI)
    let egfrSource = 'extracted';
    let egfr = input.egfr;
    if (egfr == null && input.creatinine != null){
      egfr = egfrCKDEPI(input.creatinine, input.age ?? 40, input.gender);
      egfrSource = egfr != null ? 'computed' : 'unavailable';
    } else if (egfr == null){
      egfrSource = 'unavailable';
    }

    // Per-feature components (null = field absent)
    const comp = {
      egfr:           egfrComponent(egfr),
      urinaryProtein: proteinComponent(input.urinaryProtein),
      creatinine:     creatinineComponent(input.creatinine, input.gender),
      urea:           bunComponent(input.urea),
      uricAcid:       uricAcidComponent(input.uricAcid, input.gender),
      age:            ageComponent(input.age),
    };

    // Re-normalize weights over only the present features so a missing
    // input doesn't artificially deflate the score.
    const presentKeys  = Object.keys(WEIGHTS).filter(k => comp[k] != null);
    const weightSum    = presentKeys.reduce((s, k) => s + WEIGHTS[k], 0) || 1;
    const contributions = {};
    let weightedSum = 0;
    for (const k of presentKeys){
      const w = WEIGHTS[k] / weightSum;
      const contrib = comp[k] * w;
      contributions[k] = +contrib.toFixed(2);
      weightedSum += contrib;
    }

    // Apply a KDIGO escalation: if both G ≥ G3b and A ≥ A2 (very-high-risk
    // bucket on the KDIGO heat-map), nudge the floor of the score so the
    // weighted average can't under-call a clearly critical patient.
    const kdigoG = kdigoStage(egfr);
    const kdigoA = proteinStage(input.urinaryProtein);
    if (kdigoG && (kdigoG === 'G4' || kdigoG === 'G5')) weightedSum = Math.max(weightedSum, 75);
    else if (kdigoG === 'G3b' && (kdigoA === 'A2' || kdigoA === 'A3')) weightedSum = Math.max(weightedSum, 67);
    else if (kdigoG === 'G3a' && kdigoA === 'A3')                       weightedSum = Math.max(weightedSum, 60);

    const riskScore = clamp(0, 100, Math.round(weightedSum));
    const riskCategory = riskScore >= 67 ? 'CRITICAL' : riskScore >= 34 ? 'AT_RISK' : 'NORMAL';
    const modelConfidence = confidence(input, egfrSource === 'computed');

    const bunCrRatio = (input.urea != null && input.creatinine != null)
      ? +(input.urea / input.creatinine).toFixed(1) : null;
    const [crLo, crHi] = REF.creatinine[input.gender];
    const creatinineZ = (input.creatinine != null) ? +(((input.creatinine - (crLo + crHi)/2) / 0.2)).toFixed(2) : null;

    return {
      riskScore,
      riskCategory,
      modelConfidence,
      features: { egfr, egfrSource, kdigoG, kdigoA, bunCrRatio, creatinineZ },
      contributions,
    };
  }

  /* ---------- Helpers ---------- */
  function interp(x, x0, x1, y0, y1){
    if (x0 === x1) return y0;
    const t = (x - x0) / (x1 - x0);
    return y0 + t * (y1 - y0);
  }
  function clamp(lo, hi, v){ return Math.max(lo, Math.min(hi, v)); }
  function toNum(v){ const n = parseFloat(v); return Number.isFinite(n) ? n : null; }

  window.RARisk = {
    score, egfrCKDEPI, kdigoStage, proteinStage,
    _components: { egfrComponent, proteinComponent, creatinineComponent, bunComponent, uricAcidComponent, ageComponent },
    _weights: WEIGHTS, _ref: REF,
  };
})();
