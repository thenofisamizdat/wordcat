import React, { useState } from "react";
import { useAuth } from "../hooks/useAuth.js";

export default function LoginForm() {
  const { login, register, guest } = useAuth();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      if (mode === "login") await login(email, password);
      else if (mode === "register") await register(email, password, name);
      else await guest(name);
    } catch (e) {
      setErr(e.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 sketch-card max-w-md mx-auto">
      <div className="flex gap-2 justify-center">
        {["login","register","guest"].map(m => (
          <button key={m} type="button"
            onClick={() => { setErr(null); setMode(m); }}
            className={`sketch-pill text-sm ${mode===m ? "bg-paper-300" : ""}`}>
            {m === "login" ? "Sign in" : m === "register" ? "Create account" : "Play as guest"}
          </button>
        ))}
      </div>
      {mode !== "guest" && (
        <input type="email" required placeholder="Email" value={email}
          onChange={e=>setEmail(e.target.value)}
          className="sketch-input" />
      )}
      {(mode === "register" || mode === "guest") && (
        <input type="text" required maxLength={64} placeholder="Display name" value={name}
          onChange={e=>setName(e.target.value)}
          className="sketch-input" />
      )}
      {mode !== "guest" && (
        <input type="password" required minLength={6} placeholder="Password" value={password}
          onChange={e=>setPassword(e.target.value)}
          className="sketch-input" />
      )}
      {err && <div className="text-red-700 text-sm font-hand">{err}</div>}
      <button type="submit" disabled={busy} className="sketch-btn-primary w-full">
        {busy ? "..." :
          mode === "login" ? "Sign in" :
          mode === "register" ? "Create account & play" : "Continue as guest"}
      </button>
    </form>
  );
}
