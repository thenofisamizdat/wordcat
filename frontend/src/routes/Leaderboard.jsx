import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";

export default function Leaderboard({ endpoint = "/api/leaderboard/daily", title = "Daily Leaderboard" }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setBusy(true);
    api.get(`${endpoint}?date=${date}`).then(setData).finally(() => setBusy(false));
  }, [date, endpoint]);

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <Link to="/" className="text-stone-600 hover:text-stone-900 text-sm">← Home</Link>
        <h1 className="text-2xl font-extrabold">{title}</h1>
        <input type="date" value={date} onChange={e=>setDate(e.target.value)}
          className="border rounded px-2 py-1 text-sm" />
      </div>
      {busy && <div className="text-stone-500">Loading…</div>}
      {data && data.entries.length === 0 && (
        <div className="text-stone-500 italic">Nobody has played yet on {data.date}.</div>
      )}
      {data && data.entries.length > 0 && (
        <table className="w-full bg-white rounded-xl border border-stone-200 overflow-hidden">
          <thead className="bg-stone-100 text-stone-600 text-xs uppercase">
            <tr>
              <th className="text-left px-3 py-2 w-12">#</th>
              <th className="text-left px-3 py-2">Player</th>
              <th className="text-right px-3 py-2 w-20">Score</th>
              <th className="text-right px-3 py-2 w-24">Time</th>
              <th className="text-right px-3 py-2 w-20">Done</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map(e => (
              <tr key={e.rank} className="border-t border-stone-100">
                <td className="px-3 py-2 tabular-nums">{e.rank}</td>
                <td className="px-3 py-2 font-medium">{e.name}</td>
                <td className="px-3 py-2 text-right tabular-nums font-bold">{e.score}</td>
                <td className="px-3 py-2 text-right tabular-nums text-stone-500">{Math.floor(e.duration_s/60)}:{String(e.duration_s%60).padStart(2,"0")}</td>
                <td className="px-3 py-2 text-right">{e.finished ? "✓" : "…"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
