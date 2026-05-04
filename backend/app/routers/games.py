from __future__ import annotations

import json
import secrets
import string
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..auth import Identity, get_identity
from ..db import get_db
from ..game import engine
from ..game.words import categories_by_id, load_letter_values
from ..models import Game, GamePlayer, GameState
from ..schemas import (
    CategoryOut,
    CreateGameRequest,
    GameDetail,
    GameListOut,
    GamePlayerOut,
    GameSummary,
    JoinGameResponse,
)

router = APIRouter(prefix="/api/games", tags=["games"])

CODE_ALPHABET = string.ascii_uppercase + string.digits


def _generate_code(db: Session) -> str:
    for _ in range(20):
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
        if not db.query(Game).filter(Game.code == code).first():
            return code
    raise HTTPException(status_code=500, detail="Could not allocate code")


def _identity_owns(identity: Identity, player: GamePlayer) -> bool:
    if identity.user:
        return player.user_id == identity.user.id
    return player.user_id is None and player.guest_name == identity.display_name and \
        player.guest_name is not None  # guests share name; combined with seat lookup elsewhere


def _player_for_identity(game: Game, identity: Identity) -> GamePlayer | None:
    """Find this identity's seat in the game.

    For users we match user_id; for guests we match by guest token's stable_key
    using guest_name as the storage column (we store the guest's stable_key there
    when they join — see _join_guest below). This guarantees one seat per browser
    session even if two guests pick the same display name.
    """
    if identity.user:
        for p in game.players:
            if p.user_id == identity.user.id:
                return p
        return None
    # guests: stable_key stored in guest_name to enforce per-token identity.
    # display_name is the readable label, also stored separately on the player.
    for p in game.players:
        if p.user_id is None and p.guest_name == identity.stable_key:
            return p
    return None


def _settings(game: Game) -> dict:
    try:
        return json.loads(game.settings_json or "{}")
    except json.JSONDecodeError:
        return {}


def _summary(game: Game, db: Session, *, connected_seats: set[int] | None = None) -> GameSummary:
    s = _settings(game)
    host = next((p for p in game.players if p.user_id == game.host_user_id), None) if game.host_user_id else None
    host_name = host.guest_name if host and host.user_id is None else (host and host.guest_name)  # placeholder
    # We store guest_name as the stable_key for guests; display name is in label_for_player below.
    return GameSummary(
        code=game.code,
        status=game.status,
        host_name=_label_for_player(game, host) if host else "—",
        max_players=int(s.get("max_players", 4)),
        turn_seconds=int(s.get("turn_seconds", 180)),
        players=[_player_out(p, connected_seats) for p in sorted(game.players, key=lambda x: x.seat)],
        created_at=(game.created_at or datetime.now(timezone.utc)).isoformat(),
    )


# We use a small extra column trick: the readable display name for a guest is
# kept in the User-less player row by storing a JSON {"name": "..."} in guest_name?
# That conflicts with our stable_key approach. Cleaner: add a `display_name` field
# on the player row by serializing into a per-game players label dict.
#
# Simpler: keep both. Use guest_name = stable_key (uniqueness), and put display
# names into game.settings_json["names"][seat] = "Display Name".

def _label_for_player(game: Game, player: GamePlayer | None) -> str:
    if player is None:
        return "—"
    if player.user_id is not None:
        # We don't eagerly load user here; ws layer will join with names. For REST,
        # consult the settings cache.
        names = _settings(game).get("names", {})
        return names.get(str(player.seat), f"Player {player.seat + 1}")
    names = _settings(game).get("names", {})
    return names.get(str(player.seat), "Guest")


def _player_out(p: GamePlayer, connected_seats: set[int] | None) -> GamePlayerOut:
    g = p.game
    return GamePlayerOut(
        seat=p.seat,
        name=_label_for_player(g, p),
        is_guest=(p.user_id is None),
        score=p.score,
        connected=(connected_seats is not None and p.seat in connected_seats),
    )


def _set_name_in_settings(game: Game, seat: int, display_name: str) -> None:
    s = _settings(game)
    names = s.get("names", {})
    names[str(seat)] = display_name
    s["names"] = names
    game.settings_json = json.dumps(s)


# ---------- endpoints ----------

@router.post("", response_model=GameDetail)
def create_game(
    req: CreateGameRequest,
    db: Session = Depends(get_db),
    identity: Identity = Depends(get_identity),
):
    code = _generate_code(db)
    game = Game(
        code=code,
        host_user_id=identity.user.id if identity.user else None,
        status="lobby",
        settings_json=json.dumps({
            "max_players": req.max_players,
            "turn_seconds": req.turn_seconds,
            "names": {},
        }),
    )
    db.add(game)
    db.flush()

    seat = 0
    player = GamePlayer(
        game_id=game.id,
        user_id=identity.user.id if identity.user else None,
        guest_name=None if identity.user else identity.stable_key,
        seat=seat,
        score=0,
    )
    db.add(player)
    db.flush()
    _set_name_in_settings(game, seat, identity.display_name)
    db.add(game)
    db.commit()
    db.refresh(game)
    return _detail(game, identity)


@router.get("", response_model=GameListOut)
def list_games(
    db: Session = Depends(get_db),
    status_filter: str = "lobby",
):
    rows = (
        db.query(Game)
        .filter(Game.status == status_filter)
        .order_by(Game.created_at.desc())
        .limit(50)
        .all()
    )
    return GameListOut(games=[_summary(g, db) for g in rows])


@router.post("/{code}/join", response_model=JoinGameResponse)
def join_game(
    code: str,
    db: Session = Depends(get_db),
    identity: Identity = Depends(get_identity),
):
    game = db.query(Game).filter(Game.code == code.upper()).first()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    s = _settings(game)
    max_players = int(s.get("max_players", 4))

    existing = _player_for_identity(game, identity)
    if existing:
        return JoinGameResponse(code=game.code, seat=existing.seat)

    if game.status != "lobby":
        raise HTTPException(status_code=409, detail="Game already started")
    if len(game.players) >= max_players:
        raise HTTPException(status_code=409, detail="Game is full")

    seat = max((p.seat for p in game.players), default=-1) + 1
    player = GamePlayer(
        game_id=game.id,
        user_id=identity.user.id if identity.user else None,
        guest_name=None if identity.user else identity.stable_key,
        seat=seat,
        score=0,
    )
    db.add(player)
    _set_name_in_settings(game, seat, identity.display_name)
    db.add(game)
    db.commit()
    return JoinGameResponse(code=game.code, seat=seat)


@router.get("/{code}", response_model=GameDetail)
def get_game(
    code: str,
    db: Session = Depends(get_db),
    identity: Identity = Depends(get_identity),
):
    game = db.query(Game).filter(Game.code == code.upper()).first()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    return _detail(game, identity)


@router.post("/{code}/start", response_model=GameDetail)
def start_game(
    code: str,
    db: Session = Depends(get_db),
    identity: Identity = Depends(get_identity),
):
    game = db.query(Game).filter(Game.code == code.upper()).first()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game.host_user_id is None and not _player_for_identity(game, identity):
        raise HTTPException(status_code=403, detail="Only host can start")
    # If a host is set, only that host can start.
    if game.host_user_id is not None and (not identity.user or identity.user.id != game.host_user_id):
        raise HTTPException(status_code=403, detail="Only host can start")
    if game.status != "lobby":
        raise HTTPException(status_code=409, detail="Already started or finished")
    if len(game.players) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 players to start")

    s = _settings(game)
    seed = int.from_bytes(secrets.token_bytes(6), "big")
    state = engine.new_state(
        seed=seed,
        num_players=len(game.players),
        turn_seconds=int(s.get("turn_seconds", 180)),
    )
    game.status = "active"
    game.started_at = datetime.now(timezone.utc)

    # Persist state as one row.
    if game.state is None:
        game.state = GameState(game_id=game.id, state_json=json.dumps(state))
    else:
        game.state.state_json = json.dumps(state)
    db.add(game)
    db.commit()
    db.refresh(game)
    return _detail(game, identity)


# ---------- helpers ----------

def _detail(game: Game, identity: Identity) -> GameDetail:
    summary = _summary(game, None)
    your = _player_for_identity(game, identity)
    state = None
    card = None
    if game.state is not None:
        state = engine.public_view(json.loads(game.state.state_json))
        if state.get("current_card_id"):
            c = categories_by_id().get(state["current_card_id"])
            if c:
                card = {"id": c["id"], "name": c["name"], "difficulty": c["difficulty"]}
    cats_out = [CategoryOut(**c) for c in categories_by_id().values()]
    return GameDetail(
        **summary.model_dump(),
        your_seat=your.seat if your else None,
        state=state,
        card=card,
        letter_values=load_letter_values(),
        categories=cats_out,
    )
