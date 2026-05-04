import React, { useEffect, useState } from "react";

/**
 * Overall game timer (whole-run clock). Renders a horizontal bar and a M:SS
 * countdown. Starts from `startedAt` (epoch seconds) and counts down `total`
 * seconds.
 *
 * Props:
 *   startedAt — epoch seconds when the run began
 *   total     — total run seconds (eg 300 for 5 min)
 */
export default function OverallTimer({ startedAt, total }) {
  const [now, setNow] = useState(Date.now() / 1000);

  useEffect(() => {
    if (!startedAt || !total) return undefined;
    const id = setInterval(() => setNow(Date.now() / 1000), 250);
    return () => clearInterval(id);
  }, [startedAt, total]);

  if (!startedAt || !total) return null;

  const elapsed = Math.max(0, now - startedAt);
  const remaining = Math.max(0, total - elapsed);
  const pct = Math.max(0, Math.min(100, (remaining / total) * 100));
  const seconds = Math.ceil(remaining);
  const mm = Math.floor(seconds / 60);
  const ss = String(seconds % 60).padStart(2, "0");

  const color = pct > 50 ? "#3a9a55" : pct > 20 ? "#d68a2a" : "#c4453a";

  return (
    <div className="sketch-panel" style={{ background: "#fff8e8" }}>
      <div className="flex justify-between text-sm font-hand">
        <span>Overall time</span>
        <span className="tabular-nums font-bold">{mm}:{ss}</span>
      </div>
      <div className="mt-1 h-3 rounded overflow-hidden" style={{ background: "#e6d6a8", border: "1.5px solid #1f1408" }}>
        <div
          className="h-full transition-all duration-300"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}
