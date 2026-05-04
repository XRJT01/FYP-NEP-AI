/* extraction-form.js — Phase 2C
 * ------------------------------------------------------------------
 * Owns the OCR-confirmation form. Lives in its own file so other phases
 * can render it (e.g. trends history retro-edits, doctor portal corrections).
 *
 * Public API (window.RAExtraction):
 *   render({ container, values, confidences, matches, mock, onConfirm }) -> void
 *     container:    HTMLElement to render into (innerHTML is replaced)
 *     values:       { creatinine?, urea?, egfr?, uricAcid?, urinaryProtein? }
 *     confidences:  same keys, 0–100
 *     matches:      optional same keys, { snippet, patternId } from extractor
 *     mock:         boolean — show a "mock data" banner
 *     onConfirm:    (final, meta) => Promise|void
 *                   final = { creatinine, urea, egfr, uricAcid, urinaryProtein }
 *                   meta  = { reportDate, manuallyCorrected, perFieldEdited:{}, avgConfidence }
 *
 *   validate(key, value) -> { ok, message? }
 *     Reusable plausibility check used by manual entry too.
 * ------------------------------------------------------------------ */
(() => {

  const FIELDS = [
    { key:'creatinine',     id:'cr',   unit:'mg/dL',  step:'0.01' },
    { key:'egfr',           id:'egfr', unit:'mL/min', step:'0.1'  },
    { key:'urea',           id:'bun',  unit:'mg/dL',  step:'1'    },
    { key:'uricAcid',       id:'ua',   unit:'mg/dL',  step:'0.1'  },
    { key:'urinaryProtein', id:'prot', unit:'g/24h',  step:'0.01' },
  ];

  // Plausibility ranges (mirrors RABiomarker._ranges but soft-warning, not hard reject)
  const SOFT_RANGES = {
    creatinine:     { lo: 0.3,  hi: 15,  refLo: 0.7, refHi: 1.3 },
    egfr:           { lo: 5,    hi: 150, refLo: 60,  refHi: 120 },
    urea:           { lo: 3,    hi: 150, refLo: 7,   refHi: 20  },
    uricAcid:       { lo: 1,    hi: 15,  refLo: 3.4, refHi: 7.0 },
    urinaryProtein: { lo: 0,    hi: 10,  refLo: 0,   refHi: 0.15 },
  };

  function validate(key, value){
    if (value == null || value === '' || !Number.isFinite(value)){
      return { ok: true };  // empty is allowed; downstream decides if min count met
    }
    const r = SOFT_RANGES[key];
    if (!r) return { ok: true };
    if (value < r.lo || value > r.hi){
      return { ok: false, level: 'error', message: RAi18n.t('extraction.implausible', { lo: r.lo, hi: r.hi }) };
    }
    if (value < r.refLo || value > r.refHi){
      return { ok: true, level: 'warn', message: RAi18n.t('extraction.outOfReference', { lo: r.refLo, hi: r.refHi }) };
    }
    return { ok: true, level: 'ok' };
  }

  function confTier(n){
    if (n == null) return 'conf-low';
    return n >= 90 ? 'conf-high' : n >= 80 ? 'conf-med' : 'conf-low';
  }

  function badgeForConfidence(conf, missing){
    if (missing) return `<span class="conf-badge conf-low">${RAi18n.t('extraction.missing')}</span>`;
    return `<span class="conf-badge ${confTier(conf)}">${conf.toFixed(0)}%${conf<85?' ⚠':''}</span>`;
  }

  function aggregateConfidence(c){
    const vals = Object.values(c).filter(v => Number.isFinite(v));
    return vals.length ? vals.reduce((a,b) => a+b, 0) / vals.length : 0;
  }

  function render({ container, values={}, confidences={}, matches={}, mock=false, onConfirm }){
    const filled = FIELDS.filter(f => values[f.key] != null).length;
    const avg    = aggregateConfidence(confidences);
    const tierClass = avg >= 90 ? 'badge-normal' : avg >= 80 ? 'badge-risk' : avg > 0 ? 'badge-critical' : 'badge-muted';
    const today  = new Date().toISOString().slice(0, 10);

    container.innerHTML = `
      <div class="flex-between mb-12">
        <div class="section-title" style="margin:0">${RAi18n.t('upload.ocrConfirm')}</div>
        ${filled
          ? `<span class="badge ${tierClass}">${avg.toFixed(1)}% avg · ${filled}/5</span>`
          : `<span class="badge badge-muted">${RAi18n.t('extraction.noMatches')}</span>`}
      </div>

      ${mock ? `
        <div class="alert-banner alert-info">
          <div class="alert-icon">ℹ</div>
          <div>
            <div class="alert-title">${RAi18n.t('extraction.mockTitle')}</div>
            <div class="alert-sub">${RAi18n.t('extraction.mockSub')}</div>
          </div>
        </div>` : ''}

      ${(!mock && filled > 0 && filled < 3) ? `
        <div class="alert-banner alert-warn">
          <div class="alert-icon">⚠</div>
          <div>
            <div class="alert-title">${RAi18n.t('upload.needsReview')}</div>
            <div class="alert-sub">${RAi18n.t('extraction.partialSub', { filled })}</div>
          </div>
        </div>` : ''}

      <div id="ext-fields">
        ${FIELDS.map(f => fieldRow(f, values[f.key], confidences[f.key], matches[f.key])).join('')}
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">${RAi18n.t('extraction.reportDate')}</label>
          <input type="date" id="ext-date" value="${today}">
        </div>
        <div class="form-group">
          <label class="form-label">${RAi18n.t('extraction.lab')}</label>
          <input type="text" id="ext-lab" placeholder="Chughtai Labs">
        </div>
      </div>

      <button class="btn btn-primary w-full" id="ext-confirm" disabled>${RAi18n.t('upload.confirmAnalyze')}</button>
      <div id="ext-form-error" class="muted mt-8" style="font-size:11px;text-align:center"></div>
    `;

    // Track manual edits per-field
    const edited = Object.fromEntries(FIELDS.map(f => [f.key, false]));
    FIELDS.forEach(f => {
      const input = container.querySelector(`#ext-${f.id}`);
      input.addEventListener('input', () => {
        edited[f.key] = true;
        validateField(f, input);
        updateConfirmState();
        // bump badge to "edited" tier
        const badge = container.querySelector(`#ext-badge-${f.id}`);
        if (badge){
          badge.className = 'conf-badge conf-high';
          badge.textContent = RAi18n.t('extraction.edited');
        }
      });
      // initial validation
      validateField(f, input);
    });

    function validateField(f, input){
      const val = input.value === '' ? null : parseFloat(input.value);
      const v = validate(f.key, val);
      const help = container.querySelector(`#ext-help-${f.id}`);
      if (!help) return;
      if (val == null){
        help.textContent = '';
        help.className = 'bio-sub';
        input.style.borderColor = '';
      } else if (!v.ok){
        help.textContent = v.message || '';
        help.className = 'text-red';
        help.style.fontSize = '11px';
        input.style.borderColor = 'var(--red)';
      } else if (v.level === 'warn'){
        help.textContent = v.message || '';
        help.className = 'text-amber';
        help.style.fontSize = '11px';
        input.style.borderColor = 'var(--amber)';
      } else {
        help.textContent = RAi18n.t('extraction.refRange', { lo: SOFT_RANGES[f.key].refLo, hi: SOFT_RANGES[f.key].refHi });
        help.className = 'text-green';
        help.style.fontSize = '11px';
        input.style.borderColor = 'var(--green)';
      }
    }

    function updateConfirmState(){
      const btn = container.querySelector('#ext-confirm');
      const errEl = container.querySelector('#ext-form-error');
      const finalRaw = collect();
      const filledNow = FIELDS.filter(f => Number.isFinite(finalRaw[f.key])).length;
      const anyError = FIELDS.some(f => {
        const v = finalRaw[f.key];
        return v != null && !validate(f.key, v).ok;
      });
      btn.disabled = filledNow < 2 || anyError;
      errEl.textContent = anyError
        ? RAi18n.t('extraction.fixErrors')
        : (filledNow < 2 ? RAi18n.t('extraction.needTwo') : '');
    }

    function collect(){
      const out = {};
      for (const f of FIELDS){
        const input = container.querySelector(`#ext-${f.id}`);
        const v = input.value === '' ? null : parseFloat(input.value);
        out[f.key] = Number.isFinite(v) ? v : null;
      }
      return out;
    }

    container.querySelector('#ext-confirm').onclick = async () => {
      const final = collect();
      const reportDate = container.querySelector('#ext-date').value || today;
      const lab = container.querySelector('#ext-lab').value.trim() || 'Auto-detected';
      const meta = {
        reportDate, lab,
        manuallyCorrected: Object.values(edited).some(Boolean),
        perFieldEdited: edited,
        avgConfidence: aggregateConfidence(confidences),
      };
      try {
        await onConfirm?.(final, meta);
      } catch (e){
        console.error(e);
        RAToast(e.message || 'Failed to save', 'err');
      }
    };

    updateConfirmState();
  }

  function fieldRow(f, value, conf, match){
    const missing = value == null;
    const label = `${RAi18n.t('biomarker.'+f.key)} (${f.unit})`;
    const snippet = match?.snippet ? `<details class="muted" style="font-size:11px;margin-top:4px"><summary style="cursor:pointer">${RAi18n.t('extraction.matched')}</summary><code style="display:block;margin-top:4px;padding:6px 8px;background:var(--bg3);border-radius:6px;font-family:var(--mono);font-size:11px;color:var(--text2);word-break:break-all">${escapeHtml(match.snippet)}</code></details>` : '';
    return `
      <div class="form-group">
        <label class="form-label">${label}</label>
        <div class="ocr-field">
          <input type="number" step="${f.step}" id="ext-${f.id}" value="${value ?? ''}">
          <span id="ext-badge-${f.id}">${badgeForConfidence(conf, missing)}</span>
        </div>
        <div class="bio-sub" id="ext-help-${f.id}"></div>
        ${snippet}
      </div>`;
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  window.RAExtraction = { render, validate, FIELDS, SOFT_RANGES };
})();
