# Deploying RenalAI to Vercel

Two paths. Pick the one that matches your goal.

---

## Path A — Static prototype only (5 min, $0)

Just the browser app. No backend, no database. Works exactly like `python -m http.server` does locally — Tesseract.js OCR, Nephra colorimetric analysis, IndexedDB persistence, all in the user's browser. **Each visitor's data is isolated to their own device.**

### Steps

1. Push this folder to a GitHub repo
2. Go to [vercel.com/new](https://vercel.com/new), import the repo
3. **Framework preset**: `Other`
4. **Root directory**: leave empty (deploy from repo root)
5. **Build command**: leave empty (no build step)
6. **Output directory**: leave empty (`.` is the default and exactly right)
7. Click **Deploy**

Done. You'll get `https://your-project.vercel.app` serving the prototype.

The `vercel.json` already configured here adds:
- Cache-Control headers for `/assets/**` (1-year immutable) and locale JSON (1-hour revalidate)
- Security headers (X-Content-Type-Options, Referrer-Policy, Permissions-Policy with camera enabled)
- Default rewrites that pass through static files

---

## Path B — Full stack (prototype + FastAPI backend, 30 min, ~$0 with free tiers)

Everything in Path A, plus the FastAPI backend at `apps/api/` deployed as Vercel serverless Python functions, with a managed Postgres database.

### Step 1 — Provision a Postgres database

Pick one (all have free tiers that easily cover an FYP demo):

| Provider | Free tier | Setup time | Notes |
|---|---|---|---|
| **Vercel Postgres** | 256 MB, 60h compute/mo | < 2 min | Native integration, env vars auto-injected |
| **Neon** | 0.5 GB, 191h compute/mo | < 5 min | Serverless Postgres, fastest cold starts |
| **Supabase** | 500 MB, 50k MAU | < 5 min | Comes with auth + storage if you need them later |

For the simplest path, **add a Vercel Postgres database from the project Storage tab** in the Vercel dashboard after first deploy. Vercel automatically injects `POSTGRES_*` env vars; rename one of them or set `DATABASE_URL` to the same value.

### Step 2 — Set environment variables

In Vercel **Project → Settings → Environment Variables**, add:

| Key | Value | Scope |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg://user:password@host:5432/dbname?sslmode=require` | Production, Preview |
| `JWT_SECRET` | run `python -c "import secrets; print(secrets.token_urlsafe(64))"` | Production, Preview |
| `JWT_ALGORITHM` | `HS256` | Production, Preview |
| `ENVIRONMENT` | `production` | Production |
| `CORS_ORIGINS` | `["https://your-project.vercel.app"]` | Production, Preview |

The `psycopg` driver is in `api/requirements.txt`. SQLAlchemy's connection string format wants the dialect prefix: `postgresql+psycopg://...` not `postgres://...`.

### Step 3 — Deploy

Same as Path A — push to GitHub, import to Vercel, click Deploy.

Vercel auto-detects:
- Static files at the repo root → served directly
- Python function at `api/index.py` → builds with `api/requirements.txt`
- `vercel.json` → routes `/api/v1/*`, `/api/openapi.json`, `/api/docs`, `/api/redoc`, `/api/health` to the function

### Step 4 — Smoke-test

After deployment, hit:

- `https://your-project.vercel.app/` → prototype loads
- `https://your-project.vercel.app/api/health` → `{"status":"ok",...}`
- `https://your-project.vercel.app/api/docs` → Swagger UI for the FastAPI scaffold
- Sign up via the API:
  ```bash
  curl -X POST https://your-project.vercel.app/api/v1/auth/register \
    -H 'Content-Type: application/json' \
    -d '{"email":"test@example.com","password":"supersecret1","name":"Test"}'
  ```

---

## Important caveats

| Caveat | Why | Mitigation |
|---|---|---|
| **Cold-start latency ~1–2 s** | Vercel spins down idle Python functions | Free tier is fine for FYP demo; production needs `Pro` plan with Always-On or migration to ECS Fargate |
| **10 s function timeout** (Hobby) | Hard limit on serverless execution | All current endpoints are <500 ms; OCR worker tier (PRODUCTION_PLAN M3) won't fit and will need a separate runtime |
| **No filesystem persistence** | Lambdas are ephemeral | Database is the only stateful store; image upload (M2 deliverable) goes to S3 not local disk |
| **No background jobs / Celery** | Vercel doesn't run worker processes | OCR queue (M3) needs ECS+Celery or a webhook-driven approach via Inngest/QStash |
| **Tesseract.js still client-side** | The prototype OCR runs in the browser regardless of host | Server-side OCR (M3) needs a different runtime — Vercel won't bundle Tesseract binary into a serverless function |
| **Cost at scale** | Vercel charges per invocation + bandwidth | Free tier covers thousands of demos; production load → AWS architecture from PRODUCTION_PLAN §3 |

---

## Local dev still works the same

```bash
# Static prototype
python -m http.server 8000
open http://localhost:8000

# FastAPI backend
cd apps/api
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```

The Vercel artifacts (`vercel.json`, `api/index.py`, `api/requirements.txt`) only kick in during deployment.

---

## Custom domain

After first deploy, in **Project → Settings → Domains**, add `renalai.pk` (or your domain). Vercel handles SSL automatically via Let's Encrypt.

---

## Rolling back

Vercel keeps every deployment. **Project → Deployments → ⋯ → Promote to Production** on any previous green build instantly rolls back. Database migrations remain forward-only — see PRODUCTION_PLAN §22 for the proper migration strategy when you replace `init_db()` with Alembic.

---

## Honest framing

**Path A (static prototype)** is production-ready for an FYP demo. Visitors get a fully functional app with everything documented in `DEMO.md`.

**Path B (with FastAPI scaffold)** demonstrates the production architecture but the API endpoints today only cover signup/login/refresh/me, the manual-entry report path, and the risk-scoring endpoint. The full feature set described in `PRODUCTION_PLAN.md` requires backend ML, OCR worker tier, doctor-portal endpoints, and PDF generation — all explicitly deferred to milestones M3–M6.

In other words: deploying to Vercel ships the same software that runs at `localhost:8000` today. It does **not** unlock features that aren't built yet.
