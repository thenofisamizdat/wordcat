import React, { useState } from "react";

export default function InviteLinkButton({ code }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/game/${code}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // fall back to selection
      window.prompt("Copy invite link:", url);
    }
  }
  return (
    <div className="flex items-center gap-2">
      <code className="bg-stone-100 px-2 py-1 rounded text-xs select-all">{url}</code>
      <button
        onClick={copy}
        className="bg-stone-800 hover:bg-stone-900 text-white text-xs px-3 py-1 rounded"
      >
        {copied ? "Copied!" : "Copy invite"}
      </button>
    </div>
  );
}
