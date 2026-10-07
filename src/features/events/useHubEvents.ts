import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HubEvent } from "../../../shared/hub-events";
import { listHubEvents, type EventsApiContext } from "./api";

type HubEventsEntry = {
  /** key `${id}:${occurrenceStart}` → occurrence */
  events: Record<string, HubEvent>;
  canCreate: boolean | null;
  error: string;
};

const DAY = 24 * 60 * 60_000;
export const UPCOMING_RANGE = () => {
  const from = Date.now() - DAY;
  return { from, to: from + 92 * DAY };
};

/**
 * Range-based cache of Hub events per Hub. Remembers the last few requested
 * ranges per Hub so a HUB_EVENTS_CHANGED frame can refetch exactly what is on
 * screen (no event payload is pushed because visibility is per user).
 */
export function useHubEvents(ctx: EventsApiContext) {
  const [cacheState, setCacheState] = useState<{ scopeKey: string; byHub: Record<number, HubEventsEntry> }>(() => ({
    scopeKey: ctx.scopeKey,
    byHub: {},
  }));
  const [busyState, setBusyState] = useState({ scopeKey: ctx.scopeKey, count: 0 });
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const rangesRef = useRef<Map<number, Array<[number, number]>>>(new Map());
  const generationRef = useRef<Map<string, number>>(new Map());
  const rangeScopeRef = useRef(ctx.scopeKey);
  const byHub = cacheState.scopeKey === ctx.scopeKey ? cacheState.byHub : {};
  const busy = busyState.scopeKey === ctx.scopeKey && busyState.count > 0;

  const ownsScope = (requestCtx: EventsApiContext, scopeKey: string) =>
    requestCtx.sessionGuard.owns(requestCtx.sessionSnapshot) && ctxRef.current.scopeKey === scopeKey;

  const resetForScope = (scopeKey: string) => {
    if (rangeScopeRef.current === scopeKey) return;
    rangeScopeRef.current = scopeKey;
    rangesRef.current.clear();
    generationRef.current.clear();
  };

  useEffect(() => {
    resetForScope(ctx.scopeKey);
    setCacheState((current) => (current.scopeKey === ctx.scopeKey ? current : { scopeKey: ctx.scopeKey, byHub: {} }));
    setBusyState((current) => (current.scopeKey === ctx.scopeKey ? current : { scopeKey: ctx.scopeKey, count: 0 }));
  }, [ctx.scopeKey]);

  const load = useCallback(
    async (hubId: number, from: number, to: number) => {
      if (!hubId || !(to > from)) return;
      // A callback retained by an older render must retain that render's session
      // snapshot. Reading ctxRef here would let an A callback run as account B.
      const requestCtx = ctx;
      const scopeKey = requestCtx.scopeKey;
      const sessionSnapshot = requestCtx.sessionSnapshot;
      if (!requestCtx.sessionGuard.owns(sessionSnapshot)) return;
      resetForScope(scopeKey);
      const ranges = rangesRef.current.get(hubId) ?? [];
      if (!ranges.some(([a, b]) => a === from && b === to)) {
        rangesRef.current.set(hubId, [...ranges, [from, to] as [number, number]].slice(-3));
      }
      const genKey = `${scopeKey}:${hubId}:${from}:${to}`;
      const generation = (generationRef.current.get(genKey) ?? 0) + 1;
      generationRef.current.set(genKey, generation);
      setBusyState((current) => ({ scopeKey, count: (current.scopeKey === scopeKey ? current.count : 0) + 1 }));
      try {
        const data = await listHubEvents(requestCtx, hubId, from, to);
        if (!ownsScope(requestCtx, scopeKey)) return;
        if (generationRef.current.get(genKey) !== generation) return;
        setCacheState((state) => {
          if (!ownsScope(requestCtx, scopeKey)) return state;
          const current = state.scopeKey === scopeKey ? state.byHub : {};
          const previous = current[hubId]?.events ?? {};
          const next: Record<string, HubEvent> = {};
          // Drop stale occurrences in the refetched range (cancelled / moved / no longer visible).
          for (const [key, event] of Object.entries(previous)) {
            const end = event.occurrenceEnd ?? event.occurrenceStart;
            if (event.occurrenceStart < to && end >= from) continue;
            next[key] = event;
          }
          for (const event of data.events) next[`${event.id}:${event.occurrenceStart}`] = event;
          return {
            scopeKey,
            byHub: { ...current, [hubId]: { events: next, canCreate: Boolean(data.canCreate), error: "" } },
          };
        });
      } catch (error) {
        if (!ownsScope(requestCtx, scopeKey)) return;
        if (generationRef.current.get(genKey) !== generation) return;
        const message = error instanceof Error ? error.message : "Could not load events.";
        setCacheState((state) => {
          if (!ownsScope(requestCtx, scopeKey)) return state;
          const current = state.scopeKey === scopeKey ? state.byHub : {};
          return {
            scopeKey,
            byHub: {
              ...current,
              [hubId]: {
                events: current[hubId]?.events ?? {},
                canCreate: current[hubId]?.canCreate ?? null,
                error: message,
              },
            },
          };
        });
      } finally {
        if (ownsScope(requestCtx, scopeKey)) {
          setBusyState((current) =>
            current.scopeKey === scopeKey ? { scopeKey, count: Math.max(0, current.count - 1) } : current,
          );
        }
      }
    },
    [ctx],
  );

  const loadUpcoming = useCallback(
    (hubIds: number[]) => {
      const { from, to } = UPCOMING_RANGE();
      return Promise.all(hubIds.map((id) => load(id, from, to)));
    },
    [load],
  );

  /** Refetch every remembered range for a Hub (HUB_EVENTS_CHANGED). */
  const refreshHub = useCallback(
    (hubId: number) => {
      const ranges = rangesRef.current.get(hubId);
      if (!ranges?.length) {
        const { from, to } = UPCOMING_RANGE();
        return load(hubId, from, to);
      }
      return Promise.all(ranges.map(([from, to]) => load(hubId, from, to))).then(() => undefined);
    },
    [load],
  );

  /** Apply a server response (create/update/RSVP) locally without waiting for the refetch. */
  const applyEvent = useCallback(
    (event: HubEvent) => {
      const requestCtx = ctx;
      const scopeKey = requestCtx.scopeKey;
      if (!ownsScope(requestCtx, scopeKey)) return;
      resetForScope(scopeKey);
      setCacheState((state) => {
        if (!ownsScope(requestCtx, scopeKey)) return state;
        const current = state.scopeKey === scopeKey ? state.byHub : {};
        const entry = current[event.hubId] ?? { events: {}, canCreate: null, error: "" };
        const events: Record<string, HubEvent> = {};
        for (const [key, existing] of Object.entries(entry.events)) {
          if (existing.id !== event.id) {
            events[key] = existing;
            continue;
          }
          // Keep each occurrence's own times; refresh the series fields.
          events[key] = { ...event, occurrenceStart: existing.occurrenceStart, occurrenceEnd: existing.occurrenceEnd };
          if (
            event.startsAt !== existing.startsAt ||
            event.recurrence !== existing.recurrence ||
            event.endsAt !== existing.endsAt
          )
            delete events[key];
        }
        if (!Object.values(events).some((existing) => existing.id === event.id))
          events[`${event.id}:${event.occurrenceStart}`] = event;
        return { scopeKey, byHub: { ...current, [event.hubId]: { ...entry, events } } };
      });
    },
    [ctx],
  );

  const removeEvent = useCallback(
    (hubId: number, eventId: string) => {
      const requestCtx = ctx;
      const scopeKey = requestCtx.scopeKey;
      if (!ownsScope(requestCtx, scopeKey)) return;
      resetForScope(scopeKey);
      setCacheState((state) => {
        if (!ownsScope(requestCtx, scopeKey)) return state;
        const current = state.scopeKey === scopeKey ? state.byHub : {};
        const entry = current[hubId];
        if (!entry) return state;
        const events = Object.fromEntries(Object.entries(entry.events).filter(([, event]) => event.id !== eventId));
        return { scopeKey, byHub: { ...current, [hubId]: { ...entry, events } } };
      });
    },
    [ctx],
  );

  const pruneHubs = useCallback(
    (hubIds: number[]) => {
      const requestCtx = ctx;
      const scopeKey = requestCtx.scopeKey;
      if (!ownsScope(requestCtx, scopeKey)) return;
      resetForScope(scopeKey);
      const keep = new Set(hubIds);
      setCacheState((state) => {
        if (!ownsScope(requestCtx, scopeKey)) return state;
        const current = state.scopeKey === scopeKey ? state.byHub : {};
        const keys = Object.keys(current).map(Number);
        if (keys.every((id) => keep.has(id))) return state;
        return { scopeKey, byHub: Object.fromEntries(Object.entries(current).filter(([id]) => keep.has(Number(id)))) };
      });
      for (const id of [...rangesRef.current.keys()]) if (!keep.has(id)) rangesRef.current.delete(id);
    },
    [ctx],
  );

  const allEvents = useMemo(() => Object.values(byHub).flatMap((entry) => Object.values(entry.events)), [byHub]);

  useEffect(
    () => () => {
      generationRef.current.clear();
    },
    [],
  );

  return { byHub, allEvents, busy, load, loadUpcoming, refreshHub, applyEvent, removeEvent, pruneHubs };
}

export type HubEventsStore = ReturnType<typeof useHubEvents>;
