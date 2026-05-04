import React, { useEffect, useState } from "react";

/**
 * Brief launch splash. Shown for ~1.2s on first mount, then fades out.
 * Sessionstorage gate prevents it from re-flashing on every navigation.
 */
export default function Splash() {
  const [show, setShow] = useState(() => {
    try {
      return sessionStorage.getItem("wordcat.splash") !== "1";
    } catch { return true; }
  });
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (!show) return undefined;
    const fadeTimer = setTimeout(() => setFading(true), 900);
    const hideTimer = setTimeout(() => {
      setShow(false);
      try { sessionStorage.setItem("wordcat.splash", "1"); } catch { /* ignore */ }
    }, 1500);
    return () => { clearTimeout(fadeTimer); clearTimeout(hideTimer); };
  }, [show]);

  if (!show) return null;
  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-stone-100 transition-opacity duration-500 ${fading ? "opacity-0 pointer-events-none" : "opacity-100"}`}
    >
      <img
        src="/logo.svg"
        alt="WordCat"
        className="max-w-[90vw] max-h-[80vh] drop-shadow-md"
        style={{ animation: "splash-pop 700ms ease-out" }}
      />
      <style>{`
        @keyframes splash-pop {
          0% { transform: scale(0.85); opacity: 0; }
          60% { transform: scale(1.03); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
