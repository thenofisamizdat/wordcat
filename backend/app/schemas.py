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


class MeResponse(BaseModel):
    display_name: str
    is_guest: bool
    email: Optional[EmailStr] = None


# ---------- categories ----------

class CategoryOut(BaseModel):
    id: str
    name: str
    difficulty: str


# ---------- solo ----------

class SoloStartRequest(BaseModel):
    pass  # mode in path


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
    max_players: int = Field(default=4, ge=2, le=6)
    turn_seconds: int = Field(default=180, ge=30, le=600)


class GamePlayerOut(BaseModel):
    seat: int
    name: str
    is_guest: bool
    score: int
    connected: bool = False


class GameSummary(BaseModel):
    code: str
    status: str
    host_name: str
    max_players: int
    turn_seconds: int
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
