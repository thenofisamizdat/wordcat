from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import DailyResult, SoloRun, User
from ..schemas import (
    LeaderboardEntry,
    LeaderboardOut,
    MultiplayerLeaderboardEntry,
    MultiplayerLeaderboardOut,
)
from ..services.rating import display_from, is_provisional, tier_from

router = APIRouter(prefix="/api/leaderboard", tags=["leaderboard"])


@router.get("/daily", response_model=LeaderboardOut)
def daily(
    date_str: str | None = Query(default=None, alias="date"),
    db: Session = Depends(get_db),
):
    d = date_str or date.today().isoformat()
    rows = (
        db.query(SoloRun)
        .filter(SoloRun.mode == "daily_timed", SoloRun.date == d)
        .order_by(desc(SoloRun.score), SoloRun.duration_s.asc(), SoloRun.id.asc())
        .limit(100)
        .all()
    )
    entries = [
        LeaderboardEntry(
            rank=i + 1,
            name=r.display_name,
            score=r.score,
            duration_s=r.duration_s,
            finished=bool(r.finished),
        )
        for i, r in enumerate(rows)
    ]
    return LeaderboardOut(date=d, entries=entries)


@router.get("/daily-puzzle", response_model=LeaderboardOut)
def daily_puzzle(
    date_str: str | None = Query(default=None, alias="date"),
    db: Session = Depends(get_db),
):
    """Leaderboard for the fixed daily puzzle. Ranked by total score, then by
    fastest finish, then submission order."""
    d = date_str or date.today().isoformat()
    rows = (
        db.query(DailyResult)
        .filter(DailyResult.date == d, DailyResult.finished == 1)
        .order_by(desc(DailyResult.total_score), DailyResult.duration_s.asc(), DailyResult.id.asc())
        .limit(100)
        .all()
    )
    entries = [
        LeaderboardEntry(
            rank=i + 1,
            name=r.display_name,
            score=r.total_score,
            duration_s=r.duration_s,
            finished=bool(r.finished),
        )
        for i, r in enumerate(rows)
    ]
    return LeaderboardOut(date=d, entries=entries)


@router.get("/multiplayer", response_model=MultiplayerLeaderboardOut)
def multiplayer(
    limit: int = Query(default=100, ge=1, le=500),
    include_provisional: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    """Top players ranked by conservative skill estimate (mu - 3*sigma).

    By default hides provisional players (games_played < 10 OR sigma > 5.0)
    so a brand-new user with one lucky win doesn't sit at the top.
    """
    # Build SQL: order by (rating_mu - 3*rating_sigma) DESC.
    q = db.query(User).filter(User.games_played > 0)
    rows = q.all()
    # Filter and rank in Python (small datasets; SQLite arithmetic in ORDER BY
    # is fine but provisional logic is easier here).
    enriched = []
    for u in rows:
        prov = is_provisional(u.games_played, u.rating_sigma)
        if not include_provisional and prov:
            continue
        disp = display_from(u.rating_mu, u.rating_sigma)
        tier = tier_from(disp, prov)
        enriched.append({
            "user": u,
            "display": disp,
            "tier": tier,
            "provisional": prov,
            "score_key": u.rating_mu - 3.0 * u.rating_sigma,
        })
    enriched.sort(key=lambda x: -x["score_key"])
    enriched = enriched[:limit]

    entries = [
        MultiplayerLeaderboardEntry(
            rank=i + 1,
            name=e["user"].display_name,
            display_rating=e["display"],
            tier=e["tier"]["name"],
            color=e["tier"]["color"],
            games_played=e["user"].games_played,
            provisional=e["provisional"],
        )
        for i, e in enumerate(enriched)
    ]
    return MultiplayerLeaderboardOut(entries=entries)
