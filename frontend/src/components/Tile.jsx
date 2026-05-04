import React from "react";

export default function Tile({ letter, value, size = "md", selected = false, dim = false, onClick }) {
  const sizes = {
    sm: "w-10 h-10 text-base",
    md: "w-12 h-12 text-xl",
    lg: "w-16 h-16 text-2xl"
  };
  const cls = [
    "relative inline-flex items-center justify-center font-hand select-none rounded-md",
    "bg-tile-face text-tile-ink",
    "transition-transform duration-100",
    onClick ? "cursor-pointer hover:-translate-y-0.5 active:translate-y-0" : "",
    selected ? "-translate-y-0.5" : "",
    dim ? "opacity-40" : "",
    sizes[size] || sizes.md
  ].join(" ");
  // Inline sketchy double-line look: dark border + offset shadow stroke.
  const styleSelected = selected ? { boxShadow: "2px 3px 0 rgba(31,20,8,0.85), 0 0 0 2px #a76a2e" } : {};
  return (
    <button
      type="button"
      disabled={!onClick}
      onClick={onClick}
      className={cls}
      style={{
        border: "2px solid #1f1408",
        boxShadow: "2px 3px 0 rgba(31,20,8,0.55)",
        ...styleSelected
      }}
    >
      <span className="text-xl font-bold" style={{ fontFamily: '"Patrick Hand", "Marker Felt", sans-serif' }}>{letter}</span>
      {value !== undefined && (
        <span className="absolute bottom-0 right-1 text-[0.6rem] font-bold opacity-75">{value}</span>
      )}
    </button>
  );
}
