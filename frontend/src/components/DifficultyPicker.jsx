import React from "react";
import { play } from "../sounds.js";

const TIERS = [
  { id: "easy", label: "Easy", mult: "×1", colors: "bg-emerald-500 hover:bg-emerald-600" },
  { id: "medium", label: "Medium", mult: "×1.5", colors: "bg-amber-500 hover:bg-amber-600" },
  { id: "hard", label: "Hard", mult: "×2", colors: "bg-rose-500 hover:bg-rose-600" }
];

export default function DifficultyPicker({ remaining, onPick, disabled }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {TIERS.map((t) => {
        const left = (remaining && remaining[t.id]) ?? 0;
        const isOut = left === 0;
        return (
          <button
            key={t.id}
            type="button"
            disabled={disabled || isOut}
            onClick={() => { play("draw"); onPick(t.id); }}
            className={`text-white rounded-xl py-3 px-4 font-semibold shadow disabled:opacity-40 disabled:cursor-not-allowed ${t.colors}`}
          >
            <div className="text-lg">{t.label}</div>
            <div className="text-xs opacity-90">{t.mult} score</div>
            <div className="text-[0.65rem] opacity-80 mt-1">{left} cards left</div>
          </button>
        );
      })}
    </div>
  );
}
