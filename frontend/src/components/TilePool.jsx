import React from "react";
import Tile from "./Tile.jsx";
import { play } from "../sounds.js";

export default function TilePool({ counts, values, onPick, picked }) {
  const letters = Object.keys(counts).sort();
  // Build a flat list of tile slots; account for picks (so user sees only remaining).
  const remaining = { ...counts };
  for (const p of picked || []) {
    remaining[p] = (remaining[p] || 0) - 1;
  }
  return (
    <div className="rounded-xl bg-stone-200/60 p-3 shadow-inner">
      <div className="text-xs uppercase tracking-wide text-stone-500 mb-2">Shared Pool</div>
      <div className="flex flex-wrap gap-1.5">
        {letters.map((L) => {
          const left = Math.max(0, remaining[L] || 0);
          if ((counts[L] || 0) === 0) return null;
          return (
            <div key={L} className="relative">
              <Tile
                letter={L}
                value={values[L]}
                size="sm"
                dim={left === 0}
                onClick={left > 0 && onPick ? () => { play("tile"); onPick(L); } : undefined}
              />
              <span className="absolute -bottom-1 -right-1 bg-stone-700 text-white text-[0.6rem] rounded-full px-1.5 py-px tabular-nums">
                {left}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
