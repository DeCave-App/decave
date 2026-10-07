import {
  createContext,
  type PropsWithChildren,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { apiJson, WS_URL } from "@/src/lib/api";
import { useSession } from "@/src/providers/SessionProvider";
import type { RealtimeEvent } from "@/src/types";

type ConnectionState = "offline" | "connecting" | "connected";

type RealtimeContextValue = {
  connectionState: ConnectionState;
  connectionId: string | null;
  lastEvent: RealtimeEvent | null;
  send: (payload: Record<string, unknown>) => boolean;
  subscribe: (listener: (event: RealtimeEvent) => void) => () => void;
};

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function RealtimeProvider({ children }: PropsWithChildren) {
  const { token, user, invalidate } = useSession();
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("offline");
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [lastEvent, setLastEvent] = useState<RealtimeEvent | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Set<(event: RealtimeEvent) => void>>(new Set());
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);
  const lifecycleRef = useRef(0);
  const attemptsRef = useRef(0);

  useEffect(() => {
    let disposed = false;
    const lifecycle = ++lifecycleRef.current;
    stoppedRef.current = false;

    const disconnect = () => {
      if (retryRef.current) clearTimeout(retryRef.current);
      retryRef.current = null;
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
      setConnectionId(null);
      setConnectionState("offline");
    };

    if (!token || !user) {
      disconnect();
      return () => {
        disposed = true;
        disconnect();
      };
    }

    // Exponential backoff with jitter, capped at 30s, so flaky networks are not hammered.
    const scheduleRetry = () => {
      if (stoppedRef.current || disposed || lifecycle !== lifecycleRef.current || !token) return;
      if (retryRef.current) clearTimeout(retryRef.current);
      const delay = Math.min(30000, 1500 * 2 ** attemptsRef.current) * (0.8 + Math.random() * 0.4);
      attemptsRef.current += 1;
      retryRef.current = setTimeout(() => {
        retryRef.current = null;
        void connect();
      }, delay);
    };

    const connect = async () => {
      if (stoppedRef.current || disposed || lifecycle !== lifecycleRef.current || !token) return;
      setConnectionState("connecting");

      try {
        const { wsToken } = await apiJson<{ wsToken: string }>(
          "/api/auth/ws-token",
          { method: "POST" },
          token,
        );

        if (stoppedRef.current || disposed || lifecycle !== lifecycleRef.current) return;

        const socket = new WebSocket(WS_URL);
        socketRef.current = socket;

        socket.onopen = () => {
          setConnectionState("connecting");
        };

        socket.onmessage = (message) => {
          if (lifecycle !== lifecycleRef.current || disposed) return;
          try {
            const event = JSON.parse(String(message.data)) as RealtimeEvent;
            for (const listener of [...listenersRef.current]) {
              try {
                listener(event);
              } catch (error) {
                console.warn("Realtime event listener failed.", error);
              }
            }
            setLastEvent(event);

            if (event.type === "AUTH_REQUIRED") {
              socket.send(
                JSON.stringify({
                  type: "IDENTIFY",
                  token: wsToken,
                  client: "mobile", // DECAVE_PARITY_REALTIME
                  serverId: 0,
                  channelId: 0,
                }),
              );
            }

            if (event.type === "IDENTIFIED") {
              const id = typeof event.id === "string" ? event.id : null;
              setConnectionId(id);
              setConnectionState(id ? "connected" : "connecting");
              if (id) attemptsRef.current = 0;
            }

            if (event.type === "SESSION_REVOKED") {
              void invalidate("This account was signed in somewhere else.");
            }
          } catch {}
        };

        socket.onerror = () => {
          if (lifecycle !== lifecycleRef.current) return;
          setConnectionState("offline");
        };

        socket.onclose = () => {
          if (lifecycle !== lifecycleRef.current) return;
          if (socketRef.current === socket) socketRef.current = null;
          setConnectionId(null);
          setConnectionState("offline");
          scheduleRetry();
        };
      } catch {
        if (lifecycle !== lifecycleRef.current) return;
        setConnectionId(null);
        setConnectionState("offline");
        scheduleRetry();
      }
    };

    attemptsRef.current = 0;
    void connect();

    // iOS kills sockets in the background; reconnect right away on return.
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state !== "active" || disposed || lifecycle !== lifecycleRef.current) return;
      const socket = socketRef.current;
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
      attemptsRef.current = 0;
      if (retryRef.current) clearTimeout(retryRef.current);
      retryRef.current = null;
      void connect();
    });

    return () => {
      appStateSub.remove();
      disposed = true;
      stoppedRef.current = true;
      disconnect();
    };
  }, [token, user?.id]);

  const send = useCallback((payload: Record<string, unknown>): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(payload));
    return true;
  }, []);

  const subscribe = useCallback(
    (listener: (event: RealtimeEvent) => void) => {
      listenersRef.current.add(listener);
      return () => {
        listenersRef.current.delete(listener);
      };
    },
    [],
  );

  const value = useMemo(
    () => ({
      connectionState,
      connectionId,
      lastEvent,
      send,
      subscribe,
    }),
    [
      connectionState,
      connectionId,
      lastEvent,
      send,
      subscribe,
    ],
  );

  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime(): RealtimeContextValue {
  const value = useContext(RealtimeContext);
  if (!value) {
    throw new Error("useRealtime must be used inside RealtimeProvider");
  }
  return value;
}
