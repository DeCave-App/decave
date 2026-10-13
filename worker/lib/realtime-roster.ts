// Batched D1 lookups and roster serialization for realtime presence and voice
// fan-out. The old fan-out queried users, roles, rooms and access once per
// (viewer x connected user), which made every connect cost O(N^2) queries.
// A RealtimeLookup is created per broadcast pass, loads what the pass needs in
// bounded IN (...) batches, and answers the per-viewer checks from memory.

import {
  type RoomRow,
  type ServerRole,
  type UserRow,
  customPermissions,
  presenceFieldsFor,
  presenceOnline,
  publicIdOf,
  publicUser,
} from "../db";

// D1 caps bound parameters per statement at 100.
const CHUNK = 90;

function chunks<T>(values: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) out.push(values.slice(offset, offset + size));
  return out;
}

const placeholders = (count: number) => Array.from({ length: count }, () => "?").join(",");

export type RosterSocket = {
  connectionId: string;
  userId: string | null;
  username: string | null;
  serverId: number;
  channelId: number;
};

export type RosterEntry = {
  id: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  serverId: number;
  channelId: number;
  role: ServerRole | null;
  status: string;
  statusText: string;
  activityText: string;
  bio: string;
  accent: string;
};

/** Presence of one account as a given viewer may see it (member list / friends list). */
export type PresenceHint = {
  userId: string;
  online: boolean;
  status: string;
  statusText: string;
  activityText: string;
};

/**
 * User rows and Hub memberships shared across passes for a few seconds, so a
 * reconnect burst of N clients doesn't re-read N rows per client. Entries are
 * dropped when a profile, membership or access change is broadcast, and the
 * TTL bounds anything that slips past those notifications.
 */
export class RealtimeDirectory {
  private users = new Map<string, { row: UserRow | null; at: number }>();
  private memberships = new Map<string, { roles: [number, ServerRole][]; at: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 20_000,
  ) {}

  user(id: string, now: number): UserRow | null | undefined {
    const entry = this.users.get(id);
    return entry && now - entry.at <= this.ttlMs ? entry.row : undefined;
  }

  setUser(id: string, row: UserRow | null, now: number): void {
    if (this.users.size >= this.maxEntries) this.users.clear();
    this.users.set(id, { row, at: now });
  }

  roles(userId: string, now: number): [number, ServerRole][] | undefined {
    const entry = this.memberships.get(userId);
    return entry && now - entry.at <= this.ttlMs ? entry.roles : undefined;
  }

  setRoles(userId: string, roles: [number, ServerRole][], now: number): void {
    if (this.memberships.size >= this.maxEntries) this.memberships.clear();
    this.memberships.set(userId, { roles, at: now });
  }

  forgetUsers(): void {
    this.users.clear();
  }

  forgetMemberships(): void {
    this.memberships.clear();
  }
}

export class RealtimeLookup {
  private users = new Map<string, UserRow | null>();
  private roles = new Map<string, ServerRole | null>();
  private membershipsLoaded = new Set<string>();
  private hubMembersLoaded = new Set<number>();
  private hubsOf = new Map<string, Set<number>>();
  private rooms = new Map<number, RoomRow | null>();
  private friendsOf = new Map<string, Set<string>>();
  private roomAccess = new Map<string, boolean>();

  constructor(
    private readonly db: D1Database,
    private readonly directory?: RealtimeDirectory,
  ) {}

  async loadUsers(ids: Iterable<string>): Promise<void> {
    const now = Date.now();
    const missing: string[] = [];
    for (const id of new Set(ids)) {
      if (!id || this.users.has(id)) continue;
      const cached = this.directory?.user(id, now);
      if (cached !== undefined) this.users.set(id, cached);
      else missing.push(id);
    }
    for (const chunk of chunks(missing)) {
      const rows = await this.db
        .prepare(`SELECT * FROM decave_users WHERE id IN (${placeholders(chunk.length)})`)
        .bind(...chunk)
        .all<UserRow>();
      for (const id of chunk) this.users.set(id, null);
      for (const row of rows.results) this.users.set(row.id, row);
      for (const id of chunk) this.directory?.setUser(id, this.users.get(id) ?? null, now);
    }
  }

  user(id: string): UserRow | null {
    return this.users.get(id) ?? null;
  }

  /** Every Hub membership of the given accounts. */
  async loadMembershipsOf(userIds: Iterable<string>): Promise<void> {
    const now = Date.now();
    const missing: string[] = [];
    for (const id of new Set(userIds)) {
      if (!id || this.membershipsLoaded.has(id)) continue;
      const cached = this.directory?.roles(id, now);
      if (cached) this.addMemberships(id, cached);
      else missing.push(id);
    }
    for (const chunk of chunks(missing)) {
      const rows = await this.db
        .prepare(`SELECT hub_id,user_id,role FROM decave_hub_members WHERE user_id IN (${placeholders(chunk.length)})`)
        .bind(...chunk)
        .all<{ hub_id: number; user_id: string; role: ServerRole }>();
      const byUser = new Map<string, [number, ServerRole][]>(chunk.map((id) => [id, []]));
      for (const row of rows.results) byUser.get(row.user_id)?.push([Number(row.hub_id), row.role]);
      for (const [id, roles] of byUser) {
        this.addMemberships(id, roles);
        this.directory?.setRoles(id, roles, now);
      }
    }
  }

  private addMemberships(userId: string, roles: [number, ServerRole][]): void {
    this.membershipsLoaded.add(userId);
    const hubs = this.hubsOf.get(userId) ?? new Set<number>();
    this.hubsOf.set(userId, hubs);
    for (const [hubId, role] of roles) {
      this.roles.set(`${hubId}:${userId}`, role);
      hubs.add(hubId);
    }
  }

  /** Every member of one Hub. */
  async loadHubMembers(hubId: number): Promise<void> {
    if (!hubId || this.hubMembersLoaded.has(hubId)) return;
    const rows = await this.db
      .prepare("SELECT user_id,role FROM decave_hub_members WHERE hub_id=?")
      .bind(hubId)
      .all<{ user_id: string; role: ServerRole }>();
    this.hubMembersLoaded.add(hubId);
    for (const row of rows.results) this.roles.set(`${hubId}:${row.user_id}`, row.role);
  }

  /** Hubs the account belongs to; requires loadMembershipsOf. */
  hubs(userId: string): Set<number> {
    return this.hubsOf.get(userId) ?? new Set();
  }

  async role(hubId: number, userId: string): Promise<ServerRole | null> {
    if (!hubId || !userId) return null;
    const key = `${hubId}:${userId}`;
    if (this.roles.has(key)) return this.roles.get(key) ?? null;
    if (this.membershipsLoaded.has(userId) || this.hubMembersLoaded.has(hubId)) return null;
    const row = await this.db
      .prepare("SELECT role FROM decave_hub_members WHERE hub_id=? AND user_id=?")
      .bind(hubId, userId)
      .first<{ role: ServerRole }>();
    this.roles.set(key, row?.role ?? null);
    return row?.role ?? null;
  }

  async loadRooms(ids: Iterable<number>): Promise<void> {
    const missing = [...new Set(ids)].filter((id) => id > 0 && !this.rooms.has(id));
    for (const chunk of chunks(missing)) {
      const rows = await this.db
        .prepare(`SELECT * FROM decave_rooms WHERE id IN (${placeholders(chunk.length)})`)
        .bind(...chunk)
        .all<RoomRow>();
      for (const id of chunk) this.rooms.set(id, null);
      for (const row of rows.results) this.rooms.set(Number(row.id), row);
    }
  }

  async room(id: number): Promise<RoomRow | null> {
    if (!(id > 0)) return null;
    if (!this.rooms.has(id)) await this.loadRooms([id]);
    return this.rooms.get(id) ?? null;
  }

  async loadFriends(userIds: Iterable<string>): Promise<void> {
    const missing = [...new Set(userIds)].filter((id) => id && !this.friendsOf.has(id));
    // Two IN lists per statement, so half the chunk size.
    for (const chunk of chunks(missing, CHUNK / 2)) {
      const list = placeholders(chunk.length);
      const rows = await this.db
        .prepare(`SELECT user_a,user_b FROM decave_friendships WHERE user_a IN (${list}) OR user_b IN (${list})`)
        .bind(...chunk, ...chunk)
        .all<{ user_a: string; user_b: string }>();
      for (const id of chunk) this.friendsOf.set(id, new Set());
      for (const row of rows.results) {
        this.friendsOf.get(row.user_a)?.add(row.user_b);
        this.friendsOf.get(row.user_b)?.add(row.user_a);
      }
    }
  }

  /** Requires loadFriends for `userId`. */
  friends(userId: string): Set<string> {
    return this.friendsOf.get(userId) ?? new Set();
  }

  /**
   * Same rule as HubRoom's canAccessRoom: Hub members see public rooms; private
   * rooms need owner/admin, the manageRooms permission or an explicit grant.
   */
  async canAccessRoom(room: RoomRow, userId: string): Promise<boolean> {
    const role = await this.role(room.hub_id, userId);
    if (!role) return false;
    if (Number(room.private) !== 1) return true;
    if (role === "owner" || role === "admin") return true;
    const key = `${room.id}:${userId}`;
    const cached = this.roomAccess.get(key);
    if (cached !== undefined) return cached;
    let allowed = (await customPermissions(this.db, room.hub_id, userId)).has("manageRooms");
    if (!allowed) {
      allowed = Boolean(
        await this.db
          .prepare("SELECT 1 FROM decave_room_members WHERE room_id=? AND user_id=? LIMIT 1")
          .bind(room.id, userId)
          .first(),
      );
    }
    this.roomAccess.set(key, allowed);
    return allowed;
  }

  /**
   * One connection as `viewer` may see it in the online roster, or null when
   * it is hidden from them. Mirrors the previous per-viewer broadcastUsers
   * filter: self, friends and same-Hub sockets, never invisible accounts.
   * Requires loadUsers + loadFriends(viewer) for the pair.
   */
  async rosterEntry(viewer: { userId: string; serverId: number }, st: RosterSocket): Promise<RosterEntry | null> {
    if (!st.userId || !st.username) return null;
    const self = st.userId === viewer.userId;
    const friend = this.friends(viewer.userId).has(st.userId);
    const sameHub = Boolean(viewer.serverId && st.serverId === viewer.serverId);
    if (!self && !friend && !sameHub) return null;
    const u = this.user(st.userId);
    if (!u) return null;
    // Roster membership itself reveals a live connection, even with an offline status.
    if (!self && !presenceOnline(u, true)) return null;
    const canSeeHub = Boolean(st.serverId && (self || (await this.role(st.serverId, viewer.userId))));
    if (!self && !friend && !canSeeHub) return null;
    const selectedRoom = canSeeHub && st.channelId ? await this.room(st.channelId) : null;
    const canSeeRoom = Boolean(
      selectedRoom &&
      selectedRoom.hub_id === st.serverId &&
      (self || (await this.canAccessRoom(selectedRoom, viewer.userId))),
    );
    const presence = presenceFieldsFor(u, true, self ? "self" : friend ? "friend" : "other");
    return {
      id: st.connectionId,
      userId: publicIdOf(u),
      username: st.username,
      avatarUrl: publicUser(u).avatarUrl,
      serverId: canSeeHub ? st.serverId : 0,
      channelId: canSeeRoom ? st.channelId : 0,
      role: canSeeHub ? await this.role(st.serverId, st.userId) : null,
      status: presence.status,
      statusText: presence.statusText,
      activityText: presence.activityText,
      bio: u.bio,
      accent: u.accent,
    };
  }

  /** Requires loadUsers(target) + loadFriends(viewer). */
  presenceHint(viewerUserId: string, targetUserId: string, connected: boolean): PresenceHint | null {
    const u = this.user(targetUserId);
    if (!u) return null;
    const self = viewerUserId === targetUserId;
    const relation = self ? "self" : this.friends(viewerUserId).has(targetUserId) ? "friend" : "other";
    const online = presenceOnline(u, connected);
    return { userId: publicIdOf(u), online, ...presenceFieldsFor(u, connected, relation) };
  }
}

/**
 * Short-lived session validity cache for broadcast recipients. Explicit
 * revocations close sockets directly (SESSION_REVOKED); this TTL only bounds
 * how long a missed revocation can keep receiving events.
 */
export class SessionValidityCache {
  private entries = new Map<string, { live: boolean; checkedAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 20_000,
  ) {}

  fresh(hash: string, now = Date.now()): boolean | undefined {
    const entry = this.entries.get(hash);
    if (!entry || now - entry.checkedAt > this.ttlMs) return undefined;
    return entry.live;
  }

  /** Last known answer regardless of age (used while D1 is unavailable). */
  lastKnown(hash: string): boolean | undefined {
    return this.entries.get(hash)?.live;
  }

  set(hash: string, live: boolean, now = Date.now()): void {
    if (this.entries.size >= this.maxEntries && !this.entries.has(hash)) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.delete(hash);
    this.entries.set(hash, { live, checkedAt: now });
  }

  forget(hash: string | null | undefined): void {
    if (hash) this.entries.delete(hash);
  }
}
