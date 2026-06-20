from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .db import init_db
from .game.words import (
    categories_by_id,
    load_categories,
    load_dictionary,
    load_letter_values,
    load_tile_distribution,
)
from .routers import auth, daily_puzzle, games, leaderboard, solo, ws


# Locate the built frontend (frontend/dist). In production deploy the
# `deploy.sh` script runs `npm run build` so this directory exists and
# the FastAPI app serves it directly — one process owns the whole app.
# In dev the directory may not exist; we just skip mounting it then and
# the React dev server proxies /api back to us.
REPO_ROOT = Path(__file__).resolve().parent.parent.parent  # tile-game/
FRONTEND_DIST = REPO_ROOT / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    # Warm caches.
    load_dictionary()
    load_letter_values()
    load_tile_distribution()
    load_categories()
    yield


app = FastAPI(title="tile-game", lifespan=lifespan)

# CORS for the dev server (frontend on 5180 talking to backend on 8100). In
# production the same FastAPI process serves the static frontend so CORS is
# moot, but leaving this in is harmless.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5180", "http://127.0.0.1:5180"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API + WebSocket routers (mounted before the SPA fallback below so they
# always win over the catch-all).
app.include_router(auth.router)
app.include_router(solo.router)
app.include_router(daily_puzzle.router)
app.include_router(leaderboard.router)
app.include_router(games.router)
app.include_router(ws.router)


@app.get("/api/health")
def health() -> dict:
    cats = load_categories()
    return {
        "ok": True,
        "categories": len(cats),
        "dictionary_words": len(load_dictionary()),
    }


@app.get("/api/categories")
def categories() -> dict:
    return {
        "categories": list(categories_by_id().values()),
        "letter_values": load_letter_values(),
        "tile_distribution": load_tile_distribution(),
    }


# ---------- Static frontend (production) ----------
#
# When frontend/dist exists, mount it at the root. We mount the assets folder
# at /assets directly (long-cache friendly path Vite generates) and add a
# catch-all that serves index.html for any non-API path so client-side
# routing works on hard refresh.

if FRONTEND_DIST.exists():
    assets_dir = FRONTEND_DIST / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        # Never let the SPA fallback shadow API or WS routes (those are
        # registered above so FastAPI matches them first, but defensively
        # 404 here too).
        if full_path.startswith("api/") or full_path.startswith("ws/"):
            raise HTTPException(status_code=404)
        # Serve specific asset files (favicon, logo, cats-bg) verbatim.
        candidate = FRONTEND_DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(str(candidate))
        # Otherwise return index.html so React Router can handle the route.
        return FileResponse(str(FRONTEND_DIST / "index.html"))
