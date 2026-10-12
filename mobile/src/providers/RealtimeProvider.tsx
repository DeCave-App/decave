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
type RealtimeEventIdentity = { userId: string; token: string };

type RealtimeContextValue = {
  connectionState: ConnectionState;
  connectionId: string | null;
  lastEvent: RealtimeEvent | null;
  lastEventIdentity: RealtimeEventIdentity | null;
  send: (payload: Record<string, unknown>) => boolean;
  subscribe: (listener: (event: RealtimeEvent) => void) => () => void;
};

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function RealtimeProvider({ children }: PropsWithChildren) {
  const { token, user, invalidate } = useSession();
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("offline");
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [lastEventEntry, setLastEventEntry] = useState<{
    event: RealtimeEvent;
    identity: RealtimeEventIdentity;
  } | null>(null);
  const lastEvent = lastEventEntry?.event ?? null;
  const lastEventIdentity = lastEventEntry?.identity ?? null;
  const socketRef = useRef<WebSocket | null>(null);
  const socketOwnerRef = useRef<{
    socket: WebSocket;
    lifecycle: number;
    userId: string;
    token: string;
  } | null>(null);
  const identityRef = useRef<{ userId: string | null; token: string | null }>({
    userId: user?.id ?? null,
    token,
  });
  identityRef.current = { userId: user?.id ?? null, token };
  const listenersRef = useRef<Set<(event: RealtimeEvent) => void>>(new Set());
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);
  const lifecycleRef = useRef(0);
  const attemptsRef = useRef(0);

  useEffect(() => {
    let disposed = false;
    const lifecycle = ++lifecycleRef.current;
    const identity = { userId: user?.id ?? null, token };
    const isCurrentLifecycle = () =>
      !disposed &&
      lifecycle === lifecycleRef.current &&
      identityRef.current.userId === identity.userId &&
      identityRef.current.token === identity.token;
    const ownsSocket = (socket: WebSocket) => {
      const owner = socketOwnerRef.current;
      return (
        isCurrentLifecycle() &&
        socketRef.current === socket &&
        owner?.socket === socket &&
        owner.lifecycle === lifecycle &&
        owner.userId === identity.userId &&
        owner.token === identity.token
      );
    };
    stoppedRef.current = false;
    if (isCurrentLifecycle()) setLastEventEntry(null);

    const disconnect = () => {
      const owner = socketOwnerRef.current;
      if (owner?.lifecycle === lifecycle) {
        if (retryRef.current) clearTimeout(retryRef.current);
        retryRef.current = null;
        socketOwnerRef.current = null;
        if (socketRef.current === owner.socket) socketRef.current = null;
        owner.socket.onclose = null;
        owner.socket.close();
      } else if (!owner && lifecycle === lifecycleRef.current) {
        if (retryRef.current) clearTimeout(retryRef.current);
        retryRef.current = null;
      }
      if (
        lifecycle === lifecycleRef.current &&
        identityRef.current.userId === identity.userId &&
        identityRef.current.token === identity.token
      ) {
        setConnectionId(null);
        setConnectionState("offline");
      }
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
      if (stoppedRef.current || !isCurrentLifecycle() || !token) return;
      if (retryRef.current) clearTimeout(retryRef.current);
      const delay = Math.min(30000, 1500 * 2 ** attemptsRef.current) * (0.8 + Math.random() * 0.4);
      attemptsRef.current += 1;
      retryRef.current = setTimeout(() => {
        retryRef.current = null;
        if (isCurrentLifecycle()) void connect();
      }, delay);
    };

    const connect = async () => {
      if (stoppedRef.current || !isCurrentLifecycle() || !token || !user) return;
      setConnectionState("connecting");

      try {
        const { wsToken } = await apiJson<{ wsToken: string }>(
          "/api/auth/ws-token",
          { method: "POST" },
          token,
        );

        if (stoppedRef.current || !isCurrentLifecycle()) return;

        const socket = new WebSocket(WS_URL);
        socketRef.current = socket;
        socketOwnerRef.current = { socket, lifecycle, userId: user.id, token };

        socket.onopen = () => {
          if (!ownsSocket(socket)) return;
          setConnectionState("connecting");
        };

        socket.onmessage = (message) => {
          if (!ownsSocket(socket)) return;
          try {
            const event = JSON.parse(String(message.data)) as RealtimeEvent;
            for (const listener of [...listenersRef.current]) {
              if (!ownsSocket(socket)) return;
              try {
                listener(event);
              } catch (error) {
                console.warn("Realtime event listener failed.", error);
              }
            }
            if (!ownsSocket(socket)) return;
            setLastEventEntry({ event, identity: { userId: user.id, token } });

            if (event.type === "AUTH_REQUIRED") {
              if (!ownsSocket(socket)) return;
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
              if (!ownsSocket(socket)) return;
              const id = typeof event.id === "string" ? event.id : null;
              setConnectionId(id);
              setConnectionState(id ? "connected" : "connecting");
              if (id) attemptsRef.current = 0;
            }

            if (event.type === "SESSION_REVOKED") {
              if (!ownsSocket(socket)) return;
              void invalidate("This account was signed in somewhere else.", token);
            }
          } catch {}
        };

        socket.onerror = () => {
          if (!ownsSocket(socket)) return;
          setConnectionState("offline");
        };

        socket.onclose = () => {
          if (!ownsSocket(socket)) return;
          socketRef.current = null;
          socketOwnerRef.current = null;
          setConnectionId(null);
          setConnectionState("offline");
          scheduleRetry();
        };
      } catch {
        if (!isCurrentLifecycle()) return;
        setConnectionId(null);
        setConnectionState("offline");
        scheduleRetry();
      }
    };

    attemptsRef.current = 0;
    void connect();

    // iOS kills sockets in the background; reconnect right away on return.
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state !== "active" || !isCurrentLifecycle()) return;
      const socket = socketRef.current;
      if (
        socket &&
        ownsSocket(socket) &&
        (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
      ) return;
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
    const owner = socketOwnerRef.current;
    const identity = identityRef.current;
    if (
      !socket ||
      !owner ||
      owner.socket !== socket ||
      owner.lifecycle !== lifecycleRef.current ||
      owner.userId !== identity.userId ||
      owner.token !== identity.token ||
      !identity.userId ||
      !identity.token ||
      socket.readyState !== WebSocket.OPEN
    ) return false;
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
      lastEventIdentity,
      send,
      subscribe,
    }),
    [
      connectionState,
      connectionId,
      lastEvent,
      lastEventIdentity,
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
