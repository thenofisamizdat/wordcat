import React from "react";

/**
 * Daily-puzzle streak badge. Shows the current streak with loss-aversion
 * framing once a streak exists.
 *
 * Props:
 *   current — current streak (int)
 *   best    — best streak (int)
 *   played  — whether today's puzzle is already finished (changes the copy)
 */
export default function StreakBadge({ current = 0, best = 0, played = false }) {
  if (!current && !best) {
    return (
      <div className="text-sm text-stone-600">
        Solve today's puzzle to start a <span className="font-semibold">🔥 streak</span>.
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="inline-flex items-center gap-1 font-bold text-amber-700">
        🔥 {current}-day streak
      </span>
      {best > current && <span className="text-stone-500">best {best}</span>}
      {played && current > 0 && (
        <span className="text-stone-500">— come back tomorrow to keep it going!</span>
      )}
    </div>
  );
}
