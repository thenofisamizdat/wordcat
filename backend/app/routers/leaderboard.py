from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import SoloRun
from ..schemas import LeaderboardEntry, LeaderboardOut

router = APIRouter(prefix="/api/leaderboard", tags=["leaderboard"])


@router.get("/daily", response_model=LeaderboardOut)
def daily(
    date_str: str | None = Query(default=None, alias="date"),
    db: Session = Depends(get_db),
):
    d = date_str or date.today().isoformat()
    rows = (
        db.query(SoloRun)
        .filter(SoloRun.mode == "daily", SoloRun.date == d)
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
