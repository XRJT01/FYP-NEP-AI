# RenalAI Production Plan v1.0
**Owner:** BSSE‑FYP‑F25‑052 team · **Supervisor:** Dr. Tayyab Khusi · **Target:** clinically deployable Class‑B SaMD (DRAP‑aligned)

---

## 1. Executive summary

The prototype in this folder is a vanilla‑JS, browser‑only demo of every screen and flow. It is **not** the production system. To ship to real Pakistani patients we must rebuild the application on a true full‑stack architecture (FastAPI + PostgreSQL + React + React Native), train real ML models against real data, and pass the security, observability, and regulatory bars demanded by a clinical decision‑support tool.

This plan defines the destination, sequences the work into 12 milestones across 9 parallel workstreams, and gives concrete acceptance criteria for each milestone so progress is auditable. Total runway: **44–48 weeks** with the existing 3‑person team.

| Aspect | Prototype (today) | Production (target) |
|---|---|---|
| Risk engine | KDIGO‑weighted heuristic in JS | Trained Random Forest in Python, served via API |
| Nephra | Color‑depth heuristic | MobileNetV3 CNN trained on labeled tube images |
| OCR | Tesseract.js in browser | Tesseract 5.x + Google Vision fallback, server‑side worker queue |
| Biomarker NER | 13 regex patterns | spaCy NER trained on 500 annotated PK lab reports |
| Persistence | IndexedDB | PostgreSQL 14 with RLS, pgcrypto, append‑only audit |
| Auth | None | JWT (RS256) + refresh tokens, RBAC, anomaly detection |
| Bilingual | EN/UR JSON dictionaries | Same, plus AI‑generated UR explanations validated by native speakers |
| Mobile | None | Android React Native (Expo), iOS deferred to v1.1 |
| Tests | None | Unit ≥85%, integration, E2E (Playwright), load (Locust) |
| Compliance | None | DRAP Class B SaMD documentation pack, IRB‑approved validation study |

---

## 2. Explicitly out of scope for v1.0

Documented up‑front so we don't drift:

1. **iOS native app** — Android first; iOS targeted for v1.1
2. **HL7/FHIR lab integration** — manual upload only; partner labs in v1.2
3. **Insurance / billing integration** — out of scope entirely
4. **Languages beyond EN/UR** — Punjabi/Pashto deferred
5. **On‑device offline AI inference** — server inference only; on‑device CNN deferred to v1.1
6. **Voice interface / TTS** — deferred
7. **Wearable / continuous monitoring** — deferred
8. **Self‑service doctor signup** — admin verification required for every doctor account in v1.0

---

## 3. Architecture target state

```
                      Cloudflare CDN + DDoS
                              │
                       ┌──────┴──────┐
                       │  Web (PWA)  │   ◄──  React 18 + TS + Vite + Tailwind
                       │  + Android  │   ◄──  React Native + Expo
                       └──────┬──────┘
                              │ HTTPS / TLS 1.3
                              ▼
                        AWS ALB (WAF)
                              │
                ┌─────────────┼─────────────┐
                ▼             ▼             ▼
       FastAPI Gateway  WebSocket Hub  Static Assets
        (auth, RBAC,     (OCR status,   (S3 + CF)
         routing)        share notify)
                │
   ┌────────────┼────────────────┬──────────────────┐
   ▼            ▼                ▼                  ▼
 OCR Worker   Risk Service   Nephra Service   Notify Service
 (Celery+     (sklearn       (TF Serving      (FCM, SMTP,
  Tesseract+   joblib model,  CNN model,       in‑app)
  Vision API)  inference)     OpenCV pre)
                │
                ▼
   PostgreSQL 14 (RDS Multi‑AZ)
   • RLS per‑user
   • pgcrypto field encryption
   • Append‑only audit triggers
   • Daily snapshots, PITR

   Redis 7 (ElastiCache)
   • Session store, JWT denylist
   • Celery broker
   • Rate‑limit counters

   S3 (lifecycle 60‑min TTL on report images)
```

**Stack decisions (all defensible):**

| Layer | Choice | Why over alternatives |
|---|---|---|
| Backend framework | **Python FastAPI** | Native async, automatic OpenAPI, Pydantic validation, same language as ML stack — eliminates a language boundary for model serving |
| ORM | **SQLAlchemy 2.0** | Type‑safe core, mature RLS support, integrates with Alembic for migrations |
| Database | **PostgreSQL 14** | RLS, JSONB, pgcrypto, mature tooling. MongoDB rejected: no row‑level security and weak schema enforcement for clinical data |
| Cache / queue | **Redis 7** | Industry standard for both, integrates with Celery |
| Async tasks | **Celery + Redis** | OCR is bursty + needs retry — Celery handles both. Plain asyncio rejected because OCR processes are CPU‑bound and need separate workers |
| Web frontend | **React 18 + TypeScript + Vite** | Most candidate engineers know it; Vite is faster than CRA; TS is non‑negotiable for clinical |
| State mgmt | **Zustand + TanStack Query** | Lightweight; Query handles cache + invalidation. Redux rejected: too much boilerplate for our scope |
| Mobile | **React Native + Expo** | 60% code share with web via shared TS lib; Expo OTA = faster iteration |
| Auth | **JWT (RS256) + refresh** | Stateless API, mobile‑friendly. Session cookies rejected: complicates mobile + cross‑origin |
| ML models | **scikit‑learn for tabular, TF Lite for CNN** | RF is the right tool for tabular‑with‑missing; TF Lite enables future on‑device inference |
| Storage | **S3 + lifecycle policy** | Built‑in 60‑min auto‑delete satisfies privacy SLA without custom code |
| Deployment | **AWS ECS Fargate** | Serverless containers, auto‑scaling, no node management. Kubernetes rejected: operational overhead too high for FYP team |
| CI/CD | **GitHub Actions** | Already in the team's flow; supports matrix builds + secrets |

---

## 4. Workstream map

The 9 workstreams run in parallel. Some cross‑cut every milestone.

| # | Workstream | Lead | Cross‑cuts |
|---|---|---|---|
| W1 | **Backend & Data** | Sami | — |
| W2 | **ML / AI Models** | Sami | W1 (model serving) |
| W3 | **Frontend Web (PWA)** | Saud | W1 (API contracts), W5 (auth flows) |
| W4 | **Mobile (Android)** | Saud | W3 (shared TS lib) |
| W5 | **Security & Compliance** | Fakhar | every workstream |
| W6 | **DevOps & Observability** | Sami + Fakhar | every workstream |
| W7 | **Testing & QA** | Fakhar | every workstream |
| W8 | **Clinical Validation** | Supervisor + Fakhar | W2 (model output) |
| W9 | **Documentation & Regulatory** | Fakhar + Supervisor | every workstream |

---

## 5. Sequenced milestones

Each milestone has: **goal · deliverables · acceptance · dependencies · duration**.

### M0 — Kickoff & decommission prototype as runnable demo *(1 week)*

- Goal: lock scope, freeze prototype as a reference, set up monorepo
- Deliverables:
  - `apps/api`, `apps/web`, `apps/mobile`, `packages/shared`, `infra/`, `ml/` directories
  - Frozen prototype tagged as `prototype-v1` and moved to `legacy/`
  - Decision document: which prototype components get ported (risk engine, trend analyzer, locale dictionaries) vs rewritten (storage, OCR, Nephra, all UI)
  - Coding standards: ESLint, ruff, mypy, prettier, EditorConfig
- Acceptance: monorepo CI green on empty scaffolds; legacy demo still runs from `legacy/renalai-prototype`
- Dependencies: none

### M1 — Backend foundations *(3 weeks)* · **W1, W6**

- Goal: FastAPI skeleton with JWT auth, Postgres schema, Alembic migrations, Docker Compose dev env
- Deliverables:
  - `apps/api` with FastAPI app factory, settings via pydantic‑settings
  - PostgreSQL schema for `users`, `reports`, `biomarkers`, `analyses`, `shares`, `notes`, `doctors`, `audit_events`, `sessions` — all from FYP report Ch 4.10
  - Alembic baseline migration (forward‑only)
  - JWT (RS256) issuer + refresh flow + denylist via Redis
  - bcrypt password hashing (cost 12)
  - Row‑Level Security policies enforcing per‑user data isolation
  - pgcrypto field encryption on `email`, `doctor_id`
  - Append‑only audit trigger (any UPDATE/DELETE on `audit_events` raises)
  - `docker-compose.yml` for local dev (api, postgres, redis, mailhog)
  - OpenAPI 3.1 schema published at `/api/v1/openapi.json`
- Acceptance:
  - All endpoints return 401 without JWT
  - Cross‑user `SELECT` returns 0 rows even with manipulated JWT
  - `pytest` covers auth + schema migrations end‑to‑end
  - `bandit` and `safety` clean
- Dependencies: M0

### M2 — Storage abstraction in client + first end‑to‑end ingest *(3 weeks)* · **W1, W3, W7**

- Goal: web client reads/writes via API instead of IndexedDB; first real upload→OCR→analysis flow lands in DB
- Deliverables:
  - React 18 + Vite + TS scaffold with Tailwind config ported from prototype tokens
  - TanStack Query client with auth interceptors
  - Endpoints implemented: `POST /auth/{register,login,refresh}`, `POST /reports/upload` (multipart), `GET /reports/history`, `POST /reports/{id}/confirm`, `GET /analyses/{id}`
  - S3 multipart upload with presigned URLs
  - Celery worker pool with stub OCR task (returns mock biomarkers — real OCR lands in M3)
  - WebSocket channel for OCR status: `wss://api/ws/reports/{id}`
- Acceptance:
  - User registers → uploads JPEG → mock biomarkers persisted → analysis row created
  - WebSocket emits `OCR_COMPLETE` on stub worker finish
  - Playwright E2E covers register→upload→view‑history
- Dependencies: M1

### M3 — OCR service productionized *(3 weeks)* · **W2, W7**

- Goal: real OCR + biomarker extractor trained on real PK lab data
- Deliverables:
  - **Data**: 500 annotated PK lab reports (collected by team across Chughtai, Agha Khan, Shaukat Khanum, Essa, IDC, generic clinics). Annotation schema: image bbox + biomarker label + value + unit. Stored in `ml/data/labreports/` with train/val/test splits 70/15/15
  - **OCR pipeline**: Tesseract 5.x with `eng+urd` traineddata, OpenCV preprocessing (grayscale, adaptive threshold, deskew, contour crop). Google Vision fallback when Tesseract aggregate confidence <85%
  - **Biomarker NER**: spaCy v3 pipeline trained on annotated labels — replaces the regex library. Pattern library kept as a fallback when NER confidence is low
  - **Unit normalizer**: same logic as prototype `normalize()` but as a properly tested Python module
  - **Plausibility filter**: hard ranges from prototype `RANGES` table
  - Model card (`ml/models/ocr/MODEL_CARD.md`): training data, metrics, intended use, known limits
- Acceptance:
  - Held‑out test set: ≥92% biomarker extraction accuracy across 8 lab formats (matches FYP claim)
  - p95 latency end‑to‑end ≤15 s including pdf.js render
  - Confidence score correlates with extraction correctness (Pearson r ≥ 0.65 on validation set)
- Dependencies: M1, data‑collection effort starts in M0

### M4 — Risk engine v1 *(3 weeks)* · **W2, W7, W8**

- Goal: trained Random Forest classifier replacing the heuristic
- Deliverables:
  - **Training data**: UCI CKD dataset (400 instances) + 200 anonymized PK records with ethics‑board approved consent
  - **Feature engineering**: Cr, BUN, eGFR, uric acid, urinary protein, age, gender, BUN/Cr ratio, eGFR stage one‑hot, age‑adjusted Cr z‑score (Hussain 2018 PK reference ranges)
  - **Model**: `RandomForestClassifier(n_estimators=200)` with GridSearchCV over `max_depth ∈ {None, 10, 20}` and `min_samples_leaf ∈ {1, 2, 4}`. 5‑fold stratified CV
  - **Calibration**: Platt scaling so probability output is well‑calibrated (Brier ≤ 0.10)
  - **CKD‑EPI 2021** auto‑eGFR when missing — port from prototype `js/risk-engine.js`
  - **KDIGO escalation floors** — port from prototype
  - **Output**: 0–100 risk score from `P(at_risk)*50 + P(critical)*100`, plus 3‑class label, plus model confidence, plus per‑feature SHAP contributions for explainability
  - **Service**: `POST /api/v1/risk/score` returns full result; model loaded as `joblib` artifact at process start
  - **Model registry**: each trained model gets a `model_id` (semver), stored in `ml/models/risk/{id}/` with model card
- Acceptance:
  - Held‑out test: ≥94% accuracy, ≥92% sensitivity (Critical class), ≥95% specificity (Normal class), AUC‑ROC ≥0.97
  - SHAP values agree directionally with KDIGO clinical guidance (eGFR + protein dominate)
  - Inference latency p99 ≤ 500 ms per call
  - Reproducibility: identical retrain → identical model hash given same seed
- Dependencies: M1, ethics approval in flight

### M5 — Nephra CNN + colorimetric service *(4 weeks)* · **W2, W7**

- Goal: replace heuristic depth → wavelength mapping with a trained CNN
- Deliverables:
  - **Image dataset**: ≥600 photographed test tubes spanning the full creatinine range, each labeled with the ground‑truth lab creatinine value. Lighting variations: indoor fluorescent, daylight, phone flash. Camera variations: 3 phone models (entry/mid/flagship)
  - **Tube ROI segmentation**: lightweight U‑Net or threshold‑based fallback that crops the liquid region from the tube before CNN
  - **Backbone**: MobileNetV3‑small fine‑tuned, regression head outputs a single creatinine value (not classification — we want continuous output)
  - **Loss**: Huber loss (robust to outliers in the tail)
  - **Augmentations**: brightness, contrast, hue jitter ±5°, white‑balance perturbation, JPEG compression, mild blur
  - **Calibration**: Wavelength reported as `wavelengthFromCreatinine(predicted_cr)` using the FYP linear calibration table — keeps the user‑facing wavelength value semantically tied to the output
  - **Service**: `POST /api/v1/nephra/scan` accepts multipart image, returns `{creatinine, wavelength, band, confidence, roi_bbox}`
  - **TF Lite export** for future on‑device inference
- Acceptance:
  - MAE ≤ 0.4 mg/dL on held‑out test set across all 3 phone models
  - p99 latency ≤ 3 s including ROI + CNN
  - Confidence calibration: predicted confidence correlates with absolute error (r ≥ 0.5)
  - Adversarial test: random non‑tube images return confidence ≤ 30
- Dependencies: M1, image collection in flight

### M6 — Doctor portal + sharing *(3 weeks)* · **W1, W3**

- Goal: full sharing flow with consent, revocation, clinical notes, and FCM notifications
- Deliverables:
  - DB tables: `report_shares`, `clinical_notes` with foreign keys + audit triggers
  - Endpoints: `POST /shares`, `DELETE /shares/{id}`, `GET /shares/received`, `POST /shares/{id}/notes`, `PATCH /notes/{id}` (within 72h edit window per BR‑07)
  - Doctor verification workflow: admin manually approves new doctor signups
  - Consent receipt: when share is created, an audit row is written and an immutable consent record is generated for legal traceability
  - Push notifications via Firebase Cloud Messaging
  - Email notifications via SES with templated HTML
  - 3‑active‑share cap enforced at API + DB constraint level
- Acceptance:
  - Cannot share with unverified doctor (returns 403)
  - 4th active share returns 409
  - Note editing after 72h returns 410
  - Patient revocation immediately removes doctor's read access (verified via RLS test)
- Dependencies: M2

### M7 — PWA hardening + offline + a11y *(3 weeks)* · **W3, W7**

- Goal: production‑grade web frontend
- Deliverables:
  - Service worker with Workbox: precache app shell, runtime cache for API GETs, **upload queue** for offline retries
  - WCAG 2.1 AA compliance: axe‑core CI gate at zero violations on every page; keyboard navigation tested manually for every interactive flow
  - Color‑contrast review (every text/background pair ≥ 4.5:1 normal, ≥ 3:1 large)
  - Screen‑reader testing with NVDA on Windows + TalkBack on Android
  - Form library: react‑hook‑form + zod schemas
  - Error boundaries on every route with Sentry integration
  - i18n: react‑i18next with namespace splitting; both EN and UR validated by native speakers (Urdu validation by 3 community testers, recorded sign‑off)
  - Lighthouse CI gate: Performance ≥80 mobile, Accessibility ≥95, Best Practices ≥95
- Acceptance:
  - Network‑disconnected: existing data viewable, new uploads queued and retried on reconnect
  - axe‑core CI run reports zero violations
  - SUS score ≥ 75 with 5 native Urdu speakers
- Dependencies: M2, M3, M4

### M8 — Android app *(5 weeks)* · **W4, W7**

- Goal: feature‑parity Android app via React Native + Expo
- Deliverables:
  - Shared TS package `packages/shared` with all types, validation schemas, locale dicts, API client
  - Camera screens for both report photo and Nephra tube scan with proper EXIF handling and orientation correction
  - Native push notifications (FCM) with deep links into report/share screens
  - Biometric auth (Android BiometricPrompt) for app unlock
  - Offline upload queue using AsyncStorage + reconnect retry
  - OTA updates configured via Expo
  - Play Store listing assets: 5 screenshots, feature graphic, description, privacy policy URL
- Acceptance:
  - All M3–M6 flows work on Android 8.0+ across 3 test devices
  - Cold start ≤ 4 s on a mid‑range Android (Redmi Note 10 class)
  - APK size ≤ 30 MB
- Dependencies: M3, M4, M5, M6

### M9 — Security audit + penetration test *(2 weeks)* · **W5, W7**

- Goal: external security review before clinical pilot
- Deliverables:
  - Threat model document (STRIDE per data flow)
  - OWASP Top 10 checklist completed with evidence per item
  - Third‑party penetration test by NUST CIPHER lab or equivalent
  - Findings register with severity + remediation status
  - SBOM generated for all backend + frontend dependencies (`syft`)
- Acceptance:
  - Zero critical or high findings open at sign‑off
  - All medium findings have a documented mitigation or accepted risk with supervisor approval
  - Dependency CVEs resolved or marked false‑positive with justification
- Dependencies: M2 onwards

### M10 — Clinical validation study *(8 weeks)* · **W8, W9**

- Goal: IRB‑approved validation against laboratory gold standard
- Deliverables:
  - Study protocol approved by The Superior University ERC + a partnering hospital IRB
  - Recruitment: 200 patients providing both a lab kidney panel AND a Nephra tube scan AND a RenalAI report upload, all on the same sample
  - Statistical analysis plan: Bland‑Altman for Nephra vs lab Cr; ROC for risk classification vs nephrologist consensus
  - Manuscript draft for submission to *Pakistan Journal of Medical Sciences* or equivalent peer‑reviewed venue
  - Updated model cards reflecting validation metrics
- Acceptance:
  - Bland‑Altman 95% LoA on Nephra: ± 0.5 mg/dL across the working range
  - Risk classifier vs 2‑nephrologist consensus: κ ≥ 0.75
  - At least one declared limitation per AI component, transparently disclosed
- Dependencies: M5, M4

### M11 — Regulatory documentation + DRAP submission *(4 weeks)* · **W9**

- Goal: file Class B SaMD application
- Deliverables:
  - Software Description Document (SDD)
  - Risk Management Plan per ISO 14971 (Hazard Analysis + Risk Control measures)
  - Software Verification & Validation Report (links to M9 + M10 evidence)
  - Cybersecurity Plan with reference to M9 audit
  - Labeling: in‑app disclaimer, intended use statement, contraindications, warnings, instructions for use (English + Urdu)
  - Post‑Market Surveillance Plan
  - Privacy Policy + Terms of Use legally reviewed by counsel familiar with PECA / Personal Data Protection Bill
- Acceptance: DRAP submission accepted for review (acknowledgment letter received)
- Dependencies: M9, M10

### M12 — Pilot launch + iteration *(4 weeks)* · all workstreams

- Goal: 50‑patient + 5‑doctor pilot at one Lahore clinic
- Deliverables:
  - Onboarding playbook for pilot site
  - Real‑user observability dashboards (Sentry, CloudWatch, custom Grafana)
  - Bi‑weekly retrospective with pilot users
  - Bug‑fix and iteration cadence
  - Post‑pilot report with usage metrics, SUS score, deterioration alerts fired, doctor‑patient response times
- Acceptance:
  - Zero data‑loss incidents
  - SUS ≥ 76 in pilot population (matches prototype baseline)
  - At least one clinically actionable insight per 10 patient scans (per nephrologist review)
- Dependencies: M11 (or M11 in‑flight if DRAP allows pilot under research exemption)

---

## 6. ML model specifications (model cards)

Every model gets a **model card** stored alongside its weights. Required fields:

```yaml
model_id:        risk-rf-1.0.0
trained_on:      UCI CKD (400) + RenalAI PK cohort v1 (200)
features:        [creatinine, urea, egfr, uric_acid, urinary_protein, age, gender, bun_cr_ratio, egfr_stage, cr_z_score]
holdout_metrics:
  accuracy:      0.968
  sensitivity:   0.942
  specificity:   0.971
  auc_roc:       0.991
  brier:         0.087
calibration:     platt
known_failures:  ["dehydrated patients (high BUN/Cr ratio without CKD)", "rhabdomyolysis (transient Cr spike)"]
intended_use:    "decision support, not diagnosis"
contraindications: ["pediatric patients <18", "pregnant patients", "single‑measurement diagnosis"]
fairness:
  evaluated_subgroups: [gender, age_band(18-35,36-65,>65)]
  parity_within: 5%   # max difference in any subgroup metric vs overall
inference_sla:
  p50_ms: 80
  p99_ms: 480
artifact_hash:   sha256:...
git_commit:      <commit-of-training-pipeline>
```

Same template for the Nephra CNN, OCR pipeline, and biomarker NER.

---

## 7. Security & compliance (W5)

### Threat model summary
| Asset | Threat | Mitigation |
|---|---|---|
| Patient PHI in transit | MITM | TLS 1.3 only, HSTS preload |
| Patient PHI at rest | DB compromise | pgcrypto field encryption, S3 SSE‑KMS |
| Cross‑user data leak | Auth bypass | JWT validation + RLS at DB level (defense in depth) |
| Unauthorized doctor access | Account takeover | Manual doctor verification + biometric/2FA option |
| Audit log tampering | Privilege escalation | Append‑only triggers, off‑site log shipping |
| Image retention beyond SLA | Process failure | S3 lifecycle policy + nightly reconciliation job |
| Replay of old JWT | Token theft | Short‑lived access (15 min) + refresh denylist |
| OCR‑driven SSRF | Malicious PDF | pdf.js sandboxed, no network access from worker |
| Model‑inversion attack | API abuse | Rate limit per‑user, per‑model |
| Anomalous login | Credential stuffing | Anomaly detector flags unusual IP/UA combos for re‑verification |

### Controls checklist (must‑pass at M9)
- [ ] All endpoints enforce JWT
- [ ] All DB queries through parameterized ORM (no raw SQL in app code)
- [ ] All user inputs validated by Pydantic on the server
- [ ] All outputs escaped on the client; CSP headers strict
- [ ] Audit log includes actor, action, entity, entityId, IP, UA, timestamp on every mutation
- [ ] No PII in logs (Pydantic models with `repr=False` on sensitive fields)
- [ ] Secrets rotated every 90 days via AWS Secrets Manager
- [ ] Backup encryption (server‑side KMS) + restore drill quarterly
- [ ] Account deletion completes within 24h; verified by integration test

### DRAP SaMD alignment (Class B per Medical Devices Rules 2017)
- Software Description Document
- Risk Management Plan (ISO 14971)
- Verification & Validation Report
- Cybersecurity Plan
- Labeling (intended use, contraindications, warnings)
- Post‑Market Surveillance Plan

---

## 8. Testing strategy (W7)

Coverage targets are CI gates — builds fail below threshold.

| Level | Tooling | Scope | Coverage gate |
|---|---|---|---|
| Static | mypy, ruff, ESLint, tsc | type errors, lint | zero errors |
| Unit (api) | pytest + pytest‑cov | services + repositories | ≥ 85% |
| Unit (web) | Vitest + RTL | components + hooks | ≥ 80% |
| Unit (ml) | pytest | feature engineering, normalizers | ≥ 90% |
| Integration | pytest + Docker Compose | API ↔ DB ↔ Redis ↔ S3 mock | every endpoint hit |
| Contract | Schemathesis | OpenAPI fuzzing | zero schema violations |
| E2E | Playwright | every critical user flow | green nightly |
| Mobile E2E | Detox | upload + Nephra + share flows | green nightly |
| Performance | Locust | 1000 concurrent users | p95 ≤ 800 ms |
| Stress | k6 | beyond capacity, graceful degradation | no crashes |
| Security | OWASP ZAP, bandit, npm audit | every PR | zero critical / high |
| Accessibility | axe‑core, Lighthouse CI | every page | zero AA violations |

### Critical user flows (must have E2E coverage)
1. Patient register → upload report → confirm OCR → view analysis
2. Patient → Nephra scan → save → view analysis
3. Patient share report → doctor receive notification → doctor add note → patient see note
4. Patient revoke share → doctor loses access immediately
5. Patient export full history PDF
6. Patient delete account → all data gone within 24h
7. Doctor signup → admin approval → doctor access activated
8. Trend deterioration alert fires when slope exceeds threshold

---

## 9. DevOps & observability (W6)

### Environments
| Env | Purpose | Data | Access |
|---|---|---|---|
| `local` | dev laptops | seeded synthetic | each engineer |
| `dev` | shared dev | seeded synthetic | team |
| `staging` | pre‑prod | anonymized prod copy | team + supervisor |
| `prod` | live | real patient data | break‑glass only |

### CI/CD pipeline
- Every PR: lint → unit → integration → security scan → preview deploy
- `main` merge: build → push to ECR → deploy to dev
- Tag `v*`: deploy to staging → smoke tests → approval gate → deploy to prod (blue/green)
- Database migrations run as separate job before app deploy
- Rollback: tagged previous image promoted in <5 min

### Observability
- **Logs**: structured JSON, correlation IDs, shipped to CloudWatch + Sentry
- **Metrics**: Prometheus + Grafana — request rate, error rate, latency p50/p95/p99 per endpoint, OCR queue depth, model inference time, DB connection pool usage
- **Traces**: OpenTelemetry across api → worker → db
- **Alerts**: PagerDuty rotation. SLO: 99.5% monthly uptime. Burn‑rate alerts at 2% / 5% / 10% of error budget.
- **Cost**: AWS Cost Explorer with monthly tagged report per workstream

---

## 10. Migration plan from prototype

### Reusable as‑is (port effort: low)
- `js/risk-engine.js` → `apps/api/services/risk/engine.py` (translate JS to Python; KDIGO logic + CKD‑EPI formula are language‑agnostic)
- `js/trend-analyzer.js` → `apps/api/services/trends/analyzer.py`
- `js/recommendations.js` → `apps/api/services/recommendations.py`
- `locales/{en,ur}.json` → `packages/shared/locales/` (keep verbatim)
- `assets/css/tokens.css` → `packages/shared/design-tokens/` (port to TS export)

### Replaced entirely (port effort: total rewrite)
- `js/storage.js` → API client + TanStack Query layer
- `js/ocr.js`, `js/biomarker-extractor.js` → server‑side Python pipeline (M3)
- `js/nephra.js` → server‑side CNN service (M5)
- `js/extraction-form.js`, `js/share.js`, `js/export.js` → React components
- `js/pages/*.js` → React routes under `apps/web/src/routes/`
- `index.html` → React app shell

### Kept as legacy reference
- All prototype code stays in `legacy/renalai-prototype/` so engineers can compare new behavior against the demo when in doubt
- Prototype URL stays runnable for FYP supervisor demos until M7 ships

---

## 11. Top 10 risks & mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | Cannot collect 200 PK kidney panels for risk model training | Medium | High | Start data collection Week 0 in parallel with M0; partner with one teaching hospital early |
| 2 | Tube image dataset insufficiently diverse (lighting, phones) | High | High | Crowdsource from team's classmates + 3 local clinics; budget for paid data collection if shortfall |
| 3 | DRAP review timeline extends beyond FYP deadline | High | Medium | Submit at M11 then continue iteration; ship v1.0 to pilot under research‑use exemption if needed |
| 4 | Nephra MAE > 0.4 mg/dL across phone models | Medium | High | Fall back to per‑phone calibration; require user to take a calibration shot of a reference card on first use |
| 5 | Urdu medical translations lose clinical accuracy | Medium | Medium | Sign‑off by 3 native speakers; medical reviewer (nephrologist) validates UR risk explanations |
| 6 | Penetration test surfaces critical findings late | Medium | High | Early STRIDE review at M2; pre‑audit by team using OWASP ZAP at every milestone |
| 7 | Team velocity overestimated | High | Medium | Cut scope, not quality. iOS, voice, federated learning are all explicitly v1.1+ |
| 8 | Ethics board approval delays clinical study | Medium | High | Submit IRB protocol at M2 (parallel with backend build); design study with minimal patient burden to ease approval |
| 9 | Costly OCR fallback (Google Vision) | Medium | Medium | Tesseract‑first with confidence threshold; cost cap alerts; fallback only when needed |
| 10 | Mobile camera quality variance breaks Nephra | High | High | Reject low‑confidence scans with clear UX; surface per‑phone calibration option; collect corrective feedback in‑app |

---

## 12. Definition of done (per workstream)

**W1 Backend** — every endpoint has: OpenAPI spec, Pydantic schemas, unit tests, integration tests, audit logging, RLS coverage, p95 latency budget defined, documented in `apps/api/docs/`.

**W2 ML** — every model has: model card, reproducible training script, version‑pinned dependencies, validation metrics published, SHAP/feature‑importance explainer, served behind versioned API path (`/api/v1/risk/score`, `/api/v2/risk/score`).

**W3 Frontend** — every route has: TypeScript types from OpenAPI, react‑hook‑form + zod, error boundary, loading/empty/error states, keyboard navigation, axe‑core clean, both EN+UR validated.

**W4 Mobile** — every screen has: same as W3 plus offline behavior tested, deep‑link tested, biometric path tested.

**W5 Security** — controls checklist complete, threat model updated when architecture changes, audit trail verified to capture mutation events.

**W6 DevOps** — every service has: dashboards, alerts, runbook for top 3 failure modes, deploy runbook, rollback runbook.

**W7 Testing** — coverage gates green, E2E suite covers every critical flow, performance budget met, security scans clean.

**W8 Clinical** — IRB‑approved protocol, validation manuscript drafted, model cards reflect real metrics.

**W9 Reg/Docs** — DRAP submission package complete, privacy policy + ToU legally reviewed, in‑app disclaimer present everywhere AI output is shown, IFU bilingual.

---

## 13. What we are NOT relying on the prototype for

The prototype is a **UX and behavior reference** — not a code source. Specifically:

- The prototype's risk numbers are heuristic and **must not** be quoted as evidence of clinical accuracy in the regulatory submission
- The prototype's Nephra estimates have **zero** clinical calibration and produce values purely from RGB depth heuristics
- The prototype's regex extractor will not generalize to lab formats outside the 8 it was hand‑tuned for
- The prototype's audit log is in IndexedDB and provides **no** integrity guarantee

In all four cases, M3, M4, M5, and M1 respectively replace these with auditable, validated systems. Treat the prototype as a wireframe with logic — useful for stakeholder demos, not for clinical evidence.

---

## 14. Cross‑references

- FYP Report: `../RenalAI_FULL_Report.docx` — chapters 4 (System Design), 5 (Implementation), 6 (Testing) are the sources of truth for schema, API surface, and test plan
- Prototype demo: `legacy/renalai-prototype/` — reference behavior
- Plan owners: Sami (W1, W2, W6) · Saud (W3, W4) · Fakhar (W5, W7, W9) · Supervisor (W8)

---

## 15. Self‑review gap analysis (added after v1.0 review)

The first draft of this plan covered architecture, milestones, security controls, and testing. A second pass against a real‑world SaMD launch checklist surfaced ten gap categories. Each is addressed by one of the new sections below.

| # | Gap surfaced | Addressed in |
|---|---|---|
| G1  | No budget, no post‑FYP continuity plan, no external advisor list                       | §16 |
| G2  | Privacy described but no DPIA, retention policy, DSAR process, or cross‑border rules    | §17 |
| G3  | Auth limited to JWT — no email verification, 2FA, account recovery, doctor identity     | §18 |
| G4  | No SLOs, on‑call rotation, incident response, status page, or DR drill cadence          | §19 |
| G5  | No ML drift monitoring, champion/challenger, datasheet, annotation guidelines           | §20 |
| G6  | No API versioning policy, idempotency keys, rate‑limit specifics, feature flags         | §21 |
| G7  | Edge cases not enumerated (clock skew, worker crash, malicious image, quota exhaustion) | §22 |
| G8  | Compliance referred to DRAP only — no ISO 14971/IEC 62304/PECA/PDPB explicit alignment  | §17 + §19 |
| G9  | No engineering process — ADRs, code‑review policy, CHANGELOG, branch protection         | §23 |
| G10 | No user‑facing trust signals — status page, help center, onboarding emails              | §24 |

---

## 16. Budget, headcount, and continuity (G1)

### v1.0 cost envelope (USD, 12‑month horizon)

| Line item | Estimate |
|---|---|
| AWS infra (ECS, RDS, ElastiCache, S3, CloudFront, ALB, Sec. Mgr., CloudWatch) | $4,800 |
| Google Vision API (fallback OCR, ~30k pages/yr at $1.50/1000) | $50 |
| Firebase Cloud Messaging | free tier |
| SES email (50k transactional / month) | $50 |
| Sentry (Team plan) | $312 |
| GitHub Actions CI minutes | $0 (within free tier) |
| Domain (`renalai.pk` + SSL) | $30 |
| Penetration test (NUST CIPHER lab or equivalent) | $1,500 |
| IRB submission fee + clinical study materials | $800 |
| DRAP submission fee (Class B SaMD) | $600 |
| Legal review (privacy policy, ToU, doctor agreement) | $1,200 |
| Test devices (3 phones across price tiers + 1 tablet) | $700 |
| Tube‑image dataset collection (incentives + reagent) | $600 |
| **Total** | **~$10,640** |

Funded via: FYP department allocation + Superior University seed grant (to be applied for at M0). Stretch: PSEB innovation grant if v1.0 ships and pilot succeeds.

### Headcount

3 students + 1 supervisor for build phase. Post‑FYP graduation (≈ M11) requires explicit continuity decisions:

- **Option A — Maintenance lead handover**: one team member takes a part‑time lead role with a stipend during the pilot
- **Option B — University adoption**: hand the codebase to The Superior University as an open‑source teaching project under a foundation‑grade license
- **Option C — Spin‑out**: form a Section‑42 not‑for‑profit company and pursue grant funding

Decision deadline: **M9**. Without a decided option, the project pauses at M11 with the regulatory submission filed but pilot deferred.

### External advisors (recruit by M2)

- **Clinical**: 1 nephrologist consultant (review risk thresholds, recommendation copy, IRB protocol)
- **Legal**: 1 lawyer with PECA + draft PDPB familiarity (privacy policy, doctor agreement, liability)
- **Security**: 1 external pentester (M9)
- **Native Urdu medical translator**: validate every UR risk explanation and recommendation (M7)

---

## 17. Privacy, data lifecycle, and compliance specifics (G2, G8)

### Privacy Impact Assessment (DPIA)

A formal DPIA must be completed at M9 before pilot. Template covers per data category:

1. **Description** — what data is collected, by whom, why
2. **Necessity & proportionality** — minimum data principle applied
3. **Risks** — re‑identification, breach, secondary use
4. **Controls** — technical + organizational
5. **Residual risk** — accepted by supervisor signed‑off

Categories: account data, biomarker values, lab report images, tube scan images, doctor‑patient share metadata, audit logs, support communications.

### Data retention policy

| Data class | Retention | Justification |
|---|---|---|
| Lab report images (S3) | **60 minutes** post‑OCR, hard | privacy SLA stated to users; enforced via S3 lifecycle |
| Tube scan images (S3) | **60 minutes** post‑inference, hard | same |
| Biomarker values + analyses | indefinite while account active | longitudinal trend is the product |
| Account‑deleted user data | **24 hours** then hard‑purged | matches FYP report commitment |
| Backups containing deleted user data | **purged within 30 days** of deletion | restore window minus deletion grace period |
| Audit log | **7 years** then archived to cold storage | regulatory retention |
| Support communications | **2 years** | dispute window |

Job: a nightly reconciliation worker verifies S3 + DB + backup state against the policy and reports drift to ops.

### Data Subject Access Request (DSAR) process

User rights, exposed via in‑app + email:

1. **Access** — Settings → Export My Data (already in prototype, JSON bundle)
2. **Correction** — every biomarker value editable via the OCR confirmation form even after analysis (re‑analysis triggered)
3. **Deletion** — Settings → Delete All Data; SLA 24h; verification email after purge with hash receipt
4. **Portability** — JSON export uses a documented schema (see §21 for schema versioning)

DSARs received via email get acknowledged within 2 business days, completed within 30 days.

### Cross‑border transfer

AWS region: **`me-central-1` (UAE)** as primary, **`me-south-1` (Bahrain)** as DR. Selected because:

- No AWS region in Pakistan as of plan date
- ME regions are the lowest‑latency, jurisdictionally adjacent options
- Pakistan has no data‑residency mandate today, but draft PDPB §32 hints at it. A migration plan to a future Pakistan region is documented in M11

### Compliance standards explicit alignment

| Standard | Section | What we actually do |
|---|---|---|
| DRAP Medical Devices Rules 2017 | Class B SaMD | full submission package at M11 |
| ISO 14971:2019 | Risk Management | hazard analysis + risk controls table maintained alongside code; updated when architecture changes |
| IEC 62304:2006 | Medical device software lifecycle | software safety class B; lifecycle = design + V&V + maintenance documented |
| PECA 2016 | Electronic crimes | applies to platform abuse; reflected in ToU |
| PDPB (draft) | Personal data | track quarterly; align ahead of enactment |
| ISO 27001 | InfoSec management | aligned, not certified — controls table maps to A.5–A.18 |
| WCAG 2.1 AA | Accessibility | enforced via axe‑core CI gate (M7) |

---

## 18. Authentication & identity beyond JWT (G3)

### Email verification

Required before any data upload. Implementation:

- 6‑digit code emailed via SES, TTL 15 min, max 5 attempts before throttle
- Until verified: account is read‑only, no upload, no share
- Re‑verification required if email changes

### Two‑factor authentication

- **Mobile**: biometric (Android BiometricPrompt; iOS deferred) gates app unlock when configured
- **Web**: TOTP (RFC 6238) via Authenticator apps; 8 backup codes generated at enrollment
- **Doctors**: 2FA mandatory before doctor‑tier features unlock (admin enforces at verification)
- **Patients**: 2FA optional but encouraged via in‑app nudge after 7 days of usage

### Account recovery

Three‑factor recovery, any 2 of which suffice:

1. Email‑linked password reset (signed token, TTL 30 min)
2. Phone verification (SMS code via Twilio Verify, TTL 5 min)
3. Backup code (one‑time use, regenerated after consumption)

If user has lost both email + phone, supervised recovery requires identity proof to admin via documented affidavit process. No silent shortcut.

### Session management

- Active sessions list in Settings → Security → Active sessions
- Per‑session metadata: device fingerprint, IP, last seen, location (city‑level)
- "Revoke all" button puts every refresh token on the denylist
- Auto‑revoke on password change

### Doctor identity verification (replaces "manual approval" hand‑wave)

Three‑step process:

1. **Self‑attest**: doctor enters PMC (Pakistan Medical Commission) registration number
2. **Automated lookup**: backend cron queries PMC public registry weekly; flags status changes (suspended, expired)
3. **Document upload**: copy of PMC certificate + national ID (encrypted at rest, accessed only by admin during review)
4. **Admin manual review**: cross‑checks documents vs PMC API result; explicit approve/deny with audit trail
5. **Re‑verification**: every 12 months, automated PMC re‑check; flagged accounts auto‑suspend pending re‑review

### Anomaly detection (referenced in §7, specified here)

Trained statistical model on session metadata. Features: IP country, IP ASN, UA family, login hour, hours since last login, geographic distance from previous login. Output: risk score 0–1; threshold 0.7 triggers re‑verification challenge (TOTP or email code) before granting access.

---

## 19. Operational excellence — SLOs, on‑call, incident response, DR (G4)

### Service Level Objectives (internal targets)

| SLO | Target | Measurement window |
|---|---|---|
| API availability (HTTP 5xx rate) | 99.5% | rolling 30 days |
| API latency (non‑OCR endpoints, p95) | < 500 ms | rolling 7 days |
| OCR end‑to‑end completion (p95) | < 15 s | rolling 7 days |
| Risk inference latency (p99) | < 500 ms | rolling 7 days |
| Nephra inference latency (p99) | < 3 s | rolling 7 days |
| Push notification delivery | 99.0% within 10 s | rolling 7 days |
| Zero‑PII‑in‑logs guarantee | 100% | every log line, automated grep gate |

Burn‑rate alerts at 2% / 5% / 10% of monthly error budget consumption.

### On‑call rotation

| Tier | Coverage | Response SLA |
|---|---|---|
| L1 — primary | 24/7 weekly rotation across 3 team members | acknowledge < 15 min |
| L2 — secondary | escalation if L1 unresponsive | acknowledge < 30 min |
| L3 — supervisor | data breach, regulatory, or media‑level incident | acknowledge < 2 h |

Tools: PagerDuty (free for ≤5 users) for alerting; Slack for coordination; runbook library in `apps/api/docs/runbooks/`.

### Runbook library (one per top‑severity alert)

Required runbooks at M9 (each is a markdown file with: symptoms, immediate actions, mitigation, root‑cause investigation, prevention):

1. API 5xx spike
2. Database CPU > 80%
3. Celery queue depth > 100
4. OCR timeout rate > 5%
5. Suspicious login spike (anomaly detector)
6. S3 lifecycle policy failure (image retained beyond 60 min)
7. Database connection pool exhausted
8. CDN failover
9. SES bounce rate spike
10. Model inference error rate spike

### Incident response — severity matrix

| Severity | Definition | Response |
|---|---|---|
| **SEV1** | Patient PHI data leak; service totally down | All hands, supervisor + legal notified within 1h, public status update within 4h |
| **SEV2** | Significant feature broken or degraded for >10% users | L1+L2, status update within 2h |
| **SEV3** | Single‑user issue or minor feature degradation | L1, fix in next sprint |
| **SEV4** | Cosmetic or low‑impact | normal backlog |

Every SEV1/SEV2 gets a blameless retrospective within 5 days. Action items tracked to closure.

### Disaster recovery

- **RTO** (Recovery Time Objective): **4 hours** to fully restored service
- **RPO** (Recovery Point Objective): **24 hours** maximum data loss tolerated
- **Backups**:
  - RDS automated daily snapshots, 30‑day retention
  - PITR enabled (5‑min granularity) for last 7 days
  - Cross‑region replication of snapshots to `me-south-1`
- **Restore drill**: quarterly, full restore to staging from production snapshot, success criteria: schema verified, sample queries return expected counts, audit log integrity confirmed
- **Runbook**: `runbooks/disaster-recovery.md` with step‑by‑step

### Status page

Public `status.renalai.pk`. Powered by Statuspage.io (paid) or self‑hosted Cachet. Shows real‑time component health and posts incident updates. Links from in‑app banner during SEV1/SEV2.

---

## 20. ML lifecycle in production (G5)

### Datasheet for datasets (Bender 2018 + Gebru 2021 inspired)

Every training dataset gets a `DATASHEET.md` with: motivation, composition, collection process, preprocessing, recommended uses, tasks, distribution, maintenance. Required for: UCI CKD subset, RenalAI PK kidney panel cohort, RenalAI tube image cohort, RenalAI lab‑report annotation cohort.

### Annotation guidelines + inter‑annotator agreement

- Written annotation guideline document for each labeling task (lab report bbox + biomarker labels; tube ROI; corresponding lab Cr value)
- 10% of every dataset double‑annotated; Cohen's κ ≥ 0.80 required to release for training
- Disagreements adjudicated by clinical advisor

### Model deployment process

1. New model version proposed via PR with model card update
2. Offline metrics on holdout exceed previous champion by ≥ 1 absolute % on primary metric
3. Champion/challenger A/B on staging with synthetic + replayed traffic
4. Canary rollout: 5% traffic for 7 days, monitor error rate + business metrics
5. Full promotion if canary clean; rollback if degradation detected

### Drift monitoring (production)

Three drift checks running daily:

| Drift type | Method | Alert threshold |
|---|---|---|
| **Input drift** (covariate shift) | Population Stability Index per feature | PSI > 0.20 over rolling 30‑day window |
| **Prediction drift** | KS test of predicted‑class distribution week‑over‑week | p < 0.01 |
| **Label drift** (when ground truth available) | Accuracy delta on incoming labeled data | drop > 3% from baseline |

Alerts page on‑call. Investigation runbook `runbooks/ml-drift.md`.

### Model retirement

- Each model version supported for 12 months after a successor takes over as champion
- Sunset notice in‑app + via email 90 days before retirement
- Historical analyses keep the model_version they were generated with; PDF exports note the model version
- Re‑analysis offered to users when their stored analysis is from a sunsetted model

### Reproducibility requirements

- Training pipeline pinned to: dataset hash, Python version, dependency lockfile, random seed, hardware class
- Identical inputs ⇒ identical model hash; verified via CI on every retrain PR
- Training logs archived alongside model artifact

### Fairness audit per model

Required at M4/M5 and quarterly thereafter:

- Subgroups: gender (M/F), age band (18‑35, 36‑65, >65), urban/rural (proxied by IP geolocation at signup)
- Equal‑accuracy parity within ±5% across all subgroups
- Documented in model card; failures block promotion

---

## 21. API & client maturity (G6)

### API versioning policy

- URL‑path versioning: `/api/v1/...`
- Major version bumps on breaking changes only; minor changes additive
- Deprecation = **6 months** of dual support, with `Deprecation` + `Sunset` HTTP headers + in‑app + email banners
- One major version supported beyond the current; older versions return `410 Gone` after grace period

### Idempotency

All mutating endpoints (POST/PUT/PATCH/DELETE) accept an optional `Idempotency-Key` header. Implementation:

- Key + actor stored in Redis with the response for 24 h
- Replays return the stored response, no side effects re‑applied
- Mobile + web clients automatically generate UUIDv4 keys for upload + share + note operations

### Rate limiting (specifics)

| Surface | Limit | Burst | Enforcement |
|---|---|---|---|
| Login (per IP) | 10 / 15 min | 5 | exponential backoff on excess |
| Login (per account) | 5 failed / 15 min | — | account lock 30 min after exceeding |
| Registration (per IP) | 3 / hour | — | 429 |
| Report upload (per user) | 10 / hour | 3 | 429 with `Retry-After` |
| Tube scan (per user) | 30 / hour | 5 | 429 |
| API reads (per user) | 600 / hour | 60 | 429 |
| Anonymous endpoints (status, marketing) | 60 / min per IP | 20 | 429 |

Implementation: Redis counters with sliding‑window algorithm; configuration centralized in `apps/api/security/rate_limits.py`.

### Pagination

Cursor‑based for all list endpoints (`?cursor=...&limit=...`). Offset rejected because it breaks under writes. Default limit 50, max 200.

### Feature flags

- Self‑hosted via `feature_flags` table + Redis cache
- Flag scope: global / per‑user / per‑role / percentage rollout
- Used for: progressive rollouts (M5 Nephra v2 to 5% of users first), kill switches (disable Nephra if accuracy regression detected), A/B experiments

### A/B testing infrastructure

- Experiment definition table with hypothesis, primary metric, success criterion
- User assignment hash‑based, sticky across sessions
- Built‑in analyzer with p‑value + confidence interval
- Used carefully: never A/B clinical recommendations or risk thresholds without supervisor + clinical advisor sign‑off

### WebSocket reconnection

- Exponential backoff: 1 s → 2 s → 4 s → ... capped at 60 s
- Server emits replay of missed `OCR_STATUS` events on reconnect using the last `event_id` the client received
- Client falls back to HTTP polling at 5 s interval if WS unavailable for > 60 s

### JSON export schema versioning

- Export bundles include `schemaVersion: 1`
- Schema evolutions documented in `docs/export-schema-CHANGELOG.md`
- Imports (future feature) reject unknown major versions

---

## 22. Edge cases & failure modes (G7)

### Concurrent / retry safety

| Scenario | Handling |
|---|---|
| User uploads same file twice (network retry) | Idempotency key dedups; second call returns first response |
| User clicks Confirm twice on OCR confirmation | Server checks analysis already exists for `report_id`, returns existing |
| Worker dies mid‑OCR | Celery `acks_late=True` + visibility timeout; another worker picks up |
| WebSocket disconnects mid‑status update | Client polls `/reports/{id}` on reconnect; server idempotently returns current state |

### Adversarial / malicious input

| Scenario | Handling |
|---|---|
| Zip‑bomb PDF | Hard cap on rendered‑page pixel count (15 MP); abort + reject |
| Recursive PDF references | pdf.js sandboxed; only first page rendered; no font/JS execution |
| ImageMagick‑style EXIF exploit | Use Pillow only, never ImageMagick; strip EXIF before storage |
| File with mismatched extension | Sniff magic bytes; reject if mismatch |
| Massive lab report (50 MB scan) | Reject at upload (15 MB cap) before reaching worker |
| User uploads tube image to OCR endpoint | Server detects no biomarker text, returns 422 with hint to use Nephra endpoint |
| Random non‑tube image to Nephra | CNN confidence ≤ 30% → user prompted to retake; not persisted |

### Resource & quota

| Scenario | Handling |
|---|---|
| User exceeds 50‑report free tier | 402 with upgrade prompt (paid tier deferred to v1.1) |
| Disk quota exhausted on Celery worker | Worker auto‑drains, traffic shifted to siblings |
| Postgres connection pool exhausted | Application returns 503 Retry‑After 5; alarm pages on‑call |
| Redis OOM | LRU eviction on cache keys only; rate‑limit and session keys are persistent — alarm pages immediately |

### Time & clocks

- All servers NTP‑synced (chrony); clock skew alarm if > 1 s
- All timestamps stored as `TIMESTAMPTZ` in UTC; displayed in user's locale (PKT for Pakistan)
- JWT clock skew tolerance: ±30 s

### Browser / client compatibility

| Scenario | Handling |
|---|---|
| No IndexedDB (private mode) | Detect on boot; show banner explaining limitation; degrade to read‑only |
| Service worker unsupported | App still works online; "offline mode unavailable" notice |
| Camera permission denied | Show file‑upload fallback with explanatory copy |
| WebSocket blocked by corporate firewall | HTTP long‑poll fallback at 5 s interval |
| Cookies disabled | Reject login attempt with explanation |

---

## 23. Engineering process (G9)

### Branch protection (`main`)

- Require ≥1 reviewer on every PR (≥2 for changes touching `apps/api/security`, `ml/models/`, or `infra/`)
- All CI checks pass (lint, typecheck, unit, integration, security)
- Linear history (squash‑merge only)
- No force‑push, no admin override
- DCO sign‑off required (matches license)

### Conventional commits + CHANGELOG

- Commit messages follow Conventional Commits 1.0
- `release-please` action generates release PRs that update `CHANGELOG.md` automatically
- Each release tagged in semver

### Architectural Decision Records (ADRs)

- Every major decision logged as `docs/adr/NNNN-title.md` using the MADR template
- Required for: framework choices, data model changes, security‑model changes, ML algorithm choices, deployment‑topology changes
- Past ADRs are immutable; supersession via new ADR

### Code review policy

- PR description must include: motivation, summary of changes, testing performed, screenshots for UI
- "Why" matters more than "what" — diff already shows what
- Reviewer responsibility: design soundness, test sufficiency, security implications
- Maintainer responsibility: merge only when CI green and review approved
- Self‑merge allowed only for: docs‑only changes, dependency bumps via Renovate that pass CI

### Dependencies

- Renovate bot for automated PRs on dependency updates
- Major version bumps require ADR
- Production dependencies pinned exactly; dev dependencies semver‑caret
- Monthly review of `npm audit` / `safety` / `pip-audit` reports

### Documentation discipline

- Every public API endpoint documented in OpenAPI
- Every service has a README with: purpose, run instructions, common tasks, on‑call notes
- Every model has a model card
- Every DB migration has a description in the alembic file

---

## 24. User‑facing trust signals (G10)

### Help center

`help.renalai.pk` — bilingual EN/UR, covers:

- Getting started (5 articles)
- Upload a lab report (3 articles, with screenshots)
- Use the Nephra tube scanner (3 articles)
- Understand your risk score (clinical guidance with disclaimer)
- Privacy & data (consent, deletion, export)
- For doctors (registration, sharing, clinical notes)
- Troubleshooting (10 common issues)

Built with Docusaurus or VitePress; SEO‑optimized; reachable from every page footer.

### Onboarding emails (transactional)

| Trigger | Email | Send time |
|---|---|---|
| Account created | Welcome + email verification code | immediate |
| Email verified | First steps + link to upload your first report | immediate |
| First upload completed | Walkthrough of analysis page features | +1 h |
| 7 days, no second upload | Reminder + benefits of trend tracking | +7 d |
| Risk category changes | Notification + recommendation summary | immediate |
| Doctor share received (doctor side) | Patient name + report summary | immediate |
| Inactive 30 days | "We miss you" + new‑feature highlights | +30 d |

All emails: bilingual based on user's locale, plain‑text fallback, unsubscribe link, branded template.

### In‑app trust elements

- Footer link to status page
- "DRAP submission pending" / "DRAP registered" badge once filed/approved (displayed truthfully — no pre‑claiming)
- "Privacy: your data stays in‑country adjacent · auto‑delete · audit‑logged" tag on every upload screen
- Disclaimer banner on every analysis result: "AI decision support — consult a qualified physician for diagnosis"

### Support channels

- In‑app chat (Crisp free tier or HelpScout) routed to team email
- `support@renalai.pk` mailbox monitored during business hours (M9 Lahore time)
- Ticket SLA: first response < 24h business hours, resolution target < 5 days

---

**Plan owners (unchanged):** Sami (W1, W2, W6) · Saud (W3, W4) · Fakhar (W5, W7, W9) · Supervisor (W8)
**Plan version:** v1.1 — gap analysis incorporated · ready for codex review
