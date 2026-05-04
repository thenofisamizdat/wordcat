from __future__ import annotations

import hashlib
import random
from datetime import date


def daily_seed(d: date | str) -> int:
    iso = d.isoformat() if isinstance(d, date) else str(d)
    h = hashlib.sha256(iso.encode("utf-8")).hexdigest()
    # First 12 hex chars => 48-bit positive int. Plenty of entropy, fits in int.
    return int(h[:12], 16)


def rng(seed: int) -> random.Random:
    return random.Random(seed)
