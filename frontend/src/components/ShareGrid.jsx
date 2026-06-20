import React, { useState } from "react";

const EMOJI = {
  optimal: "🟩",
  good: "🟨",
  weak: "⬜",
  skip: "⬛",
};

/**
 * Spoiler-free share grid + copy button — the growth engine. Renders the
 * day's result as an emoji row and copies the ready-made share text (provided
 * by the backend) to the clipboard, with an execCommand fallback for plain
 * HTTP / older browsers (matching the pattern used elsewhere in the app).
 *
 * Props:
 *   grid       — array of tiers ["optimal","good","weak","skip",...]
 *   shareText  — full ready-to-copy string from the backend
 */
export default function ShareGrid({ grid = [], shareText = "" }) {
  const [copied, setCopied] = useState(false);

  const squares = grid.map((g) => EMOJI[g] || EMOJI.skip).join("");

  async function copy() {
    const text = shareText || squares;
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // Fallback for non-secure contexts / older browsers.
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } else {
      window.prompt("Copy your result:", text);
    }
  }

  return (
    <div className="space-y-3 text-center">
      <div className="text-3xl tracking-widest select-none" aria-label="result grid">
        {squares}
      </div>
      <button
        onClick={copy}
        className="bg-sky-600 hover:bg-sky-700 text-white px-5 py-2 rounded-lg font-semibold"
      >
        {copied ? "Copied!" : "Share result"}
      </button>
    </div>
  );
}
