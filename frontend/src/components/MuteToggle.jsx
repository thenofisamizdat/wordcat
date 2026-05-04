import React, { useEffect, useState } from "react";
import { isMuted, toggleMuted } from "../sounds.js";

/**
 * Tiny floating sound on/off toggle. Sits in the top-right corner, fixed,
 * above the page. Persists choice to localStorage via the sounds module.
 */
export default function MuteToggle() {
  const [muted, setMuted] = useState(() => isMuted());

  useEffect(() => {
    const handler = () => setMuted(isMuted());
    window.addEventListener("wordcat:muted", handler);
    return () => window.removeEventListener("wordcat:muted", handler);
  }, []);

  return (
    <button
      type="button"
      onClick={() => setMuted(toggleMuted())}
      title={muted ? "Sound off — click to unmute" : "Sound on — click to mute"}
      aria-label={muted ? "Unmute" : "Mute"}
      className="fixed top-3 right-3 z-50 sketch-pill text-base"
      style={{ padding: "4px 10px", fontSize: "1.1rem" }}
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}
