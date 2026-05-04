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
from ..models import Game, GamePlayer, GameState, User

router = APIRouter()


def _label(game: Game, seat: int) -> str:
    s = json.loads(game.settings_json or "{}")
    names = s.get("names", {})
    return names.get(str(seat), f"Player {seat + 1}")


def _public_state(game: Game) -> dict:
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
    pv["players"] = [
        {
            "seat": p.seat,
            "name": _label(game, p.seat),
            "is_guest": p.user_id is None,
            "score": p.score,
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

def _persist(db: Session, game: Game, state: dict) -> None:
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
    if state.get("finished") and game.status != "finished":
        game.status = "finished"
        game.finished_at = datetime.now(timezone.utc)
    db.add(game)
    db.commit()


async def _send_state(room: Room, db: Session, game: Game, *, event: Optional[dict] = None) -> None:
    pv = _public_state(game)
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
            while True:
                await asyncio.sleep(0.5)
                with SessionLocal() as db:
                    game = db.query(Game).filter(Game.code == code).first()
                    if not game or not game.state or game.status != "active":
                        return
                    state = json.loads(game.state.state_json)
                    if state.get("finished"):
                        return
                    if state.get("current_card_id") is None:
                        # Nothing to time; check again later
                        continue
                    started = state.get("turn_started_at") or 0
                    deadline = float(started) + float(state.get("turn_seconds") or 180)
                    import time as _t
                    if _t.time() < deadline:
                        await asyncio.sleep(min(1.0, deadline - _t.time()))
                        continue
                    # Fire skip
                    fired = engine.force_skip_if_expired(state)
                    if fired:
                        _persist(db, game, state)
                        await _send_state(room, db, game, event={"type": "turn_timeout"})
        except asyncio.CancelledError:
            return

    room.timer_task = asyncio.create_task(_tick())


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
                    if len(game.players) < 2:
                        await websocket.send_json({"type": "error", "code": "need_two_players"})
                        continue
                    import secrets as _sec
                    settings_dict = json.loads(game.settings_json or "{}")
                    seed = int.from_bytes(_sec.token_bytes(6), "big")
                    state = engine.new_state(
                        seed=seed,
                        num_players=len(game.players),
                        turn_seconds=int(settings_dict.get("turn_seconds", 180)),
                    )
                    game.status = "active"
                    game.started_at = datetime.now(timezone.utc)
                    _persist(db, game, state)
                    await _send_state(room, db, game, event={"type": "game_started"})
                    await _schedule_turn_timer(room, code)
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
                    if not res["ok"]:
                        await websocket.send_json({"type": "action_rejected", "action": "pick", "reason": res["reason"]})
                    _persist(db, game, state)
                    await _send_state(room, db, game, event={"type": "card_drawn" if res["ok"] else "noop"})
                    if res["ok"]:
                        await _schedule_turn_timer(room, code)
                    continue

                if action == "submit":
                    word = msg.get("word", "")
                    res = engine.submit_word(state, seat=player.seat, word=word)
                    _persist(db, game, state)
                    if res["ok"]:
                        await _send_state(room, db, game, event={
                            "type": "word_accepted", "seat": player.seat,
                            "word": res["word"], "points": res["points"],
                        })
                    else:
                        await websocket.send_json({"type": "action_rejected", "action": "submit", "reason": res["reason"]})
                        # Still broadcast state in case timeout cleared the card.
                        await _send_state(room, db, game)
                    continue

                if action == "skip":
                    res = engine.skip(state, seat=player.seat, reason="voluntary")
                    _persist(db, game, state)
                    if res["ok"]:
                        await _send_state(room, db, game, event={"type": "skipped", "seat": player.seat})
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
