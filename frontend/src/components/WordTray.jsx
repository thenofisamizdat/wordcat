import React from "react";
import Tile from "./Tile.jsx";
import { play } from "../sounds.js";

export default function WordTray({ letters, values, onRemoveAt, onClear }) {
  return (
    <div className="rounded-xl bg-amber-50 p-3 border-2 border-dashed border-amber-300 min-h-[5rem] flex items-center">
      {letters.length === 0 ? (
        <div className="text-amber-700/70 italic w-full text-center text-sm">
          Pick letters from the pool to spell a word
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5 items-center w-full">
          {letters.map((L, idx) => (
            <span key={`${idx}-${L}`} className="tile-pop inline-block">
              <Tile
                letter={L}
                value={values[L]}
                size="md"
                onClick={onRemoveAt ? () => { play("untile"); onRemoveAt(idx); } : undefined}
              />
            </span>
          ))}
          {onClear && (
            <button
              type="button"
              onClick={() => { play("click"); onClear(); }}
              className="ml-auto text-xs text-amber-700 underline hover:text-amber-900"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
