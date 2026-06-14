from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, EmailStr, Field


# ---------- auth ----------

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    display_name: str = Field(min_length=1, max_length=64)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class GuestRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=64)


class TokenResponse(BaseModel):
    token: str
    display_name: str
    is_guest: bool


class RatingOut(BaseModel):
    """Public-facing rating payload, returned everywhere a user's skill is shown."""
    mu: float
    sigma: float
    display: int           # 4-digit chess-style rating
    tier: str              # Bronze / Silver / Gold / Platinum / Diamond / Master
    color: str             # hex colour for the tier badge
    provisional: bool      # True until games_played >= 10 AND sigma <= 5.0
    games_played: int


class MeResponse(BaseModel):
    display_name: str
    is_guest: bool
    email: Optional[EmailStr] = None
    rating: Optional[RatingOut] = None  # registered users only; None for guests


# ---------- categories ----------

class CategoryOut(BaseModel):
    id: str
    name: str
    difficulty: str


# ---------- solo ----------

class SoloStartRequest(BaseModel):
    timed: bool = True  # practice only; daily modes imply timed-ness via URL path


class SoloPickRequest(BaseModel):
    run_id: int
    tier: str  # easy|medium|hard


class SoloSubmitRequest(BaseModel):
    run_id: int
    word: str


class SoloSkipRequest(BaseModel):
    run_id: int


class SoloEndRequest(BaseModel):
    run_id: int


class SoloRunOut(BaseModel):
    run_id: int
    mode: str
    date: str
    seed: int
    score: int
    duration_s: int
    finished: bool
    state: dict           # public_view
    card: Optional[dict] = None  # current card details if any
    letter_values: dict[str, int]
    categories: list[CategoryOut]


# ---------- leaderboard ----------

class LeaderboardEntry(BaseModel):
    rank: int
    name: str
    score: int
    duration_s: int
    finished: bool


class LeaderboardOut(BaseModel):
    date: str
    entries: list[LeaderboardEntry]


# ---------- multiplayer ----------

class CreateGameRequest(BaseModel):
    min_players: int = Field(default=2, ge=2, le=6)
    max_players: int = Field(default=4, ge=2, le=6)
    turn_seconds: int = Field(default=180, ge=30, le=600)
    # Overall game clock (multiplayer). Settable from 5 minutes upwards.
    # Once it expires the game ends with reason "time_up".
    overall_seconds: int = Field(default=300, ge=300, le=3600)


class GamePlayerOut(BaseModel):
    seat: int
    name: str
    is_guest: bool
    score: int
    connected: bool = False
    rating: Optional[RatingOut] = None  # only present for registered users


class GameSummary(BaseModel):
    code: str
    status: str
    host_name: str
    min_players: int = 2
    max_players: int
    turn_seconds: int
    overall_seconds: int = 300
    players: list[GamePlayerOut]
    created_at: str


class GameDetail(GameSummary):
    your_seat: Optional[int] = None
    state: Optional[dict] = None
    card: Optional[dict] = None
    letter_values: dict[str, int]
    categories: list[CategoryOut]


class JoinGameResponse(BaseModel):
    code: str
    seat: int


class GameListOut(BaseModel):
    games: list[GameSummary]


# ---------- multiplayer matchmaking ----------

class AutoJoinRequest(BaseModel):
    """Optional preferences if we have to fall back to creating a new lobby
    (e.g. because no existing lobby is a good fit). When joining an existing
    lobby these are ignored."""
    min_players: int = Field(default=2, ge=2, le=6)
    max_players: int = Field(default=4, ge=2, le=6)
    turn_seconds: int = Field(default=180, ge=30, le=600)
    overall_seconds: int = Field(default=300, ge=300, le=3600)


class AutoJoinResponse(BaseModel):
    code: str
    seat: int
    action: str  # "joined" | "created"


# ---------- multiplayer leaderboard ----------

class MultiplayerLeaderboardEntry(BaseModel):
    rank: int
    name: str
    display_rating: int
    tier: str
    color: str
    games_played: int
    provisional: bool


class MultiplayerLeaderboardOut(BaseModel):
    entries: list[MultiplayerLeaderboardEntry]
