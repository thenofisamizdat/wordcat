import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import { useAuth } from "../hooks/useAuth.js";
import TilePool from "../components/TilePool.jsx";
import WordTray from "../components/WordTray.jsx";
import CategoryCard from "../components/CategoryCard.jsx";
import DifficultyPicker from "../components/DifficultyPicker.jsx";
import Timer from "../components/Timer.jsx";
import OverallTimer from "../components/OverallTimer.jsx";
import BurnedTiles from "../components/BurnedTiles.jsx";
import ResultToast from "../components/ResultToast.jsx";
import { play } from "../sounds.js";

const REJECTION_REASONS = {
  not_in_dict: "That word isn't in the dictionary.",
  not_in_category: "That word doesn't fit the category.",
  letters_unavailable: "You don't have the letters for that word.",
  empty_word: "Please pick some letters first.",
  no_card: "Pick a difficulty first to draw a card.",
  not_your_turn: "It isn't your turn.",
  game_finished: "The game is already over.",
  card_already_drawn: "You already drew a card; submit or skip.",
  bad_tier: "Unknown difficulty.",
  deck_empty: "That difficulty deck is empty — try another.",
  turn_expired: "Time ran out — turn skipped.",
  time_up: "Game over — time's up!"
};

const FINISH_REASON_TEXT = {
  pool_empty: "The shared pool is empty.",
  decks_empty: "All category decks are exhausted.",
  all_skipped: "All players skipped.",
  time_up: "Time's up!",
  ended_by_player: "You ended the game."
};

function reasonText(r) { return REJECTION_REASONS[r] || r || "Something went wrong"; }
function finishText(r) { return FINISH_REASON_TEXT[r] || r || ""; }

const MODE_TITLE = {
  daily_timed: "Daily Challenge (Timed)",
  daily_untimed: "Daily Challenge",
  practice: "Free Fire",
};

const PREFIX_MAP = {
  daily_timed: "/api/solo/daily-timed",
  daily_untimed: "/api/solo/daily-untimed",
  practice: "/api/solo/practice",
};

export default function SoloPlay({ mode }) {
  const { isAuthed, logout } = useAuth();
  const [searchParams] = useSearchParams();
  const [run, setRun] = useState(null);
  const [picked, setPicked] = useState([]);          // letters in tray order
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);          // {kind:'good'|'bad', text}
  const [unavailable, setUnavailable] = useState(null);
  const [scoreBumpKey, setScoreBumpKey] = useState(0);  // bump score number when increased
  const [floater, setFloater] = useState(null);          // {points, key} floats up
  const [shakeKey, setShakeKey] = useState(0);           // shake tray on rejected
  const [toast, setToast] = useState(null);              // {token, kind, detail} for ResultToast
  const [dud, setDud] = useState(null);                  // {letter, key} fires burned-tile flash
  const startedRef = useRef(false);
  const gameoverPlayedRef = useRef(false);

  const prefix = PREFIX_MAP[mode] ?? "/api/solo/practice";
  // For practice, read ?timed=0/1 from the URL (defaults to timed).
  const practiceTimed = searchParams.get("timed") !== "0";
  const isDaily = mode === "daily_timed" || mode === "daily_untimed";

  const start = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const body = mode === "practice" ? { timed: practiceTimed } : {};
      const r = await api.post(`${prefix}/start`, body);
      setRun(r);
      setPicked([]);
    } catch (e) {
      if (e.status === 409) setUnavailable(e.message);
      else setError(e.message);
    } finally { setBusy(false); }
  }, [prefix]);

  // Game-over jingle (fires once when run flips to finished).
  useEffect(() => {
    if (run?.state?.finished && !gameoverPlayedRef.current) {
      gameoverPlayedRef.current = true;
      play("gameover");
    }
    if (run && !run.state.finished) {
      // Reset for the next run (after Play again)
      gameoverPlayedRef.current = false;
    }
  }, [run]);

  useEffect(() => {
    if (!isAuthed) return;
    if (startedRef.current) return;
    startedRef.current = true;
    start();
  }, [isAuthed, start]);

  const pick = useCallback(async (tier) => {
    if (!run) return;
    setBusy(true); setError(null); setFlash(null);
    try {
      const r = await api.post(`${prefix}/pick`, { run_id: run.run_id, tier });
      setRun(r);
      setPicked([]);
    } catch (e) { setError(reasonText(e.message)); }
    finally { setBusy(false); }
  }, [run, prefix]);

  const submit = useCallback(async () => {
    if (!run || picked.length === 0) return;
    setBusy(true); setError(null);
    const word = picked.join("");
    try {
      const r = await api.post(`${prefix}/submit`, { run_id: run.run_id, word });
      setRun(r.run);
      if (r.result.ok) {
        play("accept");
        setFlash({ kind: "good", text: `+${r.result.points} for ${r.result.word}` });
        setPicked([]);
        setScoreBumpKey((k) => k + 1);
        setFloater({ points: r.result.points, key: Date.now() });
        setTimeout(() => setFloater(null), 1100);
        setToast({ token: Date.now(), kind: "good", detail: `+${r.result.points} for ${r.result.word}` });
      } else {
        play("reject");
        setFlash({ kind: "bad", text: reasonText(r.result.reason) });
        setShakeKey((k) => k + 1);
        setToast({ token: Date.now(), kind: "bad", detail: reasonText(r.result.reason) });
      }
    } catch (e) {
      play("reject");
      setFlash({ kind: "bad", text: reasonText(e.message) });
      setShakeKey((k) => k + 1);
      setToast({ token: Date.now(), kind: "bad", detail: reasonText(e.message) });
    } finally { setBusy(false); }
  }, [run, picked, prefix]);

  const skip = useCallback(async () => {
    if (!run) return;
    play("click");
    setBusy(true); setError(null); setFlash(null);
    try {
      const r = await api.post(`${prefix}/skip`, { run_id: run.run_id });
      setRun(r);
      setPicked([]);
    } catch (e) { setError(reasonText(e.message)); }
    finally { setBusy(false); }
  }, [run, prefix]);

  const end = useCallback(async () => {
    if (!run) return;
    play("click");
    setBusy(true);
    try {
      const r = await api.post(`${prefix}/end`, { run_id: run.run_id });
      setRun(r);
    } finally { setBusy(false); }
  }, [run, prefix]);

  const onPickLetter = useCallback((L) => setPicked((p) => [...p, L]), []);
  const onRemoveAt = useCallback((idx) => setPicked((p) => p.filter((_, i) => i !== idx)), []);
  const onClear = useCallback(() => setPicked([]), []);

  // Trigger the "dud" feedback for a burned letter the user tried to use:
  // play the dud sound + flash that tile in the burned rack.
  const fireDud = useCallback((L) => {
    play("dud");
    setDud({ letter: L, key: Date.now() });
    // Auto-clear after the animation runs so re-typing the same letter retriggers it.
    setTimeout(() => setDud((d) => (d && d.letter === L ? null : d)), 520);
  }, []);

  // Keyboard input: type letters to add them to the tray.
  //   A-Z         → add letter (or dud if burned, or quiet ignore if exhausted)
  //   Backspace   → remove last
  //   Enter       → submit
  //   Escape      → clear tray
  useEffect(() => {
    if (!run || run.state.finished) return undefined;
    const cardOpen = !!run.state.current_card_id;
    const onKey = (e) => {
      // Don't hijack typing in inputs / textareas.
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || e.target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "Enter") {
        if (cardOpen && picked.length > 0 && !busy) { e.preventDefault(); submit(); }
        return;
      }
      if (e.key === "Escape") {
        if (cardOpen && picked.length > 0) { e.preventDefault(); onClear(); }
        return;
      }
      if (e.key === "Backspace") {
        if (cardOpen && picked.length > 0) {
          e.preventDefault();
          play("untile");
          setPicked((p) => p.slice(0, -1));
        }
        return;
      }
      if (!cardOpen) return; // ignore letter input until a card is drawn
      if (e.key.length === 1 && /^[a-zA-Z]$/.test(e.key)) {
        const L = e.key.toUpperCase();
        const poolCount = (run.state.pool_counts || {})[L] || 0;
        const usedInTray = picked.filter((p) => p === L).length;
        const burnedCount = (run.state.discarded_counts || {})[L] || 0;
        if (poolCount - usedInTray > 0) {
          e.preventDefault();
          play("tile");
          setPicked((p) => [...p, L]);
        } else if (burnedCount > 0) {
          // Letter exists but is fully burned — give the user clear "no" feedback.
          e.preventDefault();
          fireDud(L);
        }
        // Otherwise the letter genuinely isn't in the game (e.g. all used in tray); silently ignore.
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run, picked, busy, submit, onClear, fireDud]);

  const cardDrawn = run?.state?.current_card_id;
  const turnStartedAt = run?.state?.turn_started_at;
  const turnSeconds = run?.state?.turn_seconds ?? 0;
  const finished = run?.state?.finished;
  const decksRemaining = run?.state?.decks_remaining;

  const wordSoFar = picked.join("");
  const liveScore = useMemo(() => {
    if (!run || !cardDrawn) return 0;
    const mult = run.state.difficulty_multipliers[run.state.current_difficulty] ?? 1;
    const base = picked.reduce((s, L) => s + (run.letter_values[L] || 0), 0);
    return Math.round(base * mult);
  }, [run, picked, cardDrawn]);

  if (!isAuthed) return <Navigate to="/" replace />;

  if (unavailable) {
    return (
      <div className="max-w-xl mx-auto p-6 space-y-4">
        <h1 className="text-2xl font-bold">Daily Challenge</h1>
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-4">{unavailable}</div>
        <Link to="/leaderboard" className="text-amber-700 underline">See today's leaderboard →</Link>
      </div>
    );
  }

  if (!run) {
    return <div className="p-6 text-stone-500">{busy ? "Starting…" : (error || "Loading…")}</div>;
  }

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
      <header className="flex items-center justify-between gap-3">
        <Link to="/" className="text-stone-600 hover:text-stone-900 text-sm">← Home</Link>
        <h1 className="text-xl sm:text-2xl font-extrabold">{MODE_TITLE[mode] ?? mode}</h1>
        <div className="text-right relative">
          <div className="text-xs text-stone-500">Score</div>
          <div className="text-2xl font-extrabold tabular-nums">
            <span key={scoreBumpKey} className="inline-block score-bump">{run.state.scores[0]}</span>
          </div>
          {floater && (
            <div key={floater.key} className="absolute -top-1 right-0 text-emerald-600 font-extrabold text-2xl float-up pointer-events-none">
              +{floater.points}
            </div>
          )}
        </div>
      </header>

      <div className="grid sm:grid-cols-3 gap-3 text-xs text-stone-600">
        <div className="bg-white rounded-lg p-2 border">Tiles in pool: <span className="font-semibold tabular-nums">{run.state.pool_total}</span></div>
        <div className="bg-white rounded-lg p-2 border">Decks left: E {decksRemaining.easy} · M {decksRemaining.medium} · H {decksRemaining.hard}</div>
        <div className="bg-white rounded-lg p-2 border">Skips this round: <span className="font-semibold tabular-nums">{run.state.consecutive_skips}</span></div>
      </div>

      {/* Overall game timer (always visible during play). */}
      {!finished && run.state.overall_seconds > 0 && (
        <OverallTimer startedAt={run.state.started_at} total={run.state.overall_seconds} />
      )}

      {finished ? (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-5 text-center">
          <div className="text-emerald-900 font-bold text-2xl">Game over!</div>
          <div className="text-stone-700 mt-1">Final score: <span className="font-extrabold text-2xl">{run.state.scores[0]}</span></div>
          <div className="text-stone-500 text-sm mt-1">{finishText(run.state.finish_reason)}</div>
          <div className="mt-3 flex gap-2 justify-center flex-wrap">
            <button onClick={start} disabled={busy || isDaily}
              className="bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white px-4 py-2 rounded font-semibold">
              {isDaily ? "Come back tomorrow" : "Play again"}
            </button>
            <button
              onClick={async () => {
                const text = isDaily
                  ? `WordCat daily ${run.date}: ${run.state.scores[0]} pts`
                  : `WordCat Free Fire: ${run.state.scores[0]} pts`;
                try { await navigator.clipboard.writeText(text); setFlash({ kind: "good", text: "Copied result!" }); }
                catch { window.prompt("Copy:", text); }
              }}
              className="bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded font-semibold">
              Share result
            </button>
            {isDaily && (
              <Link to="/leaderboard" className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded font-semibold">
                Leaderboard
              </Link>
            )}
            <Link to="/" className="bg-stone-200 hover:bg-stone-300 text-stone-800 px-4 py-2 rounded font-semibold">Home</Link>
          </div>
        </div>
      ) : (
        <>
          {!cardDrawn ? (
            <div className="space-y-3">
              <div className="text-stone-700">Pick a difficulty to draw a category card.</div>
              <DifficultyPicker remaining={decksRemaining} onPick={pick} disabled={busy} />
              <div className="text-xs text-stone-500">Higher difficulty = bigger score multiplier (Easy ×1, Medium ×1.5, Hard ×2).</div>
            </div>
          ) : (
            <>
              <CategoryCard card={run.card} />
              {turnSeconds > 0 && <Timer startedAt={turnStartedAt} totalSeconds={turnSeconds} />}
            </>
          )}

          {/* WordTray is always visible while the game is in progress — even
              before a category card is drawn — so it doesn't pop in/out
              between turns. Letters are only added when a card is in play. */}
          <div key={shakeKey} className={shakeKey ? "shake" : ""}>
            <WordTray
              letters={picked}
              values={run.letter_values}
              onRemoveAt={cardDrawn ? onRemoveAt : undefined}
              onClear={cardDrawn && picked.length ? onClear : null}
            />
          </div>

          {cardDrawn && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <div className="flex-1 min-w-[10rem]">
                <span className="text-stone-500">Word:&nbsp;</span>
                <span className="font-bold tracking-wide">{wordSoFar || "—"}</span>
              </div>
              <div>
                <span className="text-stone-500">Live points:&nbsp;</span>
                <span className="font-bold tabular-nums">{liveScore}</span>
              </div>
              {/* Big tile-shaped Submit button — same green as the accept toast,
                  drawn like an oversized tile so it feels part of the play surface.
                  Skip uses the same tile shape but in plain cream. */}
              <button onClick={submit} disabled={busy || picked.length === 0} className="play-tile play-tile-good" title="Submit (Enter)">
                Submit
              </button>
              <button onClick={skip} disabled={busy} className="play-tile" title="Skip">
                Skip
              </button>
            </div>
          )}

          {/* Tile pool is always visible during play, even before a category is
              drawn. Tiles are only clickable when a card is in play. */}
          <TilePool
            counts={run.state.pool_counts}
            values={run.letter_values}
            onPick={cardDrawn ? onPickLetter : undefined}
            picked={picked}
          />

          {/* Burned-tile rack: red-tinted dimmed tiles for everything spent.
              Clicking a burned tile fires the dud feedback (sound + flash). */}
          <BurnedTiles
            counts={run.state.discarded_counts || {}}
            values={run.letter_values}
            dudKey={dud?.key}
            dudLetter={dud?.letter}
            onDud={fireDud}
          />
        </>
      )}

      {error && <div className="text-rose-600 text-sm">{error}</div>}

      <div className="pt-4 border-t flex items-center justify-between text-xs text-stone-500">
        <button onClick={end} disabled={busy || finished} className="underline disabled:opacity-40">End game</button>
        <button onClick={logout} className="underline">Sign out</button>
      </div>

      {toast && <ResultToast token={toast.token} kind={toast.kind} detail={toast.detail} />}
    </div>
  );
}
