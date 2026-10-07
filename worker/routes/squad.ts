// Squad Finder: games and suggestions, searches, matches and squad rooms.

import { requireUser } from "../lib/sessions";
import {
  ensureSquadGameSuggestionsSchema,
  SQUAD_GAMES,
  normalizedSquadGame,
  ensureSquadFinderSchema,
  resolveSquadGame,
  squadChoice,
  SQUAD_PLATFORMS,
  SQUAD_LANGUAGES,
  SQUAD_REGIONS,
  type SquadSearchRow,
  squadSearchForClient,
} from "../lib/squad";
import { json, bodyJson, idFromPath } from "../lib/http";
import { nowIso, ensureGroupChatSchema, groupChatMemberIds, getRole } from "../db";
import { requirePlatformOwner } from "../lib/platform-owner";
import { nextIntegerId } from "../lib/hubs";
import { realtimeBroadcast } from "../lib/realtime";
import { groupChatForClient } from "../lib/social";
import { ensureHubFeatureSchema } from "../lib/hub-schema";
import { ensureSoundboardSchema } from "../lib/soundboard";
import { attemptQueuedMediaDeletionIfQueued, hubMediaObjectKeys, queueHubMediaDeletionStatement } from "../lib/media";
import type { ApiContext } from "./context";

export async function handleSquadFinderRoutes({ request, env, p, method }: ApiContext): Promise<Response | null> {
  if (method === "GET" && p === "/api/squad-finder/games") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    await ensureSquadGameSuggestionsSchema(env);
    const approved = await env.DB.prepare(
      "SELECT game_name FROM decave_squad_game_suggestions WHERE status='approved' ORDER BY game_name COLLATE NOCASE",
    ).all<{ game_name: string }>();
    const games: string[] = [...SQUAD_GAMES];
    const known = new Set(games.map(normalizedSquadGame));
    for (const row of approved.results) {
      const key = normalizedSquadGame(row.game_name);
      if (!known.has(key)) {
        known.add(key);
        games.push(row.game_name);
      }
    }
    return json({ games }, 200, { "Cache-Control": "no-store, private" });
  }

  if (method === "POST" && p === "/api/squad-finder/game-suggestions") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    await ensureSquadGameSuggestionsSchema(env);
    const body = await bodyJson(request);
    const gameName = typeof body.gameName === "string" ? body.gameName.trim().replace(/\s+/g, " ") : "";
    if (gameName.length < 2 || gameName.length > 60)
      return json({ error: "Enter a game name between 2 and 60 characters." }, 400);
    const normalized = normalizedSquadGame(gameName);
    if (SQUAD_GAMES.some((game) => normalizedSquadGame(game) === normalized))
      return json({ error: "That game is already available." }, 409);
    const existing = await env.DB.prepare(
      "SELECT status FROM decave_squad_game_suggestions WHERE game_name_normalized=? ORDER BY created_at DESC LIMIT 1",
    )
      .bind(normalized)
      .first<{ status: string }>();
    if (existing?.status === "approved") return json({ error: "That game is already available." }, 409);
    if (existing?.status === "pending") return json({ error: "That game is already awaiting review." }, 409);
    const now = nowIso();
    await env.DB.prepare(
      `INSERT INTO decave_squad_game_suggestions(id,user_id,game_name,game_name_normalized,status,created_at)
       VALUES(?,?,?,?, 'pending', ?)
       ON CONFLICT(user_id,game_name_normalized) DO UPDATE SET game_name=excluded.game_name,status='pending',reviewed_by=NULL,reviewed_at=NULL,created_at=excluded.created_at`,
    )
      .bind(crypto.randomUUID(), user.id, gameName, normalized, now)
      .run();
    return json({ success: true, status: "pending", gameName });
  }

  if (method === "GET" && p === "/api/admin/squad-game-suggestions") {
    const owner = await requirePlatformOwner(request, env);
    if (owner instanceof Response) return owner;
    await ensureSquadGameSuggestionsSchema(env);
    const rows = await env.DB.prepare(
      `SELECT s.id,s.game_name,s.status,s.created_at,s.reviewed_at,u.username
       FROM decave_squad_game_suggestions s JOIN decave_users u ON u.id=s.user_id
       ORDER BY CASE s.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,s.created_at DESC LIMIT 250`,
    ).all<{
      id: string;
      game_name: string;
      status: string;
      created_at: string;
      reviewed_at: string | null;
      username: string;
    }>();
    return json({
      suggestions: rows.results.map((row) => ({
        id: row.id,
        gameName: row.game_name,
        status: row.status,
        createdAt: row.created_at,
        reviewedAt: row.reviewed_at,
        submittedBy: row.username,
      })),
    });
  }

  const squadSuggestionReview = idFromPath(p, /^\/api\/admin\/squad-game-suggestions\/([^/]+)\/(approve|reject)$/);
  if (method === "POST" && squadSuggestionReview) {
    const owner = await requirePlatformOwner(request, env);
    if (owner instanceof Response) return owner;
    await ensureSquadGameSuggestionsSchema(env);
    const suggestionId = decodeURIComponent(squadSuggestionReview[1]);
    const status = squadSuggestionReview[2] === "approve" ? "approved" : "rejected";
    const result = await env.DB.prepare(
      "UPDATE decave_squad_game_suggestions SET status=?,reviewed_by=?,reviewed_at=? WHERE id=? AND status='pending'",
    )
      .bind(status, owner.id, nowIso(), suggestionId)
      .run();
    if (!result.meta.changes) return json({ error: "That pending suggestion was not found." }, 404);
    return json({ success: true, status });
  }

  if (p === "/api/squad-finder" && (method === "GET" || method === "POST" || method === "DELETE")) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    await ensureGroupChatSchema(env.DB);
    await ensureSquadFinderSchema(env);

    if (method === "DELETE") {
      await env.DB.prepare("DELETE FROM decave_squad_searches WHERE user_id=?").bind(user.id).run();
      return json({ success: true });
    }

    if (method === "POST") {
      const body = await bodyJson(request);
      const game = await resolveSquadGame(env, body.game);
      const platform = squadChoice(body.platform, SQUAD_PLATFORMS);
      const language = squadChoice(body.language, SQUAD_LANGUAGES);
      const region = squadChoice(body.region, SQUAD_REGIONS);
      if (!game || !platform || !language || !region || typeof body.microphoneRequired !== "boolean") {
        return json({ error: "Choose a valid game, platform, language, region and microphone preference." }, 400);
      }
      const now = nowIso();
      const expires = new Date(Date.now() + 30 * 60_000).toISOString();
      await env.DB.prepare(
        `INSERT INTO decave_squad_searches(id,user_id,game,platform,language,region,microphone_required,group_id,status,created_at,updated_at,expires_at)
         VALUES(?,?,?,?,?,?,?,NULL,'active',?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET
           game=excluded.game, platform=excluded.platform, language=excluded.language,
           region=excluded.region, microphone_required=excluded.microphone_required,
           group_id=NULL, status='active', updated_at=excluded.updated_at, expires_at=excluded.expires_at`,
      )
        .bind(
          crypto.randomUUID(),
          user.id,
          game,
          platform,
          language,
          region,
          body.microphoneRequired ? 1 : 0,
          now,
          now,
          expires,
        )
        .run();
    }

    const current = await env.DB.prepare(
      `SELECT s.*,u.username,u.public_id,u.avatar_key,u.avatar_updated_at,
        CASE WHEN s.group_id IS NULL THEN 1 ELSE (SELECT COUNT(*) FROM decave_group_chat_members gm WHERE gm.group_id=s.group_id) END AS member_count
       FROM decave_squad_searches s JOIN decave_users u ON u.id=s.user_id
       WHERE s.user_id=? AND s.status='active' AND s.expires_at>?`,
    )
      .bind(user.id, nowIso())
      .first<SquadSearchRow>();
    if (!current) return json({ current: null, matches: [] }, 200, { "Cache-Control": "no-store, private" });

    const rows = await env.DB.prepare(
      `SELECT s.*,u.username,u.public_id,u.avatar_key,u.avatar_updated_at,
        CASE WHEN s.group_id IS NULL THEN 1 ELSE (SELECT COUNT(*) FROM decave_group_chat_members gm WHERE gm.group_id=s.group_id) END AS member_count
       FROM decave_squad_searches s JOIN decave_users u ON u.id=s.user_id
       WHERE s.user_id<>? AND s.status='active' AND s.expires_at>?
         AND s.game=? AND s.platform=? AND s.language=? AND s.region=? AND s.microphone_required=?
         AND (s.group_id IS NULL OR (SELECT COUNT(*) FROM decave_group_chat_members gm WHERE gm.group_id=s.group_id)<4)
       ORDER BY s.updated_at DESC LIMIT 60`,
    )
      .bind(
        user.id,
        nowIso(),
        current.game,
        current.platform,
        current.language,
        current.region,
        current.microphone_required,
      )
      .all<SquadSearchRow>();
    const seen = new Set<string>();
    const matches = rows.results
      .filter((row) => {
        const key = row.group_id || row.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(squadSearchForClient);
    return json({ current: squadSearchForClient(current), matches }, 200, { "Cache-Control": "no-store, private" });
  }

  const squadJoin = idFromPath(p, /^\/api\/squad-finder\/([^/]+)\/join$/);
  if (method === "POST" && squadJoin) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    await ensureGroupChatSchema(env.DB);
    await ensureSquadFinderSchema(env);
    const targetId = decodeURIComponent(squadJoin[1]);
    const now = nowIso();
    const [mine, target] = await Promise.all([
      env.DB.prepare("SELECT * FROM decave_squad_searches WHERE user_id=? AND status='active' AND expires_at>?")
        .bind(user.id, now)
        .first<SquadSearchRow>(),
      env.DB.prepare(
        `SELECT s.* FROM decave_squad_searches s JOIN decave_users u ON u.id=s.user_id
         WHERE s.id=? AND s.status='active' AND s.expires_at>?
           AND u.deleted_at IS NULL AND u.erased_at IS NULL AND u.erasure_started_at IS NULL LIMIT 1`,
      )
        .bind(targetId, now)
        .first<SquadSearchRow>(),
    ]);
    if (!mine) return json({ error: "Start your search before joining a squad." }, 400);
    if (!target || target.user_id === user.id) return json({ error: "That squad is no longer available." }, 404);
    if (
      mine.game !== target.game ||
      mine.platform !== target.platform ||
      mine.language !== target.language ||
      mine.region !== target.region ||
      mine.microphone_required !== target.microphone_required
    ) {
      return json({ error: "That squad no longer matches your required criteria." }, 409);
    }

    let groupId = target.group_id;
    const squadExpires = new Date(Date.now() + 30 * 60_000).toISOString();
    if (!groupId) {
      // Claim an ungrouped target and create the initial two-member group in
      // one D1 batch. Two simultaneous joins must observe only one winner;
      // the losing request re-reads the target and joins that group below.
      const candidateGroupId = crypto.randomUUID();
      await env.DB.batch([
        // Create the candidate first so the foreign key on
        // decave_squad_searches.group_id is valid when the claim update runs.
        // A losing candidate is removed immediately below after the target is
        // re-read, so concurrent claims cannot leave an orphaned group.
        env.DB.prepare(
          `INSERT INTO decave_group_chats(id,name,owner_user_id,created_at,updated_at)
           SELECT ?,?,?,?,?
           WHERE EXISTS(SELECT 1 FROM decave_users WHERE id=? AND deleted_at IS NULL
             AND erased_at IS NULL AND erasure_started_at IS NULL)`,
        ).bind(candidateGroupId, `${target.game} Squad`, target.user_id, now, now, target.user_id),
        env.DB.prepare(
          `UPDATE decave_squad_searches
           SET group_id=?,updated_at=?
           WHERE id=? AND status='active' AND group_id IS NULL
             AND EXISTS(SELECT 1 FROM decave_users WHERE id=decave_squad_searches.user_id
               AND deleted_at IS NULL AND erased_at IS NULL AND erasure_started_at IS NULL)
             AND EXISTS (SELECT 1 FROM decave_squad_searches WHERE user_id=? AND status='active' AND group_id IS NULL)`,
        ).bind(candidateGroupId, now, target.id, user.id),
        env.DB.prepare(
          `INSERT INTO decave_group_chat_members(group_id,user_id,added_at)
           SELECT ?,user_id,? FROM decave_squad_searches WHERE id=? AND group_id=?`,
        ).bind(candidateGroupId, now, target.id, candidateGroupId),
        env.DB.prepare(
          `INSERT INTO decave_group_chat_members(group_id,user_id,added_at)
           SELECT ?,user_id,? FROM decave_squad_searches WHERE user_id=? AND status='active' AND group_id IS NULL
             AND EXISTS (SELECT 1 FROM decave_group_chats WHERE id=?)
             AND EXISTS (SELECT 1 FROM decave_squad_searches WHERE id=? AND group_id=?)`,
        ).bind(candidateGroupId, now, user.id, candidateGroupId, target.id, candidateGroupId),
        env.DB.prepare(
          `UPDATE decave_squad_searches
           SET group_id=?,status='matched',updated_at=?,expires_at=?
           WHERE user_id=? AND status='active' AND group_id IS NULL
             AND EXISTS (SELECT 1 FROM decave_group_chat_members WHERE group_id=? AND user_id=?)`,
        ).bind(candidateGroupId, now, squadExpires, user.id, candidateGroupId, user.id),
      ]);
      const claimed = await env.DB.prepare("SELECT group_id FROM decave_squad_searches WHERE id=? AND status='active'")
        .bind(target.id)
        .first<{ group_id: string | null }>();
      groupId = claimed?.group_id ?? null;
      if (groupId !== candidateGroupId) {
        // This request lost the target claim. Its candidate has no members
        // because every member insert is guarded by the same claim, so it is
        // safe to remove before joining the winner. A losing candidate never
        // received a squad-room Hub or messages, so it owns no R2 objects.
        await env.DB.prepare("DELETE FROM decave_group_chats WHERE id=?").bind(candidateGroupId).run();
      }
      if (!groupId) return json({ error: "That squad is no longer available." }, 409);
    }

    if (groupId) {
      // The capacity predicate is part of the INSERT write. A prior COUNT()
      // followed by an INSERT allows two last-seat joins to create a group of
      // five, so never make the capacity decision in a separate read.
      const joinResults = await env.DB.batch([
        env.DB.prepare(
          `INSERT OR IGNORE INTO decave_group_chat_members(group_id,user_id,added_at)
           SELECT ?,?,?
           WHERE EXISTS (SELECT 1 FROM decave_group_chats WHERE id=?)
             AND (SELECT COUNT(*) FROM decave_group_chat_members WHERE group_id=?) < 4
             AND EXISTS (SELECT 1 FROM decave_squad_searches WHERE user_id=? AND status='active' AND group_id IS NULL)`,
        ).bind(groupId, user.id, now, groupId, groupId, user.id),
        env.DB.prepare(
          `UPDATE decave_squad_searches
           SET group_id=?,status='matched',updated_at=?,expires_at=?
           WHERE user_id=? AND status='active' AND group_id IS NULL
             AND EXISTS (SELECT 1 FROM decave_group_chat_members WHERE group_id=? AND user_id=?)`,
        ).bind(groupId, now, squadExpires, user.id, groupId, user.id),
        env.DB.prepare("UPDATE decave_group_chats SET updated_at=? WHERE id=?").bind(now, groupId),
      ]);
      const joined = Number(joinResults[0]?.meta?.changes ?? 0) > 0;
      const alreadyMember = await env.DB.prepare(
        "SELECT 1 FROM decave_group_chat_members WHERE group_id=? AND user_id=? LIMIT 1",
      )
        .bind(groupId, user.id)
        .first();
      if (!joined && !alreadyMember) return json({ error: "That squad is already full." }, 409);
    }

    let squadRoom = await env.DB.prepare("SELECT hub_id,room_id FROM decave_squad_rooms WHERE group_id=?")
      .bind(groupId)
      .first<{ hub_id: number; room_id: number }>();
    if (!squadRoom) {
      const hubName = `${target.game} Squad`.slice(0, 40);
      const targetStillActive = await env.DB.prepare(
        `SELECT 1 AS active FROM decave_users
         WHERE id=? AND deleted_at IS NULL AND erased_at IS NULL AND erasure_started_at IS NULL LIMIT 1`,
      )
        .bind(target.user_id)
        .first<{ active: number }>();
      if (!targetStillActive) return json({ error: "That squad is no longer available." }, 409);
      // nextIntegerId is intentionally kept for the legacy integer schema. A
      // concurrent room creator can read the same next value, so retry a
      // failed allocation after the winning batch commits.
      for (let attempt = 0; attempt < 3 && !squadRoom; attempt += 1) {
        const hubId = await nextIntegerId(env.DB, "decave_hubs");
        const roomId = await nextIntegerId(env.DB, "decave_rooms");
        try {
          await env.DB.batch([
            env.DB.prepare(
              `INSERT INTO decave_hubs(id,name,icon,owner_id,visibility,created_at,updated_at)
               SELECT ?,?,?,?,'private',?,?
               WHERE EXISTS(SELECT 1 FROM decave_users WHERE id=? AND deleted_at IS NULL
                 AND erased_at IS NULL AND erasure_started_at IS NULL)`,
            ).bind(hubId, hubName, "🎮", target.user_id, now, now, target.user_id),
            env.DB.prepare(
              `INSERT INTO decave_hub_members(hub_id,user_id,role,joined_at)
               SELECT ?,?,'owner',? WHERE EXISTS(
                 SELECT 1 FROM decave_users WHERE id=? AND deleted_at IS NULL
                   AND erased_at IS NULL AND erasure_started_at IS NULL
               )`,
            ).bind(hubId, target.user_id, now, target.user_id),
            env.DB.prepare(
              "INSERT OR IGNORE INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(?,?,'member',?)",
            ).bind(hubId, user.id, now),
            env.DB.prepare(
              "INSERT INTO decave_rooms(id,hub_id,name,type,category,position,private,icon,created_at,updated_at) VALUES(?,?,'Squad Lounge','voice','SQUAD',0,0,'🎧',?,?)",
            ).bind(roomId, hubId, now, now),
            // group_id is the transaction's uniqueness guard. If another
            // request created this room while we allocated IDs, this insert
            // keeps the existing mapping and the read below selects it.
            env.DB.prepare(
              "INSERT OR IGNORE INTO decave_squad_rooms(group_id,hub_id,room_id,created_at) VALUES(?,?,?,?)",
            ).bind(groupId, hubId, roomId, now),
          ]);
        } catch (error) {
          if (attempt === 2) throw error;
          continue;
        }
        squadRoom = await env.DB.prepare("SELECT hub_id,room_id FROM decave_squad_rooms WHERE group_id=?")
          .bind(groupId)
          .first<{ hub_id: number; room_id: number }>();
        if (!squadRoom) return json({ error: "Could not create the squad room." }, 503);
        if (squadRoom.hub_id !== hubId) {
          // We lost the room mapping race; remove the unreferenced candidate
          // hub so concurrent joins do not leak duplicate private hubs.
          await env.DB.prepare("DELETE FROM decave_hubs WHERE id=?").bind(hubId).run();
        }
      }
      if (!squadRoom) return json({ error: "Could not create the squad room." }, 503);
    } else {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(?,?,'member',?)",
      )
        .bind(squadRoom.hub_id, user.id, now)
        .run();
    }
    const memberIds = await groupChatMemberIds(env.DB, groupId);
    await realtimeBroadcast(env, { type: "GROUP_CHAT_UPDATED", groupId }, { userIds: memberIds });
    await realtimeBroadcast(env, { type: "SERVERS_REFRESH" }, { userIds: memberIds });
    return json(
      {
        group: await groupChatForClient(env, groupId),
        hubId: squadRoom.hub_id,
        channelId: squadRoom.room_id,
        channelName: "Squad Lounge",
      },
      201,
    );
  }

  const squadRoomLeave = idFromPath(p, /^\/api\/squad-finder\/rooms\/(\d+)\/leave$/);
  if (method === "POST" && squadRoomLeave) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    await ensureGroupChatSchema(env.DB);
    await ensureSquadFinderSchema(env);
    const hubId = Number(squadRoomLeave[1]);
    const squadRoom = await env.DB.prepare("SELECT group_id,room_id FROM decave_squad_rooms WHERE hub_id=?")
      .bind(hubId)
      .first<{ group_id: string; room_id: number }>();
    if (!squadRoom || !(await getRole(env.DB, hubId, user.id))) return json({ error: "Squad room not found." }, 404);
    const owners = await env.DB.prepare(
      `SELECT groups.owner_user_id,hubs.owner_id AS hub_owner_id
       FROM decave_group_chats groups JOIN decave_hubs hubs ON hubs.id=?
       WHERE groups.id=? LIMIT 1`,
    )
      .bind(hubId, squadRoom.group_id)
      .first<{ owner_user_id: string; hub_owner_id: string }>();
    if (!owners) return json({ error: "Squad room not found." }, 404);
    const isOwner = owners.owner_user_id === user.id || owners.hub_owner_id === user.id;
    if (isOwner && (owners.owner_user_id !== user.id || owners.hub_owner_id !== user.id))
      return json({ error: "Squad ownership is changing. Try again shortly." }, 409);
    const members = isOwner
      ? await env.DB.prepare(
          `SELECT members.user_id FROM decave_group_chat_members members
           JOIN decave_users users ON users.id=members.user_id
           WHERE members.group_id=? AND members.user_id<>?
             AND users.deleted_at IS NULL AND users.erased_at IS NULL AND users.erasure_started_at IS NULL
           ORDER BY members.added_at LIMIT 1`,
        )
          .bind(squadRoom.group_id, user.id)
          .all<{ user_id: string }>()
      : { results: [] as { user_id: string }[] };
    const nextOwner = members.results[0]?.user_id ?? null;
    if (isOwner && !nextOwner) {
      const remaining = await env.DB.prepare(
        "SELECT 1 AS present FROM decave_group_chat_members WHERE group_id=? AND user_id<>? LIMIT 1",
      )
        .bind(squadRoom.group_id, user.id)
        .first<{ present: number }>();
      if (remaining) return json({ error: "An eligible squad member must take ownership before you leave." }, 409);
    }
    const now = nowIso();
    const guardEligibleSuccessor =
      isOwner && nextOwner
        ? "AND EXISTS(SELECT 1 FROM decave_users WHERE id=? AND deleted_at IS NULL AND erased_at IS NULL AND erasure_started_at IS NULL)"
        : "";
    const guardCurrentOwnership = isOwner
      ? "AND EXISTS(SELECT 1 FROM decave_group_chats g JOIN decave_hubs h ON h.id=? WHERE g.id=? AND g.owner_user_id=? AND h.owner_id=?)"
      : "";
    const groupMemberRemoval = env.DB.prepare(
      `DELETE FROM decave_group_chat_members WHERE group_id=? AND user_id=? ${guardCurrentOwnership} ${guardEligibleSuccessor}`,
    );
    const searchReset = env.DB.prepare(
      `UPDATE decave_squad_searches SET group_id=NULL,updated_at=? WHERE user_id=? ${guardCurrentOwnership} ${guardEligibleSuccessor}`,
    );
    let squadMediaKeys: string[] = [];
    if (isOwner && !nextOwner) {
      await ensureHubFeatureSchema(env);
      await ensureSoundboardSchema(env);
      squadMediaKeys = await hubMediaObjectKeys(env.DB, hubId);
    }
    const ownershipGuardBindings = isOwner ? [hubId, squadRoom.group_id, user.id, user.id] : [];
    const successorGuardBindings = isOwner && nextOwner ? [nextOwner] : [];
    const statements = [
      groupMemberRemoval.bind(squadRoom.group_id, user.id, ...ownershipGuardBindings, ...successorGuardBindings),
      searchReset.bind(now, user.id, ...ownershipGuardBindings, ...successorGuardBindings),
    ];
    if (isOwner && nextOwner) {
      statements.push(
        env.DB.prepare(
          `UPDATE decave_group_chats SET owner_user_id=?,updated_at=? WHERE id=? AND owner_user_id=?
           AND EXISTS(SELECT 1 FROM decave_users WHERE id=? AND deleted_at IS NULL AND erased_at IS NULL AND erasure_started_at IS NULL)
           AND EXISTS(SELECT 1 FROM decave_hubs WHERE id=? AND owner_id=?)`,
        ).bind(nextOwner, now, squadRoom.group_id, user.id, nextOwner, hubId, user.id),
        env.DB.prepare(
          `UPDATE decave_hubs SET owner_id=?,updated_at=? WHERE id=? AND owner_id=?
           AND EXISTS(SELECT 1 FROM decave_users WHERE id=? AND deleted_at IS NULL AND erased_at IS NULL AND erasure_started_at IS NULL)
           AND EXISTS(SELECT 1 FROM decave_group_chats WHERE id=? AND owner_user_id=?)`,
        ).bind(nextOwner, now, hubId, user.id, nextOwner, squadRoom.group_id, user.id),
        env.DB.prepare(
          `UPDATE decave_hub_members SET role='owner' WHERE hub_id=? AND user_id=?
           AND EXISTS(SELECT 1 FROM decave_hubs WHERE id=? AND owner_id=?)`,
        ).bind(hubId, nextOwner, hubId, nextOwner),
        env.DB.prepare(
          `DELETE FROM decave_hub_members WHERE hub_id=? AND user_id=?
           AND EXISTS(SELECT 1 FROM decave_hubs WHERE id=? AND owner_id=?)`,
        ).bind(hubId, user.id, hubId, nextOwner),
      );
    } else if (isOwner) {
      // The media queue insert uses the same guard as the Hub deletion so
      // objects are queued only when the Hub row is really removed. The group
      // deletion is guarded on the Hub being gone (it was deleted just above).
      statements.push(
        queueHubMediaDeletionStatement(
          env.DB,
          hubId,
          now,
          `EXISTS(SELECT 1 FROM decave_hubs WHERE id=? AND owner_id=?)
           AND EXISTS(SELECT 1 FROM decave_group_chats WHERE id=? AND owner_user_id=?)`,
          [hubId, user.id, squadRoom.group_id, user.id],
        ),
        env.DB.prepare(
          `DELETE FROM decave_hubs WHERE id=? AND owner_id=?
           AND EXISTS(SELECT 1 FROM decave_group_chats WHERE id=? AND owner_user_id=?)`,
        ).bind(hubId, user.id, squadRoom.group_id, user.id),
        env.DB.prepare(
          `DELETE FROM decave_group_chats WHERE id=? AND owner_user_id=?
           AND NOT EXISTS(SELECT 1 FROM decave_hubs WHERE id=?)`,
        ).bind(squadRoom.group_id, user.id, hubId),
        env.DB.prepare(
          "DELETE FROM decave_attachment_access WHERE hub_id=? AND NOT EXISTS(SELECT 1 FROM decave_hubs WHERE id=?)",
        ).bind(hubId, hubId),
      );
    } else {
      statements.push(
        env.DB.prepare("DELETE FROM decave_hub_members WHERE hub_id=? AND user_id=?").bind(hubId, user.id),
      );
    }
    const leaveResults = await env.DB.batch(statements);
    if (isOwner && nextOwner && Number(leaveResults[0]?.meta.changes ?? 0) !== 1)
      return json({ error: "The next owner is no longer eligible. Try again." }, 409);
    if (
      isOwner &&
      !nextOwner &&
      (Number(leaveResults[3]?.meta.changes ?? 0) !== 1 || Number(leaveResults[4]?.meta.changes ?? 0) !== 1)
    )
      return json({ error: "Squad ownership changed. Try again." }, 409);
    if (isOwner && !nextOwner && squadMediaKeys.length) await attemptQueuedMediaDeletionIfQueued(env, squadMediaKeys);
    const remainingIds = await groupChatMemberIds(env.DB, squadRoom.group_id);
    await realtimeBroadcast(
      env,
      { type: "GROUP_CHAT_UPDATED", groupId: squadRoom.group_id },
      { userIds: remainingIds },
    );
    await realtimeBroadcast(
      env,
      { type: "ACCESS_REVOKED", serverId: hubId, message: "You left the squad room." },
      { userIds: [user.id] },
    );
    await realtimeBroadcast(env, { type: "SERVERS_REFRESH" }, { userIds: remainingIds });
    return json({ success: true });
  }

  return null;
}
