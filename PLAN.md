# RenalAI – Functional Prototype Plan

A runnable, no-build, browser-only prototype of the RenalAI Smart Report Analyzer. Mirrors the FYP report's user flows end-to-end with real OCR (Tesseract.js), real risk scoring (JS-coded ensemble + KDIGO rules), real persistence (IndexedDB), and full bilingual EN/Urdu UI.

## Stack
- **HTML/CSS/JS** — vanilla, no framework, no build step
- **Tesseract.js v5** — OCR (CDN, runs in a Web Worker)
- **Chart.js v4** — trend charts (CDN)
- **Dexie.js v4** — IndexedDB wrapper (CDN)
- **html2pdf.js** — PDF export (CDN)
- **No backend** in v1; all logic runs client-side

## Why this stack
Zero install. Open `index.html` (or run `python -m http.server 8000`) and the app works. Later phases can swap in a FastAPI backend without touching UI code, since all data access goes through `js/storage.js`.

---

## Phase 1 — Foundation & Scaffolding
Three independent tracks; can be developed in parallel by different contributors.

| Track | Owner role | Deliverable |
|---|---|---|
| **1A** Shell & Design System | Frontend lead | `index.html` (sidebar/topbar/page container shell), `assets/css/tokens.css`, `assets/css/styles.css` (extracted from existing mockup), `js/app.js` SPA router, `js/pages/*.js` empty page stubs |
| **1B** Storage Layer | Backend/data lead | `js/storage.js` — Dexie schema for `users`, `reports`, `biomarkers`, `analyses`, `trends`, `shares`, `clinicalNotes`, `auditLog`; CRUD helpers; seed loader |
| **1C** i18n Engine | Localization lead | `js/i18n.js` — translation function, RTL switching, persistent language pref; `locales/en.json` + `locales/ur.json` (initial keys for shell/nav) |

**Acceptance:** opening `index.html` shows the empty shell; sidebar nav switches between 7 page stubs; EN/Urdu toggle flips RTL; seed user persists across reloads.

---

## Phase 2 — Ingestion Pipeline
Three tracks; each touches different files.

| Track | Deliverable |
|---|---|
| **2A** Upload UI | `js/pages/upload.js` — drag/drop, file picker, camera (`getUserMedia`), file validation (JPEG/PNG ≤10MB, PDF ≤15MB), 4-step progress UI |
| **2B** OCR Engine | `js/ocr.js` — Tesseract.js worker init (eng+urd), image preprocessing (canvas-based grayscale + adaptive threshold), confidence aggregation; `js/biomarker-extractor.js` — 30+ regex patterns for creatinine/BUN/eGFR/uric acid/protein across 6 PK lab formats, value normalization, physiological range validation |
| **2C** Confirmation & Manual Entry | OCR confirmation screen with editable inputs + per-field confidence badges; full manual entry form with same validation pipeline |

**Acceptance:** upload a sample lab JPEG → OCR runs in-browser → biomarkers extracted with confidence scores → user confirms/edits → record persisted to IndexedDB.

---

## Phase 3 — Intelligence Layer
Three tracks; share only the storage interface.

| Track | Deliverable |
|---|---|
| **3A** Risk Engine | `js/risk-engine.js` — feature engineering (BUN/Cr ratio, age-adjusted z-score, KDIGO eGFR stage), weighted-ensemble scoring → 0–100 risk + Normal/At Risk/Critical category + confidence; CKD-EPI eGFR auto-calc when missing |
| **3B** Trend Analyzer | `js/trend-analyzer.js` — linear regression slope across stored analyses, deterioration thresholds (slope >+2/mo, eGFR<60 first-time, Cr ↑>0.3/mo for 3 reports), severity classification (Mild/Moderate/Severe) |
| **3C** Recommendations & Explanations | `js/recommendations.js` — bilingual plain-language explanation generator + personalized actions keyed off biomarker abnormalities; templates in `locales/*.json` |

**Acceptance:** confirmed biomarkers → instant risk score → category badge → bilingual explanation → trend chart re-renders with the new data point and fires alert if thresholds cross.

---

## Phase 4 — Collaboration, History & Settings
Three tracks; touch independent pages.

| Track | Deliverable |
|---|---|
| **4A** Doctor Portal | `js/pages/doctors.js` + `js/share.js` — share-with-doctor flow (mock doctor directory in `data/seed.json`), pending/reviewed status, clinical notes panel (read for patient, write for doctor role), revoke access |
| **4B** History & Export | `js/pages/history.js` — sortable/filterable table of all analyses, per-row drill-in to `analysis.js`; PDF export via html2pdf.js with EN+UR sections |
| **4C** Settings & Privacy | `js/pages/settings.js` — profile editor, language pref, notification toggles persisted; privacy controls: "delete report image now" + "wipe all data" with confirmation; audit log viewer |

**Acceptance:** all 7 pages from the original mockup are functional with real data flowing through them.

---

## Phase 5 — Integration & Demo Polish (sequential)
- E2E wiring & regression pass
- `data/seed.json` populated with the 7 historical reports from the mockup so the dashboard looks alive on first load
- Sample lab images bundled in `assets/sample-reports/` for demo upload
- `README.md` with run instructions, demo script, and architecture notes
- PWA manifest + service worker for offline upload queue (stretch goal)

---

## Parallelism Map

```
Phase 1: [1A]  [1B]  [1C]    (all parallel)
Phase 2: [2A]  [2B]  [2C]    (all parallel — 2A and 2C consume 2B's API surface, mockable)
Phase 3: [3A]  [3B]  [3C]    (all parallel)
Phase 4: [4A]  [4B]  [4C]    (all parallel)
Phase 5:           (sequential integration)
```

Inter-phase dependencies:
- Phase 2 needs Phase 1's storage + shell.
- Phase 3 needs Phase 2's confirmed biomarkers schema.
- Phase 4 needs Phase 3's analysis records.
- Phase 5 needs everything.

Within each phase, the three tracks share only typed interfaces (documented at the top of each module file) and can be developed against stubs.

---

## File map (final state)

```
renalai-prototype/
├── PLAN.md                          (this file)
├── README.md
├── index.html
├── assets/
│   ├── css/{tokens,styles}.css
│   ├── img/logo.svg
│   └── sample-reports/*.jpg
├── locales/{en,ur}.json
├── data/seed.json
└── js/
    ├── app.js                       router + init
    ├── storage.js                   IndexedDB
    ├── i18n.js                      translation
    ├── ocr.js                       Tesseract wrapper
    ├── biomarker-extractor.js       regex pipeline
    ├── risk-engine.js               scoring
    ├── trend-analyzer.js            slopes + alerts
    ├── recommendations.js           bilingual templates
    ├── share.js                     doctor sharing
    └── pages/
        ├── dashboard.js
        ├── upload.js
        ├── analysis.js
        ├── trends.js
        ├── doctors.js
        ├── history.js
        └── settings.js
```
