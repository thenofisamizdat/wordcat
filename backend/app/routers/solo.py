from __future__ import annotations

import json
import secrets
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..auth import Identity, get_identity
from ..config import settings
from ..db import get_db
from ..game import engine
from ..game.shuffle import daily_seed
from ..game.words import (
    categories_by_id,
    load_letter_values,
)
from ..models import SoloRun
from ..schemas import (
    CategoryOut,
    SoloPickRequest,
    SoloRunOut,
    SoloSkipRequest,
    SoloSubmitRequest,
)

router = APIRouter(prefix="/api/solo", tags=["solo"])

MODE_PRACTICE = "practice"
MODE_DAILY = "daily"

# Solo modes use a tighter, snappier configuration than multiplayer.
SOLO_POOL_SIZE = 75            # Half-ish of the 147 multiplayer pool
SOLO_TURN_SECONDS = 60         # 1 min per category card
SOLO_OVERALL_SECONDS = 300     # 5 min total per game


# ---------- helpers ----------

def _today_iso() -> str:
    return date.today().isoformat()


def _identity_filter(query, identity: Identity):
    if identity.user:
        return query.filter(SoloRun.user_id == identity.user.id)
    return query.filter(SoloRun.guest_key == identity.guest_key)


def _serialize(run: SoloRun) -> SoloRunOut:
    state = json.loads(run.state_json)
    cats_by_id = categories_by_id()
    card = None
    if state.get("current_card_id"):
        c = cats_by_id.get(state["current_card_id"])
        if c:
            card = {
                "id": c["id"],
                "name": c["name"],
                "difficulty": c["difficulty"],
            }
    cats_out = [CategoryOut(**c) for c in cats_by_id.values()]
    # Sync persisted score from authoritative engine state.
    run.score = state["scores"][0]
    return SoloRunOut(
        run_id=run.id,
        mode=run.mode,
        date=run.date,
        seed=run.seed,
        score=run.score,
        duration_s=run.duration_s,
        finished=bool(run.finished or state.get("finished")),
        state=engine.public_view(state),
        card=card,
        letter_values=load_letter_values(),
        categories=cats_out,
    )


def _persist(db: Session, run: SoloRun, state: dict, *, words: list[dict] | None = None) -> None:
    # Auto-finish if engine ended.
    if state.get("finished") and not run.finished:
        run.finished = 1
        run.finished_at = datetime.now(timezone.utc)
        if run.started_at:
            started = run.started_at if run.started_at.tzinfo else run.started_at.replace(tzinfo=timezone.utc)
            run.duration_s = max(0, int((datetime.now(timezone.utc) - started).total_seconds()))
    run.state_json = json.dumps(state)
    run.score = state["scores"][0]
    if words is not None:
        run.words_json = json.dumps(words)
    db.add(run)
    db.commit()
    db.refresh(run)


def _load_run(db: Session, run_id: int, identity: Identity, mode: str) -> SoloRun:
    run = db.get(SoloRun, run_id)
    if not run or run.mode != mode:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")
    if identity.user:
        if run.user_id != identity.user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your run")
    else:
        if run.guest_key != identity.guest_key:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your run")
    return run


def _start_run(db: Session, identity: Identity, mode: str) -> SoloRun:
    today = _today_iso()
    if mode == MODE_DAILY:
        existing = (
            _identity_filter(db.query(SoloRun), identity)
            .filter(SoloRun.mode == MODE_DAILY, SoloRun.date == today)
            .first()
        )
        if existing:
            # Resume in-progress, otherwise block.
            if existing.finished:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="You already completed today's daily challenge.",
                )
            return existing
        seed = daily_seed(today)
    else:
        seed = int.from_bytes(secrets.token_bytes(6), "big")

    state = engine.new_state(
        seed=seed,
        num_players=1,
        turn_seconds=SOLO_TURN_SECONDS,
        pool_size=SOLO_POOL_SIZE,
        overall_seconds=SOLO_OVERALL_SECONDS,
    )
    run = SoloRun(
        user_id=identity.user.id if identity.user else None,
        guest_key=identity.guest_key,
        display_name=identity.display_name,
        mode=mode,
        date=today,
        seed=seed,
        score=0,
        state_json=json.dumps(state),
        words_json="[]",
        duration_s=0,
        finished=0,
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def _apply_pick(db: Session, run: SoloRun, tier: str) -> SoloRunOut:
    state = json.loads(run.state_json)
    # Auto-resolve any pending timeout from a previous turn before picking.
    engine.force_skip_if_expired(state)
    if state.get("finished"):
        _persist(db, run, state)
        return _serialize(run)
    res = engine.pick_difficulty(state, seat=0, tier=tier)
    if not res["ok"]:
        # Persist any state changes (e.g. from force_skip_if_expired) anyway.
        _persist(db, run, state)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=res.get("reason", "bad_request"))
    _persist(db, run, state)
    return _serialize(run)


def _apply_submit(db: Session, run: SoloRun, word: str) -> tuple[SoloRunOut, dict]:
    state = json.loads(run.state_json)
    res = engine.submit_word(state, seat=0, word=word)
    words = json.loads(run.words_json)
    if res["ok"]:
        words.append({
            "word": res["word"],
            "points": res["points"],
            "tier": state.get("current_difficulty") or "",  # already cleared post-accept
            "ts": datetime.now(timezone.utc).isoformat(),
        })
    _persist(db, run, state, words=words)
    return _serialize(run), res


def _apply_skip(db: Session, run: SoloRun) -> SoloRunOut:
    state = json.loads(run.state_json)
    res = engine.skip(state, seat=0, reason="voluntary")
    if not res["ok"] and res.get("reason") != "game_finished":
        _persist(db, run, state)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=res.get("reason", "bad_request"))
    _persist(db, run, state)
    return _serialize(run)


def _apply_end(db: Session, run: SoloRun) -> SoloRunOut:
    state = json.loads(run.state_json)
    state["finished"] = True
    state["finish_reason"] = state.get("finish_reason") or "ended_by_player"
    _persist(db, run, state)
    return _serialize(run)


# ---------- practice endpoints ----------

@router.post("/practice/start", response_model=SoloRunOut)
def practice_start(db: Session = Depends(get_db), identity: Identity = Depends(get_identity)):
    run = _start_run(db, identity, MODE_PRACTICE)
    return _serialize(run)


@router.post("/practice/pick", response_model=SoloRunOut)
def practice_pick(req: SoloPickRequest, db: Session = Depends(get_db), identity: Identity = Depends(get_identity)):
    run = _load_run(db, req.run_id, identity, MODE_PRACTICE)
    return _apply_pick(db, run, req.tier)


@router.post("/practice/submit")
def practice_submit(req: SoloSubmitRequest, db: Session = Depends(get_db), identity: Identity = Depends(get_identity)):
    run = _load_run(db, req.run_id, identity, MODE_PRACTICE)
    out, res = _apply_submit(db, run, req.word)
    return {"run": out, "result": res}


@router.post("/practice/skip", response_model=SoloRunOut)
def practice_skip(req: SoloSkipRequest, db: Session = Depends(get_db), identity: Identity = Depends(get_identity)):
    run = _load_run(db, req.run_id, identity, MODE_PRACTICE)
    return _apply_skip(db, run)


@router.post("/practice/end", response_model=SoloRunOut)
def practice_end(req: SoloSkipRequest, db: Session = Depends(get_db), identity: Identity = Depends(get_identity)):
    run = _load_run(db, req.run_id, identity, MODE_PRACTICE)
    return _apply_end(db, run)


# ---------- daily endpoints (Phase 2; thin wrappers reusing helpers) ----------

@router.post("/daily/start", response_model=SoloRunOut)
def daily_start(db: Session = Depends(get_db), identity: Identity = Depends(get_identity)):
    run = _start_run(db, identity, MODE_DAILY)
    return _serialize(run)


@router.post("/daily/pick", response_model=SoloRunOut)
def daily_pick(req: SoloPickRequest, db: Session = Depends(get_db), identity: Identity = Depends(get_identity)):
    run = _load_run(db, req.run_id, identity, MODE_DAILY)
    return _apply_pick(db, run, req.tier)


@router.post("/daily/submit")
def daily_submit(req: SoloSubmitRequest, db: Session = Depends(get_db), identity: Identity = Depends(get_identity)):
    run = _load_run(db, req.run_id, identity, MODE_DAILY)
    out, res = _apply_submit(db, run, req.word)
    return {"run": out, "result": res}


@router.post("/daily/skip", response_model=SoloRunOut)
def daily_skip(req: SoloSkipRequest, db: Session = Depends(get_db), identity: Identity = Depends(get_identity)):
    run = _load_run(db, req.run_id, identity, MODE_DAILY)
    return _apply_skip(db, run)


@router.post("/daily/end", response_model=SoloRunOut)
def daily_end(req: SoloSkipRequest, db: Session = Depends(get_db), identity: Identity = Depends(get_identity)):
    run = _load_run(db, req.run_id, identity, MODE_DAILY)
    return _apply_end(db, run)
