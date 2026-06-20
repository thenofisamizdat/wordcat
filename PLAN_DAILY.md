# WordCat Daily — "sticky" daily-puzzle build

A new public-facing **Daily Puzzle** experience focused on retention: a fixed,
identical-for-everyone puzzle, an optimality-based share grid, streaks, a relaxed
timer, and zero-friction first play. Built as a **separate app surface** (its own
route + branding) sharing the existing backend/engine.

## Product decisions (locked)
- **Format:** fixed sequence of **5 category cards**, same cards, same order, drawn
  from one shared tile pool — identical for every player that day.
- **Difficulty:** **fixed preset tiers** per day (e.g. E,M,M,H,H), same for everyone.
  Player does NOT pick tier; the day's tier mix is the "flavour".
- **Share grid:** **optimality tiers** — per card: green = optimal (or near-optimal)
  word, yellow = decent, grey = weak/skipped. Requires computing the best possible
  word per card from that turn's pool.
- **Streaks:** per-identity daily streak (current + best), loss-aversion framing.
- **Timer:** relaxed — generous/!untimed for the daily puzzle (no 60s/10s sprint).
- **Guest identity:** browser-stored guest key (localStorage), streak survives across
  days on the same device.
- **Scope:** separate new app surface (`/d` route + branding), sharing backend/engine.

---

## Backend

### 1. Engine: fixed-sequence daily mode (`backend/app/game/engine.py`)
The current engine lets the player pick a tier and draws from per-tier decks. The
daily puzzle needs a **predetermined ordered list of (card_id, tier)** that is the
same for everyone, with no tier choice and no auto-redraw randomness affecting
comparability.

- Add a new state constructor `new_daily_state(seed, card_sequence, turn_seconds, overall_seconds)`
  OR extend `new_state` with an optional `fixed_sequence: list[{card_id, tier}]`.
  When a fixed sequence is present:
  - Ignore `decks` / tier-picking; store `sequence` + `sequence_index`.
  - The "current card" is `sequence[sequence_index]`; advancing a turn just
    increments the index. Game ends when the index passes the last card.
  - Difficulty for scoring comes from the sequence entry, not a player pick.
- Add `submit_daily(state, word)` / reuse `submit_word` but driven by sequence index
  instead of `pick_difficulty`. Skipping advances the index (records grey).
- Keep everything deterministic & JSON-serializable (the existing contract).

### 2. Daily puzzle generator (`backend/app/game/daily.py` — NEW)
Pure, deterministic, seeded from `daily_seed(date)`:
- Build the shared pool (reuse `build_pool` + the existing subsample logic, or a
  fixed daily pool size constant, e.g. `DAILY_POOL_SIZE`).
- Choose 5 cards with a preset tier template (e.g. `["easy","medium","medium","hard","hard"]`)
  — pick one category per slot from that tier via the seeded RNG, ensuring each
  chosen card is **playable** from the pool (reuse `_words_possible`).
- Return `{seed, pool, sequence:[{card_id, tier}], tier_template}`.
- **Optimal-word precompute:** for each card in the sequence, compute the highest-scoring
  playable word (and a "decent" score threshold) given the pool state *as it would be
  at that turn assuming optimal play*, OR (simpler, recommended for v1) given the
  **full daily pool** independent of prior turns. Store `optimal_points` + `good_points`
  thresholds per card for the share-grid tiering. Cache per-date.

### 3. Data model (`backend/app/models.py`)
- New table `DailyResult` (or extend `SoloRun` with a `daily_v2` mode + extra cols).
  Recommend a dedicated table for clean leaderboard/share semantics:
  - `id, user_id?, guest_key?, display_name, date (YYYY-MM-DD), seed`
  - `state_json` (active engine state), `words_json` (submitted words per card)
  - `total_score`, `grid_json` (list of 5 tier results: optimal|good|weak|skip)
  - `finished`, `started_at`, `finished_at`
  - unique (user_id|guest_key, date) — one attempt/day.
- New table `Streak` keyed by identity (`user_id` or `guest_key`):
  - `current_streak, best_streak, last_played_date`.
  - Update logic: on finishing today's daily, if `last_played_date == yesterday`
    → `current += 1`; if `== today` → no-op; else reset to 1. `best = max(best, current)`.
- `db.py` `init_db()` creates tables automatically (SQLAlchemy `create_all`) — confirm.

### 4. Router (`backend/app/routers/daily_puzzle.py` — NEW, prefix `/api/daily`)
- `POST /api/daily/start` → create/resume today's `DailyResult` for the identity;
  returns public view (pool, current card, sequence position, relaxed timer config,
  streak info), but NEVER leaks the optimal word.
- `POST /api/daily/submit` `{result_id, word}` → validate via engine, advance sequence,
  on finish compute `grid_json` from precomputed thresholds, update `Streak`.
- `POST /api/daily/skip` `{result_id}` → advance with grey square.
- `GET /api/daily/share/{result_id}` (or include in submit-finish response) →
  emoji grid string + summary (no spoilers).
- `GET /api/daily/streak` → current/best streak for identity.
- Register router in `main.py`.

### 5. Leaderboard (`backend/app/routers/leaderboard.py`)
- Add `GET /api/leaderboard/daily-puzzle?date=` reading `DailyResult`
  (rank by total_score, then finish time). Keep existing `/daily` untouched.

### 6. Schemas (`backend/app/schemas.py`)
- `DailyStartRequest/Out`, `DailySubmitRequest`, `DailySkipRequest`,
  `DailyShareOut {grid, text, total_score, streak, best_streak, date, puzzle_no}`,
  `StreakOut`. `public_view` for daily must expose sequence position + relaxed timer
  but hide optimal words/thresholds.

---

## Frontend (new app surface)

### 7. No-signup first play
- `useAuth.js` / `client.js`: add **persistent guest bootstrap** — on first visit with
  no token, silently mint ONE guest token and reuse it forever (so `guest_key`, and
  therefore the streak, is stable across days). Currently `/api/auth/guest` mints a
  fresh key each call, so the fix is purely client-side: only call it once, then reuse
  the stored token. Add a small `ensureGuest()` helper.

### 8. New route + components
- `App.jsx`: add `/d` (or `/today`) → `DailyPuzzle.jsx`. This is the public landing
  for the daily experience (own light branding/header).
- `routes/DailyPuzzle.jsx` (NEW): zero-friction flow — auto-start, show the day's
  fixed cards one at a time, relaxed timer, submit/skip, reuse existing
  `TilePool`, `WordTray`, `CategoryCard`, `BurnedTiles`. No `DifficultyPicker`
  (tiers are preset; show the tier as a label/badge on the card instead).
- `components/ShareGrid.jsx` (NEW): renders the emoji grid + "Share" button
  (clipboard with the existing `execCommand` fallback already used elsewhere),
  streak line, e.g.:
  `WordCat Daily #142  🟩🟨🟩⬜🟩  1830 pts  🔥 7-day streak`
- `components/StreakBadge.jsx` (NEW): current streak + best, loss-aversion copy
  ("Come back tomorrow to keep your 🔥7 streak!").

### 9. End-of-run screen
- Replace the generic score screen for daily with: grid + total + streak + share +
  "come back tomorrow" + link to the daily-puzzle leaderboard.

---

## Sticky details / framing
- Puzzle number (`#N` from a launch-date epoch) for shareability.
- Relaxed timer: either none, or a soft "your time" tracked for tie-breaks only
  (not pressure). Recommend untimed for daily; surface elapsed time subtly.
- Streak persists on-device for guests; offer "create an account to save your streak
  across devices" as a gentle, optional upsell (no forced signup).

## Out of scope (this build)
- Ads integration (separate task once traffic exists).
- Multiplayer changes (Tier 3) — noted but not built here.
- Migrating/retiring the existing `/daily` scoring mode (kept as-is alongside).

## Risks / watch-items
- **Optimal-word precompute cost:** computing best word per card scans that category's
  wordlist against pool counts — fine for v1 (cached per date). The "pool as at that
  turn assuming optimal play" version is harder; v1 uses full-pool optimum per card.
- **Guest streak fragility:** localStorage clears = lost streak. Acceptable for v1;
  account upsell mitigates.
- **`init_db` migrations:** SQLite + `create_all` adds new tables but won't alter
  existing ones; new tables are additive so this is safe.
- Keep the daily public view free of any spoiler (optimal words/thresholds).

## Suggested build order
1. Engine fixed-sequence support + `daily.py` generator (+ unit-check determinism).
2. Models (`DailyResult`, `Streak`) + schemas.
3. `daily_puzzle.py` router + leaderboard endpoint + register in `main.py`.
4. Persistent guest bootstrap (client).
5. `DailyPuzzle.jsx` route + `ShareGrid`/`StreakBadge` components + route wiring.
6. End screen + manual playthrough.
