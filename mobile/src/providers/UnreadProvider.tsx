import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { usePathname } from "expo-router";
import { apiJson } from "@/src/lib/api";
import { useMutedUsers } from "@/src/providers/MutedUsersProvider";
import { useRealtime } from "@/src/providers/RealtimeProvider";
import { useSession } from "@/src/providers/SessionProvider";

type Counts = Record<string, number>;

type UnreadContextValue = {
  rooms: Counts;
  hubs: Counts;
  hubMentions: Counts;
  dms: Counts;
  dmTotal: number;
  markRoomRead: (channelId: number) => void;
  markDmRead: (userId: string) => void;
  /** A room shown outside its own route (the iPad split view); null when none. */
  setOpenRoom: (channelId: number | null) => void;
  /** Same, for a DM shown in the iPad split view. */
  setOpenDm: (userId: string | null) => void;
};

const UnreadContext = createContext<UnreadContextValue | null>(null);

function bump(counts: Counts, key: string): Counts {
  return { ...counts, [key]: Math.min(999, (counts[key] ?? 0) + 1) };
}

function drop(counts: Counts, key: string): Counts {
  if (!counts[key]) return counts;
  const next = { ...counts };
  delete next[key];
  return next;
}

/**
 * Counts messages that arrive over realtime while their room or DM is not on
 * screen. Counts live for the app session; opening the room clears them.
 */
export function UnreadProvider({ children }: PropsWithChildren) {
  const { user, token } = useSession();
  const sessionIdentity = `${user?.id ?? ""}:${token ?? ""}`;
  const sessionScopeRef = useRef({ identity: sessionIdentity, generation: 0 });
  if (sessionScopeRef.current.identity !== sessionIdentity) {
    sessionScopeRef.current = { identity: sessionIdentity, generation: sessionScopeRef.current.generation + 1 };
  }
  const sessionGeneration = sessionScopeRef.current.generation;
  const { subscribe } = useRealtime();
  const { mutedRef } = useMutedUsers();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const [openRoom, setOpenRoomState] = useState<number | null>(null);
  const openRoomRef = useRef(openRoom);
  openRoomRef.current = openRoom;
  const [openDm, setOpenDmState] = useState<string | null>(null);
  const openDmRef = useRef(openDm);
  openDmRef.current = openDm;

  const [rooms, setRooms] = useState<Counts>({});
  const [roomHub, setRoomHub] = useState<Record<string, string>>({});
  const [mentions, setMentions] = useState<Counts>({});
  const [dms, setDms] = useState<Counts>({});
  const [countsGeneration, setCountsGeneration] = useState(sessionGeneration);

  useEffect(() => {
    setCountsGeneration(sessionGeneration);
    setRooms({});
    setRoomHub({});
    setMentions({});
    setDms({});
    setOpenRoomState(null);
    setOpenDmState(null);
  }, [sessionGeneration]);

  // Server read markers make counts survive restarts and match other devices.
  const loadSummary = useCallback(async () => {
    if (!token) return;
    const requestGeneration = sessionGeneration;
    try {
      const summary = await apiJson<{
        rooms: Array<{ channelId: number; hubId: number; count: number; mentions: number }>;
        dms: Array<{ userId: string; count: number }>;
      }>("/api/read-state", {}, token);
      if (sessionScopeRef.current.generation !== requestGeneration) return;
      const open = pathnameRef.current;
      const nextRooms: Counts = {};
      const nextHubs: Record<string, string> = {};
      const nextMentions: Counts = {};
      for (const room of summary.rooms) {
        const key = String(room.channelId);
        if (open === `/channel/${key}` || open === `/voice/${key}` || openRoomRef.current === room.channelId) continue;
        nextRooms[key] = room.count;
        nextHubs[key] = String(room.hubId);
        if (room.mentions) nextMentions[key] = room.mentions;
      }
      const nextDms: Counts = {};
      for (const dm of summary.dms) {
        if (open === `/dm/${dm.userId}` || openDmRef.current === dm.userId || mutedRef.current.has(dm.userId)) continue;
        nextDms[dm.userId] = dm.count;
      }
      setRooms((current) => sessionScopeRef.current.generation === requestGeneration ? nextRooms : current);
      setRoomHub((current) => sessionScopeRef.current.generation === requestGeneration ? nextHubs : current);
      setMentions((current) => sessionScopeRef.current.generation === requestGeneration ? nextMentions : current);
      setDms((current) => sessionScopeRef.current.generation === requestGeneration ? nextDms : current);
    } catch (error) {
      if (sessionScopeRef.current.generation !== requestGeneration) return;
      console.warn("[unread] could not load read state", error);
    }
  }, [token, sessionGeneration, mutedRef]);

  useEffect(() => {
    void loadSummary();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void loadSummary();
    });
    return () => sub.remove();
  }, [loadSummary]);

  const putRead = useCallback(
    (body: Record<string, unknown>) => {
      const requestGeneration = sessionGeneration;
      if (!token || sessionScopeRef.current.generation !== requestGeneration) return;
      apiJson("/api/read-state", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, token).catch(
        (error) => console.warn("[unread] could not save read marker", error),
      );
    },
    [token, sessionGeneration],
  );

  useEffect(() => {
    if (!user) return;
    const requestGeneration = sessionGeneration;
    return subscribe((event) => {
      if (sessionScopeRef.current.generation !== requestGeneration) return;
      if (event.type === "ROOM_ACTIVITY") {
        const channelId = Number(event.channelId);
        const serverId = Number(event.serverId);
        if (!channelId || event.userId === user.id) return;
        if (typeof event.userId === "string" && mutedRef.current.has(event.userId)) return;
        if (pathnameRef.current === `/channel/${channelId}` || pathnameRef.current === `/voice/${channelId}` || openRoomRef.current === channelId) return;
        const key = String(channelId);
        setRooms((current) => sessionScopeRef.current.generation === requestGeneration ? bump(current, key) : current);
        if (serverId) setRoomHub((current) => sessionScopeRef.current.generation === requestGeneration
          ? (current[key] === String(serverId) ? current : { ...current, [key]: String(serverId) })
          : current);
        if (event.mentioned === true) setMentions((current) => sessionScopeRef.current.generation === requestGeneration ? bump(current, key) : current);
        return;
      }
      if (event.type === "DM_MESSAGE") {
        const message = event.message as { fromUserId?: unknown } | undefined;
        const from = typeof message?.fromUserId === "string" ? message.fromUserId : "";
        if (!from || from === user.id || mutedRef.current.has(from)) return;
        if (pathnameRef.current === `/dm/${encodeURIComponent(from)}` || pathnameRef.current === `/dm/${from}` || openDmRef.current === from) return;
        setDms((current) => sessionScopeRef.current.generation === requestGeneration ? bump(current, from) : current);
      }
    });
  }, [subscribe, user, mutedRef, sessionGeneration]);

  // Opening a room or DM clears it; marking again on leave covers messages read while open.
  const previousPathRef = useRef(pathname);
  useEffect(() => {
    const markFor = (path: string) => {
      const roomId = /^\/(?:channel|voice)\/(\d+)/.exec(path)?.[1];
      if (roomId) putRead({ scope: "room", channelId: Number(roomId) });
      const dmId = /^\/dm\/([^/?]+)/.exec(path)?.[1];
      if (dmId) putRead({ scope: "dm", userId: decodeURIComponent(dmId) });
    };
    if (previousPathRef.current !== pathname) markFor(previousPathRef.current);
    markFor(pathname);
    previousPathRef.current = pathname;
  }, [pathname, putRead, sessionGeneration]);

  useEffect(() => {
    const requestGeneration = sessionGeneration;
    const room = /^\/(?:channel|voice)\/(\d+)/.exec(pathname)?.[1];
    if (room) {
      setRooms((current) => sessionScopeRef.current.generation === requestGeneration ? drop(current, room) : current);
      setMentions((current) => sessionScopeRef.current.generation === requestGeneration ? drop(current, room) : current);
    }
    const dm = /^\/dm\/([^/]+)/.exec(pathname)?.[1];
    if (dm) setDms((current) => sessionScopeRef.current.generation === requestGeneration ? drop(current, decodeURIComponent(dm)) : current);
  }, [pathname, sessionGeneration]);

  // Same read-marker rules as a routed room: mark on open and again on leave.
  useEffect(() => {
    if (openRoom == null) return;
    const requestGeneration = sessionGeneration;
    putRead({ scope: "room", channelId: openRoom });
    setRooms((current) => sessionScopeRef.current.generation === requestGeneration ? drop(current, String(openRoom)) : current);
    setMentions((current) => sessionScopeRef.current.generation === requestGeneration ? drop(current, String(openRoom)) : current);
    return () => putRead({ scope: "room", channelId: openRoom });
  }, [openRoom, putRead, sessionGeneration]);
  const setOpenRoom = useCallback((channelId: number | null) => {
    const requestGeneration = sessionGeneration;
    if (sessionScopeRef.current.generation === requestGeneration) setOpenRoomState(channelId);
  }, [sessionGeneration]);
  useEffect(() => {
    if (openDm == null) return;
    const requestGeneration = sessionGeneration;
    putRead({ scope: "dm", userId: openDm });
    setDms((current) => sessionScopeRef.current.generation === requestGeneration ? drop(current, openDm) : current);
    return () => putRead({ scope: "dm", userId: openDm });
  }, [openDm, putRead, sessionGeneration]);
  const setOpenDm = useCallback((userId: string | null) => {
    const requestGeneration = sessionGeneration;
    if (sessionScopeRef.current.generation === requestGeneration) setOpenDmState(userId);
  }, [sessionGeneration]);

  const markRoomRead = useCallback((channelId: number) => {
    const requestGeneration = sessionGeneration;
    setRooms((current) => sessionScopeRef.current.generation === requestGeneration ? drop(current, String(channelId)) : current);
    setMentions((current) => sessionScopeRef.current.generation === requestGeneration ? drop(current, String(channelId)) : current);
  }, [sessionGeneration]);
  const markDmRead = useCallback(
    (userId: string) => {
      const requestGeneration = sessionGeneration;
      setDms((current) => sessionScopeRef.current.generation === requestGeneration ? drop(current, userId) : current);
      putRead({ scope: "dm", userId });
    },
    [putRead, sessionGeneration],
  );

  const value = useMemo<UnreadContextValue>(() => {
    const visibleRooms = countsGeneration === sessionGeneration ? rooms : {};
    const visibleRoomHub = countsGeneration === sessionGeneration ? roomHub : {};
    const visibleMentions = countsGeneration === sessionGeneration ? mentions : {};
    const visibleDms = countsGeneration === sessionGeneration ? dms : {};
    const hubs: Counts = {};
    const hubMentions: Counts = {};
    for (const [room, count] of Object.entries(visibleRooms)) {
      const hub = visibleRoomHub[room];
      if (hub) hubs[hub] = (hubs[hub] ?? 0) + count;
    }
    for (const [room, count] of Object.entries(visibleMentions)) {
      const hub = visibleRoomHub[room];
      if (hub) hubMentions[hub] = (hubMentions[hub] ?? 0) + count;
    }
    const dmTotal = Object.values(visibleDms).reduce((sum, count) => sum + count, 0);
    return { rooms: visibleRooms, hubs, hubMentions, dms: visibleDms, dmTotal, markRoomRead, markDmRead, setOpenRoom, setOpenDm };
  }, [rooms, roomHub, mentions, dms, countsGeneration, sessionGeneration, markRoomRead, markDmRead, setOpenRoom, setOpenDm]);

  return <UnreadContext.Provider value={value}>{children}</UnreadContext.Provider>;
}

export function useUnread(): UnreadContextValue {
  const value = useContext(UnreadContext);
  if (!value) throw new Error("useUnread must be used inside UnreadProvider");
  return value;
}
