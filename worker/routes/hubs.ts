// Hubs: listing, discovery, creating, joining and leaving, share links,
// settings, Hub home, members, roles, invites, moderation and creating rooms.

import { requireUser } from "../lib/sessions";
import {
  type HubRow,
  getRole,
  nowIso,
  getHub,
  type RoomRow,
  audit,
  type UserRow,
  type ServerRole,
  publicIdOf,
  publicUser,
  activityTextFor,
  userByReference,
  usersAreFriends,
  hasPermission,
  createRawToken,
} from "../db";
import { streamerHubIdsForUserSafe, streamerHubsEnabled } from "../lib/streamer";
import { json, bodyJson, idFromPath } from "../lib/http";
import {
  hubForUser,
  discoverSignals,
  nextIntegerId,
  voiceCountsForRooms,
  tagsForHub,
  hubHomeConfig,
  CUSTOM_ROLE_PERMISSIONS,
  cleanRoomName,
  cleanRoomIcon,
  validatedHubRoleIds,
  validatedHubMemberPublicIds,
  replaceRoomMembers,
} from "../lib/hubs";
import {
  streamerMigrationExists,
  streamerHubCreationStatement,
  streamerRevokeParticipantStatements,
} from "../streamer/index.ts";
import { STREAMER_HUB_TEMPLATE } from "../../shared/streamer-mode";
import { getHubTemplate } from "../../shared/hub-templates";
import { sanitizeDiscordImport } from "../../shared/discord-template";
import { ensureCollaborationSchema, ensureHubFeatureSchema } from "../lib/hub-schema";
import { realtimeBroadcast, realtimeFetch, realtimeRecheckAccess } from "../lib/realtime";
import { normalizeHubHomeConfig } from "../../shared/hub-home";
import { officialHubMembershipPrivate } from "../lib/official-hubs";
import { safeJsonStringArray, normalizeForumTags } from "../../shared/forum";
import { ensureSoundboardSchema } from "../lib/soundboard";
import { attemptQueuedMediaDeletion } from "../lib/media";
import type { ApiContext } from "./context";

export async function handleHubListRoutes({ request, env, p, method }: ApiContext): Promise<Response | null> {
  if (method === "GET" && p === "/api/servers") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const rows = await env.DB.prepare(
      `SELECT h.* FROM decave_hubs h
         JOIN decave_hub_members hm ON hm.hub_id=h.id
         WHERE hm.user_id=? ORDER BY h.id`,
    )
      .bind(user.id)
      .all<HubRow>();
    const streamerHubIds = await streamerHubIdsForUserSafe(env, user.id);
    return json(await Promise.all(rows.results.map((hub) => hubForUser(env, hub, user.id, streamerHubIds))));
  }

  return null;
}

export async function handleHubRoutes({ request, env, p, method }: ApiContext): Promise<Response | null> {
  if (method === "GET" && p === "/api/servers/discover") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const rows = await env.DB.prepare("SELECT * FROM decave_hubs WHERE visibility='public' ORDER BY id").all<HubRow>();
    const streamerHubIds = await streamerHubIdsForUserSafe(env, user.id);
    const signals = await discoverSignals(
      env,
      user.id,
      rows.results.map((hub) => hub.id),
    );
    const result = await Promise.all(
      rows.results.map(async (hub) => {
        const role = await getRole(env.DB, hub.id, user.id);
        const base = await hubForUser(env, hub, user.id, streamerHubIds);
        // Hubs that keep their member list private reveal neither friends nor voice presence.
        const hidePeople = base.membershipPrivate === true && role !== "owner";
        const friendNames = hidePeople ? [] : (signals.friends.get(hub.id) ?? []);
        return {
          ...base,
          channels: undefined,
          home: undefined,
          joined: role !== null,
          myRole: role,
          createdAt: hub.created_at,
          friendsInside: friendNames.length,
          friendNames: friendNames.slice(0, 3),
          voiceCount: hidePeople ? 0 : (signals.voice.get(hub.id) ?? 0),
        };
      }),
    );
    result.sort(
      (a, b) => Number(a.joined) - Number(b.joined) || Number(b.memberCount ?? -1) - Number(a.memberCount ?? -1),
    );
    return json(result);
  }

  if (method === "POST" && p === "/api/servers") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const body = await bodyJson(request);
    const raw = typeof body.name === "string" ? body.name.trim() : "";
    if (!raw) return json({ error: "Server name is required" }, 400);
    const id = await nextIntegerId(env.DB, "decave_hubs");
    const roomId = await nextIntegerId(env.DB, "decave_rooms");
    const name = raw.slice(0, 40);
    const icon =
      typeof body.icon === "string" && body.icon.trim() ? body.icon.trim().slice(0, 4) : name.charAt(0).toUpperCase();
    const visibility = body.visibility === "public" ? "public" : "private";
    const streamerTemplate = body.templateId === "streamer";
    if (streamerTemplate && (!streamerHubsEnabled(env) || !(await streamerMigrationExists(env.DB)))) {
      return json({ error: "Streamer Hub templates are not available on this deployment." }, 404);
    }
    const template = streamerTemplate ? STREAMER_HUB_TEMPLATE : getHubTemplate(body.templateId);
    const imported = sanitizeDiscordImport(body.discordImport);
    const roomSpecs = imported?.rooms.length ? imported.rooms : template.rooms;
    const now = nowIso();
    await ensureCollaborationSchema(env);
    const templateRooms = roomSpecs.slice(0, 60);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO decave_hubs(id,name,icon,owner_id,visibility,created_at,updated_at)
         SELECT ?,?,?,?,?,?,?
         WHERE EXISTS(SELECT 1 FROM decave_users WHERE id=? AND deleted_at IS NULL
           AND erased_at IS NULL AND erasure_started_at IS NULL)`,
      ).bind(id, name, icon, user.id, visibility, now, now, user.id),
      env.DB.prepare(`INSERT INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(?,?, 'owner', ?)`).bind(
        id,
        user.id,
        now,
      ),
      ...(streamerTemplate ? [streamerHubCreationStatement(env.DB, id, now)] : []),
      ...templateRooms.map((room, index) =>
        env.DB.prepare(
          `INSERT INTO decave_rooms(id,hub_id,name,type,kind,category,position,private,icon,forum_guidelines,forum_post_policy,forum_post_role_ids_json,forum_post_member_ids_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).bind(
          roomId + index,
          id,
          room.name,
          room.type === "voice" ? "voice" : "text",
          room.type === "forum" ? "forum" : "chat",
          room.category,
          index,
          room.private ? 1 : 0,
          room.icon,
          "",
          "everyone",
          "[]",
          "[]",
          now,
          now,
        ),
      ),
      ...(imported?.roles ?? []).map((role, index) =>
        env.DB.prepare(
          `INSERT INTO decave_custom_roles(id,hub_id,name,color,permissions_json,position,created_at) VALUES(?,?,?,?,?,?,?)`,
        ).bind(crypto.randomUUID(), id, role.name, role.color, "[]", index, now),
      ),
    ]);
    const hub = await getHub(env.DB, id);
    await realtimeBroadcast(env, { type: "SERVERS_REFRESH" }, { userIds: [user.id] });
    return json(await hubForUser(env, hub!, user.id, streamerTemplate ? new Set([id]) : undefined), 201);
  }

  // Stable/permanent Hub links are intentionally disabled. DeCave now uses
  // expiring one-time invites (maxUses=1) so a leaked link cannot be reused.
  const hubShareLink = idFromPath(p, /^\/api\/servers\/(\d+)\/share-link$/);
  if (method === "POST" && hubShareLink) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    return json({ error: "Permanent Hub links are disabled. Generate a one-time invite instead." }, 410);
  }

  const hubShareJoin = idFromPath(p, /^\/api\/hub-links\/([^/]+)\/join$/);
  if (method === "POST" && hubShareJoin) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    return json({ error: "This permanent Hub link has been disabled. Ask for a new one-time invite." }, 410);
  }

  const hubJoin = idFromPath(p, /^\/api\/servers\/(\d+)\/join$/);
  if (method === "POST" && hubJoin) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const hubId = Number(hubJoin[1]);
    const hub = await getHub(env.DB, hubId);
    if (!hub) return json({ error: "Server not found" }, 404);
    const banned = await env.DB.prepare("SELECT 1 FROM decave_bans WHERE hub_id=? AND user_id=?")
      .bind(hubId, user.id)
      .first();
    if (banned) return json({ error: "You are banned from this Hub" }, 403);
    if (hub.visibility !== "public")
      return json({ error: "This server is private. You need an invite or access grant." }, 403);
    await env.DB.prepare(
      "INSERT OR IGNORE INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(?,?, 'member', ?)",
    )
      .bind(hubId, user.id, nowIso())
      .run();
    await realtimeBroadcast(env, { type: "SERVERS_REFRESH" }, { userIds: [user.id] });
    return json(await hubForUser(env, hub, user.id));
  }

  // Read-only look at a public Hub before joining (Discover preview sheet).
  const hubPreview = idFromPath(p, /^\/api\/servers\/(\d+)\/preview$/);
  if (method === "GET" && hubPreview) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const hubId = Number(hubPreview[1]);
    const hub = await getHub(env.DB, hubId);
    if (!hub) return json({ error: "Hub not found" }, 404);
    const role = await getRole(env.DB, hubId, user.id);
    if (hub.visibility !== "public" && role === null)
      return json({ error: "This Hub is private. You need an invite to see it." }, 403);
    const base = await hubForUser(env, hub, user.id);
    const hidePeople = base.membershipPrivate === true && role !== "owner";
    const roomRows = await env.DB.prepare(
      "SELECT * FROM decave_rooms WHERE hub_id=? AND private=0 ORDER BY position, id LIMIT 200",
    )
      .bind(hubId)
      .all<RoomRow & { icon?: string | null }>();
    const forumIds = roomRows.results.filter((room) => room.kind === "forum").map((room) => room.id);
    const voiceIds = roomRows.results.filter((room) => room.type === "voice").map((room) => room.id);
    const threadCounts = new Map<number, number>();
    if (forumIds.length) {
      try {
        const counts = await env.DB.prepare(
          `SELECT channel_id, COUNT(*) AS n FROM decave_forum_post_state WHERE channel_id IN (${forumIds.map(() => "?").join(",")}) GROUP BY channel_id`,
        )
          .bind(...forumIds)
          .all<{ channel_id: number; n: number }>();
        for (const row of counts.results) threadCounts.set(Number(row.channel_id), Number(row.n));
      } catch (error) {
        console.warn("Hub preview: forum counts unavailable", error);
      }
    }
    const voiceCounts = hidePeople ? new Map<number, number>() : await voiceCountsForRooms(env, voiceIds);
    let nextEvent: { title: string; startsAt: number; going: number } | null = null;
    try {
      const event = await env.DB.prepare(
        "SELECT id, title, starts_at FROM decave_hub_events WHERE hub_id=? AND audience='all' AND cancelled_at IS NULL AND starts_at>=? ORDER BY starts_at LIMIT 1",
      )
        .bind(hubId, Date.now())
        .first<{ id: string; title: string; starts_at: number }>();
      if (event) {
        const going = await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM decave_hub_event_rsvps WHERE event_id=? AND status='going'",
        )
          .bind(event.id)
          .first<{ n: number }>();
        nextEvent = { title: event.title, startsAt: Number(event.starts_at), going: Number(going?.n ?? 0) };
      }
    } catch (error) {
      console.warn("Hub preview: events unavailable", error);
    }
    const signals = hidePeople ? null : await discoverSignals(env, user.id, [hubId]);
    const friendNames = signals?.friends.get(hubId) ?? [];
    return json({
      ...base,
      channels: undefined,
      joined: role !== null,
      myRole: role,
      createdAt: hub.created_at,
      friendsInside: friendNames.length,
      friendNames: friendNames.slice(0, 3),
      voiceCount: [...voiceCounts.values()].reduce((sum, n) => sum + n, 0),
      rooms: roomRows.results.map((room) => ({
        id: room.id,
        name: room.name,
        type: room.kind === "forum" ? "forum" : room.type,
        category: room.category ?? "",
        icon: typeof room.icon === "string" ? room.icon : "",
        threadCount: threadCounts.get(room.id) ?? 0,
        voiceCount: voiceCounts.get(room.id) ?? 0,
      })),
      nextEvent,
    });
  }

  const hubLeave = idFromPath(p, /^\/api\/servers\/(\d+)\/leave$/);
  if (method === "POST" && hubLeave) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const hubId = Number(hubLeave[1]);
    const hub = await getHub(env.DB, hubId);
    if (!hub) return json({ error: "Server not found" }, 404);
    if (hub.owner_id === user.id)
      return json({ error: "The server owner cannot leave. Delete the server or transfer ownership first." }, 400);
    await env.DB.prepare("DELETE FROM decave_hub_members WHERE hub_id=? AND user_id=?").bind(hubId, user.id).run();
    const fallback = await env.DB.prepare(
      `SELECT h.id FROM decave_hubs h JOIN decave_hub_members hm ON hm.hub_id=h.id WHERE hm.user_id=? ORDER BY h.id LIMIT 1`,
    )
      .bind(user.id)
      .first<{ id: number }>();
    let fallbackChannelId = 0;
    if (fallback?.id) {
      const r = await env.DB.prepare(
        "SELECT id FROM decave_rooms WHERE hub_id=? ORDER BY CASE WHEN type='text' THEN 0 ELSE 1 END, position LIMIT 1",
      )
        .bind(fallback.id)
        .first<{ id: number }>();
      fallbackChannelId = Number(r?.id ?? 0);
    }
    await realtimeBroadcast(
      env,
      { type: "ACCESS_REVOKED", serverId: hubId, message: "You left this Hub." },
      { userIds: [user.id] },
    );
    return json({ success: true, serverId: hubId, fallbackServerId: Number(fallback?.id ?? 0), fallbackChannelId });
  }

  const hubBase = idFromPath(p, /^\/api\/servers\/(\d+)$/);
  if (hubBase && (method === "GET" || method === "PATCH" || method === "DELETE")) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const hubId = Number(hubBase[1]);
    const hub = await getHub(env.DB, hubId);
    if (!hub) return json({ error: "Server not found" }, 404);
    const role = await getRole(env.DB, hubId, user.id);
    if (method === "GET") {
      if (!role) return json({ error: "You do not have access to this server" }, 403);
      return json(await hubForUser(env, hub, user.id));
    }
    if (method === "PATCH") {
      if (role !== "owner" && role !== "admin") return json({ error: "Owner or admin permission required" }, 403);
      const body = await bodyJson(request);
      const name = typeof body.name === "string" ? body.name.trim().slice(0, 40) : "";
      if (!name) return json({ error: "Server name is required" }, 400);
      const icon =
        typeof body.icon === "string" && body.icon.trim() ? body.icon.trim().slice(0, 4) : name.charAt(0).toUpperCase();
      await env.DB.prepare("UPDATE decave_hubs SET name=?,icon=?,updated_at=? WHERE id=?")
        .bind(name, icon, nowIso(), hubId)
        .run();
      await realtimeBroadcast(env, { type: "SERVERS_REFRESH" }, { hubId });
      return json(await hubForUser(env, (await getHub(env.DB, hubId))!, user.id));
    }
    if (hub.owner_id !== user.id) return json({ error: "Only the server owner can do this" }, 403);
    await ensureHubFeatureSchema(env);
    await ensureSoundboardSchema(env);
    const mediaRows = await env.DB.prepare(
      `SELECT attachment_key AS object_key FROM decave_messages WHERE hub_id=? AND attachment_key IS NOT NULL
       UNION SELECT r2_key AS object_key FROM decave_attachment_access WHERE hub_id=?
       UNION SELECT r2_key AS object_key FROM decave_hub_assets WHERE hub_id=?
       UNION SELECT r2_key AS object_key FROM decave_soundboard_sounds WHERE hub_id=?
       UNION SELECT icon_key AS object_key FROM decave_hubs WHERE id=? AND icon_key IS NOT NULL
       UNION SELECT banner_key AS object_key FROM decave_hubs WHERE id=? AND banner_key IS NOT NULL
       UNION SELECT chat_background_key AS object_key FROM decave_hubs WHERE id=? AND chat_background_key IS NOT NULL`,
    )
      .bind(hubId, hubId, hubId, hubId, hubId, hubId, hubId)
      .all<{ object_key: string }>();
    const mediaKeys = [...new Set(mediaRows.results.map((row) => row.object_key))];
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO decave_media_deletion_queue(object_key,queued_at,attempts,last_attempt_at)
         SELECT object_key,?,0,NULL FROM (
           SELECT attachment_key AS object_key FROM decave_messages WHERE hub_id=? AND attachment_key IS NOT NULL
           UNION SELECT r2_key AS object_key FROM decave_attachment_access WHERE hub_id=?
           UNION SELECT r2_key AS object_key FROM decave_hub_assets WHERE hub_id=?
           UNION SELECT r2_key AS object_key FROM decave_soundboard_sounds WHERE hub_id=?
           UNION SELECT icon_key AS object_key FROM decave_hubs WHERE id=? AND icon_key IS NOT NULL
           UNION SELECT banner_key AS object_key FROM decave_hubs WHERE id=? AND banner_key IS NOT NULL
           UNION SELECT chat_background_key AS object_key FROM decave_hubs WHERE id=? AND chat_background_key IS NOT NULL
         )`,
      ).bind(nowIso(), hubId, hubId, hubId, hubId, hubId, hubId, hubId),
      env.DB.prepare("DELETE FROM decave_hubs WHERE id=?").bind(hubId),
      env.DB.prepare("DELETE FROM decave_attachment_access WHERE hub_id=?").bind(hubId),
    ]);
    await attemptQueuedMediaDeletion(env, mediaKeys);
    await realtimeBroadcast(
      env,
      { type: "SERVER_DELETED", serverId: hubId, fallbackServerId: 0, fallbackChannelId: 0 },
      { hubId },
    );
    return json({ success: true, deletedServerId: hubId, fallbackServerId: 0, fallbackChannelId: 0 });
  }

  const hubSettings = idFromPath(p, /^\/api\/servers\/(\d+)\/settings$/);
  if (method === "PATCH" && hubSettings) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const hubId = Number(hubSettings[1]);
    const role = await getRole(env.DB, hubId, user.id);
    if (role !== "owner" && role !== "admin") return json({ error: "Owner or admin permission required" }, 403);
    await ensureHubFeatureSchema(env);
    const hub = await getHub(env.DB, hubId);
    if (!hub) return json({ error: "Hub not found" }, 404);
    const body = await bodyJson(request);
    const description = typeof body.description === "string" ? body.description.trim().slice(0, 300) : hub.description;
    const accent = typeof body.accent === "string" && /^#[0-9a-fA-F]{6}$/.test(body.accent) ? body.accent : hub.accent;
    const category = typeof body.category === "string" ? body.category.trim().slice(0, 40) || "Gaming" : hub.category;
    const slow = Math.max(0, Math.min(120, Number(body.slowModeSeconds ?? hub.slow_mode_seconds) || 0));
    const ringRow = await env.DB.prepare(
      "SELECT icon_ring,theme,use_banner_background,use_chat_background FROM decave_hubs WHERE id=?",
    )
      .bind(hubId)
      .first<{ icon_ring: number; theme: string; use_banner_background: number; use_chat_background: number }>();
    const iconRing = typeof body.iconRing === "boolean" ? (body.iconRing ? 1 : 0) : Number(ringRow?.icon_ring ?? 0);
    const storedTheme =
      ringRow?.theme === "ember" ||
      ringRow?.theme === "forest" ||
      ringRow?.theme === "ocean" ||
      ringRow?.theme === "midnight"
        ? ringRow.theme
        : "midnight";
    const theme =
      body.theme === "ember" || body.theme === "forest" || body.theme === "ocean" || body.theme === "midnight"
        ? body.theme
        : storedTheme;
    const useBannerBackground =
      typeof body.useBannerBackground === "boolean"
        ? body.useBannerBackground
          ? 1
          : 0
        : Number(ringRow?.use_banner_background ?? 0) === 1
          ? 1
          : 0;
    const useChatBackground =
      typeof body.useChatBackground === "boolean"
        ? body.useChatBackground
          ? 1
          : 0
        : Number(ringRow?.use_chat_background ?? 0) === 1
          ? 1
          : 0;
    const tags = Array.isArray(body.tags)
      ? body.tags
          .filter((x): x is string => typeof x === "string")
          .map((x) => x.trim().slice(0, 24))
          .filter(Boolean)
          .slice(0, 6)
      : await tagsForHub(env.DB, hubId);
    const stmts = [
      env.DB.prepare(
        "UPDATE decave_hubs SET description=?,accent=?,category=?,slow_mode_seconds=?,icon_ring=?,theme=?,use_banner_background=?,use_chat_background=?,updated_at=? WHERE id=?",
      ).bind(
        description,
        accent,
        category,
        slow,
        iconRing,
        theme,
        useBannerBackground,
        useChatBackground,
        nowIso(),
        hubId,
      ),
      env.DB.prepare("DELETE FROM decave_hub_tags WHERE hub_id=?").bind(hubId),
    ];
    for (const tag of tags)
      stmts.push(env.DB.prepare("INSERT INTO decave_hub_tags(hub_id,tag) VALUES(?,?)").bind(hubId, tag));
    await env.DB.batch(stmts);
    await audit(env.DB, hubId, user.id, "hub.settings", undefined, "Updated hub profile/settings");
    await realtimeBroadcast(env, { type: "SERVERS_REFRESH" }, { hubId });
    return json(await hubForUser(env, (await getHub(env.DB, hubId))!, user.id));
  }

  // Hub Home: owners and admins choose the sections and write the Welcome message and Rules.
  const hubHome = idFromPath(p, /^\/api\/servers\/(\d+)\/home$/);
  if (method === "PATCH" && hubHome) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const hubId = Number(hubHome[1]);
    const role = await getRole(env.DB, hubId, user.id);
    if (role !== "owner" && role !== "admin")
      return json({ error: "Only the Hub owner or an admin can edit Hub Home." }, 403);
    await ensureHubFeatureSchema(env);
    const hub = await getHub(env.DB, hubId);
    if (!hub) return json({ error: "Hub not found" }, 404);
    const body = await bodyJson(request);
    const current = await hubHomeConfig(env, hubId);
    const next = normalizeHubHomeConfig({
      sections: body.sections === undefined ? current.sections : body.sections,
      welcome: body.welcome === undefined ? current.welcome : body.welcome,
      rules: body.rules === undefined ? current.rules : body.rules,
    });
    await env.DB.prepare(
      `INSERT INTO decave_hub_home(hub_id, sections_json, welcome, rules, updated_by, updated_at) VALUES(?,?,?,?,?,?)
       ON CONFLICT(hub_id) DO UPDATE SET sections_json=excluded.sections_json, welcome=excluded.welcome, rules=excluded.rules, updated_by=excluded.updated_by, updated_at=excluded.updated_at`,
    )
      .bind(hubId, JSON.stringify(next.sections), next.welcome, next.rules, user.id, nowIso())
      .run();
    await audit(env.DB, hubId, user.id, "hub.home", undefined, "Updated Hub Home");
    await realtimeBroadcast(env, { type: "SERVERS_REFRESH" }, { hubId });
    return json(await hubForUser(env, hub, user.id));
  }

  const visibility = idFromPath(p, /^\/api\/servers\/(\d+)\/visibility$/);
  if (method === "PATCH" && visibility) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const hubId = Number(visibility[1]);
    const hub = await getHub(env.DB, hubId);
    if (!hub) return json({ error: "Server not found" }, 404);
    if (hub.owner_id !== user.id) return json({ error: "Only the server owner can do this" }, 403);
    const body = await bodyJson(request);
    const value = body.visibility === "public" ? "public" : body.visibility === "private" ? "private" : null;
    if (!value) return json({ error: "Visibility must be private or public" }, 400);
    await env.DB.prepare("UPDATE decave_hubs SET visibility=?,updated_at=? WHERE id=?")
      .bind(value, nowIso(), hubId)
      .run();
    await realtimeBroadcast(env, { type: "SERVERS_REFRESH" }, { hubId });
    return json(await hubForUser(env, (await getHub(env.DB, hubId))!, user.id));
  }

  const hubMembers = idFromPath(p, /^\/api\/servers\/(\d+)\/members$/);
  if (method === "GET" && hubMembers) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const hubId = Number(hubMembers[1]);
    const requestingRole = await getRole(env.DB, hubId, user.id);
    if (!requestingRole) return json({ error: "You are not a member of this Hub" }, 403);
    if ((await officialHubMembershipPrivate(env.DB, hubId)) && requestingRole !== "owner")
      return json({ error: "Only the Hub owner can view this Hub's members" }, 403);
    await ensureCollaborationSchema(env);

    const rows = await env.DB.prepare(
      `SELECT u.*, hm.role, substr(hm.joined_at,1,10) AS joinedAt
                FROM decave_hub_members hm
                JOIN decave_users u ON u.id=hm.user_id
                WHERE hm.hub_id=?
                ORDER BY CASE hm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,u.username`,
    )
      .bind(hubId)
      .all<UserRow & { role: ServerRole; joinedAt: string }>();

    const friendshipRows = await env.DB.prepare(
      `SELECT CASE WHEN user_a=? THEN user_b ELSE user_a END AS friend_id
                FROM decave_friendships
                WHERE user_a=? OR user_b=?`,
    )
      .bind(user.id, user.id, user.id)
      .all<{ friend_id: string }>();
    const friendIds = new Set(friendshipRows.results.map((row) => row.friend_id));

    const onlineResponse = await realtimeFetch(env, "/internal/online-users");
    const onlineData = onlineResponse.ok ? ((await onlineResponse.json()) as { userIds?: string[] }) : {};
    const online = new Set(onlineData.userIds ?? []);

    const result = [] as unknown[];
    for (const row of rows.results) {
      const roleIds = await env.DB.prepare("SELECT role_id FROM decave_member_roles WHERE hub_id=? AND user_id=?")
        .bind(hubId, row.id)
        .all<{ role_id: string }>();
      const custom = await env.DB.prepare(
        `SELECT id,name,color,icon,permissions_json
                  FROM decave_custom_roles
                  WHERE hub_id=? AND id IN (${roleIds.results.map(() => "?").join(",") || "''"})`,
      )
        .bind(hubId, ...roleIds.results.map((x) => x.role_id))
        .all<{ id: string; name: string; color: string; icon: string; permissions_json: string }>();

      const isSelf = row.id === user.id;
      const isFriend = friendIds.has(row.id);
      const canSeePresence = isSelf || isFriend;
      const isOnline = canSeePresence && online.has(row.id) && row.status !== "invisible";

      result.push({
        userId: publicIdOf(row),
        username: row.username,
        role: row.role,
        customRoleIds: roleIds.results.map((x) => x.role_id),
        customRoles: custom.results.map((x) => ({
          id: x.id,
          name: x.name,
          color: x.color,
          icon: x.icon,
          permissions: JSON.parse(x.permissions_json),
        })),
        avatarUrl: publicUser(row).avatarUrl,
        isFriend,
        // Hub membership date only. Do not expose account creation or last-seen timestamps.
        joinedAt: row.joinedAt,
        status: isOnline ? row.status : "offline",
        statusText: isOnline ? row.status_text : "",
        activityText: isOnline ? activityTextFor(row, isSelf ? "self" : isFriend ? "friend" : "other") : "",
        online: isOnline,
      });
    }
    return json(result);
  }

  const hubAccess = idFromPath(p, /^\/api\/servers\/(\d+)\/access$/);
  if (method === "GET" && hubAccess) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const hubId = Number(hubAccess[1]);
    const hub = await getHub(env.DB, hubId);
    if (!hub) return json({ error: "Server not found" }, 404);
    const actorRole = await getRole(env.DB, hubId, user.id);
    if (actorRole !== "owner" && actorRole !== "admin")
      return json({ error: "Hub owner or admin access required" }, 403);

    const rows = await env.DB.prepare(
      `SELECT u.public_id AS userId,u.username
       FROM decave_friendships f
       JOIN decave_users u ON u.id=CASE WHEN f.user_a=? THEN f.user_b ELSE f.user_a END
       LEFT JOIN decave_hub_members hm ON hm.hub_id=? AND hm.user_id=u.id
       WHERE (f.user_a=? OR f.user_b=?) AND hm.user_id IS NULL
       ORDER BY u.username`,
    )
      .bind(user.id, hubId, user.id, user.id)
      .all<{ userId: string | null; username: string }>();
    return json({
      visibility: hub.visibility,
      users: rows.results.map((x) => ({ userId: x.userId ?? "", username: x.username, hasAccess: false, role: null })),
    });
  }

  const memberRole = idFromPath(p, /^\/api\/servers\/(\d+)\/members\/([^/]+)$/);
  if (memberRole && (method === "PUT" || method === "PATCH" || method === "DELETE")) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const hubId = Number(memberRole[1]);
    const targetUser = await userByReference(env.DB, decodeURIComponent(memberRole[2]));
    const targetId = targetUser?.id ?? "";
    if (!targetId) return json({ error: "User not found" }, 404);
    const hub = await getHub(env.DB, hubId);
    if (!hub) return json({ error: "Server not found" }, 404);
    const actorRole = await getRole(env.DB, hubId, user.id);
    if (actorRole !== "owner" && actorRole !== "admin")
      return json({ error: "Hub owner or admin access required" }, 403);

    if (method === "PUT") {
      if (!(await usersAreFriends(env.DB, user.id, targetId)))
        return json(
          { error: "Only your existing friends can be added directly. Use an invite link for non-friends." },
          403,
        );
      const banned = await env.DB.prepare("SELECT 1 FROM decave_bans WHERE hub_id=? AND user_id=? LIMIT 1")
        .bind(hubId, targetId)
        .first();
      if (banned) return json({ error: "This user is banned from the Hub" }, 409);
      await env.DB.prepare(
        "INSERT OR IGNORE INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(?,?, 'member', ?)",
      )
        .bind(hubId, targetId, nowIso())
        .run();
      await audit(env.DB, hubId, user.id, "member.add_friend", targetId);
      await realtimeBroadcast(env, { type: "SERVERS_REFRESH" }, { userIds: [targetId] });
      return json({ success: true, userId: publicIdOf(targetUser!), role: await getRole(env.DB, hubId, targetId) });
    }

    const targetRole = await getRole(env.DB, hubId, targetId);
    if (!targetRole) return json({ error: "User is not a Hub member" }, 404);
    if (targetId === hub.owner_id) return json({ error: "The Hub owner cannot be removed or changed here" }, 400);

    if (method === "DELETE") {
      const canRemove =
        actorRole === "owner" ? targetRole === "admin" || targetRole === "member" : targetRole === "member";
      if (!canRemove) return json({ error: "You cannot remove this Hub member" }, 403);
      await env.DB.batch([
        env.DB.prepare("DELETE FROM decave_member_roles WHERE hub_id=? AND user_id=?").bind(hubId, targetId),
        env.DB.prepare(
          "DELETE FROM decave_room_members WHERE user_id=? AND room_id IN (SELECT id FROM decave_rooms WHERE hub_id=?)",
        ).bind(targetId, hubId),
        env.DB.prepare("DELETE FROM decave_hub_members WHERE hub_id=? AND user_id=?").bind(hubId, targetId),
      ]);
      await audit(env.DB, hubId, user.id, "member.remove", targetId);
      await realtimeBroadcast(
        env,
        { type: "ACCESS_REVOKED", serverId: hubId, message: "You were removed from this Hub." },
        { userIds: [targetId] },
      );
      return json({ success: true, userId: publicIdOf(targetUser!) });
    }

    if (actorRole !== "owner") return json({ error: "Only the Hub owner can change Hub roles" }, 403);
    const body = await bodyJson(request);
    const role = body.role === "admin" ? "admin" : body.role === "member" ? "member" : null;
    if (!role) return json({ error: "Role must be admin or member" }, 400);
    await env.DB.prepare("UPDATE decave_hub_members SET role=? WHERE hub_id=? AND user_id=?")
      .bind(role, hubId, targetId)
      .run();
    await realtimeRecheckAccess(env, hubId);
    await realtimeBroadcast(env, { type: "SERVERS_REFRESH" }, { hubId });
    return json({ success: true, userId: publicIdOf(targetUser!), role });
  }

  const customAssign = idFromPath(p, /^\/api\/servers\/(\d+)\/members\/([^/]+)\/custom-roles$/);
  if (method === "PATCH" && customAssign) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const hubId = Number(customAssign[1]);
    const targetUser = await userByReference(env.DB, decodeURIComponent(customAssign[2]));
    const targetId = targetUser?.id ?? "";
    if (!targetId) return json({ error: "User not found" }, 404);
    const hub = await getHub(env.DB, hubId);
    if (!hub) return json({ error: "Hub not found" }, 404);
    if (hub.owner_id !== user.id) return json({ error: "Only the server owner can do this" }, 403);
    if (!(await getRole(env.DB, hubId, targetId))) return json({ error: "User is not a Hub member" }, 404);
    const body = await bodyJson(request);
    const roleIds = Array.isArray(body.roleIds)
      ? body.roleIds.filter((x): x is string => typeof x === "string").slice(0, 8)
      : [];
    const stmts = [
      env.DB.prepare("DELETE FROM decave_member_roles WHERE hub_id=? AND user_id=?").bind(hubId, targetId),
    ];
    for (const roleId of roleIds)
      stmts.push(
        env.DB.prepare(
          "INSERT OR IGNORE INTO decave_member_roles(hub_id,user_id,role_id) SELECT ?,?,id FROM decave_custom_roles WHERE id=? AND hub_id=?",
        ).bind(hubId, targetId, roleId, hubId),
      );
    await env.DB.batch(stmts);
    await audit(env.DB, hubId, user.id, "role.assign", targetId, roleIds.join(","));
    await realtimeRecheckAccess(env, hubId);
    return json({ success: true, roleIds });
  }

  const roles = idFromPath(p, /^\/api\/servers\/(\d+)\/roles$/);
  if (roles && (method === "GET" || method === "POST")) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const hubId = Number(roles[1]);
    const role = await getRole(env.DB, hubId, user.id);
    if (!role) return json({ error: "No access" }, 403);
    if (method === "GET") {
      const rows = await env.DB.prepare(
        "SELECT id,name,color,icon,permissions_json FROM decave_custom_roles WHERE hub_id=? ORDER BY position,id",
      )
        .bind(hubId)
        .all<{ id: string; name: string; color: string; icon: string; permissions_json: string }>();
      return json(
        rows.results.map((x) => ({
          id: x.id,
          name: x.name,
          color: x.color,
          icon: x.icon,
          permissions: safeJsonStringArray(x.permissions_json),
        })),
      );
    }
    const hub = await getHub(env.DB, hubId);
    if (hub?.owner_id !== user.id) return json({ error: "Only the server owner can do this" }, 403);
    const body = await bodyJson(request);
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 32) : "";
    if (!name) return json({ error: "Role name required" }, 400);
    const color = typeof body.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : "#62d6ff";
    const icon = typeof body.icon === "string" ? Array.from(body.icon.trim()).slice(0, 4).join("") : "";
    const allowed: readonly string[] = CUSTOM_ROLE_PERMISSIONS;
    const permissions = Array.isArray(body.permissions)
      ? Array.from(new Set(body.permissions.filter((x): x is string => typeof x === "string" && allowed.includes(x))))
      : [];
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO decave_custom_roles(id,hub_id,name,color,icon,permissions_json,created_at) VALUES(?,?,?,?,?,?,?)",
    )
      .bind(id, hubId, name, color, icon, JSON.stringify(permissions), nowIso())
      .run();
    await audit(env.DB, hubId, user.id, "role.create", undefined, name);
    return json({ id, name, color, icon, permissions }, 201);
  }
  const roleItem = idFromPath(p, /^\/api\/servers\/(\d+)\/roles\/([^/]+)$/);
  if (roleItem && (method === "PATCH" || method === "DELETE")) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const hubId = Number(roleItem[1]);
    const roleId = decodeURIComponent(roleItem[2]);
    const hub = await getHub(env.DB, hubId);
    if (!hub) return json({ error: "Hub not found" }, 404);
    if (hub.owner_id !== user.id) return json({ error: "Only the server owner can do this" }, 403);
    const existing = await env.DB.prepare(
      "SELECT id,name,color,icon,permissions_json FROM decave_custom_roles WHERE id=? AND hub_id=?",
    )
      .bind(roleId, hubId)
      .first<{ id: string; name: string; color: string; icon: string; permissions_json: string }>();
    if (!existing) return json({ error: "Custom role not found" }, 404);
    if (method === "DELETE") {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM decave_member_roles WHERE hub_id=? AND role_id=?").bind(hubId, roleId),
        env.DB.prepare("DELETE FROM decave_custom_roles WHERE id=? AND hub_id=?").bind(roleId, hubId),
      ]);
      await audit(env.DB, hubId, user.id, "role.delete", undefined, existing.name);
      await realtimeRecheckAccess(env, hubId);
      return json({ success: true, id: roleId });
    }
    const body = await bodyJson(request);
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 32) : "";
    if (!name) return json({ error: "Role name required" }, 400);
    const color = typeof body.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : existing.color;
    const icon = typeof body.icon === "string" ? Array.from(body.icon.trim()).slice(0, 4).join("") : existing.icon;
    const allowed: readonly string[] = CUSTOM_ROLE_PERMISSIONS;
    const permissions = Array.isArray(body.permissions)
      ? Array.from(new Set(body.permissions.filter((x): x is string => typeof x === "string" && allowed.includes(x))))
      : [];
    await env.DB.prepare(
      "UPDATE decave_custom_roles SET name=?,color=?,icon=?,permissions_json=? WHERE id=? AND hub_id=?",
    )
      .bind(name, color, icon, JSON.stringify(permissions), roleId, hubId)
      .run();
    await audit(env.DB, hubId, user.id, "role.update", undefined, name);
    await realtimeRecheckAccess(env, hubId);
    return json({ id: roleId, name, color, icon, permissions });
  }

  const invites = idFromPath(p, /^\/api\/servers\/(\d+)\/invites$/);
  if (invites && (method === "GET" || method === "POST")) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const hubId = Number(invites[1]);
    if (!(await hasPermission(env.DB, hubId, user.id, "createInvites")))
      return json({ error: "Missing createInvites permission" }, 403);
    if (method === "GET") {
      const rows = await env.DB.prepare(
        `SELECT i.code,u.public_id createdBy,i.created_at createdAt,i.expires_at expiresAt,i.max_uses maxUses,i.uses FROM decave_invites i LEFT JOIN decave_users u ON u.id=i.created_by WHERE i.hub_id=? ORDER BY i.created_at DESC`,
      )
        .bind(hubId)
        .all();
      return json(rows.results);
    }
    const body = await bodyJson(request);
    const expiresHours = Math.max(0, Math.min(720, Number(body.expiresHours) || 0));
    const maxRaw = Number(body.maxUses) || 0;
    const code = createRawToken().slice(0, 24);
    const createdAt = nowIso();
    const expiresAt = expiresHours ? new Date(Date.now() + expiresHours * 3600000).toISOString() : null;
    const maxUses = maxRaw > 0 ? Math.min(10000, maxRaw) : null;
    await env.DB.prepare(
      "INSERT INTO decave_invites(code,hub_id,created_by,created_at,expires_at,max_uses) VALUES(?,?,?,?,?,?)",
    )
      .bind(code, hubId, user.id, createdAt, expiresAt, maxUses)
      .run();
    await audit(env.DB, hubId, user.id, "invite.create", undefined, "Invite created");
    return json({ code, createdBy: publicIdOf(user), createdAt, expiresAt, maxUses, uses: 0 }, 201);
  }

  const inviteJoin = idFromPath(p, /^\/api\/invites\/([^/]+)\/join$/);
  if (method === "POST" && inviteJoin) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const code = decodeURIComponent(inviteJoin[1]);
    const invite = await env.DB.prepare("SELECT * FROM decave_invites WHERE code=? COLLATE NOCASE")
      .bind(code)
      .first<{ hub_id: number; expires_at: string | null; max_uses: number | null; uses: number }>();
    if (!invite) return json({ error: "Invite not found" }, 404);
    if (invite.expires_at && Date.parse(invite.expires_at) < Date.now()) return json({ error: "Invite expired" }, 410);
    const banned = await env.DB.prepare("SELECT 1 FROM decave_bans WHERE hub_id=? AND user_id=?")
      .bind(invite.hub_id, user.id)
      .first();
    if (banned) return json({ error: "You are banned from this Hub" }, 403);
    const existing = await getRole(env.DB, invite.hub_id, user.id);
    if (!existing) {
      const claimed = await env.DB.prepare(
        "UPDATE decave_invites SET uses=uses+1 WHERE code=? COLLATE NOCASE AND (max_uses IS NULL OR uses<max_uses) AND (expires_at IS NULL OR expires_at>?) RETURNING hub_id",
      )
        .bind(code, nowIso())
        .first<{ hub_id: number }>();
      if (!claimed) return json({ error: "Invite has expired or reached its use limit" }, 410);
      await env.DB.prepare(
        "INSERT OR IGNORE INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(?,?, 'member', ?)",
      )
        .bind(invite.hub_id, user.id, nowIso())
        .run();
    }
    const hub = await getHub(env.DB, invite.hub_id);
    await realtimeBroadcast(env, { type: "SERVERS_REFRESH" }, { userIds: [user.id] });
    return json(await hubForUser(env, hub!, user.id));
  }

  const auditRoute = idFromPath(p, /^\/api\/servers\/(\d+)\/audit$/);
  if (method === "GET" && auditRoute) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const hubId = Number(auditRoute[1]);
    if (!(await hasPermission(env.DB, hubId, user.id, "viewAudit")))
      return json({ error: "Missing viewAudit permission" }, 403);
    const rows = await env.DB.prepare(
      `SELECT a.id,a.action,actor.public_id actorUserId,actor.username actorUsername,target.public_id targetUserId,target.username targetUsername,a.detail,a.created_at timestamp FROM decave_audit a LEFT JOIN decave_users actor ON actor.id=a.actor_user_id LEFT JOIN decave_users target ON target.id=a.target_user_id WHERE a.hub_id=? ORDER BY a.created_at DESC LIMIT 100`,
    )
      .bind(hubId)
      .all();
    return json(rows.results);
  }

  const modRoute = idFromPath(p, /^\/api\/servers\/(\d+)\/members\/([^/]+)\/(kick|ban|timeout)$/);
  if (method === "POST" && modRoute) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const hubId = Number(modRoute[1]);
    const targetUser = await userByReference(env.DB, decodeURIComponent(modRoute[2]));
    const targetId = targetUser?.id ?? "";
    if (!targetId) return json({ error: "User not found" }, 404);
    const action = modRoute[3];
    const actorRole = await getRole(env.DB, hubId, user.id);
    const targetRole = await getRole(env.DB, hubId, targetId);
    const allowed =
      actorRole === "owner"
        ? targetRole === "admin" || targetRole === "member"
        : actorRole === "admin"
          ? targetRole === "member"
          : (await hasPermission(env.DB, hubId, user.id, "moderateMembers")) && targetRole === "member";
    if (!allowed) return json({ error: `You cannot ${action} this member` }, 403);
    const body = await bodyJson(request);
    const reason = typeof body.reason === "string" ? body.reason.slice(0, 120) : "";
    const streamerCleanup = (await streamerMigrationExists(env.DB))
      ? streamerRevokeParticipantStatements(env.DB, hubId, targetId)
      : [];
    if (action === "kick") {
      await env.DB.batch([
        env.DB.prepare(
          "DELETE FROM decave_room_members WHERE user_id=? AND room_id IN (SELECT id FROM decave_rooms WHERE hub_id=?)",
        ).bind(targetId, hubId),
        env.DB.prepare("DELETE FROM decave_hub_members WHERE hub_id=? AND user_id=?").bind(hubId, targetId),
        ...streamerCleanup,
      ]);
      await audit(env.DB, hubId, user.id, "member.kick", targetId, reason);
      await realtimeBroadcast(
        env,
        { type: "ACCESS_REVOKED", serverId: hubId, message: "You were kicked from this Hub." },
        { userIds: [targetId] },
      );
      return json({ success: true });
    }
    if (action === "ban") {
      await env.DB.batch([
        env.DB.prepare(
          "DELETE FROM decave_room_members WHERE user_id=? AND room_id IN (SELECT id FROM decave_rooms WHERE hub_id=?)",
        ).bind(targetId, hubId),
        env.DB.prepare("DELETE FROM decave_hub_members WHERE hub_id=? AND user_id=?").bind(hubId, targetId),
        env.DB.prepare(
          "INSERT OR REPLACE INTO decave_bans(hub_id,user_id,banned_by,reason,created_at) VALUES(?,?,?,?,?)",
        ).bind(hubId, targetId, user.id, reason, nowIso()),
        ...streamerCleanup,
      ]);
      await audit(env.DB, hubId, user.id, "member.ban", targetId, reason);
      await realtimeBroadcast(
        env,
        { type: "ACCESS_REVOKED", serverId: hubId, message: "You were banned from this Hub." },
        { userIds: [targetId] },
      );
      return json({ success: true });
    }
    const minutes = Math.max(0, Math.min(10080, Number(body.minutes) || 10));
    const until = new Date(Date.now() + minutes * 60000).toISOString();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT OR REPLACE INTO decave_timeouts(hub_id,user_id,timed_out_by,reason,expires_at,created_at) VALUES(?,?,?,?,?,?)",
      ).bind(hubId, targetId, user.id, reason, until, nowIso()),
      ...streamerCleanup,
    ]);
    await audit(env.DB, hubId, user.id, "member.timeout", targetId, `${minutes} minutes`);
    await realtimeRecheckAccess(env, hubId);
    return json({ success: true, until });
  }

  const createRoom = idFromPath(p, /^\/api\/servers\/(\d+)\/channels$/);
  if (method === "POST" && createRoom) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const hubId = Number(createRoom[1]);
    if (!(await hasPermission(env.DB, hubId, user.id, "manageRooms")))
      return json({ error: "Missing manageRooms permission" }, 403);
    const body = await bodyJson(request);
    const name = cleanRoomName(body.name);
    if (!name) return json({ error: "Room name is required" }, 400);
    const requestedType = body.type;
    const type =
      requestedType === "voice" ? "voice" : requestedType === "text" || requestedType === "forum" ? "text" : null;
    const kind = requestedType === "forum" ? "forum" : "chat";
    if (!type) return json({ error: "Room type must be text, voice, or forum" }, 400);
    const icon = cleanRoomIcon(body.icon);
    const dup = await env.DB.prepare("SELECT 1 FROM decave_rooms WHERE hub_id=? AND name=? AND type=? AND kind=?")
      .bind(hubId, name, type, kind)
      .first();
    if (dup) return json({ error: "Room already exists" }, 409);
    const id = await nextIntegerId(env.DB, "decave_rooms");
    const category = typeof body.category === "string" ? body.category.trim().slice(0, 40) : "";
    const position = Number(
      (
        await env.DB.prepare("SELECT COUNT(*) count FROM decave_rooms WHERE hub_id=?")
          .bind(hubId)
          .first<{ count: number }>()
      )?.count ?? 0,
    );
    const privateFlag = body.private === true ? 1 : 0;
    const now = nowIso();
    const forumGuidelines =
      kind === "forum" && typeof body.forumGuidelines === "string" ? body.forumGuidelines.trim().slice(0, 500) : "";
    const forumPostPolicy =
      kind === "forum" &&
      (body.forumPostPolicy === "staff" || body.forumPostPolicy === "roles" || body.forumPostPolicy === "members")
        ? body.forumPostPolicy
        : "everyone";
    const forumPostRoleIds =
      forumPostPolicy === "roles" ? await validatedHubRoleIds(env.DB, hubId, body.forumPostRoleIds) : [];
    if (forumPostRoleIds === null)
      return json({ error: "Forum posting roles must be roles of this Hub", field: "forumPostRoleIds" }, 400);
    const forumPostMemberIds =
      forumPostPolicy === "members" ? await validatedHubMemberPublicIds(env.DB, hubId, body.forumPostMemberIds) : [];
    if (forumPostMemberIds === null)
      return json({ error: "Forum posting members must be members of this Hub", field: "forumPostMemberIds" }, 400);
    const forumTagsResult =
      kind === "forum" ? normalizeForumTags(body.forumTags) : { ok: true as const, tags: [] as string[] };
    if (!forumTagsResult.ok) return json({ error: forumTagsResult.error, field: "forumTags" }, 400);
    const forumTags = forumTagsResult.tags;
    await env.DB.prepare(
      "INSERT INTO decave_rooms(id,hub_id,name,type,kind,category,position,private,icon,forum_guidelines,forum_post_policy,forum_post_role_ids_json,forum_post_member_ids_json,forum_tags_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        id,
        hubId,
        name,
        type,
        kind,
        category,
        position,
        privateFlag,
        icon,
        forumGuidelines,
        forumPostPolicy,
        JSON.stringify(forumPostRoleIds),
        JSON.stringify(forumPostMemberIds),
        JSON.stringify(forumTags),
        now,
        now,
      )
      .run();
    if (privateFlag === 1) await replaceRoomMembers(env.DB, id, hubId, user.id, body.memberIds);
    await realtimeBroadcast(env, { type: "SERVERS_REFRESH" }, { hubId });
    return json(
      {
        id,
        name,
        type: kind === "forum" ? "forum" : type,
        kind,
        category,
        position,
        private: privateFlag === 1,
        icon,
        forumGuidelines,
        forumPostPolicy,
        forumPostRoleIds,
        forumPostMemberIds,
        forumTags,
      },
      201,
    );
  }

  const reorderRooms = idFromPath(p, /^\/api\/servers\/(\d+)\/channels\/reorder$/);
  if (method === "POST" && reorderRooms) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const hubId = Number(reorderRooms[1]);
    if (!(await hasPermission(env.DB, hubId, user.id, "manageRooms")))
      return json({ error: "Missing manageRooms permission" }, 403);
    const body = await bodyJson(request);
    const orderedIds = Array.isArray(body.orderedIds)
      ? body.orderedIds.filter((id): id is number => Number.isSafeInteger(id) && id > 0)
      : [];
    if (!orderedIds.length || orderedIds.length > 250 || new Set(orderedIds).size !== orderedIds.length)
      return json({ error: "A unique room order is required" }, 400);
    const rows = (
      await env.DB.prepare("SELECT id,type,kind FROM decave_rooms WHERE hub_id=? ORDER BY position,id")
        .bind(hubId)
        .all<{ id: number; type: "text" | "voice"; kind: "chat" | "forum" }>()
    ).results;
    const first = rows.find((room) => room.id === orderedIds[0]);
    if (!first) return json({ error: "Room not found" }, 404);
    const displayType = (room: { type: "text" | "voice"; kind: "chat" | "forum" }) =>
      room.kind === "forum" ? "forum" : room.type;
    const group = rows.filter((room) => displayType(room) === displayType(first));
    if (group.length !== orderedIds.length || group.some((room) => !orderedIds.includes(room.id)))
      return json({ error: "The order must include every room in that section" }, 400);
    const updatedAt = nowIso();
    await env.DB.batch(
      orderedIds.map((id, position) =>
        env.DB.prepare("UPDATE decave_rooms SET position=?,updated_at=? WHERE id=? AND hub_id=?").bind(
          position,
          updatedAt,
          id,
          hubId,
        ),
      ),
    );
    await realtimeBroadcast(env, { type: "SERVERS_REFRESH" }, { hubId });
    return json({ success: true, orderedIds });
  }

  return null;
}
