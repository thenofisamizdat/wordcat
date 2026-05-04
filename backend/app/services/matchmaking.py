"""Auto-Join matchmaking.

Given a player's rating and a list of open lobbies, pick the best fit
(or recommend creating a new one) using:

    fit(lobby) = rating_match * urgency * capacity_bonus

where:
  rating_match  = exp(-z²/2),  z = |μ_p - μ̄_lobby| / sqrt(σ_p² + σ̄_lobby² + 2β²)
  urgency       = clamp(0.5 + 0.5 * age_seconds / 90, 0.5, 1.0)
  capacity_bonus = 1.0 if needed ≤ 1, 0.6 if needed == 2, 0.4 otherwise

If the best fit ≥ JOIN_THRESHOLD we recommend joining; otherwise we
recommend creating a new lobby. The threshold corresponds to roughly
"rating gap within ~1.4 sigma" for a brand-new lobby.
"""
from __future__ import annotations

import math
import time
from dataclasses import dataclass
from typing import List, Optional, Tuple

# OpenSkill default β = σ₀ / 2 = 25/6 ≈ 4.167
BETA: float = 25.0 / 6.0
JOIN_THRESHOLD: float = 0.35


@dataclass
class PlayerRating:
    mu: float
    sigma: float


@dataclass
class LobbySummary:
    code: str
    created_at_epoch: float
    min_players: int
    max_players: int
    current_player_ratings: List[PlayerRating]   # only RATED players (skip guests)
    current_player_count: int                    # includes guests, for capacity check


def _fit(player: PlayerRating, lobby: LobbySummary, now: float) -> float:
    if lobby.current_player_count >= lobby.max_players:
        return 0.0
    rated = lobby.current_player_ratings
    if rated:
        mu_avg = sum(r.mu for r in rated) / len(rated)
        sigma_avg = math.sqrt(sum(r.sigma * r.sigma for r in rated) / len(rated))
    else:
        # Empty lobby (or all guests): treat as "average" so any player fits.
        mu_avg = player.mu
        sigma_avg = player.sigma

    sigma_combined = math.sqrt(player.sigma**2 + sigma_avg**2 + 2 * BETA * BETA)
    z = abs(player.mu - mu_avg) / sigma_combined if sigma_combined > 0 else 0.0
    rating_match = math.exp(-0.5 * z * z)

    age = max(0.0, now - lobby.created_at_epoch)
    urgency = max(0.5, min(1.0, 0.5 + 0.5 * age / 90.0))

    needed = max(0, lobby.min_players - lobby.current_player_count)
    capacity_bonus = 1.0 if needed <= 1 else (0.6 if needed == 2 else 0.4)

    return rating_match * urgency * capacity_bonus


def auto_join_pick(
    player: PlayerRating,
    open_lobbies: List[LobbySummary],
    *,
    threshold: float = JOIN_THRESHOLD,
    now_fn=time.time,
) -> Tuple[str, Optional[str]]:
    """Return ("JOIN", code) or ("CREATE", None).

    Tie-breakers when fits are very close (within 0.01):
      1. Lobby closer to starting (smaller `needed`).
      2. Older lobby (more deserving).
    """
    if not open_lobbies:
        return ("CREATE", None)

    now = now_fn()
    scored = [(_fit(player, lob, now), lob) for lob in open_lobbies]
    # Filter out non-joinable (full / fit==0) lobbies entirely.
    scored = [(f, lob) for f, lob in scored if f > 0]
    if not scored:
        return ("CREATE", None)

    def _key(item):
        f, lob = item
        # Sort: highest fit first; on near-tie, fewer needed first, older first.
        needed = max(0, lob.min_players - lob.current_player_count)
        return (-round(f, 2), needed, -lob.created_at_epoch)

    scored.sort(key=_key)
    best_fit, best_lobby = scored[0]
    if best_fit >= threshold:
        return ("JOIN", best_lobby.code)
    return ("CREATE", None)
