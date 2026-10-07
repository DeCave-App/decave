// Lifecycle of the realtime WebSocket: IDENTIFY on open, PING every 20 s with a
// watchdog that drops a socket silent for 55 s, reconnect with exponential
// backoff (a fresh realtime token is fetched first; a 401 from /api/auth/me ends
// the session), and recovery when the app comes back online, regains focus or
// becomes visible. What each message means is up to the caller.
//
// Reconnecting does not open a new socket here: the caller stores the refreshed
// token, which starts a new connection.

export type RealtimeStatus = "Connecting..." | "Reconnecting..." | "Connected" | "Disconnected";

type Ref<T> = { current: T };

// Frames from the server are JSON objects with a string `type`; each handler
// reads the fields of the frame types it handles.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RealtimeFrame = any;

/** The page exposes the live connection's send for the call overlay. */
export type RealtimeSendWindow = Window & { __decaveRealtimeSend?: (payload: Record<string, unknown>) => boolean };

export type RealtimeEnvironment = {
  createSocket: (url: string) => WebSocket;
  setTimeout: (callback: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
  setInterval: (callback: () => void, ms: number) => number;
  clearInterval: (id: number) => void;
  now: () => number;
  random: () => number;
  window: Pick<Window, "addEventListener" | "removeEventListener">;
  document: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
  console: Pick<Console, "warn" | "error">;
};

export type RealtimeConnectionOptions = {
  url: string;
  /** The open socket, shared with code that sends frames. */
  socketRef: Ref<WebSocket | null>;
  /** Failed attempts since the last IDENTIFIED; survives reconnects. */
  reconnectAttemptRef: Ref<number>;
  /** False once the session ended or the user logged out. */
  reconnectEnabledRef: Ref<boolean>;
  setStatus: (status: RealtimeStatus) => void;
  /** IDENTIFY frame, built when the socket opens. */
  identify: () => Record<string, unknown>;
  refreshToken: () => Promise<string>;
  /** Asked only when no token came back: is the session gone (401)? */
  isSessionExpired: () => Promise<boolean>;
  onSessionExpired: () => void;
  /** A fresh token was fetched; storing it starts the next connection. */
  onTokenRefreshed: (token: string) => void;
  /** Every parsed frame, before anything else looks at it. */
  onFrame: (data: RealtimeFrame) => void;
  onAuthError: (data: RealtimeFrame) => void;
  onIdentified: (data: RealtimeFrame, socket: WebSocket) => void;
  /** Every frame other than PONG, AUTH_ERROR and IDENTIFIED. */
  onEvent: (data: RealtimeFrame, socket: WebSocket) => void;
  /** The socket closed while the connection was still wanted. */
  onClosed: () => void;
  /** The app came back online, regained focus or became visible. */
  onResume: () => void;
  env?: RealtimeEnvironment;
};

export type RealtimeConnection = {
  /** Reconnect right away unless a socket is already open or connecting. */
  reconnectNow: () => void;
  /** Send a frame on this connection's socket if it is open. */
  send: (payload: Record<string, unknown>) => boolean;
  dispose: () => void;
};

const OPEN = 1;
const CONNECTING = 0;
const CLOSED = 3;
const HEARTBEAT_INTERVAL_MS = 20_000;
const HEARTBEAT_TIMEOUT_MS = 55_000;
const WATCHDOG_INTERVAL_MS = 10_000;
const MAX_BACKOFF_MS = 15_000;

function browserEnvironment(): RealtimeEnvironment {
  return {
    createSocket: (url) => new WebSocket(url),
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: (id) => window.clearTimeout(id),
    setInterval: (callback, ms) => window.setInterval(callback, ms),
    clearInterval: (id) => window.clearInterval(id),
    now: () => Date.now(),
    random: () => Math.random(),
    window,
    document,
    console,
  };
}

export function connectRealtime(options: RealtimeConnectionOptions): RealtimeConnection {
  const env = options.env ?? browserEnvironment();
  const { socketRef, reconnectAttemptRef, reconnectEnabledRef } = options;
  let disposed = false;
  let identified = false;
  let reconnectTimer: number | null = null;
  let heartbeatTimer: number | null = null;
  let heartbeatWatchdogTimer: number | null = null;
  let lastPongAt = env.now();

  const clearHeartbeat = () => {
    if (heartbeatTimer !== null) {
      env.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (heartbeatWatchdogTimer !== null) {
      env.clearInterval(heartbeatWatchdogTimer);
      heartbeatWatchdogTimer = null;
    }
  };

  const scheduleReconnect = (immediate = false) => {
    if (disposed || !reconnectEnabledRef.current) return;
    if (immediate && reconnectTimer !== null) {
      env.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (reconnectTimer !== null) return;

    options.setStatus("Reconnecting...");
    const attempt = reconnectAttemptRef.current;
    const baseDelay = immediate ? 0 : Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** Math.min(attempt, 4));
    const jitter = immediate ? 0 : Math.floor(env.random() * 350);
    reconnectTimer = env.setTimeout(async () => {
      reconnectTimer = null;
      if (disposed || !reconnectEnabledRef.current) return;

      try {
        const freshToken = await options.refreshToken();
        if (disposed || !reconnectEnabledRef.current) return;

        if (!freshToken) {
          if (await options.isSessionExpired()) {
            options.onSessionExpired();
            return;
          }

          reconnectAttemptRef.current += 1;
          scheduleReconnect(false);
          return;
        }

        reconnectAttemptRef.current += 1;
        options.onTokenRefreshed(freshToken);
      } catch (error) {
        env.console.warn("Could not refresh DeCave realtime credentials:", error);
        reconnectAttemptRef.current += 1;
        scheduleReconnect(false);
      }
    }, baseDelay + jitter);
  };

  const reconnectNow = () => {
    if (disposed || !reconnectEnabledRef.current) return;
    const current = socketRef.current;
    if (current && (current.readyState === OPEN || current.readyState === CONNECTING)) {
      return;
    }
    scheduleReconnect(true);
  };

  const recoverRealtimeIfNeeded = () => {
    if (disposed || !reconnectEnabledRef.current) return;
    const current = socketRef.current;
    if (!current || current.readyState === CLOSED) {
      scheduleReconnect(true);
      return;
    }
    if (current.readyState === OPEN && identified && env.now() - lastPongAt > HEARTBEAT_TIMEOUT_MS) {
      try {
        current.close(4000, "Realtime heartbeat timed out");
      } catch {
        scheduleReconnect(true);
      }
    }
  };

  const handleOnline = () => {
    recoverRealtimeIfNeeded();
    options.onResume();
  };
  const handleFocus = () => {
    recoverRealtimeIfNeeded();
    options.onResume();
  };
  const handleVisibility = () => {
    if (env.document.visibilityState === "visible") {
      recoverRealtimeIfNeeded();
      options.onResume();
    }
  };
  env.window.addEventListener("online", handleOnline);
  env.window.addEventListener("focus", handleFocus);
  env.document.addEventListener("visibilitychange", handleVisibility);

  options.setStatus(reconnectAttemptRef.current > 0 ? "Reconnecting..." : "Connecting...");
  const socket = env.createSocket(options.url);
  socketRef.current = socket;

  socket.onopen = () => {
    if (disposed || socketRef.current !== socket) return;
    options.setStatus(reconnectAttemptRef.current > 0 ? "Reconnecting..." : "Connecting...");
    socket.send(JSON.stringify(options.identify()));
  };

  socket.onmessage = (event) => {
    if (disposed || socketRef.current !== socket) return;
    try {
      const data = JSON.parse(event.data);
      options.onFrame(data);

      if (data.type === "PONG") {
        lastPongAt = env.now();
        return;
      }

      if (data.type === "AUTH_ERROR") {
        options.onAuthError(data);
        return;
      }

      if (data.type === "IDENTIFIED") {
        identified = true;
        reconnectAttemptRef.current = 0;
        lastPongAt = env.now();
        clearHeartbeat();
        heartbeatTimer = env.setInterval(() => {
          if (disposed || socketRef.current !== socket || socket.readyState !== OPEN) return;
          try {
            socket.send(JSON.stringify({ type: "PING", timestamp: env.now() }));
          } catch {
            try {
              socket.close();
            } catch {}
          }
        }, HEARTBEAT_INTERVAL_MS);
        heartbeatWatchdogTimer = env.setInterval(() => {
          if (disposed || socketRef.current !== socket || socket.readyState !== OPEN) return;
          if (env.now() - lastPongAt > HEARTBEAT_TIMEOUT_MS) {
            try {
              socket.close(4000, "Realtime heartbeat timed out");
            } catch {
              scheduleReconnect(true);
            }
          }
        }, WATCHDOG_INTERVAL_MS);
        options.onIdentified(data, socket);
        return;
      }

      options.onEvent(data, socket);
    } catch (error) {
      env.console.error("Invalid WebSocket data:", error);
    }
  };

  socket.onerror = (error) => {
    if (disposed || socketRef.current !== socket) return;
    env.console.error("DeCave WebSocket error:", error);
    options.setStatus("Reconnecting...");
  };

  socket.onclose = () => {
    clearHeartbeat();
    if (socketRef.current === socket) socketRef.current = null;
    if (disposed) return;

    options.onClosed();

    if (reconnectEnabledRef.current) {
      // The first retry is safe to make immediate: the old socket is already
      // closed and the token endpoint is rate-limited. Later failures retain
      // exponential backoff with jitter.
      scheduleReconnect(reconnectAttemptRef.current === 0);
    } else {
      options.setStatus("Disconnected");
    }
  };

  return {
    reconnectNow,
    send: (payload) => {
      if (socket.readyState !== OPEN) return false;
      socket.send(JSON.stringify(payload));
      return true;
    },
    dispose: () => {
      disposed = true;
      clearHeartbeat();
      if (reconnectTimer !== null) {
        env.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      env.window.removeEventListener("online", handleOnline);
      env.window.removeEventListener("focus", handleFocus);
      env.document.removeEventListener("visibilitychange", handleVisibility);
      try {
        socket.close();
      } catch {}
      if (socketRef.current === socket) socketRef.current = null;
    },
  };
}
