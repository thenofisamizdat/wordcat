import { useEffect, useState, useCallback } from "react";
import { api, auth } from "../api/client.js";

export function useAuth() {
  const [state, setState] = useState({
    token: auth.token,
    name: auth.name,
    isGuest: auth.isGuest
  });

  useEffect(() => {
    const handler = () => setState({ token: auth.token, name: auth.name, isGuest: auth.isGuest });
    window.addEventListener("tilegame:auth", handler);
    return () => window.removeEventListener("tilegame:auth", handler);
  }, []);

  const login = useCallback(async (email, password) => {
    const r = await api.post("/api/auth/login", { email, password });
    auth.set(r.token, r.display_name, false);
  }, []);

  const register = useCallback(async (email, password, displayName) => {
    const r = await api.post("/api/auth/register", { email, password, display_name: displayName });
    auth.set(r.token, r.display_name, false);
  }, []);

  const guest = useCallback(async (displayName) => {
    const r = await api.post("/api/auth/guest", { display_name: displayName || "Guest" });
    auth.set(r.token, r.display_name, true);
  }, []);

  const logout = useCallback(() => auth.clear(), []);

  return { ...state, login, register, guest, logout, isAuthed: !!state.token };
}
