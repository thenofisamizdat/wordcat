import React, { useEffect, useState } from "react";

export default function Timer({ startedAt, totalSeconds, onExpire }) {
  const [now, setNow] = useState(Date.now() / 1000);

  useEffect(() => {
    if (!startedAt) return undefined;
    const id = setInterval(() => setNow(Date.now() / 1000), 200);
    return () => clearInterval(id);
  }, [startedAt]);

  if (!startedAt) {
    return <div className="text-stone-500 text-sm">Pick a difficulty to start the timer.</div>;
  }
  const elapsed = Math.max(0, now - startedAt);
  const remaining = Math.max(0, totalSeconds - elapsed);
  const pct = Math.max(0, Math.min(100, (remaining / totalSeconds) * 100));
  const seconds = Math.ceil(remaining);
  const mm = String(Math.floor(seconds / 60)).padStart(1, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  if (remaining === 0 && onExpire) onExpire();

  const barColor = pct > 50 ? "bg-emerald-500" : pct > 20 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div>
      <div className="flex justify-between text-xs text-stone-600 mb-1">
        <span>Time remaining</span>
        <span className="tabular-nums font-semibold">{mm}:{ss}</span>
      </div>
      <div className="h-2 bg-stone-200 rounded overflow-hidden">
        <div className={`h-full ${barColor} transition-all duration-200`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
