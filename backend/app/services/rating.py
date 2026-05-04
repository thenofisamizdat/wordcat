"""Rating service backed by OpenSkill PlackettLuce.

Single source of truth for the rating maths and the user-facing display
mapping. Used by:
  - routers/ws.py        — to update ratings at game-end
  - routers/auth.py      — to surface rating in /api/auth/me
  - routers/games.py     — to include ratings in lobby + game responses
  - routers/leaderboard.py — to drive the multiplayer leaderboard

OpenSkill PlackettLuce was chosen because it natively models a
free-for-all permutation of N players (no pairwise hack), tracks
uncertainty (so cold-start works without arbitrary K-factors), is
MIT-licensed (TrueSkill is patented), and yields O(N) closed-form
updates per game.
"""
from __future__ import annotations

from typing import List, Optional, Tuple

from openskill.models import PlackettLuce

# Defaults are kept in sync with models.RATING_MU0 / RATING_SIGMA0.
MU0: float = 25.0
SIGMA0: float = 25.0 / 3.0  # ≈ 8.3333

# Single shared model instance — PlackettLuce is stateless, so this is fine
# and avoids re-allocating the same defaults thousands of times.
_MODEL = PlackettLuce()


# ---------- Public API ----------

def display_from(mu: float, sigma: float) -> int:
    """Map (mu, sigma) → 4-digit display rating, chess.com style.

    Uses the conservative skill estimate (mu - 3*sigma), the same convention
    Halo/Xbox Live use, then linearly rescales so that:
      - new player    (mu=25,  sigma=8.33) → display ≈ 1000
      - mid-game      (mu=30,  sigma=4)    → display ≈ 2080
      - high tier     (mu=40,  sigma=2)    → display ≈ 3040
    Floor of 100 so the number is always 3-4 digits and never negative.
    """
    raw = (mu - 3.0 * sigma) * 60.0 + 1000.0
    return max(100, int(round(raw)))


# (min_display, name, color)
TIERS: List[Tuple[int, str, str]] = [
    (0,    "Bronze",   "#a16a3c"),
    (1100, "Silver",   "#9aa0a6"),
    (1300, "Gold",     "#d4a72c"),
    (1500, "Platinum", "#7ad1f0"),
    (1700, "Diamond",  "#5cb6ff"),
    (1900, "Master",   "#b46cff"),
]


def tier_from(display: int, provisional: bool) -> dict:
    """Bucket a display rating into a named tier with a colour.

    Provisional players are always shown as Bronze regardless of display
    until they've played enough games — this stops a lucky first win from
    flashing them into Diamond and back.
    """
    if provisional:
        name, color = "Bronze", "#a16a3c"
    else:
        name, color = "Bronze", "#a16a3c"
        for threshold, n, c in TIERS:
            if display >= threshold:
                name, color = n, c
    return {"name": name, "color": color}


def is_provisional(games_played: int, sigma: float) -> bool:
    """A rating is provisional until the player has played enough games AND
    their uncertainty has shrunk below 5.0. Either condition keeps them
    provisional — both must clear to be 'established'."""
    return games_played < 10 or sigma > 5.0


def rating_payload(mu: float, sigma: float, games_played: int) -> dict:
    """Build the dict used everywhere the API surfaces a rating."""
    display = display_from(mu, sigma)
    prov = is_provisional(games_played, sigma)
    tier = tier_from(display, prov)
    return {
        "mu": mu,
        "sigma": sigma,
        "display": display,
        "tier": tier["name"],
        "color": tier["color"],
        "provisional": prov,
        "games_played": games_played,
    }


def apply_game_result(
    player_ratings: List[Tuple[float, float]],
    ranks: List[int],
) -> List[Tuple[float, float]]:
    """Compute new (mu, sigma) for each player from a finished game.

    Args:
        player_ratings: list of (mu, sigma) tuples in seat order.
        ranks:          list of 1-based finishing ranks in the same seat
                        order. Lower rank = better. Ties allowed
                        (e.g. [1, 2, 2, 4]).

    Returns:
        list of (mu', sigma') tuples in the same seat order.
    """
    if len(player_ratings) != len(ranks):
        raise ValueError("player_ratings and ranks must have the same length")
    if len(player_ratings) < 2:
        # No rating change for a one-player "game".
        return list(player_ratings)

    teams = [[_MODEL.rating(mu=mu, sigma=sigma)] for mu, sigma in player_ratings]
    new_teams = _MODEL.rate(teams, ranks=ranks)
    return [(t[0].mu, t[0].sigma) for t in new_teams]


def ranks_from_scores(scores: List[int]) -> List[int]:
    """Convert a list of game scores into 1-based ranks with tie handling.

    Example: scores [50, 35, 30, 20] → ranks [1, 2, 3, 4]
             scores [30, 50, 30, 20] → ranks [2, 1, 2, 4]  (ties get the same rank,
                                                            then the next rank skips
                                                            ahead — chess-style)
    """
    n = len(scores)
    order = sorted(range(n), key=lambda i: -scores[i])  # best first
    ranks = [0] * n
    cur_rank = 1
    last_score: Optional[int] = None
    for k, idx in enumerate(order, start=1):
        if scores[idx] != last_score:
            cur_rank = k
            last_score = scores[idx]
        ranks[idx] = cur_rank
    return ranks
