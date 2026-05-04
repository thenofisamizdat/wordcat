import { useCallback, useEffect, useRef, useState } from "react";
import { auth } from "../api/client.js";

/**
 * Connect to a multiplayer game over WebSocket.
 *
 * Returns { state, lastEvent, send, status, error }.
 *  - status: 'connecting' | 'open' | 'closed' | 'error'
 *  - send(action, data): send a JSON message to the server
 */
export function useGameSocket(code, { enabled = true } = {}) {
  const [state, setState] = useState(null);
  const [letterValues, setLetterValues] = useState({});
  const [lastEvent, setLastEvent] = useState(null);
  const [lastError, setLastError] = useState(null);
  const [status, setStatus] = useState("connecting");
  const wsRef = useRef(null);
  const reconnectRef = useRef(0);
  const stoppedRef = useRef(false);

  const send = useCallback((type, payload = {}) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type, ...payload }));
    return true;
  }, []);

  useEffect(() => {
    if (!enabled || !code) return undefined;
    stoppedRef.current = false;

    let pingTimer = null;
    let reconnectTimer = null;

    function connect() {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      // Vite dev proxies /ws → backend
      const url = `${proto}//${window.location.host}/ws/games/${code}?token=${encodeURIComponent(auth.token || "")}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;
      setStatus("connecting");

      ws.onopen = () => {
        setStatus("open");
        reconnectRef.current = 0;
        // Heartbeat
        pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
        }, 20000);
      };

      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === "state") {
          setState(msg.state);
          if (msg.letter_values) setLetterValues(msg.letter_values);
          if (msg.event) setLastEvent({ ...msg.event, ts: Date.now() });
        } else if (msg.type === "action_rejected") {
          setLastError({ kind: msg.action, reason: msg.reason, ts: Date.now() });
        } else if (msg.type === "error") {
          setLastError({ kind: "error", reason: msg.code || msg.message, ts: Date.now() });
        } else if (msg.type === "pong") {
          // ignore
        } else {
          setLastEvent({ ...msg, ts: Date.now() });
        }
      };

      ws.onclose = () => {
        if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
        if (stoppedRef.current) {
          setStatus("closed");
          return;
        }
        setStatus("closed");
        // Exponential backoff up to 8s
        const wait = Math.min(8000, 500 * Math.pow(2, reconnectRef.current++));
        reconnectTimer = setTimeout(connect, wait);
      };

      ws.onerror = () => {
        setStatus("error");
      };
    }

    connect();

    return () => {
      stoppedRef.current = true;
      if (pingTimer) clearInterval(pingTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try { wsRef.current && wsRef.current.close(); } catch { /* ignore */ }
    };
  }, [code, enabled]);

  return { state, letterValues, lastEvent, lastError, status, send };
}
