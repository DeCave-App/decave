import { apiJson } from "./api";
import type { Hub } from "../types";

/**
 * In-memory cache of the signed-in account's Hubs ("mine": GET /api/servers)
 * and of Discover. The tab bar's Hub pills, the Hubs tab and a Hub's screen
 * render from it at once and refresh in the background; concurrent loads of
 * the same list share one request. Entries belong to one session token, so
 * another account never sees them.
 */
export type HubListKind = "mine" | "discover";

type Entry = {
  token: string | null;
  hubs: Hub[] | null;
  fetchedAt: number;
  inflight: Promise<Hub[]> | null;
};

const PATHS: Record<HubListKind, string> = { mine: "/api/servers", discover: "/api/servers/discover" };
const entries: Record<HubListKind, Entry> = {
  mine: { token: null, hubs: null, fetchedAt: 0, inflight: null },
  discover: { token: null, hubs: null, fetchedAt: 0, inflight: null },
};
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function entryFor(kind: HubListKind, token: string): Entry {
  const entry = entries[kind];
  if (entry.token !== token) entries[kind] = { token, hubs: null, fetchedAt: 0, inflight: null };
  return entries[kind];
}

export function subscribeHubLists(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The last loaded list for this session, or null before the first load. Stable until it changes. */
export function cachedHubList(kind: HubListKind, token: string | null | undefined): Hub[] | null {
  const entry = entries[kind];
  return token && entry.token === token ? entry.hubs : null;
}

/** One of my Hubs from the cached list (with its rooms), for drawing a Hub before its detail loads. */
export function cachedHub(token: string | null | undefined, hubId: number): Hub | null {
  const hub = cachedHubList("mine", token)?.find((item) => item.id === hubId);
  return hub && Array.isArray(hub.channels) ? hub : null;
}

/**
 * Loads a list, reusing a request already in flight. With `maxAgeMs`, a list
 * loaded that recently is returned without a request.
 */
export function loadHubList(kind: HubListKind, token: string, { maxAgeMs = 0 } = {}): Promise<Hub[]> {
  const entry = entryFor(kind, token);
  if (entry.hubs && Date.now() - entry.fetchedAt < maxAgeMs) return Promise.resolve(entry.hubs);
  if (entry.inflight) return entry.inflight;
  const request = apiJson<Hub[]>(PATHS[kind], {}, token).then((value) => {
    const hubs = Array.isArray(value) ? value : [];
    if (entries[kind] === entry) {
      entry.hubs = hubs;
      entry.fetchedAt = Date.now();
      notify();
    }
    return hubs;
  });
  entry.inflight = request;
  const clear = () => {
    if (entry.inflight === request) entry.inflight = null;
  };
  request.then(clear, clear);
  return request;
}

/** Drops a Hub I left or deleted from my cached list, so it disappears at once. */
export function forgetHub(token: string, hubId: number): void {
  const entry = entries.mine;
  if (entry.token !== token || !entry.hubs) return;
  const hubs = entry.hubs.filter((item) => item.id !== hubId);
  if (hubs.length === entry.hubs.length) return;
  entry.hubs = hubs;
  notify();
}

/** Puts a freshly loaded Hub (GET /api/servers/:id) into my cached list. */
export function rememberHub(token: string, hub: Hub): void {
  const entry = entries.mine;
  if (entry.token !== token || !entry.hubs) return;
  const index = entry.hubs.findIndex((item) => item.id === hub.id);
  if (index < 0) return;
  entry.hubs = entry.hubs.map((item, position) => (position === index ? hub : item));
  notify();
}
