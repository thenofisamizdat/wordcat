import React, { useEffect, useState } from "react";

/**
 * Big celebratory / commiseratory popup that appears in the center of the screen
 * after a word is submitted. Auto-dismisses after ~1.4 seconds.
 *
 * Props:
 *   token  — any value (eg a counter); change it to fire a new toast
 *   kind   — 'good' | 'bad'
 *   detail — optional small line under the headline (eg "+12 for APPLE")
 */
const GOOD_WORDS = ["NICE!", "GREAT!", "BOOM!", "MEOW!", "PURR-FECT!", "SWEET!", "YES!"];
const BAD_WORDS = ["MISS!", "OOPS!", "NO!", "HISS!", "TRY AGAIN!"];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export default function ResultToast({ token, kind, detail }) {
  const [headline, setHeadline] = useState("");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!token || !kind) return undefined;
    setHeadline(pick(kind === "good" ? GOOD_WORDS : BAD_WORDS));
    setVisible(true);
    const id = setTimeout(() => setVisible(false), 1400);
    return () => clearTimeout(id);
  }, [token, kind]);

  if (!visible) return null;

  const isGood = kind === "good";
  const colorBg = isGood ? "#b6e3b1" : "#f4b1ad";
  const colorBorder = isGood ? "#1d6b1d" : "#9a3a3a";
  const colorText = isGood ? "#0c4a0c" : "#5a1212";
  const rotate = (Math.random() * 10 - 5).toFixed(1);

  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center">
      <div
        className="result-toast font-script text-center"
        style={{
          background: colorBg,
          color: colorText,
          border: `4px solid ${colorBorder}`,
          boxShadow: `4px 6px 0 rgba(31,20,8,0.55)`,
          padding: "24px 56px",
          borderRadius: "20px",
          transform: `rotate(${rotate}deg)`,
        }}
      >
        <div style={{ fontSize: "5rem", lineHeight: 1, fontWeight: 700, letterSpacing: "1px" }}>
          {headline}
        </div>
        {detail && (
          <div className="font-hand mt-1" style={{ fontSize: "1.5rem", opacity: 0.85 }}>{detail}</div>
        )}
      </div>
      <style>{`
        @keyframes toast-in {
          0% { transform: scale(0.4) rotate(-20deg); opacity: 0; }
          50% { transform: scale(1.2) rotate(8deg); opacity: 1; }
          70% { transform: scale(0.96) rotate(-4deg); }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        @keyframes toast-out {
          0% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(0.9) translateY(-12px); }
        }
        .result-toast { animation: toast-in 350ms cubic-bezier(.22,1.6,.36,1) both, toast-out 350ms ease-out 1.05s both; }
      `}</style>
    </div>
  );
}
