import React from "react";

const tierStyle = {
  easy: "bg-emerald-100 border-emerald-400 text-emerald-900",
  medium: "bg-amber-100 border-amber-400 text-amber-900",
  hard: "bg-rose-100 border-rose-400 text-rose-900"
};

const tierLabel = { easy: "Easy ×1", medium: "Medium ×1.5", hard: "Hard ×2" };

export default function CategoryCard({ card }) {
  if (!card) return null;
  const t = card.difficulty;
  return (
    <div key={card.id} className={`card-flip rounded-xl border-2 p-5 shadow-md ${tierStyle[t] || ""}`}>
      <div className="text-xs font-semibold uppercase tracking-wider opacity-70">{tierLabel[t]}</div>
      <div className="text-3xl font-extrabold mt-1">{card.name}</div>
    </div>
  );
}
