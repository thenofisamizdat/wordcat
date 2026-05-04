import React, { useState } from "react";

// TinyURL alias for http://104.196.134.31:8100/. Swap when the real domain is live.
const SHARE_URL = "https://tinyurl.com/2bdudx3d";
const SHARE_MESSAGE = `Come play WordCat — a word & category game! ${SHARE_URL}`;

export default function ShareButton() {
  const [copied, setCopied] = useState(false);

  function flash() {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function share() {
    try {
      await navigator.clipboard.writeText(SHARE_MESSAGE);
      flash();
    } catch {
      window.prompt("Copy WordCat message:", SHARE_MESSAGE);
    }
  }

  return (
    <button
      onClick={share}
      title="Copy a shareable WordCat message"
      className="bg-stone-800 hover:bg-stone-900 text-white text-xs px-3 py-1 rounded"
    >
      {copied ? "Copied!" : "Share WordCat"}
    </button>
  );
}
