"""Vercel serverless entry point.

Vercel's Python runtime invokes this module and looks for a top-level ASGI
`app`. We re-export the FastAPI app from `apps/api/main`. The path
manipulation lets the colocated `apps/api/*.py` modules import each other
with their existing absolute names (`from config import ...`), unchanged
from local-dev.

Local dev still uses `cd apps/api && uvicorn main:app`. Vercel uses this file.
"""
import sys
from pathlib import Path

# Make `apps/api/*.py` importable as top-level modules
_APPS_API = (Path(__file__).resolve().parent.parent / "apps" / "api").resolve()
sys.path.insert(0, str(_APPS_API))

# Importing `main` triggers init_db() in the FastAPI lifespan.
# Vercel's serverless filesystem is read-only between invocations, so make
# sure the runtime is configured with a real database (Vercel Postgres, Neon,
# Supabase) via the DATABASE_URL env var. The default sqlite path will fail
# silently on cold start in Vercel — see DEPLOY.md.
from main import app  # noqa: E402, F401  (re-exported for the runtime)
