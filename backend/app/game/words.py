from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Iterable

from ..config import settings


@lru_cache(maxsize=1)
def load_dictionary() -> frozenset[str]:
    path = settings.data_dir / "dictionary.txt"
    with path.open() as f:
        return frozenset(w.strip().upper() for w in f if w.strip().isalpha())


@lru_cache(maxsize=1)
def load_letter_values() -> dict[str, int]:
    with (settings.data_dir / "letter_values.json").open() as f:
        return {k.upper(): int(v) for k, v in json.load(f).items()}


@lru_cache(maxsize=1)
def load_tile_distribution() -> dict[str, int]:
    with (settings.data_dir / "tile_distribution.json").open() as f:
        raw = json.load(f)
    return {k.upper(): int(v) for k, v in raw.items() if not k.startswith("_") and int(v) > 0}


@lru_cache(maxsize=1)
def load_categories() -> list[dict]:
    with (settings.data_dir / "categories.json").open() as f:
        cats = json.load(f)
    for c in cats:
        if c["difficulty"] not in {"easy", "medium", "hard"}:
            raise ValueError(f"Bad difficulty for {c['id']}: {c['difficulty']}")
    return cats


def categories_by_difficulty() -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {"easy": [], "medium": [], "hard": []}
    for c in load_categories():
        out[c["difficulty"]].append(c)
    return out


def categories_by_id() -> dict[str, dict]:
    return {c["id"]: c for c in load_categories()}


@lru_cache(maxsize=128)
def load_category_words(category_id: str) -> frozenset[str]:
    path: Path = settings.data_dir / "category_words" / f"{category_id}.txt"
    if not path.exists():
        return frozenset()
    with path.open() as f:
        return frozenset(w.strip().upper() for w in f if w.strip().isalpha())


def normalize_word(word: str) -> str:
    return "".join(ch for ch in word.upper() if ch.isalpha())


def in_dictionary(word: str) -> bool:
    return word in load_dictionary()


def in_category(word: str, category_id: str) -> bool:
    return word in load_category_words(category_id)


def letters_available(word: str, pool_counts: dict[str, int]) -> bool:
    needed: dict[str, int] = {}
    for c in word:
        needed[c] = needed.get(c, 0) + 1
    for c, n in needed.items():
        if pool_counts.get(c, 0) < n:
            return False
    return True


def remove_letters(word: str, pool: list[str]) -> list[str]:
    """Return a copy of pool with one occurrence of each letter in word removed.
    Caller has already verified availability."""
    pool = list(pool)
    for c in word:
        pool.remove(c)
    return pool


def pool_to_counts(pool: Iterable[str]) -> dict[str, int]:
    out: dict[str, int] = {}
    for c in pool:
        out[c] = out.get(c, 0) + 1
    return out
