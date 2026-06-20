const TOKEN_KEY = "tilegame.token";
const NAME_KEY = "tilegame.name";
const GUEST_KEY = "tilegame.isGuest";

export const auth = {
  get token() { return localStorage.getItem(TOKEN_KEY); },
  get name() { return localStorage.getItem(NAME_KEY); },
  get isGuest() { return localStorage.getItem(GUEST_KEY) === "1"; },
  set(token, name, isGuest) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(NAME_KEY, name);
    localStorage.setItem(GUEST_KEY, isGuest ? "1" : "0");
    window.dispatchEvent(new Event("tilegame:auth"));
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(NAME_KEY);
    localStorage.removeItem(GUEST_KEY);
    window.dispatchEvent(new Event("tilegame:auth"));
  }
};

async function request(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  if (auth.token) headers["Authorization"] = `Bearer ${auth.token}`;
  const opts = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) {
    const err = new Error((data && (data.detail || data.message)) || res.statusText);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  get: (p) => request("GET", p),
  post: (p, body) => request("POST", p, body)
};

// ---------- zero-friction guest bootstrap ----------
//
// For the daily puzzle we want play with no signup. A guest token carries a
// stable `guest_key`; the backend ties streaks + the one-attempt-per-day rule
// to that key. So we must mint the guest token EXACTLY ONCE and reuse it
// forever (re-minting would generate a new key and silently reset the streak).
//
// ensureGuest() is idempotent: if any token already exists (guest or real
// account) it's a no-op; otherwise it creates a single persistent guest.
let _guestInFlight = null;
export async function ensureGuest(displayName) {
  if (auth.token) return; // already have an identity (guest or registered)
  if (_guestInFlight) return _guestInFlight; // de-dupe concurrent callers
  _guestInFlight = (async () => {
    try {
      const r = await api.post("/api/auth/guest", { display_name: displayName || "Player" });
      auth.set(r.token, r.display_name, true);
    } finally {
      _guestInFlight = null;
    }
  })();
  return _guestInFlight;
}
