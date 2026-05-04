import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { api } from "../api/client.js";
import { useAuth } from "../hooks/useAuth.js";
import { useGameSocket } from "../hooks/useGameSocket.js";
import TilePool from "../components/TilePool.jsx";
import WordTray from "../components/WordTray.jsx";
import CategoryCard from "../components/CategoryCard.jsx";
import DifficultyPicker from "../components/DifficultyPicker.jsx";
import Timer from "../components/Timer.jsx";
import OverallTimer from "../components/OverallTimer.jsx";
import BurnedTiles from "../components/BurnedTiles.jsx";
import ResultToast from "../components/ResultToast.jsx";
import PlayerList from "../components/PlayerList.jsx";
import InviteLinkButton from "../components/InviteLinkButton.jsx";
import { play } from "../sounds.js";

const REJECTION_REASONS = {
  not_in_dict: "Not in the dictionary.",
  not_in_category: "Doesn't fit the category.",
  letters_unavailable: "You don't have those letters.",
  not_your_turn: "Not your turn.",
  no_card: "Pick a difficulty first.",
  card_already_drawn: "Card already drawn.",
  bad_tier: "Invalid difficulty.",
  deck_empty: "That tier has no cards left.",
  game_finished: "Game's over.",
  not_active: "Game hasn't started.",
  not_host: "Only the host can do that.",
  need_two_players: "Need at least 2 players.",
  already_started: "Game already started.",
  not_in_game: "You haven't joined this game.",
  not_found: "Game not found.",
  unauthorized: "Sign in or rejoin as a guest.",
  no_words_possible: "No playable words for those cards — turn skipped.",
  time_up: "Time's up!"
};
const FINISH_REASON_TEXT = {
  pool_empty: "The shared pool is empty.",
  decks_empty: "All category decks are exhausted.",
  all_skipped: "All players skipped.",
  pool_exhausted: "Nobody can play anything from what's left.",
  time_up: "Time's up!",
};
function reasonText(r) { return REJECTION_REASONS[r] || r || "Something went wrong"; }
function finishText(r) { return FINISH_REASON_TEXT[r] || r || ""; }

export default function GameRoom() {
  const { code } = useParams();
  const { isAuthed, name } = useAuth();
  const [yourSeat, setYourSeat] = useState(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState(null);
  const [picked, setPicked] = useState([]);
  const [flash, setFlash] = useState(null);
  const [scoreBumpKey, setScoreBumpKey] = useState(0);  // bumps when MY score changes
  const [floater, setFloater] = useState(null);          // floating +N over my score
  const [shakeKey, setShakeKey] = useState(0);           // shake my tray on rejection
  const [countdownEndsAt, setCountdownEndsAt] = useState(null);  // epoch ms; null when no countdown
  const [countdownNow, setCountdownNow] = useState(Date.now());
  const [ratingChanges, setRatingChanges] = useState(null); // [{seat, name, display_before, display_after, delta, ...}]
  const [toast, setToast] = useState(null);              // {token, kind, detail} for ResultToast
  const [dud, setDud] = useState(null);                  // {letter, key} for burned-tile flash

  // 1. Ensure we've joined this game (REST). useGameSocket then connects.
  useEffect(() => {
    if (!isAuthed || !code) return;
    let aborted = false;
    setJoining(true);
    api.post(`/api/games/${code}/join`, {})
      .then((r) => { if (!aborted) setYourSeat(r.seat); })
      .catch((e) => { if (!aborted) setJoinError(reasonText(e.message)); })
      .finally(() => { if (!aborted) setJoining(false); });
    return () => { aborted = true; };
  }, [isAuthed, code]);

  const enabled = !!yourSeat || yourSeat === 0;
  const { state, letterValues, lastEvent, lastError, status, send } = useGameSocket(code, { enabled });

  // Surface server rejections / events as a transient flash bar.
  useEffect(() => {
    if (!lastError) return;
    if (lastError.kind === "submit") {
      play("reject");
      setShakeKey((k) => k + 1);
      setToast({ token: Date.now(), kind: "bad", detail: reasonText(lastError.reason) });
    }
    setFlash({ kind: "bad", text: reasonText(lastError.reason) });
    const id = setTimeout(() => setFlash(null), 3000);
    return () => clearTimeout(id);
  }, [lastError]);
  useEffect(() => {
    if (!lastEvent) return;
    if (lastEvent.type === "word_accepted") {
      play("accept");
      setFlash({ kind: "good", text: `${state?.players?.[lastEvent.seat]?.name || "Player"} +${lastEvent.points} for ${lastEvent.word}` });
      setToast({ token: Date.now(), kind: "good",
                 detail: `${state?.players?.[lastEvent.seat]?.name || "Player"} +${lastEvent.points} for ${lastEvent.word}` });
      // If it was our seat, clear tray + animate.
      if (lastEvent.seat === yourSeat) {
        setPicked([]);
        setScoreBumpKey((k) => k + 1);
        setFloater({ points: lastEvent.points, key: Date.now() });
        setTimeout(() => setFloater(null), 1100);
      }
      const id = setTimeout(() => setFlash(null), 2500);
      return () => clearTimeout(id);
    }
    if (lastEvent.type === "card_drawn" && (lastEvent.redraws || []).length > 0) {
      // The pick produced a playable card, but only after one or more
      // unplayable cards were auto-redrawn from the same tier.
      const n = lastEvent.redraws.length;
      setFlash({ kind: "neutral",
                 text: `No words possible from ${n} card${n > 1 ? "s" : ""} — drew another.` });
      const id = setTimeout(() => setFlash(null), 2500);
      return () => clearTimeout(id);
    }
    if (lastEvent.type === "card_unplayable") {
      // The pick exhausted the redraw budget — turn skipped.
      play("timeout");
      const who = state?.players?.[lastEvent.seat]?.name || "Player";
      setFlash({ kind: "bad",
                 text: `${who}: no playable cards — turn skipped.` });
      if (lastEvent.seat === yourSeat) setPicked([]);
      const id = setTimeout(() => setFlash(null), 3000);
      return () => clearTimeout(id);
    }
    if (lastEvent.type === "turn_timeout") {
      play("timeout");
      setFlash({ kind: "bad", text: "Time's up — turn skipped." });
      if (lastEvent.seat === yourSeat || state?.current_seat !== yourSeat) setPicked([]);
      const id = setTimeout(() => setFlash(null), 2500);
      return () => clearTimeout(id);
    }
    if (lastEvent.type === "skipped") {
      play("click");
      setFlash({ kind: "neutral", text: `${state?.players?.[lastEvent.seat]?.name || "Player"} skipped.` });
      const id = setTimeout(() => setFlash(null), 2000);
      return () => clearTimeout(id);
    }
    if (lastEvent.type === "countdown_started") {
      const seconds = Number(lastEvent.seconds || 10);
      setCountdownEndsAt(Date.now() + seconds * 1000);
      return undefined;
    }
    if (lastEvent.type === "game_finished" && lastEvent.rating_changes) {
      // Stash the rating changes so the game-over panel can render them per player.
      setRatingChanges(lastEvent.rating_changes);
      return undefined;
    }
    if (lastEvent.type === "countdown_cancelled") {
      setCountdownEndsAt(null);
      return undefined;
    }
    if (lastEvent.type === "game_started") {
      setCountdownEndsAt(null);
      return undefined;
    }
  }, [lastEvent, state, yourSeat]);

  // Tick the countdown display once per 200ms while a countdown is running.
  useEffect(() => {
    if (countdownEndsAt === null) return undefined;
    const id = setInterval(() => {
      const now = Date.now();
      setCountdownNow(now);
      if (now >= countdownEndsAt) setCountdownEndsAt(null);
    }, 200);
    return () => clearInterval(id);
  }, [countdownEndsAt]);

  // Game-over jingle (fires once when game finishes)
  const gameoverPlayedRef = React.useRef(false);
  useEffect(() => {
    if (state?.finished && !gameoverPlayedRef.current) {
      gameoverPlayedRef.current = true;
      play("gameover");
    }
    if (state && !state.finished) gameoverPlayedRef.current = false;
  }, [state?.finished]);

  const onPickLetter = useCallback((L) => setPicked((p) => [...p, L]), []);
  const onRemoveAt = useCallback((idx) => setPicked((p) => p.filter((_, i) => i !== idx)), []);
  const onClear = useCallback(() => setPicked([]), []);

  // Trigger the burned-letter "dud" feedback (sound + flashing rack tile).
  const fireDud = useCallback((L) => {
    play("dud");
    setDud({ letter: L, key: Date.now() });
    setTimeout(() => setDud((d) => (d && d.letter === L ? null : d)), 520);
  }, []);

  // Keyboard input — parity with SoloPlay. Only active during the player's
  // own turn with a card drawn.
  useEffect(() => {
    if (!state || state.finished) return undefined;
    const cardOpen = !!state.current_card_id;
    const myTurnNow = state.current_seat === yourSeat;
    if (!myTurnNow) return undefined;
    const onKey = (e) => {
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || e.target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "Enter") {
        if (cardOpen && picked.length > 0) {
          e.preventDefault();
          send("submit", { word: picked.join("") });
        }
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
      if (!cardOpen) return;
      if (e.key.length === 1 && /^[a-zA-Z]$/.test(e.key)) {
        const L = e.key.toUpperCase();
        const poolCount = (state.pool_counts || {})[L] || 0;
        const usedInTray = picked.filter((p) => p === L).length;
        const burnedCount = (state.discarded_counts || {})[L] || 0;
        if (poolCount - usedInTray > 0) {
          e.preventDefault();
          play("tile");
          setPicked((p) => [...p, L]);
        } else if (burnedCount > 0) {
          e.preventDefault();
          fireDud(L);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, picked, yourSeat, send, onClear, fireDud]);

  const isMyTurn = state && yourSeat === state.current_seat;
  const cardDrawn = state && state.current_card_id;

  const liveScore = useMemo(() => {
    if (!state || !cardDrawn) return 0;
    const mult = state.difficulty_multipliers?.[state.current_difficulty] ?? 1;
    const base = picked.reduce((s, L) => s + (letterValues[L] || 0), 0);
    return Math.round(base * mult);
  }, [state, picked, cardDrawn, letterValues]);

  if (!isAuthed) return <Navigate to="/" replace />;

  if (joining) return <div className="p-6 text-stone-500">Joining game…</div>;
  if (joinError) return (
    <div className="max-w-xl mx-auto p-6 space-y-3">
      <div className="rounded-xl bg-rose-50 border border-rose-200 p-4">{joinError}</div>
      <Link to="/lobby" className="underline text-stone-700">Back to lobby</Link>
    </div>
  );
  if (!state) {
    return <div className="p-6 text-stone-500">Connecting… ({status})</div>;
  }

  const decksRemaining = state.decks_remaining || { easy: 0, medium: 0, hard: 0 };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
      <header className="flex items-center justify-between gap-3">
        <Link to="/lobby" className="text-stone-600 hover:text-stone-900 text-sm">← Lobby</Link>
        <h1 className="text-xl sm:text-2xl font-extrabold">
          Game <span className="font-mono tracking-widest">{code}</span>
        </h1>
        <div className="text-xs">
          <span className={`inline-block w-2 h-2 rounded-full mr-1 ${status === "open" ? "bg-emerald-500" : "bg-amber-500"}`} />
          {status === "open" ? "live" : status}
        </div>
      </header>

      <div className="grid sm:grid-cols-3 gap-4">
        {/* Left: scoreboard / players */}
        <aside className="sm:col-span-1 space-y-3">
          <PlayerList players={state.players || []} currentSeat={state.current_seat} yourSeat={yourSeat} bumpKey={scoreBumpKey} floater={floater} />
          {state.status === "lobby" && (() => {
            const playerCount = (state.players || []).length;
            const minPlayers = state.min_players || 2;
            const meetsMin = playerCount >= minPlayers;
            const countdownSeconds = countdownEndsAt
              ? Math.max(0, Math.ceil((countdownEndsAt - countdownNow) / 1000))
              : null;
            return (
              <>
                <InviteLinkButton code={code} />
                <button
                  onClick={() => send("start")}
                  disabled={!meetsMin}
                  className="w-full bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded py-2 disabled:opacity-40"
                >
                  {countdownSeconds !== null
                    ? `Start now (${countdownSeconds}s left)`
                    : meetsMin ? "Start game" : `Waiting for ${minPlayers - playerCount} more`}
                </button>
                <div className="text-xs text-stone-500">
                  {playerCount}/{state.max_players || "?"} players · need {minPlayers} to start.
                </div>
                {countdownSeconds !== null && (
                  <div className="bg-emerald-50 border-2 border-emerald-300 rounded-lg p-3 text-center">
                    <div className="text-xs uppercase tracking-wider text-emerald-700">Auto-starting</div>
                    <div className="text-3xl font-extrabold text-emerald-800 tabular-nums">{countdownSeconds}s</div>
                  </div>
                )}
              </>
            );
          })()}
          <div className="text-xs text-stone-600 bg-white rounded-lg p-2 border">
            Tiles in pool: <span className="font-semibold tabular-nums">{state.pool_total}</span><br/>
            Decks left: E {decksRemaining.easy} · M {decksRemaining.medium} · H {decksRemaining.hard}<br/>
            Skips this round: <span className="tabular-nums">{state.consecutive_skips}</span>
          </div>
        </aside>

        {/* Right: play area */}
        <section className="sm:col-span-2 space-y-3">
          {state.finished ? (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-5 text-center">
              <div className="text-emerald-900 font-bold text-xl">Game over!</div>
              <div className="text-stone-700 mt-1 text-sm">{finishText(state.finish_reason)}</div>
              <div className="mt-3 grid gap-1 text-sm">
                {(state.players || []).slice().sort((a,b)=>b.score-a.score).map((p, i) => {
                  const rc = (ratingChanges || []).find(c => c.seat === p.seat);
                  return (
                    <div key={p.seat} className={`flex items-center justify-between px-3 py-1 rounded ${i===0 ? "bg-amber-100 font-bold" : ""}`}>
                      <span>#{i+1} {p.name}</span>
                      <span className="flex items-center gap-2">
                        {rc && (
                          <span
                            className={`text-xs font-bold tabular-nums ${rc.delta > 0 ? "text-emerald-700" : rc.delta < 0 ? "text-rose-700" : "text-stone-500"}`}
                            title={`${rc.display_before} → ${rc.display_after}`}
                          >
                            {rc.delta > 0 ? "+" : ""}{rc.delta}
                          </span>
                        )}
                        <span className="tabular-nums">{p.score}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
              {ratingChanges && ratingChanges.length > 0 && (
                <div className="text-xs text-stone-500 mt-2">Ratings updated.</div>
              )}
              <div className="mt-3 flex gap-2 justify-center">
                <Link to="/lobby" className="underline text-stone-700">Back to lobby</Link>
                <span className="text-stone-400">·</span>
                <Link to="/multiplayer-leaderboard" className="underline text-stone-700">Top players</Link>
              </div>
            </div>
          ) : state.status === "lobby" ? (
            <div className="rounded-xl bg-white p-6 border border-stone-200 text-center text-stone-600">
              Waiting for the game to start…
            </div>
          ) : (
            <>
              {/* Overall game clock — always visible during active play. */}
              {state.overall_seconds > 0 && state.started_at && (
                <OverallTimer startedAt={state.started_at} total={state.overall_seconds} />
              )}

              {/* Per-turn clock — single-clock model: covers BOTH the pick
                  and the submit phase. Visible whenever there's a current seat. */}
              {state.turn_started_at && (
                <Timer startedAt={state.turn_started_at} totalSeconds={state.turn_seconds} />
              )}

              {!cardDrawn ? (
                <>
                  {isMyTurn ? (
                    <>
                      <div className="text-stone-700">Your turn — pick a difficulty to draw a category card.</div>
                      <DifficultyPicker remaining={decksRemaining} onPick={(t)=>send("pick", { tier: t })} />
                      <div className="text-xs text-stone-500">
                        Easy ×1, Medium ×1.5, Hard ×2. The clock above ticks for picking AND playing.
                      </div>
                    </>
                  ) : (
                    <div className="rounded-xl bg-stone-100 p-6 text-center text-stone-700">
                      Waiting for {state.players?.[state.current_seat]?.name || "the next player"} to pick a difficulty…
                    </div>
                  )}
                </>
              ) : (
                <>
                  <CategoryCard card={state.current_card} />

                  {isMyTurn ? (
                    <>
                      <div key={shakeKey} className={shakeKey ? "shake" : ""}>
                        <WordTray letters={picked} values={letterValues} onRemoveAt={onRemoveAt} onClear={picked.length ? onClear : null} />
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-sm">
                        <div className="flex-1 min-w-[10rem]">
                          <span className="text-stone-500">Word:&nbsp;</span>
                          <span className="font-bold tracking-wide">{picked.join("") || "—"}</span>
                        </div>
                        <div>
                          <span className="text-stone-500">Live points:&nbsp;</span>
                          <span className="font-bold tabular-nums">{liveScore}</span>
                        </div>
                        <button
                          onClick={() => { send("submit", { word: picked.join("") }); }}
                          disabled={picked.length === 0}
                          className="play-tile play-tile-good"
                          title="Submit (Enter)">
                          Submit
                        </button>
                        <button
                          onClick={() => { send("skip"); setPicked([]); }}
                          className="play-tile">
                          Skip
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-xl bg-stone-100 p-6 text-center text-stone-700">
                      Waiting for <span className="font-semibold">{state.players?.[state.current_seat]?.name || "player"}</span> to play…
                    </div>
                  )}

                  {flash && (
                    <div className={`rounded p-2 text-sm ${
                      flash.kind === "good" ? "bg-emerald-100 text-emerald-900" :
                      flash.kind === "bad" ? "bg-rose-100 text-rose-900" :
                      "bg-stone-100 text-stone-800"
                    }`}>{flash.text}</div>
                  )}
                </>
              )}

              {/* Tile pool is always visible during active play. Tiles are only
                  clickable when it's our turn AND a card has been drawn. */}
              <TilePool
                counts={state.pool_counts}
                values={letterValues}
                onPick={isMyTurn && cardDrawn ? onPickLetter : undefined}
                picked={picked}
              />

              {/* Burned-tile rack: red-tinted dimmed tiles for everything spent. */}
              <BurnedTiles
                counts={state.discarded_counts || {}}
                values={letterValues}
                dudKey={dud?.key}
                dudLetter={dud?.letter}
                onDud={isMyTurn && cardDrawn ? (L) => fireDud(L) : undefined}
              />
            </>
          )}
        </section>
      </div>

      {toast && <ResultToast token={toast.token} kind={toast.kind} detail={toast.detail} />}
    </div>
  );
}
