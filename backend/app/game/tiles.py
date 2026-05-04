from __future__ import annotations

import random

from .words import load_letter_values, load_tile_distribution

DIFFICULTY_MULTIPLIER: dict[str, float] = {
    "easy": 1.0,
    "medium": 1.5,
    "hard": 2.0,
}


def build_pool(rng: random.Random) -> list[str]:
    """Construct the shared tile pool from the configured distribution and shuffle it."""
    dist = load_tile_distribution()
    pool: list[str] = []
    for letter, count in dist.items():
        pool.extend([letter] * count)
    rng.shuffle(pool)
    return pool


def score_word(word: str, difficulty: str) -> int:
    values = load_letter_values()
    base = sum(values.get(c, 0) for c in word)
    mult = DIFFICULTY_MULTIPLIER[difficulty]
    return int(round(base * mult))
