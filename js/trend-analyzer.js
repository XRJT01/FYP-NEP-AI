/* trend-analyzer.js — Phase 3B
 * ------------------------------------------------------------------
 * Longitudinal analytics for stored kidney panels.
 *
 * Inputs ("timeline"): chronological list of objects shaped like
 *   { analyzedAt, riskScore, riskCategory, biomarkers: { creatinine, urea, egfr, uricAcid, urinaryProtein } }
 *
 * Public API (window.RATrend):
 *   analyze(timeline) -> {
 *     direction:    'insufficient' | 'improving' | 'stable' | 'worsening',
 *     severity:     'NONE' | 'MILD' | 'MODERATE' | 'SEVERE',
 *     slope: {                          // change per month from linear regression
 *       riskScore, creatinine, urea, egfr, uricAcid, urinaryProtein
 *     },
 *     r2: { ... },                      // regression goodness-of-fit per series
 *     alerts: [{ type, severity, key, title, description }],
 *     projection: {                     // months until eGFR crosses 60 (G3)
 *       stage:   'G2'|'G3a'|'G3b'|'G4'|'G5'|null,
 *       monthsToG3:    Number|null,
 *       monthsToCritical: Number|null
 *     },
 *     summary: { reportsUsed, timeSpanMonths, currentCategory,
 *                 egfrFirstBelow60, maxCreatinineDelta, latestEgfr,
 *                 latestCreatinine, dateFrom, dateTo }
 *   }
 *
 *   regress(points)              -> { slope, intercept, r2, n }
 *   monthsBetween(isoA, isoB)    -> Number
 *
 * Alert thresholds (from FYP report Ch 5.2.3):
 *   - Risk score slope > +2.0 pts/month       → MILD/MODERATE/SEVERE escalation
 *   - eGFR drops below 60 (first time)        → KDIGO G3 entry
 *   - Creatinine ↑ > 0.3 mg/dL between two consecutive reports
 *   - Creatinine ↑ > 0.3 mg/dL/month sustained over 3+ consecutive reports
 *   - Latest analysis category = CRITICAL     → urgent referral
 *   - Risk slope < -2 → positive "improving" signal
 * ------------------------------------------------------------------ */
(() => {

  const DAY_MS = 86400000;
  const MONTH_MS = 30.4375 * DAY_MS;

  function monthsBetween(isoA, isoB){
    return (new Date(isoB) - new Date(isoA)) / MONTH_MS;
  }

  /** Linear regression. points = [{x, y}]. Returns slope/intercept/r2.
   *  Empty/single-point input returns zeros (not NaN). */
  function regress(points){
    const valid = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
    const n = valid.length;
    if (n < 2) return { slope: 0, intercept: n ? valid[0].y : 0, r2: 0, n };

    let sumX=0, sumY=0, sumXY=0, sumX2=0, sumY2=0;
    for (const { x, y } of valid){
      sumX += x; sumY += y; sumXY += x*y; sumX2 += x*x; sumY2 += y*y;
    }
    const denom = (n * sumX2 - sumX*sumX);
    if (denom === 0) return { slope: 0, intercept: sumY / n, r2: 0, n };

    const slope = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;
    // Pearson r^2
    const meanY = sumY / n;
    const ssTot = sumY2 - n * meanY * meanY;
    const ssRes = valid.reduce((s, p) => s + Math.pow(p.y - (slope * p.x + intercept), 2), 0);
    const r2 = ssTot > 0 ? Math.max(0, Math.min(1, 1 - ssRes/ssTot)) : 0;
    return { slope, intercept, r2, n };
  }

  function emptyResult(){
    return {
      direction: 'insufficient',
      severity: 'NONE',
      slope: { riskScore:0, creatinine:0, urea:0, egfr:0, uricAcid:0, urinaryProtein:0 },
      r2:    { riskScore:0, creatinine:0, urea:0, egfr:0, uricAcid:0, urinaryProtein:0 },
      alerts: [],
      projection: { stage:null, monthsToG3:null, monthsToCritical:null },
      summary: { reportsUsed:0, timeSpanMonths:0, currentCategory:null, egfrFirstBelow60:null,
                  maxCreatinineDelta:null, latestEgfr:null, latestCreatinine:null,
                  dateFrom:null, dateTo:null },
    };
  }

  function analyze(timeline){
    if (!Array.isArray(timeline) || !timeline.length) return emptyResult();

    // Sort chronologically + augment with monthsFromStart
    const sorted = [...timeline].sort((a,b) => new Date(a.analyzedAt) - new Date(b.analyzedAt));
    const t0 = new Date(sorted[0].analyzedAt);
    const augmented = sorted.map(t => ({
      ...t,
      monthsFromStart: (new Date(t.analyzedAt) - t0) / MONTH_MS,
    }));

    const last = augmented[augmented.length - 1];
    const span = last.monthsFromStart;
    const reportsUsed = augmented.length;

    // Per-series regression
    const series = ['riskScore','creatinine','urea','egfr','uricAcid','urinaryProtein'];
    const slope = {}, r2 = {};
    for (const k of series){
      const points = augmented
        .map(t => ({ x: t.monthsFromStart, y: pickValue(t, k) }))
        .filter(p => Number.isFinite(p.y));
      const reg = regress(points);
      slope[k] = +reg.slope.toFixed(3);
      r2[k]    = +reg.r2.toFixed(3);
    }

    // Direction (based on risk-score slope)
    const dir = (reportsUsed < 2) ? 'insufficient'
              : slope.riskScore >  1.0 ? 'worsening'
              : slope.riskScore < -1.0 ? 'improving'
              : 'stable';

    // Severity classification
    const severity = classifySeverity(slope.riskScore, last.riskCategory);

    // Alerts
    const alerts = computeAlerts(augmented, slope, severity);

    // Projection: when does eGFR cross 60 / 30 ?
    const projection = computeProjection(augmented, slope.egfr);

    // First-time eGFR<60 crossing
    let egfrFirstBelow60 = null;
    for (let i = 0; i < augmented.length; i++){
      const e = pickValue(augmented[i], 'egfr');
      if (Number.isFinite(e) && e < 60){
        egfrFirstBelow60 = augmented[i].analyzedAt;
        break;
      }
    }

    // Max consecutive creatinine delta
    let maxDelta = null;
    for (let i = 1; i < augmented.length; i++){
      const a = pickValue(augmented[i-1], 'creatinine');
      const b = pickValue(augmented[i],   'creatinine');
      if (Number.isFinite(a) && Number.isFinite(b)){
        const d = b - a;
        if (maxDelta == null || Math.abs(d) > Math.abs(maxDelta)) maxDelta = d;
      }
    }

    return {
      direction: dir,
      severity,
      slope,
      r2,
      alerts,
      projection,
      summary: {
        reportsUsed,
        timeSpanMonths: +span.toFixed(1),
        currentCategory: last.riskCategory,
        egfrFirstBelow60,
        maxCreatinineDelta: maxDelta == null ? null : +maxDelta.toFixed(2),
        latestEgfr: pickValue(last, 'egfr'),
        latestCreatinine: pickValue(last, 'creatinine'),
        dateFrom: augmented[0].analyzedAt,
        dateTo:   last.analyzedAt,
      },
    };
  }

  function pickValue(entry, key){
    if (key === 'riskScore')    return Number.isFinite(entry.riskScore) ? entry.riskScore : null;
    if (key === 'riskCategory') return entry.riskCategory;
    return entry.biomarkers ? entry.biomarkers[key] : null;
  }

  function classifySeverity(slopeRisk, latestCategory){
    if (latestCategory === 'CRITICAL') return 'SEVERE';
    if (slopeRisk >= 10) return 'SEVERE';
    if (slopeRisk >= 5)  return 'MODERATE';
    if (slopeRisk >= 2)  return 'MILD';
    return 'NONE';
  }

  function computeProjection(augmented, egfrSlope){
    const last = augmented[augmented.length - 1];
    const lastEgfr = pickValue(last, 'egfr');
    const stage = window.RARisk?.kdigoStage ? RARisk.kdigoStage(lastEgfr) : null;
    if (!Number.isFinite(lastEgfr)) return { stage, monthsToG3: null, monthsToCritical: null };

    const monthsTo = (target) => {
      // (lastEgfr + slope * m = target) → m = (target - lastEgfr) / slope
      if (!Number.isFinite(egfrSlope) || egfrSlope >= -0.05) return null; // not declining meaningfully
      if (lastEgfr <= target) return 0;
      return Math.max(0, Math.round((target - lastEgfr) / egfrSlope));
    };

    return {
      stage,
      monthsToG3:       lastEgfr < 60 ? 0 : monthsTo(60),
      monthsToCritical: lastEgfr < 30 ? 0 : monthsTo(30),
    };
  }

  function computeAlerts(augmented, slope, severity){
    const alerts = [];
    const last = augmented[augmented.length - 1];
    const prev = augmented[augmented.length - 2];

    // 1) Risk-score climbing (only meaningful with ≥3 reports)
    if (augmented.length >= 3 && slope.riskScore >= 2){
      const tier = slope.riskScore >= 10 ? 'SEVERE' : slope.riskScore >= 5 ? 'MODERATE' : 'MILD';
      alerts.push({
        type: tier === 'MILD' ? 'WARN' : 'CRITICAL', severity: tier, key:'riskClimb',
        title: i18n('trends.alert.riskClimb.t', { tier: tierLabel(tier) }),
        description: i18n('trends.alert.riskClimb.s', { slope: slope.riskScore.toFixed(1) }),
      });
    }

    // 2) Improving signal
    if (slope.riskScore <= -2){
      alerts.push({ type:'INFO', severity:'NONE', key:'improving',
        title: i18n('trends.alert.improving.t'),
        description: i18n('trends.alert.improving.s', { slope: Math.abs(slope.riskScore).toFixed(1) }),
      });
    }

    // 3) eGFR crossed below 60 for the first time
    const lastEgfr = pickValue(last, 'egfr');
    const prevEgfr = prev ? pickValue(prev, 'egfr') : null;
    if (Number.isFinite(lastEgfr) && lastEgfr < 60 && Number.isFinite(prevEgfr) && prevEgfr >= 60){
      alerts.push({ type:'CRITICAL', severity:'MODERATE', key:'egfrG3',
        title: i18n('trends.alert.egfrG3.t'),
        description: i18n('trends.alert.egfrG3.s', { egfr: lastEgfr.toFixed(1) }),
      });
    }

    // 4) Creatinine spike between two consecutive reports
    const lastCr = pickValue(last, 'creatinine');
    const prevCr = prev ? pickValue(prev, 'creatinine') : null;
    if (Number.isFinite(lastCr) && Number.isFinite(prevCr) && (lastCr - prevCr) > 0.3){
      alerts.push({ type:'WARN', severity:'MILD', key:'crSpike',
        title: i18n('trends.alert.crSpike.t'),
        description: i18n('trends.alert.crSpike.s', { delta: (lastCr - prevCr).toFixed(2), prev: prevCr.toFixed(2), curr: lastCr.toFixed(2) }),
      });
    }

    // 5) Sustained creatinine rise: >0.3 mg/dL/month over the last 3 reports
    if (augmented.length >= 3){
      const tail = augmented.slice(-3);
      const dt   = (new Date(tail[2].analyzedAt) - new Date(tail[0].analyzedAt)) / MONTH_MS;
      const dCr  = pickValue(tail[2],'creatinine') - pickValue(tail[0],'creatinine');
      if (dt > 0 && Number.isFinite(dCr) && (dCr / dt) > 0.3){
        alerts.push({ type:'WARN', severity:'MODERATE', key:'sustainedCrRise',
          title: i18n('trends.alert.sustainedCrRise.t'),
          description: i18n('trends.alert.sustainedCrRise.s', { perMonth: (dCr/dt).toFixed(2) }),
        });
      }
    }

    // 6) Latest critical
    if (last.riskCategory === 'CRITICAL'){
      alerts.unshift({ type:'CRITICAL', severity:'SEVERE', key:'criticalCat',
        title: i18n('trends.alert.criticalCat.t'),
        description: i18n('trends.alert.criticalCat.s'),
      });
    }

    // 7) Sub-threshold worsening: direction is up but slope hasn't hit the MILD bar
    if (!alerts.length && augmented.length >= 2 && severity === 'NONE' && slope.riskScore > 0.5){
      alerts.push({ type:'INFO', severity:'NONE', key:'subWorsening',
        title: i18n('trends.alert.subWorsening.t'),
        description: i18n('trends.alert.subWorsening.s', { slope: slope.riskScore.toFixed(1) }),
      });
    }
    // 8) "All clear" only when truly stable or improving
    if (!alerts.length && augmented.length >= 2 && severity === 'NONE'){
      alerts.push({ type:'OK', severity:'NONE', key:'allClear',
        title: i18n('trends.alert.allClear.t'),
        description: i18n('trends.alert.allClear.s'),
      });
    }

    return alerts;
  }

  function tierLabel(tier){
    return i18n('trends.severity.'+tier);
  }
  function i18n(k, p){
    return window.RAi18n?.t ? RAi18n.t(k, p) : k;
  }

  window.RATrend = { analyze, regress, monthsBetween };
})();
