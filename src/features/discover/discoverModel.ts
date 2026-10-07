// Discover: filtering and sorting of public Hubs. Pure functions so the
// rules are easy to test and stay the same everywhere they are used.
import { hubRulesList } from "../../../shared/hub-home";

export type DiscoverHub = {
  id: number;
  name: string;
  icon: string;
  memberCount: number | null;
  onlineCount: number | null;
  joined: boolean;
  description?: string;
  accent?: string;
  category?: string;
  tags?: string[];
  iconUrl?: string | null;
  bannerUrl?: string | null;
  membershipPrivate?: boolean;
  /** ISO time the Hub was created (newer servers only). */
  createdAt?: string;
  /** Viewer's friends who are members (0 when membership is private). */
  friendsInside?: number;
  /** Up to three of those friends, alphabetical. */
  friendNames?: string[];
  /** People in the Hub's public voice rooms right now. */
  voiceCount?: number;
};

export type DiscoverSort = "active" | "friends" | "largest" | "new";
export type DiscoverSize = "any" | "small" | "medium" | "large";

export type DiscoverFilters = {
  query: string;
  category: string; // "all" or a category name
  size: DiscoverSize;
  friendsOnly: boolean;
  activeOnly: boolean;
  sort: DiscoverSort;
};

export const DEFAULT_DISCOVER_FILTERS: DiscoverFilters = {
  query: "",
  category: "all",
  size: "any",
  friendsOnly: false,
  activeOnly: false,
  sort: "active",
};

export const DISCOVER_SORT_LABELS: Record<DiscoverSort, string> = {
  active: "Active now",
  friends: "Friends",
  largest: "Largest",
  new: "New",
};
export const DISCOVER_SIZE_LABELS: Record<DiscoverSize, string> = {
  any: "Any size",
  small: "Under 50",
  medium: "50 to 500",
  large: "500+",
};

const n = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;

export function isActiveNow(hub: DiscoverHub): boolean {
  return n(hub.onlineCount) > 0 || n(hub.voiceCount) > 0;
}

/** People in voice count three times: they are the strongest "come join" signal. */
export function activityScore(hub: DiscoverHub): number {
  return n(hub.voiceCount) * 3 + n(hub.onlineCount);
}

export function sizeBucket(hub: DiscoverHub): Exclude<DiscoverSize, "any"> | null {
  if (typeof hub.memberCount !== "number" || !Number.isFinite(hub.memberCount)) return null;
  if (hub.memberCount < 50) return "small";
  if (hub.memberCount <= 500) return "medium";
  return "large";
}

export function matchesQuery(hub: DiscoverHub, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [hub.name, hub.description ?? "", hub.category ?? "", ...(hub.tags ?? [])].some((value) =>
    value.toLowerCase().includes(q),
  );
}

/** Categories with how many Hubs use each, most used first, then alphabetical. */
export function categoryCounts(hubs: readonly DiscoverHub[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const hub of hubs) {
    const name = (hub.category ?? "").trim();
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function createdTime(hub: DiscoverHub): number {
  const time = hub.createdAt ? new Date(hub.createdAt).getTime() : Number.NaN;
  return Number.isFinite(time) ? time : 0;
}

export function sortHubs(hubs: readonly DiscoverHub[], sort: DiscoverSort): DiscoverHub[] {
  const byName = (a: DiscoverHub, b: DiscoverHub) => a.name.localeCompare(b.name);
  const copy = [...hubs];
  switch (sort) {
    case "friends":
      return copy.sort(
        (a, b) => n(b.friendsInside) - n(a.friendsInside) || activityScore(b) - activityScore(a) || byName(a, b),
      );
    case "largest":
      return copy.sort((a, b) => n(b.memberCount) - n(a.memberCount) || byName(a, b));
    case "new":
      return copy.sort((a, b) => createdTime(b) - createdTime(a) || b.id - a.id);
    case "active":
    default:
      return copy.sort(
        (a, b) => activityScore(b) - activityScore(a) || n(b.memberCount) - n(a.memberCount) || byName(a, b),
      );
  }
}

export function filterHubs(hubs: readonly DiscoverHub[], filters: DiscoverFilters): DiscoverHub[] {
  const visible = hubs.filter(
    (hub) =>
      matchesQuery(hub, filters.query) &&
      (filters.category === "all" || (hub.category ?? "").trim() === filters.category) &&
      (filters.size === "any" || sizeBucket(hub) === filters.size) &&
      (!filters.friendsOnly || n(hub.friendsInside) > 0) &&
      (!filters.activeOnly || isActiveNow(hub)),
  );
  return sortHubs(visible, filters.sort);
}

export function hasActiveFilters(filters: DiscoverFilters): boolean {
  return (
    Boolean(filters.query.trim()) ||
    filters.category !== "all" ||
    filters.size !== "any" ||
    filters.friendsOnly ||
    filters.activeOnly
  );
}

/** "Mara and Jun are here", "Mara, Jun and 3 more are here". */
export function friendsLine(hub: DiscoverHub): string {
  const total = n(hub.friendsInside);
  if (total === 0) return "";
  const names = (hub.friendNames ?? []).filter(Boolean).slice(0, 2);
  if (!names.length) return `${total} friend${total === 1 ? "" : "s"} here`;
  const rest = total - names.length;
  if (rest <= 0) return names.length === 1 ? `${names[0]} is here` : `${names.join(" and ")} are here`;
  return `${names.join(", ")} and ${rest} more are here`;
}

// ---- Preview (GET /api/servers/:id/preview) ----

export type HubPreviewRoom = {
  id: number;
  name: string;
  type: "text" | "voice" | "forum";
  category: string;
  icon: string;
  threadCount: number;
  voiceCount: number;
};

export type HubPreview = DiscoverHub & {
  rooms: HubPreviewRoom[];
  nextEvent: { title: string; startsAt: number; going: number } | null;
  /** The Hub's rules from Hub Home, one per item. */
  rules: string[];
};

export function parseHubPreview(raw: unknown): HubPreview | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== "number" || typeof value.name !== "string") return null;
  const rooms = Array.isArray(value.rooms)
    ? value.rooms.flatMap((room): HubPreviewRoom[] => {
        if (!room || typeof room !== "object") return [];
        const r = room as Record<string, unknown>;
        if (typeof r.id !== "number" || typeof r.name !== "string") return [];
        const type = r.type === "voice" ? "voice" : r.type === "forum" ? "forum" : "text";
        return [
          {
            id: r.id,
            name: r.name,
            type,
            category: typeof r.category === "string" ? r.category : "",
            icon: typeof r.icon === "string" ? r.icon : "",
            threadCount: n(r.threadCount as number),
            voiceCount: n(r.voiceCount as number),
          },
        ];
      })
    : [];
  const ev = value.nextEvent as Record<string, unknown> | null | undefined;
  const nextEvent =
    ev && typeof ev.title === "string" && typeof ev.startsAt === "number"
      ? { title: ev.title, startsAt: ev.startsAt, going: n(ev.going as number) }
      : null;
  const home = value.home && typeof value.home === "object" ? (value.home as { rules?: unknown }) : null;
  const rules = typeof home?.rules === "string" ? hubRulesList(home.rules) : [];
  return { ...(value as unknown as DiscoverHub), rooms, nextEvent, rules };
}

export function previewRoomSummary(rooms: readonly HubPreviewRoom[]): {
  text: number;
  forum: number;
  voice: number;
  threads: number;
} {
  return rooms.reduce(
    (acc, room) => {
      acc[room.type] += 1;
      acc.threads += room.type === "forum" ? room.threadCount : 0;
      return acc;
    },
    { text: 0, forum: 0, voice: 0, threads: 0 },
  );
}
