import React from "react";
import RatingBadge from "./RatingBadge.jsx";

export default function PlayerList({ players, currentSeat, yourSeat, bumpKey, floater }) {
  return (
    <ul className="space-y-1">
      {players.map((p) => {
        const isCurrent = currentSeat === p.seat;
        const isYou = yourSeat === p.seat;
        return (
          <li
            key={p.seat}
            className={`flex items-center justify-between rounded-lg px-3 py-2 border ${
              isCurrent ? "bg-amber-100 border-amber-300" : "bg-white border-stone-200"
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className={`inline-block w-2 h-2 rounded-full ${p.connected ? "bg-emerald-500" : "bg-stone-300"}`} />
              <span className="font-medium truncate">{p.name}{isYou && <span className="text-stone-500 font-normal text-xs"> (you)</span>}</span>
              {p.rating && <RatingBadge rating={p.rating} size="sm" showTier={false} />}
              {p.is_guest && <span className="text-[0.65rem] uppercase text-stone-500">guest</span>}
              {isCurrent && <span className="text-[0.65rem] uppercase text-amber-700 font-semibold">turn</span>}
            </div>
            <div className="font-bold tabular-nums relative">
              {isYou && bumpKey ? (
                <span key={bumpKey} className="inline-block score-bump">{p.score}</span>
              ) : (
                <span>{p.score}</span>
              )}
              {isYou && floater && (
                <span key={floater.key} className="absolute -top-1 right-0 text-emerald-600 font-extrabold float-up pointer-events-none">
                  +{floater.points}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
