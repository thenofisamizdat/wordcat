"""Daily-puzzle router — the fixed-sequence, sticky daily experience.

Every player on a given date gets the identical puzzle (same pool, same 5 cards,
same preset tiers). One attempt per identity per day. On finish we compute the
share grid and update the player's streak.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..auth import Identity, get_identity
from ..db import get_db
from ..game import engine
from ..game.daily import (
    DAILY_OVERALL_SECONDS,
    DAILY_TURN_SECONDS,
    build_daily,
    grade_results,
)
from ..game.words import categories_by_id, load_letter_values
from ..models import DailyResult, Streak
from ..schemas import (
    CategoryOut,
    DailyPuzzleOut,
    DailyPuzzleSkipRequest,
    DailyPuzzleSubmitRequest,
    StreakOut,
)

router = APIRouter(prefix="/api/daily-puzzle", tags=["daily-puzzle"])

# Launch epoch — the date that is puzzle #1. Used only for the shareable "#N".
LAUNCH_DATE = date(2026, 1, 1)

# Share-grid emoji per tier.
GRID_EMOJI = {
    "optimal": "\U0001F7E9",  # green square
    "good": "\U0001F7E8",     # yellow square
    "weak": "\u2B1C",         # white square
    "skip": "\u2B1B",         # black square
}


# ---------- helpers ----------

def _today_iso() -> str:
    return date.today().isoformat()


def _puzzle_no(date_iso: str) -> int:
    d = date.fromisoformat(date_iso)
    return (d - LAUNCH_DATE).days + 1


def _identity_filter(query, identity: Identity):
    if identity.user:
        return query.filter(DailyResult.user_id == identity.user.id)
    return query.filter(DailyResult.guest_key == identity.guest_key)


def _share_text(date_iso: str, grid: list[str], total: int, streak: int) -> str:
    squares = "".join(GRID_EMOJI.get(g, GRID_EMOJI["skip"]) for g in grid)
    line = f"WordCat Daily #{_puzzle_no(date_iso)}  {squares}  {total} pts"
    if streak and streak > 1:
        line += f"  \U0001F525 {streak}-day streak"
    return line


def _update_streak(db: Session, identity: Identity, date_iso: str) -> Streak:
    """Bump the identity's streak on finishing today's puzzle. Idempotent for a
    given date (replaying the same day doesn't inflate the streak)."""
    streak = (
        db.query(Streak)
        .filter(Streak.identity_key == identity.stable_key)
        .first()
    )
    if streak is None:
        streak = Streak(
            identity_key=identity.stable_key,
            current_streak=0,
            best_streak=0,
            last_played_date=None,
        )
        db.add(streak)

    today = date.fromisoformat(date_iso)
    if streak.last_played_date == date_iso:
        return streak  # already counted today
    yesterday = (today - timedelta(days=1)).isoformat()
    if streak.last_played_date == yesterday:
        streak.current_streak += 1
    else:
        streak.current_streak = 1
    streak.best_streak = max(streak.best_streak, streak.current_streak)
    streak.last_played_date = date_iso
    return streak


def _read_streak(db: Session, identity: Identity) -> Streak:
    streak = (
        db.query(Streak)
        .filter(Streak.identity_key == identity.stable_key)
        .first()
    )
    if streak is None:
        return Streak(
            identity_key=identity.stable_key,
            current_streak=0,
            best_streak=0,
            last_played_date=None,
        )
    return streak


def _serialize(db: Session, run: DailyResult, identity: Identity) -> DailyPuzzleOut:
    state = json.loads(run.state_json)
    cats_by_id = categories_by_id()
    pv = engine.daily_public_view(state)

    card = None
    cur_id = pv["current_card_id"]
    if cur_id:
        c = cats_by_id.get(cur_id)
        if c:
            card = {"id": c["id"], "name": c["name"], "difficulty": c["difficulty"]}

    grid = json.loads(run.grid_json) if run.grid_json else []
    streak = _read_streak(db, identity)
    share_text = None
    if run.finished:
        share_text = _share_text(run.date, grid, run.total_score, streak.current_streak)

    return DailyPuzzleOut(
        result_id=run.id,
        date=run.date,
        puzzle_no=_puzzle_no(run.date),
        seed=run.seed,
        finished=bool(run.finished),
        total_score=run.total_score,
        state=pv,
        card=card,
        grid=grid,
        share_text=share_text,
        streak=StreakOut(
            current_streak=streak.current_streak,
            best_streak=streak.best_streak,
            last_played_date=streak.last_played_date,
        ),
        letter_values=load_letter_values(),
        categories=[CategoryOut(**c) for c in cats_by_id.values()],
    )


def _persist(db: Session, run: DailyResult, state: dict) -> None:
    run.state_json = json.dumps(state)
    run.total_score = state["scores"][0]
    db.add(run)
    db.commit()
    db.refresh(run)


def _finalize_if_finished(db: Session, run: DailyResult, state: dict, identity: Identity) -> None:
    """If the engine state has flipped to finished, grade the grid, stamp the
    finish time, and update the streak — exactly once."""
    if not state.get("finished") or run.finished:
        return
    grid = grade_results(run.date, state["results"])
    run.grid_json = json.dumps(grid)
    run.finished = 1
    run.finished_at = datetime.now(timezone.utc)
    if run.started_at:
        started = run.started_at if run.started_at.tzinfo else run.started_at.replace(tzinfo=timezone.utc)
        run.duration_s = max(0, int((datetime.now(timezone.utc) - started).total_seconds()))
    _update_streak(db, identity, run.date)


def _load_run(db: Session, result_id: int, identity: Identity) -> DailyResult:
    run = db.get(DailyResult, result_id)
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Result not found")
    owns = (run.user_id == identity.user.id) if identity.user else (run.guest_key == identity.guest_key)
    if not owns:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your result")
    return run


# ---------- endpoints ----------

@router.post("/start", response_model=DailyPuzzleOut)
def start(db: Session = Depends(get_db), identity: Identity = Depends(get_identity)):
    today = _today_iso()
    existing = (
        _identity_filter(db.query(DailyResult), identity)
        .filter(DailyResult.date == today)
        .first()
    )
    if existing:
        # Resume in-progress, or return the finished result (so the client can
        # show the grid). One attempt/day — no restart on finished.
        return _serialize(db, existing, identity)

    puzzle = build_daily(today)
    state = engine.new_daily_state(
        seed=puzzle["seed"],
        pool=puzzle["pool"],
        sequence=puzzle["sequence"],
        turn_seconds=DAILY_TURN_SECONDS,
        overall_seconds=DAILY_OVERALL_SECONDS,
    )
    run = DailyResult(
        user_id=identity.user.id if identity.user else None,
        guest_key=identity.guest_key,
        display_name=identity.display_name,
        date=today,
        seed=puzzle["seed"],
        state_json=json.dumps(state),
        grid_json="[]",
        total_score=0,
        finished=0,
        duration_s=0,
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return _serialize(db, run, identity)


@router.post("/submit", response_model=DailyPuzzleOut)
def submit(req: DailyPuzzleSubmitRequest, db: Session = Depends(get_db), identity: Identity = Depends(get_identity)):
    run = _load_run(db, req.result_id, identity)
    state = json.loads(run.state_json)
    engine.daily_force_expire(state)
    res = engine.daily_submit(state, req.word)
    if not res["ok"]:
        # Persist any expiry-driven state change, then report the rejection. A
        # rejected word is a normal gameplay event (retry) — 400 with reason.
        _finalize_if_finished(db, run, state, identity)
        _persist(db, run, state)
        if res.get("reason") in ("game_finished", "time_up"):
            return _serialize(db, run, identity)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=res.get("reason", "bad_request"))
    _finalize_if_finished(db, run, state, identity)
    _persist(db, run, state)
    return _serialize(db, run, identity)


@router.post("/skip", response_model=DailyPuzzleOut)
def skip(req: DailyPuzzleSkipRequest, db: Session = Depends(get_db), identity: Identity = Depends(get_identity)):
    run = _load_run(db, req.result_id, identity)
    state = json.loads(run.state_json)
    engine.daily_force_expire(state)
    res = engine.daily_skip(state, reason="voluntary")
    if not res["ok"] and res.get("reason") not in ("game_finished", "time_up"):
        _persist(db, run, state)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=res.get("reason", "bad_request"))
    _finalize_if_finished(db, run, state, identity)
    _persist(db, run, state)
    return _serialize(db, run, identity)


@router.get("/streak", response_model=StreakOut)
def streak(db: Session = Depends(get_db), identity: Identity = Depends(get_identity)):
    s = _read_streak(db, identity)
    return StreakOut(
        current_streak=s.current_streak,
        best_streak=s.best_streak,
        last_played_date=s.last_played_date,
    )
