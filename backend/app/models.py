from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


# OpenSkill PlackettLuce defaults — keep in sync with services/rating.py.
RATING_MU0 = 25.0
RATING_SIGMA0 = 25.0 / 3.0  # ≈ 8.3333


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    # Multiplayer rating (OpenSkill PlackettLuce). New users start at the
    # default mu/sigma; ratings update at the end of every multiplayer game
    # in which all seats are registered users. Guests' games don't move
    # anyone's rating.
    rating_mu: Mapped[float] = mapped_column(Float, nullable=False, default=RATING_MU0)
    rating_sigma: Mapped[float] = mapped_column(Float, nullable=False, default=RATING_SIGMA0)
    games_played: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rating_updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class Game(Base):
    __tablename__ = "games"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(8), unique=True, index=True)
    host_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="lobby")  # lobby | active | finished
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    settings_json: Mapped[str] = mapped_column(Text, default="{}")

    players: Mapped[list["GamePlayer"]] = relationship(back_populates="game", cascade="all, delete-orphan")
    state: Mapped[Optional["GameState"]] = relationship(back_populates="game", uselist=False, cascade="all, delete-orphan")


class GamePlayer(Base):
    __tablename__ = "game_players"

    id: Mapped[int] = mapped_column(primary_key=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("games.id"), index=True)
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    guest_name: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    seat: Mapped[int] = mapped_column(Integer)
    score: Mapped[int] = mapped_column(Integer, default=0)
    joined_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    game: Mapped[Game] = relationship(back_populates="players")


class GameState(Base):
    __tablename__ = "game_state"

    game_id: Mapped[int] = mapped_column(ForeignKey("games.id"), primary_key=True)
    state_json: Mapped[str] = mapped_column(Text)  # full engine state dict
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    game: Mapped[Game] = relationship(back_populates="state")


class SoloRun(Base):
    __tablename__ = "solo_runs"
    __table_args__ = (
        # Daily uniqueness per identity is enforced in code (handles user OR guest).
        UniqueConstraint("user_id", "date", "mode", name="uq_user_date_mode"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    guest_key: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    display_name: Mapped[str] = mapped_column(String(64))
    mode: Mapped[str] = mapped_column(String(16), index=True)  # daily | practice
    date: Mapped[str] = mapped_column(String(10), index=True)  # YYYY-MM-DD
    seed: Mapped[int] = mapped_column(Integer)
    score: Mapped[int] = mapped_column(Integer, default=0)
    state_json: Mapped[str] = mapped_column(Text)  # active engine state during play
    words_json: Mapped[str] = mapped_column(Text, default="[]")
    duration_s: Mapped[int] = mapped_column(Integer, default=0)
    finished: Mapped[int] = mapped_column(Integer, default=0)  # 0/1 boolean
    started_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class RatingHistory(Base):
    """One row per (user, multiplayer game) recording the rating before/after.
    Used for audit trails, rating-progression charts, and rolling back if needed."""
    __tablename__ = "rating_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("games.id"), index=True)
    finishing_rank: Mapped[int] = mapped_column(Integer)        # 1 = winner, ties allowed
    finishing_score: Mapped[int] = mapped_column(Integer)
    mu_before: Mapped[float] = mapped_column(Float)
    sigma_before: Mapped[float] = mapped_column(Float)
    mu_after: Mapped[float] = mapped_column(Float)
    sigma_after: Mapped[float] = mapped_column(Float)
    display_before: Mapped[int] = mapped_column(Integer)
    display_after: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
