import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";

export default function MultiplayerLeaderboard() {
  const [entries, setEntries] = useState(null);
  const [includeProvisional, setIncludeProvisional] = useState(false);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    setBusy(true);
    api.get(`/api/leaderboard/multiplayer?include_provisional=${includeProvisional ? "true" : "false"}`)
      .then((r) => setEntries(r.entries || []))
      .catch((e) => setErr(e.message || "Failed to load"))
      .finally(() => setBusy(false));
  }, [includeProvisional]);

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <header className="flex items-center justify-between">
        <Link to="/" className="text-stone-600 hover:text-stone-900 text-sm">← Home</Link>
        <h1 className="text-2xl font-extrabold">Top Players</h1>
        <Link to="/lobby" className="text-stone-600 hover:text-stone-900 text-sm">Lobby →</Link>
      </header>

      <div className="flex items-center gap-2 text-sm">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={includeProvisional}
            onChange={(e) => setIncludeProvisional(e.target.checked)}
          />
          <span>Show provisional players</span>
        </label>
        <span className="text-xs text-stone-500">
          (provisional = fewer than 10 games played OR rating still uncertain)
        </span>
      </div>

      {err && <div className="text-rose-600 text-sm">{err}</div>}
      {busy && <div className="text-stone-500 italic">Loading…</div>}

      {!busy && entries && entries.length === 0 && (
        <div className="text-stone-500 italic text-center py-8">
          No ranked players yet — be the first!
        </div>
      )}

      {!busy && entries && entries.length > 0 && (
        <table className="w-full text-sm bg-white rounded-xl border border-stone-200 overflow-hidden">
          <thead className="bg-stone-100 text-xs uppercase text-stone-600">
            <tr>
              <th className="px-3 py-2 text-left w-12">#</th>
              <th className="px-3 py-2 text-left">Player</th>
              <th className="px-3 py-2 text-right">Tier</th>
              <th className="px-3 py-2 text-right w-20">Rating</th>
              <th className="px-3 py-2 text-right w-16">Games</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.rank} className="border-t border-stone-200">
                <td className="px-3 py-2 font-mono text-stone-500">{e.rank}</td>
                <td className="px-3 py-2 font-semibold">{e.name}</td>
                <td className="px-3 py-2 text-right">
                  <span
                    className="inline-block px-2 py-0.5 rounded-full text-xs font-bold"
                    style={{
                      background: e.color + "33",
                      border: `1.5px solid ${e.color}`,
                      color: e.color,
                    }}
                  >
                    {e.tier}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-bold">
                  {e.display_rating}{e.provisional ? "?" : ""}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-stone-500">{e.games_played}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
