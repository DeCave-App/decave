import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { apiJson } from "@/src/lib/api";
import { useSession } from "@/src/providers/SessionProvider";

type MutedUsersContextValue = {
  mutedIds: Set<string>;
  /** Ref mirror for event handlers that should not re-subscribe on change. */
  mutedRef: React.MutableRefObject<Set<string>>;
  isMuted: (userId: string) => boolean;
  toggleMute: (userId: string) => Promise<boolean>;
};

const MutedUsersContext = createContext<MutedUsersContextValue | null>(null);

/**
 * Users whose notifications and unread counts are silenced, matching the web
 * app's "Mute notifications" (stored server-side under /api/safety/mutes).
 */
export function MutedUsersProvider({ children }: PropsWithChildren) {
  const { token } = useSession();
  const [mutedIds, setMutedIds] = useState<Set<string>>(new Set());
  const mutedRef = useRef(mutedIds);
  mutedRef.current = mutedIds;

  useEffect(() => {
    if (!token) {
      setMutedIds(new Set());
      return;
    }
    let cancelled = false;
    apiJson<{ mutes: Array<{ userId: string }> }>("/api/safety/mutes", {}, token)
      .then((data) => {
        if (!cancelled) setMutedIds(new Set(data.mutes.map((item) => item.userId)));
      })
      .catch((error) => console.warn("[mutes] could not load", error));
    return () => {
      cancelled = true;
    };
  }, [token]);

  const isMuted = useCallback((userId: string) => mutedRef.current.has(userId), []);

  const toggleMute = useCallback(
    async (userId: string) => {
      if (!token) throw new Error("Sign in again to change this.");
      const muted = mutedRef.current.has(userId);
      await apiJson(`/api/safety/mutes/${encodeURIComponent(userId)}`, { method: muted ? "DELETE" : "PUT" }, token);
      setMutedIds((current) => {
        const next = new Set(current);
        if (muted) next.delete(userId);
        else next.add(userId);
        return next;
      });
      return !muted;
    },
    [token],
  );

  const value = useMemo(() => ({ mutedIds, mutedRef, isMuted, toggleMute }), [mutedIds, isMuted, toggleMute]);
  return <MutedUsersContext.Provider value={value}>{children}</MutedUsersContext.Provider>;
}

export function useMutedUsers(): MutedUsersContextValue {
  const value = useContext(MutedUsersContext);
  if (!value) throw new Error("useMutedUsers must be used inside MutedUsersProvider");
  return value;
}
