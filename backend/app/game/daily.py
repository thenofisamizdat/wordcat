"""Deterministic daily-puzzle generator.

Given a date, produces the *same* puzzle for every player: one shared tile pool
plus a fixed ordered sequence of (card_id, tier) cards. Also precomputes, per
card, the best-possible word and the score thresholds used to colour the share
grid (optimal / good / weak).

Everything is seeded from `daily_seed(date)` so the puzzle is reproducible, and
the result is cached per date.
"""
from __future__ import annotations

from functools import lru_cache

from .shuffle import daily_seed, rng as make_rng
from .tiles import build_pool, score_word
from .words import (
    categories_by_difficulty,
    letters_available,
    load_category_words,
    pool_to_counts,
)

# The daily puzzle is a calm 5-card sequence. The tier template is the same for
# everyone every day — the "shape" of the puzzle — while the specific categories
# are chosen by the day's seed.
DAILY_TIER_TEMPLATE: list[str] = ["easy", "medium", "medium", "hard", "hard"]

# A focused pool: big enough to give options, small enough to feel like a puzzle
# rather than an open scoring run.
DAILY_POOL_SIZE = 90

# Relaxed clock: an overall budget only (no per-turn pressure). 5 minutes is
# plenty for five cards; it exists mainly as a soft tie-break / anti-AFK bound.
DAILY_OVERALL_SECONDS = 300
# turn_seconds is set to the overall budget so the per-turn timer never bites
# before the overall clock does — the daily puzzle is intentionally unpressured.
DAILY_TURN_SECONDS = DAILY_OVERALL_SECONDS

# Share-grid thresholds, as a fraction of the card's best-possible score.
OPTIMAL_FRACTION = 0.90   # >= 90% of best => green
GOOD_FRACTION = 0.50      # >= 50% of best => yellow; below => grey


def _subsample_pool(full_pool: list[str], target: int, rng) -> list[str]:
    """Deterministically shrink the full distribution pool to `target` tiles,
    keeping at least one of every letter present so rare-letter categories stay
    solvable. Mirrors the proportional-subsample approach used in the engine."""
    from collections import Counter

    if target >= len(full_pool):
        return list(full_pool)
    full_counts = Counter(full_pool)
    ratio = target / len(full_pool)
    sub_counts: dict[str, int] = {}
    for letter, n in full_counts.items():
        scaled = max(1, int(round(n * ratio)))
        sub_counts[letter] = min(scaled, n)
    sub_pool: list[str] = []
    for letter, n in sub_counts.items():
        sub_pool.extend([letter] * n)
    diff = target - len(sub_pool)
    if diff > 0:
        for _ in range(diff):
            candidates = [L for L, n in sub_counts.items() if n < full_counts[L]]
            if not candidates:
                break
            pick = rng.choice(candidates)
            sub_counts[pick] += 1
            sub_pool.append(pick)
    elif diff < 0:
        for _ in range(-diff):
            candidates = [L for L, n in sub_counts.items() if n > 1]
            if not candidates:
                break
            drop = rng.choice(candidates)
            sub_counts[drop] -= 1
            sub_pool.remove(drop)
    rng.shuffle(sub_pool)
    return sub_pool


def best_word_for_card(pool_counts: dict[str, int], card_id: str, tier: str) -> tuple[str | None, int]:
    """Return (best_word, best_points) for a card given the pool, or (None, 0)
    if nothing in the category is playable. Scoring includes the tier multiplier
    so thresholds are comparable to what the player actually earns."""
    best_word: str | None = None
    best_pts = 0
    for w in load_category_words(card_id):
        if letters_available(w, pool_counts):
            pts = score_word(w, tier)
            if pts > best_pts:
                best_pts = pts
                best_word = w
    return best_word, best_pts


def _pick_card_for_tier(tier: str, pool_counts: dict[str, int], rng, used: set[str]) -> dict | None:
    """Pick one playable, not-yet-used category of the given tier. Returns
    {card_id, tier, best_word, best_points, optimal_threshold, good_threshold}."""
    candidates = [c["id"] for c in categories_by_difficulty()[tier] if c["id"] not in used]
    rng.shuffle(candidates)
    for cid in candidates:
        best_word, best_pts = best_word_for_card(pool_counts, cid, tier)
        if best_word is not None and best_pts > 0:
            return {
                "card_id": cid,
                "tier": tier,
                "best_word": best_word,
                "best_points": best_pts,
                "optimal_threshold": int(round(best_pts * OPTIMAL_FRACTION)),
                "good_threshold": int(round(best_pts * GOOD_FRACTION)),
            }
    return None


@lru_cache(maxsize=64)
def build_daily(date_iso: str) -> dict:
    """Build (and cache) the full daily puzzle for an ISO date string.

    Returns:
      {
        "date", "seed", "pool": [...],
        "sequence": [{card_id, tier}, ...],            # what the engine consumes
        "cards":    [{card_id, tier, best_word, best_points,
                      optimal_threshold, good_threshold}, ...],  # private
      }
    Note: the optimal word / thresholds are PRIVATE — never expose `cards` or
    `best_word` to the client; only the engine sequence and (post-finish) the
    derived grid colours are public.
    """
    seed = daily_seed(date_iso)
    rng = make_rng(seed)

    pool = _subsample_pool(build_pool(rng), DAILY_POOL_SIZE, rng)
    pool_counts = pool_to_counts(pool)

    cards: list[dict] = []
    used: set[str] = set()
    for tier in DAILY_TIER_TEMPLATE:
        card = _pick_card_for_tier(tier, pool_counts, rng, used)
        if card is None:
            # Extremely unlikely with a 90-tile pool, but degrade gracefully by
            # trying any tier so we always yield a full 5-card puzzle.
            for fallback_tier in ("easy", "medium", "hard"):
                card = _pick_card_for_tier(fallback_tier, pool_counts, rng, used)
                if card is not None:
                    break
        if card is None:
            continue  # give up on this slot rather than crash; puzzle may be <5
        used.add(card["card_id"])
        cards.append(card)

    sequence = [{"card_id": c["card_id"], "tier": c["tier"]} for c in cards]
    return {
        "date": date_iso,
        "seed": seed,
        "pool": pool,
        "sequence": sequence,
        "cards": cards,
    }


def grade_results(date_iso: str, results: list[dict]) -> list[str]:
    """Turn the engine's per-card `results` into share-grid tiers using the
    day's precomputed thresholds. Returns a list like
    ["optimal","good","weak","skip","optimal"] aligned to the sequence.

    A result is graded by comparing its points to that card's thresholds.
    Skips/unanswered cards are "skip" (grey)."""
    puzzle = build_daily(date_iso)
    cards = puzzle["cards"]
    grid: list[str] = []
    for i, card in enumerate(cards):
        if i >= len(results):
            grid.append("skip")
            continue
        r = results[i]
        if r.get("result") == "skip" or r.get("word") is None:
            grid.append("skip")
            continue
        pts = int(r.get("points", 0))
        if pts >= card["optimal_threshold"]:
            grid.append("optimal")
        elif pts >= card["good_threshold"]:
            grid.append("good")
        else:
            grid.append("weak")
    return grid
