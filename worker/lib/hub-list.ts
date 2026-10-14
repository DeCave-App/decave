// Hubs as sent to the client (GET /api/servers, Discover, a Hub's detail and
// most Hub writes). One round of queries covers any number of Hubs: each D1
// query is a network round trip from the edge, so the old per-Hub and per-room
// lookups made opening Hubs take seconds.

import { parseCommunityFeatures } from "../../shared/streamer-mode";
import { safeJsonStringArray } from "../../shared/forum";
import { type HubHomeConfig, normalizeHubHomeConfig } from "../../shared/hub-home";
import {
  type HubRow,
  type ServerRole,
  type CustomRolePermission,
  ensureGroupChatSchema,
  officialHubPostingPolicyFromRow,
  parseCustomPermissions,
  safeStringArray,
} from "../db";
import type { Env } from "./env";
import { ensureHubFeatureSchema } from "./hub-schema";
import { ensureSquadFinderSchema } from "./squad";
import { ensureOfficialHubSchema } from "./official-hubs";
import { streamerHubsEnabled } from "./streamer";
import { streamerMigrationExists, streamerLayoutForHub } from "../streamer/index.ts";
import { mediaUrl } from "./media";
import { realtimeFetch } from "./realtime";

// D1 allows 100 bound parameters per query; leave room for the user id.
const IN_CHUNK = 90;

/** Runs one query per chunk of ids (in parallel) and concatenates the rows, for IN (...) lists of any length. */
export async function rowsForIds<T>(
  ids: readonly (number | string)[],
  query: (placeholders: string, chunk: (number | string)[]) => Promise<D1Result<T>>,
): Promise<T[]> {
  const chunks: (number | string)[][] = [];
  for (let offset = 0; offset < ids.length; offset += IN_CHUNK) chunks.push(ids.slice(offset, offset + IN_CHUNK));
  const results = await Promise.all(chunks.map((chunk) => query(chunk.map(() => "?").join(","), chunk)));
  return results.flatMap((result) => result.results);
}

function groupBy<T>(rows: readonly T[], key: (row: T) => number): Map<number, T[]> {
  const out = new Map<number, T[]>();
  for (const row of rows) {
    const id = key(row);
    const list = out.get(id);
    if (list) list.push(row);
    else out.set(id, [row]);
  }
  return out;
}

type RoomListRow = {
  id: number;
  hub_id: number;
  name: string;
  type: "text" | "voice";
  kind: "chat" | "forum";
  category: string;
  position: number;
  private: number;
  icon: string;
  forum_guidelines: string;
  forum_post_policy: "everyone" | "staff" | "roles" | "members";
  forum_post_role_ids_json: string;
  forum_post_member_ids_json: string;
  forum_tags_json: string;
  user_limit: number | null;
  post_policy: string | null;
  post_role_ids_json: string | null;
  accent: string | null;
  background_key: string | null;
};

/** What one member holds in one Hub, enough to decide room access and posting without more queries. */
export type HubMemberAccess = {
  role: ServerRole | null;
  permissions: ReadonlySet<CustomRolePermission>;
  roleIds: ReadonlySet<string>;
  /** Holds a custom role literally named "mod"/"moderator" (legacy forum staff). */
  namedModerator: boolean;
  /** Private rooms this member was granted individually. */
  grantedRoomIds: ReadonlySet<number>;
};

/** Same rule as canAccessRoom in lib/hubs.ts, from preloaded access. */
export function roomVisibleTo(room: { id: number; private: number }, access: HubMemberAccess): boolean {
  if (!access.role) return false;
  if (Number(room.private) !== 1) return true;
  if (access.role === "owner" || access.role === "admin") return true;
  return access.permissions.has("manageRooms") || access.grantedRoomIds.has(room.id);
}

/** Same rule as canPostInChatRoom in db.ts (isForumStaff included), from preloaded access. */
export function roomPostableBy(
  room: { kind: string; post_policy: string | null; post_role_ids_json: string | null },
  access: HubMemberAccess,
): boolean {
  const policy = room.post_policy ?? "everyone";
  if (policy === "everyone" || room.kind === "forum") return true;
  if (!access.role) return false;
  if (access.role === "owner" || access.role === "admin") return true;
  const staff =
    access.permissions.has("moderateMessages") || access.permissions.has("manageRooms") || access.namedModerator;
  if (policy === "staff") return staff;
  if (policy === "roles") {
    if (staff) return true;
    return safeStringArray(room.post_role_ids_json ?? "[]")
      .slice(0, 50)
      .some((id) => access.roleIds.has(id));
  }
  return false;
}

function homeFromRow(row: { sections_json: string; welcome: string; rules: string } | undefined): HubHomeConfig {
  let sections: unknown = [];
  try {
    sections = row ? JSON.parse(row.sections_json) : [];
  } catch {
    sections = [];
  }
  return normalizeHubHomeConfig({ sections, welcome: row?.welcome ?? "", rules: row?.rules ?? "" });
}

/** Online member counts for many Hubs in one realtime call (per-Hub fallback for an older Durable Object). */
async function onlineCountsForHubs(env: Env, hubIds: number[]): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  if (!hubIds.length) return counts;
  const response = await realtimeFetch(env, "/internal/counts", { hubIds });
  const data = response.ok
    ? ((await response.json().catch(() => null)) as { counts?: Record<string, number> } | null)
    : null;
  if (data?.counts && typeof data.counts === "object") {
    for (const id of hubIds) counts.set(id, Number(data.counts[String(id)] ?? 0));
    return counts;
  }
  await Promise.all(
    hubIds.map(async (hubId) => {
      const single = await realtimeFetch(env, "/internal/count", { hubId });
      const data = single.ok ? ((await single.json()) as { count?: number }) : {};
      counts.set(hubId, Number(data.count ?? 0));
    }),
  );
  return counts;
}

async function streamerLayouts(env: Env, hubIds: number[]): Promise<Set<number>> {
  const streamer = new Set<number>();
  if (!streamerHubsEnabled(env) || !(await streamerMigrationExists(env.DB))) return streamer;
  await Promise.all(
    hubIds.map(async (hubId) => {
      try {
        if ((await streamerLayoutForHub(env.DB, hubId)) === "streamer") streamer.add(hubId);
      } catch (error) {
        console.error("Could not read Streamer Hub layout", error instanceof Error ? error.name : "UnknownError");
      }
    }),
  );
  return streamer;
}

export type HubsForUserOptions = {
  /** Skip the room list (Discover drops it). The result's channels are then empty. */
  rooms?: boolean;
};

/**
 * Many Hubs as one user sees them, in the order given. Output matches the old
 * per-Hub serializer field for field. `streamerHubIds` (the user's Streamer
 * Hubs) avoids a layout lookup per Hub.
 */
export async function hubsForUser(
  env: Env,
  hubs: readonly HubRow[],
  userId: string,
  streamerHubIds?: ReadonlySet<number>,
  options: HubsForUserOptions = {},
) {
  if (!hubs.length) return [];
  await ensureHubFeatureSchema(env);
  await ensureGroupChatSchema(env.DB);
  await ensureSquadFinderSchema(env);
  await ensureOfficialHubSchema(env);
  const db = env.DB;
  const hubIds = hubs.map((hub) => hub.id);
  const ownerIds = [...new Set(hubs.map((hub) => hub.owner_id))];
  const withRooms = options.rooms !== false;

  const [
    styleRows,
    homeRows,
    squadRows,
    roleRows,
    membershipRows,
    postingRows,
    ownerRows,
    countRows,
    tagRows,
    roomRows,
    customRoleRows,
    grantRows,
    streamerIds,
  ] = await Promise.all([
    rowsForIds(hubIds, (ids, chunk) =>
      db
        .prepare(
          `SELECT id,icon_ring,theme,use_banner_background,chat_background_key,use_chat_background FROM decave_hubs WHERE id IN (${ids})`,
        )
        .bind(...chunk)
        .all<{
          id: number;
          icon_ring: number;
          theme: string;
          use_banner_background: number;
          chat_background_key: string | null;
          use_chat_background: number;
        }>(),
    ),
    rowsForIds(hubIds, (ids, chunk) =>
      db
        .prepare(`SELECT hub_id, sections_json, welcome, rules FROM decave_hub_home WHERE hub_id IN (${ids})`)
        .bind(...chunk)
        .all<{ hub_id: number; sections_json: string; welcome: string; rules: string }>(),
    ).catch((error) => {
      console.warn("Hub Home config unavailable", error instanceof Error ? error.name : "UnknownError");
      return null;
    }),
    rowsForIds(hubIds, (ids, chunk) =>
      db
        .prepare(`SELECT DISTINCT hub_id FROM decave_squad_rooms WHERE hub_id IN (${ids})`)
        .bind(...chunk)
        .all<{ hub_id: number }>(),
    ),
    rowsForIds(hubIds, (ids, chunk) =>
      db
        .prepare(`SELECT hub_id, role FROM decave_hub_members WHERE user_id=? AND hub_id IN (${ids})`)
        .bind(userId, ...chunk)
        .all<{ hub_id: number; role: ServerRole }>(),
    ),
    rowsForIds(hubIds, (ids, chunk) =>
      db
        .prepare(`SELECT hub_id, membership_private FROM decave_official_hubs WHERE hub_id IN (${ids})`)
        .bind(...chunk)
        .all<{ hub_id: number; membership_private: number }>(),
    ).catch(() => null),
    rowsForIds(hubIds, (ids, chunk) =>
      db
        .prepare(`SELECT hub_id, owner_only_posts FROM decave_official_hubs WHERE hub_id IN (${ids})`)
        .bind(...chunk)
        .all<{ hub_id: number; owner_only_posts: unknown }>(),
    ).catch(() => null),
    rowsForIds(ownerIds, (ids, chunk) =>
      db
        .prepare(`SELECT id, public_id FROM decave_users WHERE id IN (${ids})`)
        .bind(...chunk)
        .all<{ id: string; public_id: string | null }>(),
    ),
    rowsForIds(hubIds, (ids, chunk) =>
      db
        .prepare(`SELECT hub_id, COUNT(*) AS count FROM decave_hub_members WHERE hub_id IN (${ids}) GROUP BY hub_id`)
        .bind(...chunk)
        .all<{ hub_id: number; count: number }>(),
    ),
    rowsForIds(hubIds, (ids, chunk) =>
      db
        .prepare(`SELECT hub_id, tag FROM decave_hub_tags WHERE hub_id IN (${ids}) ORDER BY hub_id, tag`)
        .bind(...chunk)
        .all<{ hub_id: number; tag: string }>(),
    ),
    withRooms
      ? rowsForIds(hubIds, (ids, chunk) =>
          db
            .prepare(
              `SELECT id, hub_id, name, type, category, position, private, icon, kind, user_limit, post_policy, post_role_ids_json, accent, background_key,forum_guidelines,forum_post_policy,forum_post_role_ids_json,forum_post_member_ids_json,forum_tags_json
               FROM decave_rooms
               WHERE hub_id IN (${ids})
               ORDER BY hub_id, position, id`,
            )
            .bind(...chunk)
            .all<RoomListRow>(),
        )
      : Promise.resolve([] as RoomListRow[]),
    withRooms
      ? rowsForIds(hubIds, (ids, chunk) =>
          db
            .prepare(
              `SELECT mr.hub_id, mr.role_id, cr.permissions_json,
                 CASE WHEN cr.id IS NOT NULL AND LOWER(cr.name) IN ('mod','moderator') THEN 1 ELSE 0 END AS named_moderator
               FROM decave_member_roles mr
               LEFT JOIN decave_custom_roles cr ON cr.id = mr.role_id
               WHERE mr.user_id=? AND mr.hub_id IN (${ids})`,
            )
            .bind(userId, ...chunk)
            .all<{ hub_id: number; role_id: string; permissions_json: string | null; named_moderator: number }>(),
        )
      : Promise.resolve([]),
    withRooms
      ? rowsForIds(hubIds, (ids, chunk) =>
          db
            .prepare(
              `SELECT rm.room_id FROM decave_room_members rm
               JOIN decave_rooms r ON r.id = rm.room_id
               WHERE rm.user_id=? AND r.hub_id IN (${ids})`,
            )
            .bind(userId, ...chunk)
            .all<{ room_id: number }>(),
        )
      : Promise.resolve([]),
    streamerHubIds ? Promise.resolve(streamerHubIds) : streamerLayouts(env, hubIds),
  ]);

  const styleById = new Map(styleRows.map((row) => [Number(row.id), row]));
  const homeById = new Map((homeRows ?? []).map((row) => [Number(row.hub_id), row]));
  const squadHubIds = new Set(squadRows.map((row) => Number(row.hub_id)));
  const roleById = new Map(roleRows.map((row) => [Number(row.hub_id), row.role]));
  const privateHubIds = new Set(
    (membershipRows ?? []).filter((row) => Number(row.membership_private ?? 0) === 1).map((row) => Number(row.hub_id)),
  );
  const postingById = new Map((postingRows ?? []).map((row) => [Number(row.hub_id), row]));
  const ownerPublicIds = new Map(ownerRows.map((row) => [row.id, row.public_id]));
  const countById = new Map(countRows.map((row) => [Number(row.hub_id), Number(row.count ?? 0)]));
  const tagsById = groupBy(tagRows, (row) => Number(row.hub_id));
  const roomsById = groupBy(roomRows, (row) => Number(row.hub_id));
  const customRolesById = groupBy(customRoleRows, (row) => Number(row.hub_id));
  const grantedRoomIds = new Set(grantRows.map((row) => Number(row.room_id)));

  const canSeeMembership = (hubId: number) => !privateHubIds.has(hubId) || roleById.get(hubId) === "owner";
  const streamerLayoutIds = hubIds.filter((hubId) => streamerIds.has(hubId));
  const [onlineCounts, featureRows] = await Promise.all([
    onlineCountsForHubs(env, hubIds.filter(canSeeMembership)),
    streamerLayoutIds.length
      ? rowsForIds(streamerLayoutIds, (ids, chunk) =>
          db
            .prepare(`SELECT hub_id, community_features FROM decave_streamer_hubs WHERE hub_id IN (${ids})`)
            .bind(...chunk)
            .all<{ hub_id: number; community_features: string | null }>(),
        ).catch(() => [])
      : Promise.resolve([]),
  ]);
  const featuresById = new Map(featureRows.map((row) => [Number(row.hub_id), row.community_features]));

  return hubs.map((hub) => {
    const myRole = roleById.get(hub.id) ?? null;
    const style = styleById.get(hub.id);
    const membershipPrivate = privateHubIds.has(hub.id);
    const postingPolicy = postingRows
      ? officialHubPostingPolicyFromRow(postingById.get(hub.id) ?? null)
      : ({ status: "unavailable" } as const);
    const seesMembership = canSeeMembership(hub.id);
    const layout: "standard" | "streamer" = streamerIds.has(hub.id) ? "streamer" : "standard";
    const customRoles = customRolesById.get(hub.id) ?? [];
    const access: HubMemberAccess = {
      role: myRole,
      permissions: parseCustomPermissions(
        customRoles.flatMap((row) =>
          row.permissions_json === null ? [] : [{ permissions_json: row.permissions_json }],
        ),
      ),
      roleIds: new Set(customRoles.map((row) => row.role_id)),
      namedModerator: customRoles.some((row) => Number(row.named_moderator) === 1),
      grantedRoomIds,
    };
    const features = layout === "streamer" ? parseCommunityFeatures(featuresById.get(hub.id) ?? null) : null;
    return {
      id: hub.id,
      name: hub.name,
      icon: hub.icon,
      channels: (roomsById.get(hub.id) ?? [])
        .filter((room) => roomVisibleTo(room, access))
        .map(({ background_key: backgroundKey, ...room }) => ({
          ...room,
          accent: room.accent ?? null,
          backgroundUrl: mediaUrl(backgroundKey),
          type: room.kind === "forum" ? "forum" : room.type,
          private: room.private === 1,
          forumGuidelines: room.forum_guidelines,
          forumPostPolicy: room.forum_post_policy,
          forumPostRoleIds: safeJsonStringArray(room.forum_post_role_ids_json),
          forumPostMemberIds: safeJsonStringArray(room.forum_post_member_ids_json),
          forumTags: safeJsonStringArray(room.forum_tags_json),
          userLimit: Number(room.user_limit ?? 0),
          postPolicy: room.post_policy ?? "everyone",
          postRoleIds: safeJsonStringArray(room.post_role_ids_json ?? "[]"),
          canPost: roomPostableBy(room, access),
        })),
      ownerId: ownerPublicIds.get(hub.owner_id) ?? "",
      myRole,
      visibility: hub.visibility,
      memberCount: seesMembership ? (countById.get(hub.id) ?? 0) : null,
      onlineCount: seesMembership ? (onlineCounts.get(hub.id) ?? 0) : null,
      description: hub.description,
      accent: hub.accent,
      category: hub.category,
      tags: (tagsById.get(hub.id) ?? []).map((row) => row.tag),
      slowModeSeconds: hub.slow_mode_seconds,
      iconUrl: mediaUrl(hub.icon_key),
      bannerUrl: mediaUrl(hub.banner_key),
      headerUrl: mediaUrl(hub.header_key ?? null),
      chatBackgroundUrl: mediaUrl(style?.chat_background_key ?? null),
      iconRing: Number(style?.icon_ring ?? 0) === 1,
      theme: style?.theme ?? "midnight",
      useBannerBackground: Number(style?.use_banner_background ?? 0) === 1,
      useChatBackground: Number(style?.use_chat_background ?? 0) === 1,
      ...(features
        ? {
            communityFeatures: {
              voiceLimits: features.voiceLimits,
              subRoles: features.subRoles,
              faceitBadges: features.faceitBadges,
            },
          }
        : {}),
      isSquad: squadHubIds.has(hub.id),
      ownerOnlyPosting: postingPolicy.status === "unavailable" ? true : postingPolicy.ownerOnly,
      membershipPrivate,
      layout,
      home: homeFromRow(homeById.get(hub.id)),
    };
  });
}

/** One Hub as this user sees it. */
export async function hubForUser(env: Env, hub: HubRow, userId: string, streamerHubIds?: ReadonlySet<number>) {
  return (await hubsForUser(env, [hub], userId, streamerHubIds))[0];
}
