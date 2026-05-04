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
from ..models import Game, GamePlayer, GameState, User
from ..schemas import (
    AutoJoinRequest,
    AutoJoinResponse,
    CategoryOut,
    CreateGameRequest,
    GameDetail,
    GameListOut,
    GamePlayerOut,
    GameSummary,
    JoinGameResponse,
    RatingOut,
)
from ..services.matchmaking import (
    LobbySummary as MMLobby,
    PlayerRating as MMPlayer,
    auto_join_pick,
)
from ..services.rating import rating_payload

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


def _users_for_game(db: Session, game: Game) -> dict[int, User]:
    user_ids = [p.user_id for p in game.players if p.user_id is not None]
    if not user_ids:
        return {}
    rows = db.query(User).filter(User.id.in_(user_ids)).all()
    return {u.id: u for u in rows}


def _summary(game: Game, db: Session | None, *, connected_seats: set[int] | None = None) -> GameSummary:
    s = _settings(game)
    host = next((p for p in game.players if p.user_id == game.host_user_id), None) if game.host_user_id else None
    users_by_id = _users_for_game(db, game) if db is not None else {}
    return GameSummary(
        code=game.code,
        status=game.status,
        host_name=_label_for_player(game, host) if host else "—",
        min_players=int(s.get("min_players", 2)),
        max_players=int(s.get("max_players", 4)),
        turn_seconds=int(s.get("turn_seconds", 180)),
        players=[_player_out(p, connected_seats, users_by_id)
                 for p in sorted(game.players, key=lambda x: x.seat)],
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


def _player_out(
    p: GamePlayer,
    connected_seats: set[int] | None,
    users_by_id: dict[int, User] | None = None,
) -> GamePlayerOut:
    g = p.game
    rating: RatingOut | None = None
    if p.user_id is not None and users_by_id is not None and p.user_id in users_by_id:
        u = users_by_id[p.user_id]
        rating = RatingOut(**rating_payload(u.rating_mu, u.rating_sigma, u.games_played))
    return GamePlayerOut(
        seat=p.seat,
        name=_label_for_player(g, p),
        is_guest=(p.user_id is None),
        score=p.score,
        connected=(connected_seats is not None and p.seat in connected_seats),
        rating=rating,
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
    if req.min_players > req.max_players:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="min_players cannot exceed max_players",
        )
    code = _generate_code(db)
    game = Game(
        code=code,
        host_user_id=identity.user.id if identity.user else None,
        status="lobby",
        settings_json=json.dumps({
            "min_players": req.min_players,
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
    return _detail(game, identity, db)


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


@router.post("/auto-join", response_model=AutoJoinResponse)
def auto_join(
    req: AutoJoinRequest,
    db: Session = Depends(get_db),
    identity: Identity = Depends(get_identity),
):
    """Pick the best-fit open lobby for this player or create a new one.

    Registered users only — guests get 401. Matching uses
    `services.matchmaking.auto_join_pick` which scores candidate lobbies on
    rating closeness × lobby age × capacity (closer to starting first).
    """
    if identity.user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign up to use auto-join (guests can still join games by code).",
        )
    if req.min_players > req.max_players:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="min_players cannot exceed max_players",
        )

    # Pull all lobby-status games we could potentially join (excluding ones
    # this user already sits in).
    open_games = (
        db.query(Game)
        .filter(Game.status == "lobby")
        .order_by(Game.created_at.desc())
        .limit(50)
        .all()
    )

    candidates: list[MMLobby] = []
    user_already_in: dict[str, int] = {}
    for g in open_games:
        s = _settings(g)
        existing = _player_for_identity(g, identity)
        if existing is not None:
            user_already_in[g.code] = existing.seat
            continue
        # Build rating list of CURRENT players (skip guests for matchmaking).
        users_by_id = _users_for_game(db, g)
        ratings: list[MMPlayer] = []
        for p in g.players:
            if p.user_id is not None and p.user_id in users_by_id:
                u = users_by_id[p.user_id]
                ratings.append(MMPlayer(mu=u.rating_mu, sigma=u.rating_sigma))
        candidates.append(MMLobby(
            code=g.code,
            created_at_epoch=(g.created_at.replace(tzinfo=timezone.utc).timestamp()
                              if g.created_at and g.created_at.tzinfo is None
                              else (g.created_at.timestamp() if g.created_at else 0)),
            min_players=int(s.get("min_players", 2)),
            max_players=int(s.get("max_players", 4)),
            current_player_ratings=ratings,
            current_player_count=len(g.players),
        ))

    # If the player already sits in any open lobby, just route them back there
    # — picks the most-recently-created of their existing seats.
    if user_already_in:
        # Pick whichever they most recently joined (latest created_at)
        latest = max(open_games, key=lambda g: g.created_at if g.code in user_already_in else None)
        if latest.code in user_already_in:
            return AutoJoinResponse(code=latest.code, seat=user_already_in[latest.code], action="joined")

    me = identity.user
    player_rating = MMPlayer(mu=me.rating_mu, sigma=me.rating_sigma)
    decision, code = auto_join_pick(player_rating, candidates)

    if decision == "JOIN" and code is not None:
        # Use the same join flow (re-fetch the chosen game to add this user).
        game = db.query(Game).filter(Game.code == code).first()
        if game and game.status == "lobby":
            s = _settings(game)
            max_players = int(s.get("max_players", 4))
            if len(game.players) < max_players:
                seat = max((p.seat for p in game.players), default=-1) + 1
                player = GamePlayer(
                    game_id=game.id,
                    user_id=me.id,
                    guest_name=None,
                    seat=seat,
                    score=0,
                )
                db.add(player)
                _set_name_in_settings(game, seat, identity.display_name)
                db.add(game)
                db.commit()
                return AutoJoinResponse(code=game.code, seat=seat, action="joined")
        # Fall through to create if the chosen lobby filled up between query
        # and join (race condition; rare but possible).

    # CREATE: brand-new lobby with this user as host (seat 0).
    code = _generate_code(db)
    game = Game(
        code=code,
        host_user_id=me.id,
        status="lobby",
        settings_json=json.dumps({
            "min_players": req.min_players,
            "max_players": req.max_players,
            "turn_seconds": req.turn_seconds,
            "names": {},
        }),
    )
    db.add(game)
    db.flush()
    player = GamePlayer(
        game_id=game.id,
        user_id=me.id,
        guest_name=None,
        seat=0,
        score=0,
    )
    db.add(player)
    db.flush()
    _set_name_in_settings(game, 0, identity.display_name)
    db.add(game)
    db.commit()
    return AutoJoinResponse(code=game.code, seat=0, action="created")


@router.get("/{code}", response_model=GameDetail)
def get_game(
    code: str,
    db: Session = Depends(get_db),
    identity: Identity = Depends(get_identity),
):
    game = db.query(Game).filter(Game.code == code.upper()).first()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    return _detail(game, identity, db)


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
    return _detail(game, identity, db)


# ---------- helpers ----------

def _detail(game: Game, identity: Identity, db: Session | None = None) -> GameDetail:
    summary = _summary(game, db)
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
