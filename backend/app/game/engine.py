"""Pure deterministic game engine.

State is a JSON-serializable dict so it can be persisted directly. All randomness
flows through the seeded RNG built from `state["seed"]`. The engine itself is
mode-agnostic — solo modes use it with a single player; multiplayer games use it
with several seats.
"""
from __future__ import annotations

import time
from typing import Optional

from .shuffle import rng as make_rng
from .tiles import DIFFICULTY_MULTIPLIER, build_pool, score_word
from .words import (
    categories_by_difficulty,
    in_category,
    in_dictionary,
    letters_available,
    normalize_word,
    pool_to_counts,
    remove_letters,
)

VALID_TIERS = ("easy", "medium", "hard")


# ---------- state construction ----------

def new_state(
    *,
    seed: int,
    num_players: int,
    turn_seconds: int,
    pool_size: Optional[int] = None,
    overall_seconds: Optional[int] = None,
) -> dict:
    """Build a fresh deterministic state for `num_players` (>=1).

    Optional knobs:
      pool_size       — if set, subsample the full Scrabble-distribution pool
                        down to this many tiles (deterministic via seeded RNG).
                        Solo modes use ~75; multiplayer uses None (full ~147).
      overall_seconds — if set, an overall-game clock that, once elapsed, ends
                        the game with reason 'time_up'. Solo modes use 300
                        (5 min); multiplayer leaves it unset.
    """
    if num_players < 1:
        raise ValueError("num_players must be >= 1")
    rng = make_rng(seed)

    pool = build_pool(rng)
    if pool_size is not None and pool_size > 0 and pool_size < len(pool):
        # Proportional subsample with a floor of 1: scale each letter's count
        # by pool_size/full but ALWAYS keep at least one of every letter that
        # exists in the full distribution (otherwise rare letters like C, J,
        # Q, X, Z can vanish from a small pool, making categories like 'color'
        # or 'daily' impossible). Then top-up or trim by random draws using
        # the seeded RNG so the final size matches `pool_size`.
        from collections import Counter
        full_counts = Counter(pool)
        ratio = pool_size / len(pool)
        sub_counts: dict[str, int] = {}
        for letter, n in full_counts.items():
            scaled = max(1, int(round(n * ratio)))
            sub_counts[letter] = min(scaled, n)
        sub_pool: list[str] = []
        for letter, n in sub_counts.items():
            sub_pool.extend([letter] * n)
        diff = pool_size - len(sub_pool)
        if diff > 0:
            for _ in range(diff):
                candidates = [L for L, n in sub_counts.items() if n < full_counts[L]]
                if not candidates:
                    break
                pick_letter = rng.choice(candidates)
                sub_counts[pick_letter] += 1
                sub_pool.append(pick_letter)
        elif diff < 0:
            for _ in range(-diff):
                candidates = [L for L, n in sub_counts.items() if n > 1]
                if not candidates:
                    break
                drop_letter = rng.choice(candidates)
                sub_counts[drop_letter] -= 1
                sub_pool.remove(drop_letter)
        rng.shuffle(sub_pool)
        pool = sub_pool

    # Per-tier shuffled card draw orders (lists of category ids).
    by_diff = categories_by_difficulty()
    decks: dict[str, list[str]] = {}
    for tier in VALID_TIERS:
        ids = [c["id"] for c in by_diff[tier]]
        rng.shuffle(ids)
        decks[tier] = ids

    return {
        "seed": seed,
        "turn_seconds": int(turn_seconds),
        "overall_seconds": int(overall_seconds) if overall_seconds else 0,
        "started_at": _now(),                 # epoch seconds; whole-game clock anchor
        "pool": pool,
        "discarded_tiles": [],
        "decks": decks,
        "discarded_cards": [],
        "scores": [0] * num_players,
        "current_seat": 0,
        "current_card_id": None,
        "current_difficulty": None,
        "turn_started_at": None,
        "consecutive_skips": 0,
        "history": [],
        "finished": False,
        "finish_reason": None,
        "num_players": num_players,
    }


# ---------- helpers ----------

def _now() -> float:
    return time.time()


def _advance_seat(state: dict) -> None:
    state["current_seat"] = (state["current_seat"] + 1) % state["num_players"]


def _overall_expired(state: dict) -> bool:
    overall = float(state.get("overall_seconds") or 0)
    if overall <= 0:
        return False
    started = state.get("started_at")
    if started is None:
        return False
    return (_now() - float(started)) >= overall


def _check_end(state: dict) -> Optional[str]:
    if _overall_expired(state):
        return "time_up"
    if not state["pool"]:
        return "pool_empty"
    if all(len(state["decks"][t]) == 0 for t in VALID_TIERS):
        return "decks_empty"
    if state["consecutive_skips"] >= state["num_players"]:
        return "all_skipped"
    return None


def _maybe_finish(state: dict) -> None:
    reason = _check_end(state)
    if reason:
        state["finished"] = True
        state["finish_reason"] = reason
        state["current_card_id"] = None
        state["current_difficulty"] = None
        state["turn_started_at"] = None


def public_view(state: dict) -> dict:
    """A frontend-friendly snapshot."""
    pool_counts = pool_to_counts(state["pool"])
    return {
        "pool_counts": pool_counts,
        "pool_total": len(state["pool"]),
        "discarded_total": len(state["discarded_tiles"]),
        "discarded_counts": pool_to_counts(state["discarded_tiles"]),
        "decks_remaining": {t: len(state["decks"][t]) for t in VALID_TIERS},
        "scores": state["scores"],
        "current_seat": state["current_seat"],
        "current_card_id": state["current_card_id"],
        "current_difficulty": state["current_difficulty"],
        "turn_started_at": state["turn_started_at"],
        "turn_seconds": state["turn_seconds"],
        "overall_seconds": state.get("overall_seconds", 0),
        "started_at": state.get("started_at"),
        "consecutive_skips": state["consecutive_skips"],
        "finished": state["finished"],
        "finish_reason": state["finish_reason"],
        "num_players": state["num_players"],
        "history": state["history"][-20:],  # last 20 events
        "difficulty_multipliers": DIFFICULTY_MULTIPLIER,
    }


# ---------- actions ----------

def pick_difficulty(state: dict, seat: int, tier: str) -> dict:
    """Player at `seat` declares a difficulty; we draw the top card from that tier's deck."""
    if state["finished"]:
        return {"ok": False, "reason": "game_finished"}
    # Overall game timer takes precedence over per-action checks.
    if _overall_expired(state):
        _maybe_finish(state)
        return {"ok": False, "reason": "time_up"}
    if seat != state["current_seat"]:
        return {"ok": False, "reason": "not_your_turn"}
    if state["current_card_id"] is not None:
        return {"ok": False, "reason": "card_already_drawn"}
    if tier not in VALID_TIERS:
        return {"ok": False, "reason": "bad_tier"}
    deck = state["decks"][tier]
    if not deck:
        return {"ok": False, "reason": "deck_empty"}
    card_id = deck.pop()  # treat tail as top
    state["current_card_id"] = card_id
    state["current_difficulty"] = tier
    state["turn_started_at"] = _now()
    state["history"].append({
        "type": "card_drawn",
        "seat": seat,
        "tier": tier,
        "card_id": card_id,
        "ts": state["turn_started_at"],
    })
    return {"ok": True, "card_id": card_id, "tier": tier}


def submit_word(state: dict, seat: int, word: str) -> dict:
    if state["finished"]:
        return {"ok": False, "reason": "game_finished"}
    if _overall_expired(state):
        _maybe_finish(state)
        return {"ok": False, "reason": "time_up"}
    if seat != state["current_seat"]:
        return {"ok": False, "reason": "not_your_turn"}
    if state["current_card_id"] is None:
        return {"ok": False, "reason": "no_card"}
    norm = normalize_word(word)
    if not norm:
        return {"ok": False, "reason": "empty_word"}

    # Server-side per-turn timeout enforcement: if turn timer has elapsed, treat as skip.
    if _turn_expired(state):
        _do_skip(state, seat, reason="timeout")
        _maybe_finish(state)
        return {"ok": False, "reason": "turn_expired"}

    pool_counts = pool_to_counts(state["pool"])
    if not letters_available(norm, pool_counts):
        return {"ok": False, "reason": "letters_unavailable", "word": norm}
    if not in_dictionary(norm):
        return {"ok": False, "reason": "not_in_dict", "word": norm}
    if not in_category(norm, state["current_card_id"]):
        return {"ok": False, "reason": "not_in_category", "word": norm}

    pts = score_word(norm, state["current_difficulty"])

    # Apply effects.
    state["pool"] = remove_letters(norm, state["pool"])
    state["discarded_tiles"].extend(list(norm))
    state["scores"][seat] += pts
    state["discarded_cards"].append(state["current_card_id"])
    state["history"].append({
        "type": "word_accepted",
        "seat": seat,
        "word": norm,
        "tier": state["current_difficulty"],
        "card_id": state["current_card_id"],
        "points": pts,
        "ts": _now(),
    })
    state["current_card_id"] = None
    state["current_difficulty"] = None
    state["turn_started_at"] = None
    state["consecutive_skips"] = 0
    _advance_seat(state)
    _maybe_finish(state)
    return {"ok": True, "word": norm, "points": pts}


def skip(state: dict, seat: int, *, reason: str = "voluntary") -> dict:
    if state["finished"]:
        return {"ok": False, "reason": "game_finished"}
    if _overall_expired(state):
        _maybe_finish(state)
        return {"ok": False, "reason": "time_up"}
    if seat != state["current_seat"]:
        return {"ok": False, "reason": "not_your_turn"}
    _do_skip(state, seat, reason=reason)
    _maybe_finish(state)
    return {"ok": True, "reason": reason}


def force_skip_if_expired(state: dict) -> bool:
    """Idempotent helper for callers polling the state. Returns True if a skip
    or game-end fired. Handles BOTH the per-turn timeout AND the overall-game
    timeout."""
    if state["finished"]:
        return False
    # Overall-game expiry beats per-turn expiry.
    if _overall_expired(state):
        _maybe_finish(state)
        return True
    if state["current_card_id"] is None:
        return False
    if _turn_expired(state):
        _do_skip(state, state["current_seat"], reason="timeout")
        _maybe_finish(state)
        return True
    return False


# ---------- internals ----------

def _do_skip(state: dict, seat: int, *, reason: str) -> None:
    if state["current_card_id"] is not None:
        state["discarded_cards"].append(state["current_card_id"])
    state["history"].append({
        "type": "skip",
        "seat": seat,
        "reason": reason,
        "card_id": state["current_card_id"],
        "ts": _now(),
    })
    state["current_card_id"] = None
    state["current_difficulty"] = None
    state["turn_started_at"] = None
    state["consecutive_skips"] += 1
    _advance_seat(state)


def _turn_expired(state: dict) -> bool:
    started = state["turn_started_at"]
    if started is None:
        return False
    return (_now() - float(started)) > float(state["turn_seconds"])
