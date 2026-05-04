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
  unauthorized: "Sign in or rejoin as a guest."
};
function reasonText(r) { return REJECTION_REASONS[r] || r || "Something went wrong"; }

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
  }, [lastEvent, state, yourSeat]);

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
          {state.status === "lobby" && (
            <>
              <InviteLinkButton code={code} />
              <button
                onClick={() => send("start")}
                disabled={(state.players || []).length < 2}
                className="w-full bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded py-2 disabled:opacity-40"
              >
                Start game
              </button>
              <div className="text-xs text-stone-500">
                Need 2+ players. Anyone can press start. Currently {(state.players || []).length} in.
              </div>
            </>
          )}
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
              <div className="text-stone-700 mt-1 text-sm">Reason: {state.finish_reason}</div>
              <div className="mt-3 grid gap-1 text-sm">
                {(state.players || []).slice().sort((a,b)=>b.score-a.score).map((p, i) => (
                  <div key={p.seat} className={`flex justify-between px-3 py-1 rounded ${i===0 ? "bg-amber-100 font-bold" : ""}`}>
                    <span>#{i+1} {p.name}</span><span className="tabular-nums">{p.score}</span>
                  </div>
                ))}
              </div>
              <Link to="/lobby" className="inline-block mt-3 underline text-stone-700">Back to lobby</Link>
            </div>
          ) : state.status === "lobby" ? (
            <div className="rounded-xl bg-white p-6 border border-stone-200 text-center text-stone-600">
              Waiting for the game to start…
            </div>
          ) : (
            <>
              {!cardDrawn ? (
                <>
                  {isMyTurn ? (
                    <>
                      <div className="text-stone-700">Your turn — pick a difficulty to draw a category card.</div>
                      <DifficultyPicker remaining={decksRemaining} onPick={(t)=>send("pick", { tier: t })} />
                      <div className="text-xs text-stone-500">Easy ×1, Medium ×1.5, Hard ×2.</div>
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
                  <Timer startedAt={state.turn_started_at} totalSeconds={state.turn_seconds} />

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
                          className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded font-semibold disabled:opacity-40">
                          Submit
                        </button>
                        <button
                          onClick={() => { send("skip"); setPicked([]); }}
                          className="bg-stone-300 hover:bg-stone-400 text-stone-900 px-4 py-2 rounded font-semibold">
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
            </>
          )}
        </section>
      </div>
    </div>
  );
}
