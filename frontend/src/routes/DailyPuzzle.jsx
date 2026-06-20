import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, ensureGuest } from "../api/client.js";
import TilePool from "../components/TilePool.jsx";
import WordTray from "../components/WordTray.jsx";
import CategoryCard from "../components/CategoryCard.jsx";
import OverallTimer from "../components/OverallTimer.jsx";
import BurnedTiles from "../components/BurnedTiles.jsx";
import ResultToast from "../components/ResultToast.jsx";
import ShareGrid from "../components/ShareGrid.jsx";
import StreakBadge from "../components/StreakBadge.jsx";
import { play } from "../sounds.js";

const REJECTION_REASONS = {
  not_in_dict: "That word isn't in the dictionary.",
  not_in_category: "That word doesn't fit the category.",
  letters_unavailable: "You don't have the letters for that word.",
  empty_word: "Please pick some letters first.",
  no_card: "No card in play.",
  game_finished: "The puzzle is already complete.",
  time_up: "Time's up for today's puzzle!",
};

// Squares for the per-card progress row (mirrors the share grid palette).
const PROGRESS_EMOJI = { optimal: "🟩", good: "🟨", weak: "⬜", skip: "⬛" };

function reasonText(r) { return REJECTION_REASONS[r] || r || "Something went wrong"; }

export default function DailyPuzzle() {
  const [run, setRun] = useState(null);
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [scoreBumpKey, setScoreBumpKey] = useState(0);
  const [floater, setFloater] = useState(null);
  const [dud, setDud] = useState(null);
  const startedRef = useRef(false);
  const gameoverPlayedRef = useRef(false);

  const start = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      await ensureGuest("Player");          // zero-friction: silent guest on first visit
      const r = await api.post("/api/daily-puzzle/start");
      setRun(r);
      setPicked([]);
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    start();
  }, [start]);

  useEffect(() => {
    if (run?.state?.finished && !gameoverPlayedRef.current) {
      gameoverPlayedRef.current = true;
      play("gameover");
    }
  }, [run]);

  const submit = useCallback(async () => {
    if (!run || picked.length === 0) return;
    setBusy(true); setError(null);
    const word = picked.join("");
    try {
      const r = await api.post("/api/daily-puzzle/submit", { result_id: run.result_id, word });
      setRun(r);
      setPicked([]);
      play("accept");
      setScoreBumpKey((k) => k + 1);
      setToast({ token: Date.now(), kind: "good", detail: `+ ${word}` });
    } catch (e) {
      play("reject");
      setShakeKey((k) => k + 1);
      setToast({ token: Date.now(), kind: "bad", detail: reasonText(e.message) });
    } finally { setBusy(false); }
  }, [run, picked]);

  const skip = useCallback(async () => {
    if (!run) return;
    play("click");
    setBusy(true); setError(null);
    try {
      const r = await api.post("/api/daily-puzzle/skip", { result_id: run.result_id });
      setRun(r);
      setPicked([]);
    } catch (e) { setError(reasonText(e.message)); }
    finally { setBusy(false); }
  }, [run]);

  const onClear = useCallback(() => setPicked([]), []);
  const onPickLetter = useCallback((L) => setPicked((p) => [...p, L]), []);
  const onRemoveAt = useCallback((idx) => setPicked((p) => p.filter((_, i) => i !== idx)), []);

  const fireDud = useCallback((L) => {
    play("dud");
    setDud({ letter: L, key: Date.now() });
    setTimeout(() => setDud((d) => (d && d.letter === L ? null : d)), 520);
  }, []);

  // Keyboard input (type to build a word; Enter submits, Esc clears, Backspace deletes).
  useEffect(() => {
    if (!run || run.state.finished) return undefined;
    const cardOpen = !!run.state.current_card_id;
    const onKey = (e) => {
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
        if (cardOpen && picked.length > 0) { e.preventDefault(); play("untile"); setPicked((p) => p.slice(0, -1)); }
        return;
      }
      if (!cardOpen) return;
      if (e.key.length === 1 && /^[a-zA-Z]$/.test(e.key)) {
        const L = e.key.toUpperCase();
        const poolCount = (run.state.pool_counts || {})[L] || 0;
        const usedInTray = picked.filter((p) => p === L).length;
        const burnedCount = (run.state.discarded_counts || {})[L] || 0;
        if (poolCount - usedInTray > 0) { e.preventDefault(); play("tile"); setPicked((p) => [...p, L]); }
        else if (burnedCount > 0) { e.preventDefault(); fireDud(L); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run, picked, busy, submit, onClear, fireDud]);

  const finished = run?.state?.finished;
  const cardDrawn = run?.state?.current_card_id;
  const idx = run?.state?.sequence_index ?? 0;
  const total = run?.state?.sequence_length ?? 5;

  const wordSoFar = picked.join("");
  const liveScore = useMemo(() => {
    if (!run || !cardDrawn) return 0;
    const mult = run.state.difficulty_multipliers[run.state.current_difficulty] ?? 1;
    const base = picked.reduce((s, L) => s + (run.letter_values[L] || 0), 0);
    return Math.round(base * mult);
  }, [run, picked, cardDrawn]);

  // Per-card progress row: graded squares for done cards, a dot for the
  // current card, faint dots for upcoming ones.
  const progressRow = useMemo(() => {
    if (!run) return null;
    const results = run.state.results || [];
    const cells = [];
    for (let i = 0; i < total; i++) {
      if (i < results.length) {
        // graded only at finish; mid-run show a neutral "done" mark
        const grade = finished && run.grid[i] ? PROGRESS_EMOJI[run.grid[i]] : "✅";
        cells.push(<span key={i} className="text-lg">{grade}</span>);
      } else if (i === idx && !finished) {
        cells.push(<span key={i} className="text-lg animate-pulse">🔲</span>);
      } else {
        cells.push(<span key={i} className="text-lg opacity-30">⬚</span>);
      }
    }
    return cells;
  }, [run, total, idx, finished]);

  if (!run) {
    return <div className="p-6 text-stone-500">{busy ? "Loading today's puzzle…" : (error || "Loading…")}</div>;
  }

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
      <header className="flex items-center justify-between gap-3">
        <Link to="/" className="text-stone-600 hover:text-stone-900 text-sm">← Home</Link>
        <h1 className="text-xl sm:text-2xl font-extrabold">Daily Puzzle <span className="text-stone-400 font-bold">#{run.puzzle_no}</span></h1>
        <div className="text-right relative">
          <div className="text-xs text-stone-500">Score</div>
          <div className="text-2xl font-extrabold tabular-nums">
            <span key={scoreBumpKey} className="inline-block score-bump">{run.total_score}</span>
          </div>
        </div>
      </header>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">{progressRow}</div>
        <div className="text-xs text-stone-500">{Math.min(idx, total)} / {total}</div>
      </div>

      <StreakBadge current={run.streak.current_streak} best={run.streak.best_streak} played={finished} />

      {!finished && run.state.overall_seconds > 0 && (
        <OverallTimer startedAt={run.state.started_at} total={run.state.overall_seconds} />
      )}

      {finished ? (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-6 text-center space-y-4">
          <div className="text-emerald-900 font-bold text-2xl">Today's puzzle complete!</div>
          <div className="text-stone-700">Final score: <span className="font-extrabold text-2xl">{run.total_score}</span></div>
          <ShareGrid grid={run.grid} shareText={run.share_text} />
          <StreakBadge current={run.streak.current_streak} best={run.streak.best_streak} played />
          <div className="flex gap-2 justify-center flex-wrap pt-2">
            <Link to="/daily-leaderboard" className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded font-semibold">Leaderboard</Link>
            <Link to="/" className="bg-stone-200 hover:bg-stone-300 text-stone-800 px-4 py-2 rounded font-semibold">Home</Link>
          </div>
          <div className="text-xs text-stone-500 pt-1">Come back tomorrow for puzzle #{run.puzzle_no + 1}.</div>
        </div>
      ) : (
        <>
          {cardDrawn && (
            <>
              <CategoryCard card={run.card} />
              <div className="text-xs text-stone-500">Find a word in this category from the shared pool. Higher tiers score more (Easy ×1, Medium ×1.5, Hard ×2).</div>
            </>
          )}

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
              <button onClick={submit} disabled={busy || picked.length === 0} className="play-tile play-tile-good" title="Submit (Enter)">Submit</button>
              <button onClick={skip} disabled={busy} className="play-tile" title="Skip">Skip</button>
            </div>
          )}

          <TilePool
            counts={run.state.pool_counts}
            values={run.letter_values}
            onPick={cardDrawn ? onPickLetter : undefined}
            picked={picked}
          />

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
      {toast && <ResultToast token={toast.token} kind={toast.kind} detail={toast.detail} />}
    </div>
  );
}
