/* recommendations.js — Phase 3C
 * ------------------------------------------------------------------
 * Bilingual explanation generator + personalized recommendation picker.
 * The actual user-facing strings live in locales/{en,ur}.json — this
 * module only decides *which* template + which actions apply, so the
 * caller can re-resolve via RAi18n.t() when language changes (no need
 * to regenerate the recommendation tree).
 *
 * Public API (window.RARecs):
 *   build({ analysis, biomarkers, user, features, contributions }) -> {
 *     explanationKey:    'normal' | 'atRisk' | 'critical',
 *     explanationParams: { cr, bun, egfr, stage } (numbers stringified),
 *     actions: [
 *       { key, priority, reason }    // 'reason' is a short trigger note for debugging
 *     ]
 *   }
 *
 * Caller usage (analysis.js):
 *   const recs = RARecs.build(...);
 *   const text = RAi18n.t('explanation.' + recs.explanationKey, recs.explanationParams);
 *   recs.actions.forEach(a => {
 *     RAi18n.t('recommendations.'+a.key+'.t');
 *     RAi18n.t('recommendations.'+a.key+'.s');
 *   });
 * ------------------------------------------------------------------ */
(() => {

  function build({ analysis = {}, biomarkers = {}, user = {}, features = {}, contributions = {} } = {}){
    const cat   = analysis.riskCategory || 'NORMAL';
    const bio   = biomarkers || {};
    const f     = features   || {};
    const c     = contributions || {};

    // ---- Explanation template selection ----
    const explanationKey =
      cat === 'CRITICAL' ? 'critical' :
      cat === 'AT_RISK'  ? 'atRisk'   :
      'normal';

    const explanationParams = {
      cr:    fmt(bio.creatinine, 2),
      bun:   fmt(bio.urea, 0),
      egfr:  fmt(f.egfr ?? bio.egfr, 1),
      stage: f.kdigoG || (window.RARisk?.kdigoStage ? RARisk.kdigoStage(bio.egfr) : '') || '—',
    };

    // ---- Action selection ----
    const actions = [];
    const add = (key, priority, reason) => {
      if (actions.find(a => a.key === key)) return;
      actions.push({ key, priority, reason });
    };

    // 1. CRITICAL band → urgent referral always at the top
    if (cat === 'CRITICAL'){
      add('urgent', 1, 'Critical risk category');
    }

    // 2. eGFR / KDIGO stage drives nephrology referral priority
    const stageG = f.kdigoG;
    if (stageG === 'G4' || stageG === 'G5'){
      add('nephro', cat === 'CRITICAL' ? 2 : 1, `eGFR stage ${stageG}`);
    } else if (stageG === 'G3a' || stageG === 'G3b'){
      add('nephro', 2, `eGFR stage ${stageG}`);
    } else if ((c.egfr || 0) > 12){
      add('nephro', 3, `Strong eGFR contribution (${c.egfr.toFixed(1)})`);
    }

    // 3. Proteinuria → also points to nephrology + repeat-test
    const protein = bio.urinaryProtein;
    if (Number.isFinite(protein)){
      if (protein >= 0.5){
        add('nephro', 2, `Macroalbuminuria (${protein} g/24h)`);
      } else if (protein >= 0.15){
        add('nephro', 3, `Microalbuminuria (${protein} g/24h)`);
      }
    }

    // 4. Elevated creatinine → hydrate + avoid nephrotoxins
    const crHi = (user.gender === 'F') ? 1.1 : 1.3;
    if (Number.isFinite(bio.creatinine) && bio.creatinine > crHi){
      add('hydrate', 4, `Creatinine ${bio.creatinine} above ${crHi}`);
      add('nsaid',   5, 'Elevated creatinine');
    }

    // 5. BUN-driven dietary advice
    if (Number.isFinite(bio.urea) && bio.urea > 20){
      add('protein', 4, `BUN ${bio.urea} above 20`);
    }
    // BUN/Cr ratio > 20 hints pre-renal cause → emphasize hydration
    if (Number.isFinite(f.bunCrRatio) && f.bunCrRatio > 20){
      add('hydrate', 4, `BUN/Cr ratio ${f.bunCrRatio}`);
    }

    // 6. Comorbidity reminder for any at-risk patient
    if (cat !== 'NORMAL'){
      add('diabetes', 6, 'Comorbidity reminder');
      add('salt',     7, 'Comorbidity reminder');
    }

    // 7. Hyperuricemia → salt reduction is also useful (and gout warning)
    const uaHi = (user.gender === 'F') ? 6.0 : 7.0;
    if (Number.isFinite(bio.uricAcid) && bio.uricAcid > uaHi){
      add('salt', 7, `Uric acid ${bio.uricAcid} above ${uaHi}`);
    }

    // 8. Always close with the repeat-test reminder
    add('repeat', 8, 'Standard follow-up');

    // For NORMAL category trim to the gentlest set: repeat + hydrate (encouragement)
    if (cat === 'NORMAL' && !actions.some(a => a.key === 'urgent')){
      const trimmed = actions.filter(a => a.key === 'repeat' || a.key === 'hydrate');
      if (trimmed.length === 0) trimmed.push({ key:'repeat', priority:8, reason:'Routine' });
      return { explanationKey, explanationParams, actions: trimmed.sort(byPriority) };
    }

    return {
      explanationKey,
      explanationParams,
      actions: actions.sort(byPriority).slice(0, 6),
    };
  }

  function byPriority(a, b){ return a.priority - b.priority; }
  function fmt(v, d){ return Number.isFinite(v) ? v.toFixed(d) : '—'; }

  window.RARecs = { build };
})();
