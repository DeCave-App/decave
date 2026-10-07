// Hub calendar events: /api/servers/:hubId/events (alias /api/hubs/:hubId/events).
import {
  customPermissions,
  getHub,
  getRole,
  getRoom,
  publicIdOf,
  userByReference,
  type RoomRow,
  type UserRow,
} from "./db";
import {
  HUB_EVENT_LIMITS,
  HUB_EVENT_RSVP_STATUSES,
  expandOccurrences,
  hubEventToIcs,
  validateHubEventInput,
  type HubEvent,
  type HubEventInput,
  type HubEventRsvpStatus,
} from "../shared/hub-events";
import { safeJsonStringArray } from "../shared/forum";

export type HubEventRow = {
  id: string;
  hub_id: number;
  channel_id: number | null;
  voice_channel_id: number | null;
  title: string;
  description: string;
  cover_url: string | null;
  starts_at: number;
  ends_at: number | null;
  timezone: string;
  recurrence: HubEvent["recurrence"];
  audience: HubEvent["audience"];
  audience_ids_json: string;
  reminder_minutes: number | null;
  capacity: number | null;
  game_tag: string | null;
  created_by: string;
  created_at: number;
  updated_at: number;
  cancelled_at: number | null;
};

export type HubEventDeps = {
  json(data: unknown, status?: number, headers?: HeadersInit): Response;
  requireUser(request: Request): Promise<UserRow | Response>;
  canAccessRoom(room: RoomRow, userId: string): Promise<boolean>;
  bodyJson(request: Request): Promise<Record<string, unknown>>;
  broadcast(event: unknown, filter: Record<string, unknown>): Promise<void>;
  now?: () => number;
};

type Viewer = {
  user: UserRow;
  hubId: number;
  role: "owner" | "admin" | "member";
  canManageAll: boolean;
  canCreate: boolean;
  roleIds: Set<string>;
};

const EVENT_ROUTE = /^\/api\/(?:servers|hubs)\/(\d+)\/events(?:\/([^/]+))?(?:\/(rsvp|ics))?$/;

export function matchHubEventRoute(pathname: string): RegExpMatchArray | null {
  return pathname.match(EVENT_ROUTE);
}

async function viewerFor(db: D1Database, hubId: number, user: UserRow): Promise<Viewer | null> {
  const role = await getRole(db, hubId, user.id);
  if (!role) return null;
  const perms = role === "owner" || role === "admin" ? null : await customPermissions(db, hubId, user.id);
  const canManageAll =
    role === "owner" || role === "admin" || Boolean(perms?.has("manageEvents") || perms?.has("manageRooms"));
  const roleRows = await db
    .prepare("SELECT role_id FROM decave_member_roles WHERE hub_id=? AND user_id=?")
    .bind(hubId, user.id)
    .all<{ role_id: string }>();
  return {
    user,
    hubId,
    role,
    canManageAll,
    canCreate: canManageAll,
    roleIds: new Set(roleRows.results.map((r) => r.role_id)),
  };
}

async function canSeeEvent(
  db: D1Database,
  deps: HubEventDeps,
  viewer: Viewer,
  row: HubEventRow,
  roomAccess: Map<number, boolean>,
): Promise<boolean> {
  if (viewer.canManageAll || row.created_by === viewer.user.id) return true;
  for (const roomId of [row.channel_id, row.voice_channel_id]) {
    if (roomId === null) continue;
    let ok = roomAccess.get(roomId);
    if (ok === undefined) {
      const room = await getRoom(db, roomId);
      ok = Boolean(room && room.hub_id === viewer.hubId && (await deps.canAccessRoom(room, viewer.user.id)));
      roomAccess.set(roomId, ok);
    }
    if (!ok) return false;
  }
  const ids = safeJsonStringArray(row.audience_ids_json);
  if (row.audience === "roles") return ids.some((id) => viewer.roleIds.has(id));
  if (row.audience === "members") return ids.includes(viewer.user.id);
  return true;
}

function rowToInput(row: HubEventRow): HubEventInput {
  return {
    title: row.title,
    description: row.description,
    coverUrl: row.cover_url,
    startsAt: Number(row.starts_at),
    endsAt: row.ends_at === null ? null : Number(row.ends_at),
    timezone: row.timezone,
    recurrence: row.recurrence,
    audience: row.audience,
    audienceIds: safeJsonStringArray(row.audience_ids_json),
    reminderMinutes: row.reminder_minutes,
    capacity: row.capacity,
    gameTag: row.game_tag,
    channelId: row.channel_id,
    voiceChannelId: row.voice_channel_id,
  };
}

/** audience ids are stored as internal user ids (members) / role ids (roles); serialized as public ids. */
async function serializeEvents(
  db: D1Database,
  viewer: Viewer,
  rows: { row: HubEventRow; occurrenceStart: number }[],
): Promise<HubEvent[]> {
  const eventIds = [...new Set(rows.map((r) => r.row.id))];
  const counts = new Map<string, { going: number; maybe: number; declined: number }>();
  const mine = new Map<string, HubEventRsvpStatus>();
  const going = new Map<string, string[]>();
  const publicIds = new Map<string, string>();
  const publicIdFor = async (userId: string) => {
    if (!publicIds.has(userId)) {
      const u = await db
        .prepare("SELECT id, public_id FROM decave_users WHERE id=?")
        .bind(userId)
        .first<{ id: string; public_id: string | null }>();
      publicIds.set(userId, u ? publicIdOf(u) : "");
    }
    return publicIds.get(userId) ?? "";
  };
  for (let i = 0; i < eventIds.length; i += 90) {
    const ids = eventIds.slice(i, i + 90);
    const marks = ids.map(() => "?").join(",");
    const countRows = await db
      .prepare(
        `SELECT event_id, status, COUNT(*) AS n FROM decave_hub_event_rsvps WHERE event_id IN (${marks}) GROUP BY event_id, status`,
      )
      .bind(...ids)
      .all<{ event_id: string; status: HubEventRsvpStatus; n: number }>();
    for (const r of countRows.results) {
      const c = counts.get(r.event_id) ?? { going: 0, maybe: 0, declined: 0 };
      c[r.status] = Number(r.n);
      counts.set(r.event_id, c);
    }
    const myRows = await db
      .prepare(`SELECT event_id, status FROM decave_hub_event_rsvps WHERE user_id=? AND event_id IN (${marks})`)
      .bind(viewer.user.id, ...ids)
      .all<{ event_id: string; status: HubEventRsvpStatus }>();
    for (const r of myRows.results) mine.set(r.event_id, r.status);
    const goingRows = await db
      .prepare(
        `SELECT r.event_id, u.public_id FROM decave_hub_event_rsvps r JOIN decave_users u ON u.id=r.user_id
       WHERE r.status='going' AND r.event_id IN (${marks}) ORDER BY r.updated_at DESC`,
      )
      .bind(...ids)
      .all<{ event_id: string; public_id: string | null }>();
    for (const r of goingRows.results) {
      const list = going.get(r.event_id) ?? [];
      if (list.length < HUB_EVENT_LIMITS.goingPreviewMax && r.public_id) list.push(r.public_id);
      going.set(r.event_id, list);
    }
  }
  const out: HubEvent[] = [];
  for (const { row, occurrenceStart } of rows) {
    const storedIds = safeJsonStringArray(row.audience_ids_json);
    const audienceIds =
      row.audience === "members" ? (await Promise.all(storedIds.map(publicIdFor))).filter(Boolean) : storedIds;
    const startsAt = Number(row.starts_at);
    const endsAt = row.ends_at === null ? null : Number(row.ends_at);
    out.push({
      id: row.id,
      hubId: row.hub_id,
      channelId: row.channel_id,
      voiceChannelId: row.voice_channel_id,
      title: row.title,
      description: row.description,
      coverUrl: row.cover_url,
      startsAt,
      endsAt,
      timezone: row.timezone,
      recurrence: row.recurrence,
      audience: row.audience,
      audienceIds,
      reminderMinutes: row.reminder_minutes === null ? null : Number(row.reminder_minutes),
      capacity: row.capacity === null ? null : Number(row.capacity),
      gameTag: row.game_tag,
      createdBy: await publicIdFor(row.created_by),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      cancelledAt: row.cancelled_at === null ? null : Number(row.cancelled_at),
      occurrenceStart,
      occurrenceEnd: endsAt === null ? null : occurrenceStart + (endsAt - startsAt),
      rsvpCounts: counts.get(row.id) ?? { going: 0, maybe: 0, declined: 0 },
      myRsvp: mine.get(row.id) ?? null,
      goingUserIds: going.get(row.id) ?? [],
      canManage: viewer.canManageAll || row.created_by === viewer.user.id,
    });
  }
  return out;
}

/** Validate rooms + audience ids against the hub; returns stored audience ids or an error response. */
async function resolveReferences(
  db: D1Database,
  deps: HubEventDeps,
  viewer: Viewer,
  input: HubEventInput,
): Promise<{ ok: true; storedAudienceIds: string[] } | { ok: false; response: Response }> {
  const bad = (field: string, error: string) => ({ ok: false as const, response: deps.json({ error, field }, 400) });
  if (input.channelId !== null) {
    const room = await getRoom(db, input.channelId);
    if (!room || room.hub_id !== viewer.hubId || room.type !== "text")
      return bad("channelId", "Announcement room must be a text room in this Hub.");
    if (!(await deps.canAccessRoom(room, viewer.user.id)))
      return bad("channelId", "You do not have access to that room.");
  }
  if (input.voiceChannelId !== null) {
    const room = await getRoom(db, input.voiceChannelId);
    if (!room || room.hub_id !== viewer.hubId || room.type !== "voice")
      return bad("voiceChannelId", "Voice room must be a voice room in this Hub.");
    if (!(await deps.canAccessRoom(room, viewer.user.id)))
      return bad("voiceChannelId", "You do not have access to that voice room.");
  }
  if (input.audience === "roles") {
    const marks = input.audienceIds.map(() => "?").join(",");
    const rows = await db
      .prepare(`SELECT id FROM decave_custom_roles WHERE hub_id=? AND id IN (${marks})`)
      .bind(viewer.hubId, ...input.audienceIds)
      .all<{ id: string }>();
    if (rows.results.length !== input.audienceIds.length)
      return bad("audienceIds", "Every role must belong to this Hub.");
    return { ok: true, storedAudienceIds: input.audienceIds };
  }
  if (input.audience === "members") {
    const stored: string[] = [];
    for (const reference of input.audienceIds) {
      const user = await userByReference(db, reference);
      if (!user || !(await getRole(db, viewer.hubId, user.id)))
        return bad("audienceIds", "Every member must belong to this Hub.");
      stored.push(user.id);
    }
    return { ok: true, storedAudienceIds: Array.from(new Set(stored)) };
  }
  return { ok: true, storedAudienceIds: [] };
}

async function hubMemberIds(db: D1Database, hubId: number): Promise<string[]> {
  const rows = await db
    .prepare("SELECT user_id FROM decave_hub_members WHERE hub_id=?")
    .bind(hubId)
    .all<{ user_id: string }>();
  return rows.results.map((r) => r.user_id);
}

async function notifyChanged(
  db: D1Database,
  deps: HubEventDeps,
  hubId: number,
  eventId: string,
  action: "created" | "updated" | "cancelled" | "rsvp",
) {
  try {
    await deps.broadcast(
      { type: "HUB_EVENTS_CHANGED", serverId: hubId, eventId, action },
      { userIds: await hubMemberIds(db, hubId) },
    );
  } catch {
    // Realtime fan-out is best effort; clients also refetch on navigation.
  }
}

export async function handleHubEventRoute(
  request: Request,
  env: { DB: D1Database },
  match: RegExpMatchArray,
  deps: HubEventDeps,
): Promise<Response | null> {
  const db = env.DB;
  const method = request.method.toUpperCase();
  const now = deps.now ? deps.now() : Date.now();
  const hubId = Number(match[1]);
  const eventId = match[2] ? decodeURIComponent(match[2]) : null;
  const sub = match[3] ?? null;

  const allowed =
    (!eventId && (method === "GET" || method === "POST")) ||
    (eventId && !sub && (method === "GET" || method === "PATCH" || method === "DELETE")) ||
    (eventId && sub === "rsvp" && method === "PUT") ||
    (eventId && sub === "ics" && method === "GET");
  if (!allowed) return null;

  const user = await deps.requireUser(request);
  if (user instanceof Response) return user;
  const hub = await getHub(db, hubId);
  if (!hub) return deps.json({ error: "Hub not found" }, 404);
  const viewer = await viewerFor(db, hubId, user);
  if (!viewer) return deps.json({ error: "You are not a member of this Hub" }, 403);
  const roomAccess = new Map<number, boolean>();

  // ---- collection ------------------------------------------------------
  if (!eventId && method === "GET") {
    const url = new URL(request.url);
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");
    const from = fromParam === null || fromParam === "" ? now - 31 * 86_400_000 : Number(fromParam);
    const to = toParam === null || toParam === "" ? from + 92 * 86_400_000 : Number(toParam);
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || to <= from)
      return deps.json({ error: "from/to must be ms timestamps with to > from" }, 400);
    if (to - from > HUB_EVENT_LIMITS.maxRangeMs) return deps.json({ error: "Range too large (max 400 days)" }, 400);
    const includeCancelled = url.searchParams.get("includeCancelled") === "1";
    const rows = await db
      .prepare(
        `SELECT * FROM decave_hub_events
       WHERE hub_id=? AND starts_at < ?
         AND (recurrence <> 'none' OR COALESCE(ends_at, starts_at + 1) > ?)
         ${includeCancelled ? "" : "AND cancelled_at IS NULL"}
       ORDER BY starts_at, id`,
      )
      .bind(hubId, to, from)
      .all<HubEventRow>();
    const occurrences: { row: HubEventRow; occurrenceStart: number }[] = [];
    for (const row of rows.results) {
      if (!(await canSeeEvent(db, deps, viewer, row, roomAccess))) continue;
      for (const start of expandOccurrences(
        {
          startsAt: Number(row.starts_at),
          endsAt: row.ends_at === null ? null : Number(row.ends_at),
          recurrence: row.recurrence,
          timezone: row.timezone,
        },
        from,
        to,
      )) {
        occurrences.push({ row, occurrenceStart: start });
      }
    }
    occurrences.sort((a, b) => a.occurrenceStart - b.occurrenceStart || a.row.id.localeCompare(b.row.id));
    const truncated = occurrences.length > HUB_EVENT_LIMITS.maxOccurrences;
    const events = await serializeEvents(db, viewer, occurrences.slice(0, HUB_EVENT_LIMITS.maxOccurrences));
    return deps.json({ events, truncated, canCreate: viewer.canCreate });
  }

  if (!eventId && method === "POST") {
    if (!viewer.canCreate) return deps.json({ error: "Missing manageEvents permission" }, 403);
    const body = await deps.bodyJson(request);
    const result = validateHubEventInput(body, { now });
    if (!result.ok) return deps.json({ error: result.error, field: result.field }, 400);
    const refs = await resolveReferences(db, deps, viewer, result.value);
    if (!refs.ok) return refs.response;
    const count = await db
      .prepare(
        "SELECT COUNT(*) AS n FROM decave_hub_events WHERE hub_id=? AND cancelled_at IS NULL AND (recurrence<>'none' OR starts_at > ?)",
      )
      .bind(hubId, now)
      .first<{ n: number }>();
    if (Number(count?.n ?? 0) >= 500) return deps.json({ error: "This Hub has too many upcoming events" }, 429);
    const id = crypto.randomUUID();
    const v = result.value;
    await db
      .prepare(
        `INSERT INTO decave_hub_events(id,hub_id,channel_id,voice_channel_id,title,description,cover_url,starts_at,ends_at,timezone,recurrence,audience,audience_ids_json,reminder_minutes,capacity,game_tag,created_by,created_at,updated_at,cancelled_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`,
      )
      .bind(
        id,
        hubId,
        v.channelId,
        v.voiceChannelId,
        v.title,
        v.description,
        v.coverUrl,
        v.startsAt,
        v.endsAt,
        v.timezone,
        v.recurrence,
        v.audience,
        JSON.stringify(refs.storedAudienceIds),
        v.reminderMinutes,
        v.capacity,
        v.gameTag,
        user.id,
        now,
        now,
      )
      .run();
    const row = await db.prepare("SELECT * FROM decave_hub_events WHERE id=?").bind(id).first<HubEventRow>();
    await notifyChanged(db, deps, hubId, id, "created");
    return deps.json(
      { event: (await serializeEvents(db, viewer, [{ row: row!, occurrenceStart: v.startsAt }]))[0] },
      201,
    );
  }

  // ---- single event ----------------------------------------------------
  const row = await db
    .prepare("SELECT * FROM decave_hub_events WHERE id=? AND hub_id=?")
    .bind(eventId, hubId)
    .first<HubEventRow>();
  if (!row || !(await canSeeEvent(db, deps, viewer, row, roomAccess)))
    return deps.json({ error: "Event not found" }, 404);
  const canManage = viewer.canManageAll || row.created_by === user.id;

  if (method === "GET" && sub === "ics") {
    const ics = hubEventToIcs(
      {
        id: row.id,
        title: row.title,
        description: row.description,
        startsAt: Number(row.starts_at),
        endsAt: row.ends_at === null ? null : Number(row.ends_at),
        recurrence: row.recurrence,
        cancelledAt: row.cancelled_at,
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
      },
      { hubName: hub.name, now },
    );
    const filename = (
      row.title
        .replace(/[^\w\- ]+/g, "")
        .trim()
        .slice(0, 60) || "event"
    ).replace(/\s+/g, "-");
    return new Response(ics, {
      status: 200,
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}.ics"`,
        "cache-control": "no-store, private",
      },
    });
  }

  if (method === "GET") {
    return deps.json({
      event: (await serializeEvents(db, viewer, [{ row, occurrenceStart: Number(row.starts_at) }]))[0],
    });
  }

  if (method === "PATCH") {
    if (!canManage) return deps.json({ error: "Only the event creator or an event manager can edit this event" }, 403);
    if (row.cancelled_at !== null) return deps.json({ error: "Cancelled events cannot be edited" }, 409);
    const body = await deps.bodyJson(request);
    // audienceIds for members come back from the API as public ids; translate the
    // stored internal ids so an untouched PATCH re-validates cleanly.
    const existing = rowToInput(row);
    if (existing.audience === "members") {
      const ids: string[] = [];
      for (const internalId of existing.audienceIds) {
        const u = await db
          .prepare("SELECT id, public_id FROM decave_users WHERE id=?")
          .bind(internalId)
          .first<{ id: string; public_id: string | null }>();
        if (u && publicIdOf(u)) ids.push(publicIdOf(u));
      }
      existing.audienceIds = ids;
    }
    const result = validateHubEventInput(body, { now, existing, partial: true });
    if (!result.ok) return deps.json({ error: result.error, field: result.field }, 400);
    const refs = await resolveReferences(db, deps, viewer, result.value);
    if (!refs.ok) return refs.response;
    const v = result.value;
    await db
      .prepare(
        `UPDATE decave_hub_events SET channel_id=?,voice_channel_id=?,title=?,description=?,cover_url=?,starts_at=?,ends_at=?,timezone=?,recurrence=?,audience=?,audience_ids_json=?,reminder_minutes=?,capacity=?,game_tag=?,updated_at=?
       WHERE id=? AND hub_id=?`,
      )
      .bind(
        v.channelId,
        v.voiceChannelId,
        v.title,
        v.description,
        v.coverUrl,
        v.startsAt,
        v.endsAt,
        v.timezone,
        v.recurrence,
        v.audience,
        JSON.stringify(refs.storedAudienceIds),
        v.reminderMinutes,
        v.capacity,
        v.gameTag,
        Math.max(now, Number(row.updated_at) + 1),
        row.id,
        hubId,
      )
      .run();
    const updated = await db.prepare("SELECT * FROM decave_hub_events WHERE id=?").bind(row.id).first<HubEventRow>();
    await notifyChanged(db, deps, hubId, row.id, "updated");
    return deps.json({
      event: (await serializeEvents(db, viewer, [{ row: updated!, occurrenceStart: v.startsAt }]))[0],
    });
  }

  if (method === "DELETE") {
    if (!canManage)
      return deps.json({ error: "Only the event creator or an event manager can cancel this event" }, 403);
    if (row.cancelled_at === null) {
      await db
        .prepare("UPDATE decave_hub_events SET cancelled_at=?,updated_at=? WHERE id=? AND hub_id=?")
        .bind(now, now, row.id, hubId)
        .run();
      await notifyChanged(db, deps, hubId, row.id, "cancelled");
    }
    return deps.json({ success: true, id: row.id, cancelledAt: row.cancelled_at ?? now });
  }

  if (method === "PUT" && sub === "rsvp") {
    if (row.cancelled_at !== null) return deps.json({ error: "This event was cancelled" }, 409);
    const body = await deps.bodyJson(request);
    const status = body.status;
    if (status !== null && !HUB_EVENT_RSVP_STATUSES.includes(status as HubEventRsvpStatus))
      return deps.json({ error: "status must be going, maybe, declined or null" }, 400);
    const lastEnd = row.recurrence === "none" ? (row.ends_at ?? row.starts_at) : null;
    if (lastEnd !== null && Number(lastEnd) < now) return deps.json({ error: "This event has already ended" }, 409);
    if (status === null) {
      await db.prepare("DELETE FROM decave_hub_event_rsvps WHERE event_id=? AND user_id=?").bind(row.id, user.id).run();
    } else if (status === "going" && row.capacity !== null) {
      // Conditional insert keeps the capacity check and write in one statement.
      const result = await db
        .prepare(
          `INSERT INTO decave_hub_event_rsvps(event_id,user_id,status,updated_at)
         SELECT ?,?, 'going', ?
         WHERE (SELECT COUNT(*) FROM decave_hub_event_rsvps WHERE event_id=? AND status='going' AND user_id<>?) < ?
         ON CONFLICT(event_id,user_id) DO UPDATE SET status='going', updated_at=excluded.updated_at`,
        )
        .bind(row.id, user.id, now, row.id, user.id, row.capacity)
        .run();
      if (!Number(result.meta?.changes ?? 0))
        return deps.json({ error: "This event is full", code: "EVENT_FULL" }, 409);
    } else {
      await db
        .prepare(
          `INSERT INTO decave_hub_event_rsvps(event_id,user_id,status,updated_at) VALUES(?,?,?,?)
         ON CONFLICT(event_id,user_id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at`,
        )
        .bind(row.id, user.id, status, now)
        .run();
    }
    await notifyChanged(db, deps, hubId, row.id, "rsvp");
    return deps.json({
      event: (await serializeEvents(db, viewer, [{ row, occurrenceStart: Number(row.starts_at) }]))[0],
    });
  }

  return null;
}
