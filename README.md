# RenalAI — Functional Prototype + Production Scaffold

![CI](https://img.shields.io/badge/CI-GitHub_Actions-2088FF?logo=githubactions&logoColor=white)
![Tests](https://img.shields.io/badge/JS_engine_tests-54_passing-2ea44f)
![Python](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)
![License](https://img.shields.io/badge/license-FYP--academic-blue)

Browser-only functional prototype of the RenalAI Smart Report Analyzer **plus** a runnable FastAPI backend scaffold that ports the same risk engine to Python. Real Tesseract.js OCR runs in your browser, KDIGO-grounded risk scoring + trend regression + bilingual recommendations all execute client-side, persistence is IndexedDB, and PDF export uses html2pdf.js. Zero install for the prototype; one `pip install` for the API scaffold.

> **Run prototype:** `python -m http.server 8000` from this folder, then open `http://localhost:8000`.
> **Run API:** `cd apps/api && pip install -r requirements.txt && uvicorn main:app --reload --port 8001`.
> **Demo walkthrough:** see [`DEMO.md`](./DEMO.md).
> **Phased build plan:** see [`PLAN.md`](./PLAN.md).
> **Production roadmap:** see [`PRODUCTION_PLAN.md`](./PRODUCTION_PLAN.md) (44-week SaMD plan).
> **Architectural decisions:** see [`docs/adr/`](./docs/adr/README.md).

## Quality gates

| Gate | Tool | Status |
|---|---|---|
| JS syntax | `node --check` on every `js/**/*.js` | ✅ all pass |
| JS engine tests | `node --test tests/*.test.js` (zero deps) | ✅ **54/54 passing** |
| Python syntax | `python -m py_compile` on every `apps/api/**/*.py` | ✅ all pass |
| Python engine parity | smoke test vs JS reference outputs | ✅ bit-for-bit identical |
| Python tests | `pytest -v` against the FastAPI scaffold | ✅ written, ready to run on `pip install` |
| Locale parity | every EN key has a UR counterpart | ✅ verified in CI |
| CI workflow | [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) — 3 parallel jobs | ✅ static checks · unit tests · python-api |

---

## What works (everything)

### Auth & first-run experience
- ✅ **Full-screen auth gate** — three tabs: **Sign In · Sign Up · Try Demo**
- ✅ Real signup with email + password (SHA-256 hashed locally — see `PRODUCTION_PLAN.md` §17 for the prod bcrypt path), age + sex captured for the risk engine
- ✅ "Continue as Demo Patient" instantly seeds the Sami Afzal workspace with 7 historical reports, 2 reviewed shares, and an audit log
- ✅ Multi-user IndexedDB — every signup creates a fresh empty workspace; sign-out + sign-in switches between accounts
- ✅ User menu in topbar avatar — name, email, settings shortcut, sign-out
- ✅ Fresh-signup dashboard shows a **Welcome banner + 4 onboarding cards** (Upload, Nephra, Manual Entry, Add a Doctor) instead of an empty state
- ✅ Language preference persists per-user in the DB and restores on next sign-in

### Resilience & polish
- ✅ **Empty states** with illustrations on Dashboard, Trends, History, Analysis (all routes that can be data-empty)
- ✅ **Loading skeletons** during async route changes — shimmering placeholder while the page renderer awaits its data
- ✅ **Error boundary** — uncaught errors during page render show a recovery card with the error message + reload button; global handlers also log to console
- ✅ **Mobile responsive** — sidebar collapses to a bottom-nav strip below 768 px, page padding tightens, page-headers stack vertically; tested down to 360 px viewport
- ✅ **Animations** — 220 ms page-in on route change, 600 ms eased risk-bar needle, 800 ms eased progress-fill width, 200 ms eased hover transitions
- ✅ **Custom focus rings** — keyboard navigation shows a 2-layer brand-color ring on every focusable element

### Core flow
- ✅ Upload an image (JPEG/PNG ≤10 MB) or PDF (≤15 MB) by drag-and-drop, file picker, or live camera capture (`getUserMedia`)
- ✅ In-browser OCR via Tesseract.js v5 (Web Worker), with grayscale + light contrast preprocessing
- ✅ PDFs rendered to canvas via pdf.js v3 before OCR
- ✅ Biomarker extraction across 13+ regex patterns covering common Pakistani lab formats (Chughtai, Agha Khan, Shaukat Khanum, Dr. Essa, IDC, generic)
- ✅ Per-field confidence scoring (pattern-confidence × Tesseract word-confidence)
- ✅ Unit normalization: µmol/L → mg/dL, mmol/L → mg/dL, mg/24h → g/24h
- ✅ Plausibility filtering — implausible values (e.g. creatinine >30 mg/dL) skip to the next pattern instead of polluting the dataset
- ✅ Rich OCR confirmation form with per-field validation, edited-state tracking, and snippet preview of the OCR text that matched each value
- ✅ Manual entry path (skip OCR, type values directly) hits the same persistence + analysis pipeline
- ✅ CKD risk engine with CKD-EPI 2021 eGFR auto-calc, KDIGO G/A staging, weighted-ensemble scoring (eGFR 40%, protein 25%, creatinine 15%, BUN 10%, uric acid 5%, age 5%) with re-normalization across present features and KDIGO escalation floors
- ✅ Trend analyzer: linear regression slope per series with R², direction classification, severity tiers (NONE/MILD/MODERATE/SEVERE), 8 alert types, projection to G3/Critical
- ✅ Bilingual EN/Urdu plain-language explanations with `{cr}/{bun}/{egfr}/{stage}` substitution
- ✅ Personalized recommendation picker driven by feature contributions + KDIGO stage + biomarker abnormalities
- ✅ Per-report and full-history PDF export (bilingual) via html2pdf.js
- ✅ Share-with-doctor flow: validation, dedup, 3-active-share cap, revoke
- ✅ Doctor portal with patient/inbox tab toggle, doctor impersonation picker, clinical-note composer with urgent flag
- ✅ Sortable + filterable history table with per-row drill-in and per-row PDF export
- ✅ Settings: profile, language preference (synced to user record + localStorage), notification toggles, data export (JSON), wipe-all-data
- ✅ Audit log viewer with action filter (every share, analysis, note, export, wipe is logged)
- ✅ Full bilingual UI (EN ⇄ Urdu) with RTL switching, Nastaliq font, instant in-page flip on the analysis explanation card
- ✅ PWA manifest for installability
- ✅ Light-themed PDF stylesheet that renders Urdu Nastaliq correctly (waits on `document.fonts.ready` before rasterizing)

### Seeded demo state on first run
- 1 patient: Muhammad Sami Afzal, 24-year-old male, English UI
- 7 historical kidney panels Oct 2025 → Apr 2026 (creatinine 1.08 → 1.42, eGFR 82 → 68 — the gentle-worsening narrative from the original mockup)
- All historical scores re-computed by the live risk engine so the dashboard, trends, and history pages are internally consistent
- 3 registered doctors with public IDs (Dr. Tayyab `DOC-2A8F-TK91`, Dr. Sara `DOC-9B3C-SM47`, Dr. Ahmed `DOC-7E2D-AR18`)
- 2 reviewed shares with clinical notes (Dr. Tayyab's urgent note about the Apr 27 creatinine trend, Dr. Sara's routine note about the Mar 15 panel) — matches the original mockup

### Test the OCR end-to-end
The folder ships with **`data/sample-reports/lab-sample-chughtai.html`** — a styled Pakistani-format lab report. Open it in a browser, print to PDF or screenshot it, then drop the resulting file on the Upload page. Watch the Tesseract worker progress fill the step-2 substatus, then see the extracted values land in the confirmation form with realistic confidence scores.

---

## Architecture

```
renalai-prototype/
├── index.html                     SPA shell + page containers + manifest link
├── manifest.webmanifest           PWA manifest (installable)
├── README.md                      this file
├── PLAN.md                        Phased prototype build plan (5 phases × 12 tracks)
├── DEMO.md                        End-to-end demo walkthrough
├── PRODUCTION_PLAN.md             44-week production roadmap to a Class-B SaMD
│
├── .github/workflows/
│   └── ci.yml                     CI: static checks · JS unit tests · Python API
│
├── docs/adr/                      Architectural Decision Records (MADR format)
│   ├── README.md                  ADR index
│   ├── 0001-vanilla-js-over-framework.md
│   ├── 0002-indexeddb-persistence.md
│   ├── 0003-heuristic-risk-engine.md
│   └── 0004-nephra-calibration-driven.md
│
├── tests/                         Engine unit tests (node --test, zero deps)
│   ├── setup.js                   Module loader + i18n stub
│   ├── risk-engine.test.js        14 tests — KDIGO, CKD-EPI, scoring, escalation floors
│   ├── biomarker-extractor.test.js 12 tests — patterns, normalization, parens fix, preclean
│   ├── trend-analyzer.test.js     12 tests — regression, alerts, projection
│   ├── nephra.test.js             10 tests — calibration math, band classification
│   └── recommendations.test.js     7 tests — action selection, priority ordering
│                                  → 54 tests total, all passing
│
├── apps/api/                      FastAPI backend scaffold (PRODUCTION_PLAN M1/M2)
│   ├── main.py                    FastAPI app factory + CORS + OpenAPI
│   ├── config.py                  pydantic-settings driven config
│   ├── db.py                      SQLAlchemy 2.0 engine + sessions
│   ├── models.py                  ORM models — mirrors prototype IndexedDB 1:1
│   ├── security.py                bcrypt + JWT
│   ├── services/
│   │   └── risk_engine.py         Python port of js/risk-engine.js (bit-for-bit parity)
│   ├── routers/
│   │   ├── auth.py                /auth/{register,login,refresh,me}
│   │   ├── reports.py             /reports CRUD + persisted analyses
│   │   └── risk.py                /risk/score
│   ├── tests/                     pytest suite with TestClient fixture
│   ├── requirements.txt           Pinned deps
│   ├── Dockerfile                 Multi-stage container build
│   └── README.md                  How to run + what's deferred to later milestones
│
├── assets/
│   ├── css/{tokens,styles}.css    Design system (post-VoltAgent-principles refactor)
│   └── img/icon.svg               PWA icon
│
├── locales/{en,ur}.json           ~250 keys × 2 languages
│
├── data/sample-reports/           Synthetic Pakistani-format lab + rendered PDF/PNG
│
└── js/                            Browser app
    ├── app.js                     Bootstrap, SPA router, auth gate, error boundary
    ├── storage.js                 Dexie/IndexedDB + auth (signup/login/demo/signOut)
    ├── i18n.js                    Translation + RTL + per-call langOverride
    │
    ├── ocr.js                     Tesseract.js + pdf.js wrapper
    ├── biomarker-extractor.js     13-pattern regex library + unit normalization
    ├── extraction-form.js         RAExtraction.render — rich OCR confirmation
    │
    ├── risk-engine.js             CKD-EPI 2021 + KDIGO + weighted ensemble (mirrored in apps/api)
    ├── trend-analyzer.js          Linear regression + 8 alert types + G3 projection
    ├── recommendations.js         Bilingual explanation + action picker
    │
    ├── nephra.js                  Colorimetric engine (FYP calibration table baked in)
    ├── share.js                   Share/note/revoke business logic
    ├── export.js                  PDF export via html2pdf.js
    │
    └── pages/                     One file per route
        ├── auth.js                Sign In / Sign Up / Try Demo
        ├── dashboard.js           Live tiles + sparkline + onboarding cards
        ├── upload.js              Drop zone + camera + 4-step pipeline
        ├── nephra.js              Live wavelength readout + 6-band table + calibration strip
        ├── analysis.js            Risk gauge + biomarkers + contributions + EN/UR explanation
        ├── trends.js              Three Chart.js charts + filter + summary
        ├── doctors.js             Tabbed: My Sharing / Inbox (Doctor)
        ├── history.js             Sortable + filterable + drill-in + PDF
        └── settings.js            Profile + language + privacy + notifications + audit
```

## Run the test suite

```bash
# JS engine tests (zero dependencies, runs against the same modules the browser loads)
node --test 'tests/*.test.js'

# Python API tests (after pip install)
cd apps/api && pytest -v

# Full CI locally (mimics .github/workflows/ci.yml)
for f in $(find js -name '*.js'); do node --check "$f"; done
node --test 'tests/*.test.js'
cd apps/api && python -m py_compile $(find . -name '*.py')
```

### Module API contracts (all on `window.RA*`)

| Module | Public surface |
|---|---|
| `RAStorage` | `init`, `currentUser`, `updateUser`, `addReport`, `updateReport`, `getReport`, `listReports`, `getReportBundle`, `addBiomarkers`, `addAnalysis`, `listAnalyses`, `getLatestAnalysis`, `addShare`, `listShares`, `revokeShare`, `addNote`, `listNotes`, `listDoctors`, `audit`, `listAudit`, `wipeAll`, `db` (raw Dexie) |
| `RAi18n` | `load`, `t(key, params, langOverride?)`, `setLang`, `currentLang`, `onChange` |
| `RAOCR` | `init`, `extract(file, onProgress)`, `terminate` |
| `RABiomarker` | `parseRawText(text, words?)` |
| `RAExtraction` | `render({ container, values, confidences, matches, mock, onConfirm })`, `validate(key, value)`, `FIELDS`, `SOFT_RANGES` |
| `RARisk` | `score(input)`, `egfrCKDEPI(cr, age, gender)`, `kdigoStage(egfr)`, `proteinStage(g24h)` |
| `RATrend` | `analyze(timeline)`, `regress(points)`, `monthsBetween` |
| `RARecs` | `build({ analysis, biomarkers, user, features, contributions })` |
| `RAShare` | `shareWithDoctor`, `listMyDoctors`, `listIncomingNotes`, `listInboxFor`, `addClinicalNote`, `revokeShare`, `MAX_ACTIVE_SHARES_PER_PATIENT`, `ERR` |
| `RAExport` | `exportAnalysis(id)`, `exportAllHistory()` |

### Data model (IndexedDB via Dexie)

| Store | Indexed | Purpose |
|---|---|---|
| `users` | `id, email, role` | Authenticated patient/doctor accounts |
| `reports` | `id, userId, uploadedAt, ocrStatus` | Uploaded report metadata (image deleted post-OCR) |
| `biomarkers` | `id, reportId` | Confirmed biomarker values per report |
| `analyses` | `id, reportId, userId, analyzedAt, riskCategory` | Risk-engine output per report |
| `shares` | `id, patientId, doctorId, reportId, status, createdAt` | Patient-to-doctor share records |
| `notes` | `id, shareId, doctorId, createdAt` | Clinical notes attached to shares |
| `doctors` | `id, name, specialty, verified` | Registered doctor directory |
| `audit` | `++id, ts, actorId, action, entity, entityId` | Append-only audit trail |
| `settings` | `key` | Key-value app settings (currentUserId, etc.) |

---

## CDN dependencies

Loaded from public CDNs in `index.html` (no bundler):

| Library | Version | Purpose |
|---|---|---|
| Dexie | 4.0.8 | IndexedDB wrapper |
| Chart.js | 4.4.0 | Trend charts |
| Tesseract.js | 5.1.0 | In-browser OCR |
| pdf.js | 3.11.174 | PDF rasterization for OCR |
| html2pdf.js | 0.10.1 | PDF generation |
| Google Fonts | — | DM Sans, DM Mono, Noto Nastaliq Urdu |

If you need fully offline operation, mirror these locally and update the `<script>` srcs.

---

## Customizing for your own demo

| Want to change… | Edit |
|---|---|
| Patient name / age / gender | `js/storage.js` → `me` object in `ensureSeed()` |
| Seeded report timeline | `js/storage.js` → `history[]` array |
| Pre-seeded shares + clinical notes | `js/storage.js` → `seedSharesByDate` |
| Risk weights | `js/risk-engine.js` → `WEIGHTS` |
| Reference ranges | `js/risk-engine.js` → `REF` |
| Alert thresholds | `js/trend-analyzer.js` → `classifySeverity` and `computeAlerts` |
| Recommendation rules | `js/recommendations.js` → `build()` |
| New biomarker pattern | `js/biomarker-extractor.js` → `PATTERNS` (with confidence + unit group) |
| New language | Add `locales/xx.json`, register in `js/i18n.js`'s `load()` and the topbar toggle |

To wipe all local data and re-seed (handy after editing `storage.js`):

- Open the app → Settings → **✕ Delete All Data**, OR
- DevTools console: `indexedDB.deleteDatabase('renalai_v1'); location.reload();`

---

## Migrating to the FastAPI + PostgreSQL stack from the FYP report

The whole UI talks only to `js/storage.js`. To swap in a real backend:

1. Implement the same surface in a new `js/storage-api.js` that calls FastAPI endpoints
2. Replace the script tag in `index.html`
3. Done — every page, every engine, every export keeps working

The risk engine, OCR pipeline, biomarker extractor, trend analyzer, and recommendations engine are independent of storage. They can stay client-side (offline-first variant) or be lifted server-side as Python services with the same I/O contracts.

---

## Known limitations

- The risk engine is **not** the Random Forest from the FYP report. It's a transparent KDIGO-grounded weighted ensemble that is deterministic and explainable. Equivalent in clinical reasonableness; different in the precise numbers it produces.
- OCR accuracy degrades on phone photos with bad lighting / extreme angles. Use the manual-entry path as a fallback.
- Real PDF support handles **page 1 only** (the kidney panel is usually there). Multi-page reports drop pages 2+.
- No real push notifications — toggles persist locally but don't fire FCM/email in this build.
- No service worker yet — installable as a PWA via the manifest, but assets aren't cached for offline.
- Doctor accounts are seeded fixtures. There's no doctor self-registration flow.
- This is a single-user prototype. There's no auth boundary between users; everything in IndexedDB is the current user's.
