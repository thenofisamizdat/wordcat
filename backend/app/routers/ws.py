from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from ..auth import Identity, decode_token
from ..db import SessionLocal
from ..game import engine
from ..game.words import categories_by_id, load_letter_values
from ..models import Game, GamePlayer, GameState, RatingHistory, User
from ..services.rating import (
    apply_game_result,
    display_from,
    is_provisional,
    ranks_from_scores,
    rating_payload,
)

router = APIRouter()


def _label(game: Game, seat: int) -> str:
    s = json.loads(game.settings_json or "{}")
    names = s.get("names", {})
    return names.get(str(seat), f"Player {seat + 1}")


def _public_state(game: Game, db: Optional[Session] = None) -> dict:
    if game.state is not None:
        state = json.loads(game.state.state_json)
        pv = engine.public_view(state)
    else:
        # Lobby — game hasn't been initialised yet.
        s = json.loads(game.settings_json or "{}")
        pv = {
            "pool_counts": {},
            "pool_total": 0,
            "discarded_total": 0,
            "decks_remaining": {"easy": 0, "medium": 0, "hard": 0},
            "scores": [0] * len(game.players),
            "current_seat": 0,
            "current_card_id": None,
            "current_difficulty": None,
            "turn_started_at": None,
            "turn_seconds": int(s.get("turn_seconds", 180)),
            "consecutive_skips": 0,
            "finished": False,
            "finish_reason": None,
            "num_players": len(game.players),
            "history": [],
            "difficulty_multipliers": {"easy": 1.0, "medium": 1.5, "hard": 2.0},
        }
    pv["status"] = game.status
    settings_dict = json.loads(game.settings_json or "{}")
    pv["min_players"] = int(settings_dict.get("min_players", 2))
    pv["max_players"] = int(settings_dict.get("max_players", len(game.players) or 2))

    # Fetch rated users in one query so we can attach a rating dict per seat.
    users_by_id: dict = {}
    if db is not None:
        user_ids = [p.user_id for p in game.players if p.user_id is not None]
        if user_ids:
            users_by_id = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()}

    def _seat_rating(p):
        if p.user_id is None or p.user_id not in users_by_id:
            return None
        u = users_by_id[p.user_id]
        return rating_payload(u.rating_mu, u.rating_sigma, u.games_played)

    pv["players"] = [
        {
            "seat": p.seat,
            "name": _label(game, p.seat),
            "is_guest": p.user_id is None,
            "score": p.score,
            "rating": _seat_rating(p),
        }
        for p in sorted(game.players, key=lambda x: x.seat)
    ]
    if pv.get("current_card_id"):
        c = categories_by_id().get(pv["current_card_id"])
        if c:
            pv["current_card"] = {"id": c["id"], "name": c["name"], "difficulty": c["difficulty"]}
    return pv


def _identity_from_token(db: Session, token: str) -> Optional[Identity]:
    if not token:
        return None
    try:
        payload = decode_token(token)
    except Exception:
        return None
    sub = payload.get("sub", "")
    name = payload.get("name", "")
    if sub.startswith("user:"):
        try:
            uid = int(sub.split(":", 1)[1])
        except ValueError:
            return None
        user = db.get(User, uid)
        if not user:
            return None
        return Identity(user=user, guest_key=None, display_name=user.display_name)
    if sub.startswith("guest:"):
        return Identity(user=None, guest_key=sub.split(":", 1)[1], display_name=name or "Guest")
    return None


def _player_for_identity(game: Game, identity: Identity) -> Optional[GamePlayer]:
    if identity.user:
        return next((p for p in game.players if p.user_id == identity.user.id), None)
    return next((p for p in game.players if p.user_id is None and p.guest_name == identity.stable_key), None)


# ---------- room manager ----------

class Room:
    def __init__(self, code: str):
        self.code = code
        self.connections: dict[int, set[WebSocket]] = {}  # seat -> sockets
        self.lock = asyncio.Lock()
        self.timer_task: Optional[asyncio.Task] = None
        # Auto-start countdown task. Set when len(players) >= min_players in
        # the lobby phase. Cancelled if a player leaves below threshold or if
        # the host manually starts (which fires immediately).
        self.countdown_task: Optional[asyncio.Task] = None

    def add(self, seat: int, ws: WebSocket) -> None:
        self.connections.setdefault(seat, set()).add(ws)

    def remove(self, seat: int, ws: WebSocket) -> None:
        if seat in self.connections:
            self.connections[seat].discard(ws)
            if not self.connections[seat]:
                self.connections.pop(seat, None)

    def all_sockets(self) -> list[WebSocket]:
        out: list[WebSocket] = []
        for s in self.connections.values():
            out.extend(list(s))
        return out

    def connected_seats(self) -> set[int]:
        return set(self.connections.keys())


class Manager:
    def __init__(self) -> None:
        self.rooms: dict[str, Room] = {}
        self.lock = asyncio.Lock()

    async def get(self, code: str) -> Room:
        async with self.lock:
            r = self.rooms.get(code)
            if r is None:
                r = Room(code)
                self.rooms[code] = r
            return r

    async def broadcast(self, room: Room, message: dict) -> None:
        dead: list[tuple[int, WebSocket]] = []
        for seat, sockets in list(room.connections.items()):
            for ws in list(sockets):
                try:
                    await ws.send_json(message)
                except Exception:
                    dead.append((seat, ws))
        for seat, ws in dead:
            room.remove(seat, ws)


manager = Manager()


# ---------- helpers ----------

def _persist(db: Session, game: Game, state: dict) -> Optional[list]:
    """Persist engine state + scores to DB. If the game just transitioned to
    'finished' AND every seat is held by a registered user, compute rating
    updates, write them to the User rows + RatingHistory, and return a
    `rating_changes` payload for broadcasting. Otherwise returns None.
    """
    if game.state is None:
        game.state = GameState(game_id=game.id, state_json=json.dumps(state))
    else:
        game.state.state_json = json.dumps(state)
    # Sync per-player scores from authoritative engine state.
    for p in game.players:
        try:
            p.score = state["scores"][p.seat]
        except (IndexError, KeyError):
            pass

    rating_changes: Optional[list] = None
    just_finished = state.get("finished") and game.status != "finished"
    if just_finished:
        game.status = "finished"
        game.finished_at = datetime.now(timezone.utc)
        rating_changes = _apply_ratings_on_finish(db, game, state)

    db.add(game)
    db.commit()
    return rating_changes


def _apply_ratings_on_finish(db: Session, game: Game, state: dict) -> Optional[list]:
    """Update OpenSkill ratings for every player in the freshly-finished game.

    Skips entirely if any seat is a guest (`user_id is None`) — guest games
    don't move anyone's rating because guest accounts are throwaway.

    Returns a list of per-seat rating-change dicts suitable for broadcasting:
        [{seat, user_id, name, display_before, display_after, delta,
          provisional_before, provisional_after}, ...]
    """
    seats = sorted(game.players, key=lambda p: p.seat)
    if not seats or any(p.user_id is None for p in seats):
        return None
    if len(seats) < 2:
        return None

    scores = state.get("scores") or []
    if len(scores) < len(seats):
        return None

    user_ids = [p.user_id for p in seats]
    users_by_id = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()}
    if any(uid not in users_by_id for uid in user_ids):
        return None

    in_ratings = [(users_by_id[p.user_id].rating_mu, users_by_id[p.user_id].rating_sigma)
                  for p in seats]
    seat_scores = [scores[p.seat] for p in seats]
    ranks = ranks_from_scores(seat_scores)
    new_ratings = apply_game_result(in_ratings, ranks)

    now = datetime.now(timezone.utc)
    changes: list = []
    for p, (mu_b, sg_b), (mu_a, sg_a) in zip(seats, in_ratings, new_ratings):
        u = users_by_id[p.user_id]
        gp_before = u.games_played
        gp_after = gp_before + 1
        disp_b = display_from(mu_b, sg_b)
        disp_a = display_from(mu_a, sg_a)
        prov_b = is_provisional(gp_before, sg_b)
        prov_a = is_provisional(gp_after, sg_a)

        # Persist new rating to User.
        u.rating_mu = mu_a
        u.rating_sigma = sg_a
        u.games_played = gp_after
        u.rating_updated_at = now
        db.add(u)

        # Audit row.
        db.add(RatingHistory(
            user_id=u.id,
            game_id=game.id,
            finishing_rank=ranks[seats.index(p)],
            finishing_score=seat_scores[seats.index(p)],
            mu_before=mu_b, sigma_before=sg_b,
            mu_after=mu_a,  sigma_after=sg_a,
            display_before=disp_b, display_after=disp_a,
        ))

        changes.append({
            "seat": p.seat,
            "user_id": u.id,
            "name": _label(game, p.seat),
            "display_before": disp_b,
            "display_after": disp_a,
            "delta": disp_a - disp_b,
            "provisional_before": prov_b,
            "provisional_after": prov_a,
        })
    return changes


async def _send_state(room: Room, db: Session, game: Game, *, event: Optional[dict] = None) -> None:
    pv = _public_state(game, db)
    pv["connected_seats"] = sorted(room.connected_seats())
    msg = {"type": "state", "state": pv, "letter_values": load_letter_values()}
    if event:
        msg["event"] = event
    await manager.broadcast(room, msg)


async def _schedule_turn_timer(room: Room, code: str) -> None:
    """(Re)arm an asyncio task that waits until the current turn deadline and
    fires a timeout-skip if still applicable."""
    if room.timer_task and not room.timer_task.done():
        room.timer_task.cancel()

    async def _tick():
        try:
            # Re-read state each loop in case actions move the deadline.
            import time as _t
            while True:
                await asyncio.sleep(0.5)
                with SessionLocal() as db:
                    game = db.query(Game).filter(Game.code == code).first()
                    if not game or not game.state or game.status != "active":
                        return
                    state = json.loads(game.state.state_json)
                    if state.get("finished"):
                        return

                    # Overall game clock: fire when it expires regardless of
                    # whether a card has been drawn.
                    overall = float(state.get("overall_seconds") or 0)
                    started_at = state.get("started_at")
                    if overall > 0 and started_at is not None:
                        if _t.time() >= float(started_at) + overall:
                            engine.force_skip_if_expired(state)
                            rating_changes = _persist(db, game, state)
                            ev = {"type": "game_finished", "reason": "time_up"}
                            if rating_changes is not None:
                                ev["rating_changes"] = rating_changes
                            await _send_state(room, db, game, event=ev)
                            return

                    # Per-turn clock: covers BOTH the pick phase and the
                    # submit phase under the single-clock model. Fires once
                    # the seat's turn_started_at + turn_seconds is in the past.
                    turn_started = state.get("turn_started_at")
                    if turn_started is None:
                        continue  # solo at game-start, before first pick
                    deadline = float(turn_started) + float(state.get("turn_seconds") or 180)
                    if _t.time() < deadline:
                        await asyncio.sleep(min(1.0, deadline - _t.time()))
                        continue
                    fired = engine.force_skip_if_expired(state)
                    if fired:
                        rating_changes = _persist(db, game, state)
                        ev = {"type": "turn_timeout"}
                        if rating_changes is not None:
                            ev = {"type": "game_finished", "rating_changes": rating_changes}
                        await _send_state(room, db, game, event=ev)
        except asyncio.CancelledError:
            return

    room.timer_task = asyncio.create_task(_tick())


# ---------- start helpers ----------

async def _start_game_now(room: Room, db: Session, game: Game, *, started_by: str = "host") -> None:
    """Transition the game from lobby → active, persist, broadcast, and arm
    the per-turn timer. Cancels any pending countdown task."""
    import secrets as _sec
    if room.countdown_task and not room.countdown_task.done():
        room.countdown_task.cancel()
        room.countdown_task = None

    settings_dict = json.loads(game.settings_json or "{}")
    seed = int.from_bytes(_sec.token_bytes(6), "big")
    state = engine.new_state(
        seed=seed,
        num_players=len(game.players),
        turn_seconds=int(settings_dict.get("turn_seconds", 180)),
        overall_seconds=int(settings_dict.get("overall_seconds", 300)),
    )
    game.status = "active"
    game.started_at = datetime.now(timezone.utc)
    _persist(db, game, state)
    await _send_state(room, db, game, event={"type": "game_started", "started_by": started_by})
    await _schedule_turn_timer(room, room.code)


def _min_players_for(game: Game) -> int:
    s = json.loads(game.settings_json or "{}")
    return int(s.get("min_players", 2))


async def _maybe_schedule_countdown(room: Room, code: str, *, seconds: int = 10) -> None:
    """If the lobby has reached its min_players threshold and no countdown is
    already running, start one. The countdown re-checks conditions before
    firing — if a player has left in the meantime it self-cancels."""
    with SessionLocal() as db:
        game = db.query(Game).filter(Game.code == code).first()
        if not game or game.status != "lobby":
            return
        if len(game.players) < _min_players_for(game):
            return
    # Already counting down — leave it alone.
    if room.countdown_task and not room.countdown_task.done():
        return

    async def _tick():
        try:
            # Announce.
            await manager.broadcast(room, {"type": "countdown_started", "seconds": seconds})
            await asyncio.sleep(seconds)
            with SessionLocal() as db2:
                game2 = db2.query(Game).filter(Game.code == code).first()
                if not game2 or game2.status != "lobby":
                    return
                if len(game2.players) < _min_players_for(game2):
                    await manager.broadcast(room, {"type": "countdown_cancelled"})
                    return
                await _start_game_now(room, db2, game2, started_by="countdown")
        except asyncio.CancelledError:
            return

    room.countdown_task = asyncio.create_task(_tick())


async def _cancel_countdown_if_below_min(room: Room, code: str) -> None:
    """Called after a player leaves; if we've dropped below min_players,
    cancel any in-flight countdown and tell clients."""
    with SessionLocal() as db:
        game = db.query(Game).filter(Game.code == code).first()
        if not game or game.status != "lobby":
            return
        below = len(game.players) < _min_players_for(game)
    if below and room.countdown_task and not room.countdown_task.done():
        room.countdown_task.cancel()
        room.countdown_task = None
        await manager.broadcast(room, {"type": "countdown_cancelled"})


# ---------- endpoint ----------

@router.websocket("/ws/games/{code}")
async def ws_game(
    websocket: WebSocket,
    code: str,
    token: str = Query(default=""),
):
    await websocket.accept()

    code = code.upper()
    db: Session = SessionLocal()
    try:
        identity = _identity_from_token(db, token)
        if not identity:
            await websocket.send_json({"type": "error", "code": "unauthorized", "message": "Bad/missing token"})
            await websocket.close()
            return
        game = db.query(Game).filter(Game.code == code).first()
        if not game:
            await websocket.send_json({"type": "error", "code": "not_found", "message": "Game not found"})
            await websocket.close()
            return
        player = _player_for_identity(game, identity)
        if not player:
            await websocket.send_json({"type": "error", "code": "not_in_game", "message": "Join the game first"})
            await websocket.close()
            return

        room = await manager.get(code)
        room.add(player.seat, websocket)
        # Initial state push to everyone (announces presence)
        await _send_state(room, db, game, event={"type": "player_connected", "seat": player.seat, "name": _label(game, player.seat)})

        if game.status == "active":
            await _schedule_turn_timer(room, code)
        elif game.status == "lobby":
            # If we've now reached min_players, kick off the auto-start countdown.
            await _maybe_schedule_countdown(room, code)

        try:
            while True:
                raw = await websocket.receive_text()
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    await websocket.send_json({"type": "error", "code": "bad_json"})
                    continue
                action = msg.get("type")

                # Re-fetch the live game each action.
                db.expire_all()
                game = db.query(Game).filter(Game.code == code).first()
                if not game:
                    await websocket.send_json({"type": "error", "code": "not_found"})
                    continue

                if action == "start":
                    if game.status != "lobby":
                        await websocket.send_json({"type": "error", "code": "already_started"})
                        continue
                    if game.host_user_id is not None and (not identity.user or identity.user.id != game.host_user_id):
                        await websocket.send_json({"type": "error", "code": "not_host"})
                        continue
                    min_p = _min_players_for(game)
                    if len(game.players) < min_p:
                        await websocket.send_json({
                            "type": "error", "code": "need_min_players",
                            "min_players": min_p, "have": len(game.players),
                        })
                        continue
                    await _start_game_now(room, db, game, started_by="host")
                    continue

                if game.status != "active" or not game.state:
                    await websocket.send_json({"type": "error", "code": "not_active"})
                    continue

                state = json.loads(game.state.state_json)
                # Resolve any pending timeout from before this action.
                engine.force_skip_if_expired(state)

                if action == "pick":
                    tier = msg.get("tier")
                    res = engine.pick_difficulty(state, seat=player.seat, tier=tier)
                    redraws = res.get("redraws") or []
                    if res["ok"]:
                        # Successful pick (possibly after some impossible cards
                        # were auto-redrawn from the same tier).
                        ev = {"type": "card_drawn",
                              "card_id": res["card_id"], "tier": tier,
                              "seat": player.seat,
                              "redraws": redraws}
                    elif res.get("skipped"):
                        # Engine consumed the turn because every redraw was
                        # unplayable. Tell clients so they can show the
                        # "no words possible" toast.
                        ev = {"type": "card_unplayable",
                              "seat": player.seat, "tier": tier,
                              "redraws": redraws}
                    else:
                        await websocket.send_json({
                            "type": "action_rejected", "action": "pick",
                            "reason": res["reason"],
                        })
                        ev = None

                    rc = _persist(db, game, state)
                    if rc is not None:
                        ev = {"type": "game_finished", "rating_changes": rc,
                              "card_unplayable_redraws": redraws or None}
                    await _send_state(room, db, game, event=ev)
                    if res["ok"]:
                        await _schedule_turn_timer(room, code)
                    elif res.get("skipped"):
                        # Forced-skip moves us to the next seat — re-arm the timer.
                        await _schedule_turn_timer(room, code)
                    continue

                if action == "submit":
                    word = msg.get("word", "")
                    res = engine.submit_word(state, seat=player.seat, word=word)
                    rc = _persist(db, game, state)
                    if res["ok"]:
                        ev = {"type": "word_accepted", "seat": player.seat,
                              "word": res["word"], "points": res["points"]}
                        if rc is not None:
                            ev = {"type": "game_finished", "rating_changes": rc,
                                  "last_word": {"seat": player.seat, "word": res["word"], "points": res["points"]}}
                        await _send_state(room, db, game, event=ev)
                    else:
                        await websocket.send_json({"type": "action_rejected", "action": "submit", "reason": res["reason"]})
                        # Still broadcast state in case timeout cleared the card.
                        if rc is not None:
                            await _send_state(room, db, game, event={"type": "game_finished", "rating_changes": rc})
                        else:
                            await _send_state(room, db, game)
                    continue

                if action == "skip":
                    res = engine.skip(state, seat=player.seat, reason="voluntary")
                    rc = _persist(db, game, state)
                    if res["ok"]:
                        ev = {"type": "skipped", "seat": player.seat}
                        if rc is not None:
                            ev = {"type": "game_finished", "rating_changes": rc}
                        await _send_state(room, db, game, event=ev)
                    else:
                        await websocket.send_json({"type": "action_rejected", "action": "skip", "reason": res["reason"]})
                    continue

                if action == "ping":
                    await websocket.send_json({"type": "pong"})
                    continue

                await websocket.send_json({"type": "error", "code": "unknown_action", "action": action})
        except WebSocketDisconnect:
            pass
        finally:
            room.remove(player.seat, websocket)
            # If room is empty, cancel timer (state remains in DB for resume).
            if not room.all_sockets() and room.timer_task:
                room.timer_task.cancel()
            try:
                game = db.query(Game).filter(Game.code == code).first()
                if game:
                    await _send_state(room, db, game, event={"type": "player_disconnected", "seat": player.seat})
            except Exception:
                pass
    finally:
        db.close()
