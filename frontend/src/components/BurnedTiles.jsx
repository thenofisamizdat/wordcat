import React from "react";

/**
 * Rack showing letters that have already been spent in successful submissions.
 * Letters appear red-tinted and dimmed to make it clear they're no longer
 * available in the shared pool.
 *
 * Props:
 *   counts:   { A: 3, E: 5, ... }  — discarded_counts from public_view
 *   values:   { A: 1, B: 4, ... }  — letter point values
 *   dudKey:   any value; change it to fire the dud animation on a single tile
 *   dudLetter: which burned letter to flash (e.g. "Z")
 *   onDud:    callback fired when the user clicks a burned tile (so the parent
 *             can play the dud sound and trigger the dudLetter flash)
 */
export default function BurnedTiles({ counts, values, dudKey, dudLetter, onDud }) {
  const letters = Object.keys(counts || {}).filter((L) => counts[L] > 0).sort();
  const total = letters.reduce((s, L) => s + counts[L], 0);

  return (
    <div className="sketch-panel mt-3" style={{ background: "#fbeaea", borderColor: "#9a3a3a" }}>
      <div className="text-xs uppercase tracking-wide text-rose-800 mb-2 flex items-center justify-between">
        <span>Burned tiles</span>
        <span className="tabular-nums opacity-80">{total} used</span>
      </div>
      {letters.length === 0 ? (
        <div className="text-rose-700/60 italic text-sm text-center py-1">
          No tiles burned yet.
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {letters.map((L) => {
            const isDud = dudLetter === L;
            return (
              <div
                key={L}
                className={`relative ${isDud ? "burned-dud" : ""}`}
                {...(isDud && dudKey ? { "data-dud-key": dudKey } : {})}
              >
                <button
                  type="button"
                  onClick={onDud ? () => onDud(L) : undefined}
                  className="w-10 h-10 inline-flex items-center justify-center font-hand rounded-md select-none relative"
                  title="This letter is used up"
                  style={{
                    background: "#f4b1ad",
                    color: "#5a1212",
                    border: "2px solid #7a2020",
                    boxShadow: "1px 2px 0 rgba(122,32,32,0.5)",
                    textDecoration: "line-through",
                    textDecorationThickness: "2px",
                    textDecorationColor: "rgba(90,18,18,0.85)",
                    opacity: 0.85,
                    cursor: onDud ? "not-allowed" : "default"
                  }}
                >
                  <span className="text-xl font-bold">{L}</span>
                  <span className="absolute bottom-0 right-1 text-[0.6rem] font-bold opacity-75">{values[L]}</span>
                </button>
                <span className="absolute -bottom-1 -right-1 bg-rose-800 text-white text-[0.6rem] rounded-full px-1.5 py-px tabular-nums">
                  {counts[L]}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
