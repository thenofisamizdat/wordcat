import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import { useAuth } from "../hooks/useAuth.js";

export default function Lobby() {
  const { isAuthed, name, isGuest, logout } = useAuth();
  const nav = useNavigate();
  const [games, setGames] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [turnSeconds, setTurnSeconds] = useState(180);
  const [joinCode, setJoinCode] = useState("");

  const refresh = useCallback(async () => {
    try {
      const r = await api.get("/api/games?status_filter=lobby");
      setGames(r.games || []);
    } catch (e) { setError(e.message); }
  }, []);

  useEffect(() => {
    if (!isAuthed) return;
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [isAuthed, refresh]);

  const create = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.post("/api/games", {
        max_players: Number(maxPlayers),
        turn_seconds: Number(turnSeconds),
      });
      nav(`/game/${r.code}`);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }, [maxPlayers, turnSeconds, nav]);

  const join = useCallback(async (code) => {
    setBusy(true); setError(null);
    try {
      const r = await api.post(`/api/games/${code.toUpperCase()}/join`, {});
      nav(`/game/${r.code}`);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }, [nav]);

  if (!isAuthed) return <div className="p-6"><Link to="/" className="underline">Sign in to play multiplayer</Link></div>;

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <Link to="/" className="text-stone-600 hover:text-stone-900 text-sm">← Home</Link>
        <h1 className="text-2xl font-extrabold">Multiplayer Lobby</h1>
        <div className="text-right text-xs">
          {name} {isGuest && <span className="text-stone-500">(guest)</span>}
          <button onClick={logout} className="block ml-auto underline text-stone-500">sign out</button>
        </div>
      </header>

      <section className="bg-white rounded-xl border border-stone-200 p-4 shadow-sm space-y-3">
        <h2 className="font-semibold">Create a new game</h2>
        <div className="flex flex-wrap gap-3 items-end">
          <label className="text-sm">
            <div className="text-xs text-stone-500">Max players</div>
            <select value={maxPlayers} onChange={e=>setMaxPlayers(e.target.value)} className="border rounded px-2 py-1">
              {[2,3,4,5,6].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <div className="text-xs text-stone-500">Turn time</div>
            <select value={turnSeconds} onChange={e=>setTurnSeconds(e.target.value)} className="border rounded px-2 py-1">
              <option value={60}>1 min</option>
              <option value={120}>2 min</option>
              <option value={180}>3 min</option>
              <option value={300}>5 min</option>
            </select>
          </label>
          <button onClick={create} disabled={busy}
            className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded font-semibold disabled:opacity-40">
            Create &amp; share invite
          </button>
        </div>
      </section>

      <section className="bg-white rounded-xl border border-stone-200 p-4 shadow-sm space-y-3">
        <h2 className="font-semibold">Join by code</h2>
        <div className="flex gap-2">
          <input value={joinCode} onChange={e=>setJoinCode(e.target.value)}
            placeholder="ABC123"
            maxLength={6}
            className="border rounded px-3 py-2 uppercase tracking-widest font-mono w-32" />
          <button onClick={()=>joinCode && join(joinCode)} disabled={busy || !joinCode}
            className="bg-stone-800 hover:bg-stone-900 text-white px-4 py-2 rounded font-semibold disabled:opacity-40">
            Join
          </button>
        </div>
      </section>

      <section>
        <h2 className="font-semibold mb-2">Open games</h2>
        {games.length === 0 ? (
          <div className="text-stone-500 italic">No open games right now. Create one!</div>
        ) : (
          <ul className="space-y-2">
            {games.map(g => (
              <li key={g.code} className="bg-white rounded-xl border border-stone-200 p-3 flex items-center justify-between">
                <div>
                  <div className="font-mono text-lg font-bold tracking-widest">{g.code}</div>
                  <div className="text-xs text-stone-500">
                    Host: {g.host_name} · {g.players.length}/{g.max_players} players · {g.turn_seconds}s turns
                  </div>
                </div>
                <button onClick={()=>join(g.code)} disabled={busy || g.players.length >= g.max_players}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1 rounded text-sm font-semibold disabled:opacity-40">
                  {g.players.length >= g.max_players ? "Full" : "Join"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {error && <div className="text-rose-600 text-sm">{error}</div>}
    </div>
  );
}
