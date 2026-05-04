import React, { useState } from "react";

/**
 * Copy `text` to the clipboard, working on both secure (HTTPS / localhost)
 * and non-secure (plain HTTP) contexts. Returns true on success.
 *
 * Background: navigator.clipboard.writeText only works in secure contexts.
 * On plain-HTTP deployments (eg http://104.196.134.31:8100/) it throws
 * NotAllowedError, so we fall back to the legacy execCommand("copy")
 * pattern which works everywhere.
 */
async function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through
    }
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
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

export default function InviteLinkButton({ code }) {
  const [status, setStatus] = useState("idle"); // 'idle' | 'copied' | 'failed'
  const url = `${window.location.origin}/game/${code}`;

  function flash(s) {
    setStatus(s);
    setTimeout(() => setStatus("idle"), 1500);
  }

  async function copy() {
    const ok = await copyToClipboard(url);
    if (ok) flash("copied");
    else { window.prompt("Copy invite link:", url); flash("failed"); }
  }

  const label =
    status === "copied" ? "✓ Link copied!" :
    status === "failed" ? "Copy failed" :
    "Copy invite link";

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={copy}
        className="w-full bg-stone-800 hover:bg-stone-900 active:bg-black text-white text-sm font-semibold px-3 py-2 rounded shadow-sm"
      >
        {label}
      </button>
      <div className="text-[0.65rem] text-stone-500 text-center break-all select-all">
        {url}
      </div>
    </div>
  );
}
