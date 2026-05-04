import React, { useState } from "react";

// TinyURL alias for http://104.196.134.31:8100/. Swap when the real domain is live.
const SHARE_URL = "https://tinyurl.com/2bdudx3d";
const SHARE_MESSAGE = `Come play WordCat — a word & category game! ${SHARE_URL}`;

/**
 * Copy `text` to the clipboard, working on both secure (HTTPS / localhost)
 * and non-secure (plain HTTP) contexts.
 *
 * - On HTTPS / localhost: uses the modern async `navigator.clipboard` API.
 * - On plain HTTP (where `navigator.clipboard` is undefined or throws
 *   NotAllowedError), falls back to a hidden <textarea> + document.execCommand.
 *   That API is deprecated but still supported by every major browser, and
 *   it's the only programmatic copy that works without a secure context.
 *
 * Returns true on success, false if both paths fail.
 */
async function copyToClipboard(text) {
  // 1) Modern path
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through
    }
  }
  // 2) Legacy execCommand fallback (works on http://)
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    // Hide off-screen but keep it focusable / selectable.
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export default function ShareButton() {
  const [status, setStatus] = useState("idle"); // 'idle' | 'copied' | 'failed'

  function flash(kind) {
    setStatus(kind);
    setTimeout(() => setStatus("idle"), 1500);
  }

  async function share() {
    const ok = await copyToClipboard(SHARE_MESSAGE);
    if (ok) {
      flash("copied");
    } else {
      // Last-resort visual fallback so the user can manually copy.
      window.prompt("Copy WordCat link:", SHARE_MESSAGE);
      flash("failed");
    }
  }

  const label =
    status === "copied" ? "Copied!" :
    status === "failed" ? "Copy failed" :
    "Share WordCat";

  return (
    <button
      onClick={share}
      title="Copy a shareable WordCat link to your clipboard"
      className="bg-stone-800 hover:bg-stone-900 text-white text-xs px-3 py-1 rounded"
    >
      {label}
    </button>
  );
}
