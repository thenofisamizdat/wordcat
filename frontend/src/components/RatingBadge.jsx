import React from "react";

/**
 * Tier-coloured pill showing a player's display rating.
 *
 * Props:
 *   rating: { display, tier, color, provisional, games_played, mu, sigma }
 *   size:   "sm" | "md"  (default "sm")
 *   showTier: boolean (default true) — also show the tier name before the number
 */
export default function RatingBadge({ rating, size = "sm", showTier = true }) {
  if (!rating) return null;
  const padding = size === "md" ? "px-2.5 py-1 text-sm" : "px-2 py-0.5 text-xs";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-semibold ${padding}`}
      style={{
        background: rating.color + "33",      // 20% alpha tint
        border: `1.5px solid ${rating.color}`,
        color: "#1f1408",
      }}
      title={`${rating.tier} · ${rating.display}${rating.provisional ? " (provisional)" : ""} · μ=${rating.mu.toFixed(1)} σ=${rating.sigma.toFixed(2)} · ${rating.games_played} game${rating.games_played === 1 ? "" : "s"}`}
    >
      {showTier && (
        <span style={{ color: rating.color, fontWeight: 700 }}>{rating.tier}</span>
      )}
      <span className="tabular-nums">
        {rating.display}{rating.provisional ? "?" : ""}
      </span>
    </span>
  );
}
