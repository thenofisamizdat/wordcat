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
