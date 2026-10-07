// Discord template import into a Hub: preview, apply and roll back.

import { idFromPath, json, bodyJson } from "../lib/http";
import { requireUser } from "../lib/sessions";
import {
  extractDiscordTemplateCode,
  normalizeDiscordTemplatePayload,
  sanitizeDiscordImport,
  type DiscordImportExistingRole,
  type DiscordImportExistingRoom,
  buildDiscordImportDryRun,
} from "../../shared/discord-template";
import type { Env } from "../lib/env";
import { ensureCollaborationSchema } from "../lib/hub-schema";
import { hasPermission, nowIso, audit } from "../db";
import { nextIntegerId } from "../lib/hubs";
import { realtimeBroadcast } from "../lib/realtime";
import { ensureSquadFinderSchema } from "../lib/squad";
import type { ApiContext } from "./context";

export async function handleHubImportRoutes({ request, env, p, method }: ApiContext): Promise<Response | null> {
  const discordTemplate = idFromPath(p, /^\/api\/discord\/templates\/([^/]+)$/);
  if (method === "GET" && discordTemplate) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const code = extractDiscordTemplateCode(`https://discord.new/${decodeURIComponent(discordTemplate[1])}`);
    if (!code) return json({ error: "Invalid Discord Server Template code." }, 400);
    const response = await fetch(`https://discord.com/api/v10/guilds/templates/${encodeURIComponent(code)}`, {
      headers: { Accept: "application/json", "User-Agent": "DeCave local development client" },
    });
    if (!response.ok)
      return json(
        {
          error:
            response.status === 404
              ? "Discord template not found or unavailable."
              : "Discord template could not be retrieved.",
        },
        response.status === 404 ? 404 : 502,
      );
    const payload = await response.json<unknown>();
    return json(normalizeDiscordTemplatePayload(payload, code));
  }

  // Imports into an existing Hub are deliberately review-first. The preview
  // endpoint only reads the current structure; apply requires the caller's
  // fingerprint, and rollback can remove only untouched entities created by
  // that apply. Messages, edits, and assignments therefore survive rollback.
  const hubImportPreview = idFromPath(p, /^\/api\/servers\/(\d+)\/import\/preview$/);
  const hubImportApply = idFromPath(p, /^\/api\/servers\/(\d+)\/import\/apply$/);
  const hubImportRollback = idFromPath(p, /^\/api\/servers\/(\d+)\/import\/([^/]+)\/rollback$/);
  const readHubImportDryRun = async (env: Env, hubId: number, source: unknown) => {
    const sourceRecord = source && typeof source === "object" ? (source as Record<string, unknown>) : {};
    const sourceCreate =
      sourceRecord.create && typeof sourceRecord.create === "object"
        ? (sourceRecord.create as Record<string, unknown>)
        : null;
    const normalizedSource = sourceCreate
      ? {
          name: sourceRecord.sourceName,
          code: sourceRecord.sourceCode,
          rooms: sourceCreate.rooms,
          roles: sourceCreate.roles,
          unsupported: sourceRecord.unsupported,
        }
      : source;
    const sanitized = sanitizeDiscordImport(normalizedSource);
    if (!sanitized) return null;
    await ensureCollaborationSchema(env);
    const candidate =
      normalizedSource && typeof normalizedSource === "object" ? (normalizedSource as Record<string, unknown>) : {};
    const rooms = await env.DB.prepare(
      "SELECT id,name,type,kind,category,position FROM decave_rooms WHERE hub_id=? ORDER BY position,id",
    )
      .bind(hubId)
      .all<{
        id: number;
        name: string;
        type: "text" | "voice";
        kind: "chat" | "forum";
        category: string;
        position: number;
      }>();
    const roles = await env.DB.prepare(
      "SELECT id,name,color FROM decave_custom_roles WHERE hub_id=? ORDER BY position,id",
    )
      .bind(hubId)
      .all<DiscordImportExistingRole>();
    const existingRooms: DiscordImportExistingRoom[] = rooms.results.map((room) => ({
      id: room.id,
      name: room.name,
      type: room.kind === "forum" ? "forum" : room.type,
      category: room.category,
    }));
    return buildDiscordImportDryRun(
      {
        code: typeof candidate.code === "string" ? candidate.code : "",
        name: typeof candidate.name === "string" ? candidate.name : "Imported Discord Hub",
        rooms: sanitized.rooms,
        roles: sanitized.roles,
        unsupported: sanitized.unsupported,
      },
      existingRooms,
      roles.results,
    );
  };

  if (method === "POST" && hubImportPreview) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const hubId = Number(hubImportPreview[1]);
    if (!(await hasPermission(env.DB, hubId, user.id, "manageRooms")))
      return json({ error: "Missing manageRooms permission" }, 403);
    const body = await bodyJson(request);
    const source = body.discordImport ?? body.preview ?? body;
    const dryRun = await readHubImportDryRun(env, hubId, source);
    if (!dryRun) return json({ error: "A valid Discord structure preview is required." }, 400);
    return json(dryRun);
  }

  if (method === "POST" && hubImportApply) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const hubId = Number(hubImportApply[1]);
    if (!(await hasPermission(env.DB, hubId, user.id, "manageRooms")))
      return json({ error: "Missing manageRooms permission" }, 403);
    const body = await bodyJson(request);
    const source = body.discordImport ?? body.preview ?? body;
    const sourceRecord = source && typeof source === "object" ? (source as Record<string, unknown>) : {};
    const sourceCreate =
      sourceRecord.create && typeof sourceRecord.create === "object"
        ? (sourceRecord.create as Record<string, unknown>)
        : null;
    const dryRun = await readHubImportDryRun(env, hubId, source);
    if (!dryRun) return json({ error: "A valid Discord structure preview is required." }, 400);
    // A full preview can be fingerprinted against current Hub state. The
    // review component may send its already-filtered `create` plan instead;
    // that plan contains only entities approved for creation and is safe to
    // re-apply through the duplicate checks below.
    if (!sourceCreate && typeof body.fingerprint === "string" && body.fingerprint !== dryRun.fingerprint)
      return json({ error: "The Hub changed after this preview. Review the updated conflicts before applying." }, 409);
    await ensureCollaborationSchema(env);
    const importId = crypto.randomUUID();
    const roomId = await nextIntegerId(env.DB, "decave_rooms");
    const roomPositionRow = await env.DB.prepare(
      "SELECT COALESCE(MAX(position), -1) AS position FROM decave_rooms WHERE hub_id=?",
    )
      .bind(hubId)
      .first<{ position: number }>();
    const roomPosition = Number(roomPositionRow?.position ?? -1) + 1;
    const now = nowIso();
    const createdRoomRecords = dryRun.create.rooms.slice(0, 60).map((room, index) => ({
      id: roomId + index,
      name: room.name,
      type: room.type,
      category: room.category,
      position: roomPosition + index,
    }));
    const createdRoleRecords = dryRun.create.roles
      .slice(0, 24)
      .map((role) => ({ id: crypto.randomUUID(), name: role.name, color: role.color }));
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO decave_hub_imports(id,hub_id,created_by,fingerprint,created_at) VALUES(?,?,?,?,?)",
      ).bind(importId, hubId, user.id, dryRun.fingerprint, now),
      ...createdRoomRecords.map((room) =>
        env.DB.prepare(
          `INSERT INTO decave_rooms(id,hub_id,name,type,kind,category,position,private,icon,forum_guidelines,forum_post_policy,forum_post_role_ids_json,forum_post_member_ids_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).bind(
          room.id,
          hubId,
          room.name,
          room.type === "voice" ? "voice" : "text",
          room.type === "forum" ? "forum" : "chat",
          room.category,
          room.position,
          0,
          room.type === "voice" ? "🔊" : room.type === "forum" ? "▤" : "💬",
          "",
          "everyone",
          "[]",
          "[]",
          now,
          now,
        ),
      ),
      ...createdRoleRecords.map((role, index) =>
        env.DB.prepare(
          `INSERT INTO decave_custom_roles(id,hub_id,name,color,permissions_json,position,created_at) VALUES(?,?,?,?,?,?,?)`,
        ).bind(role.id, hubId, role.name, role.color, "[]", index, now),
      ),
      ...createdRoomRecords.map((room) =>
        env.DB.prepare(
          `INSERT INTO decave_hub_import_rooms(
           import_id,room_id,name,type,kind,category,position,private,icon,
           forum_guidelines,forum_post_policy,forum_post_role_ids_json,
           forum_post_member_ids_json,created_at,updated_at
         ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).bind(
          importId,
          room.id,
          room.name,
          room.type === "voice" ? "voice" : "text",
          room.type === "forum" ? "forum" : "chat",
          room.category,
          room.position,
          0,
          room.type === "voice" ? "🔊" : room.type === "forum" ? "▤" : "💬",
          "",
          "everyone",
          "[]",
          "[]",
          now,
          now,
        ),
      ),
      ...createdRoleRecords.map((role) =>
        env.DB.prepare(
          "INSERT INTO decave_hub_import_roles(import_id,role_id,name,color,icon,created_at) VALUES(?,?,?,?,?,?)",
        ).bind(importId, role.id, role.name, role.color, "", now),
      ),
    ]);
    await audit(
      env.DB,
      hubId,
      user.id,
      "hub.import.apply",
      undefined,
      `${importId}:${createdRoomRecords.length} rooms, ${createdRoleRecords.length} roles`,
    );
    await realtimeBroadcast(env, { type: "SERVERS_REFRESH" }, { hubId });
    return json(
      {
        importId,
        createdRoomIds: createdRoomRecords.map((room) => room.id),
        createdRooms: createdRoomRecords,
        createdRoleIds: createdRoleRecords.map((role) => role.id),
        createdRoles: createdRoleRecords,
        retainedConflictCount: dryRun.conflicts.length,
        rollback: "available",
      },
      201,
    );
  }

  if (method === "POST" && hubImportRollback) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const hubId = Number(hubImportRollback[1]);
    if (!(await hasPermission(env.DB, hubId, user.id, "manageRooms")))
      return json({ error: "Missing manageRooms permission" }, 403);
    let importId = "";
    try {
      importId = decodeURIComponent(hubImportRollback[2]);
    } catch {
      return json({ error: "Import not found." }, 404);
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(importId)) {
      return json({ error: "Import not found." }, 404);
    }
    await ensureCollaborationSchema(env);
    const importRecord = await env.DB.prepare(
      "SELECT id,rolled_back_at FROM decave_hub_imports WHERE id=? AND hub_id=? LIMIT 1",
    )
      .bind(importId, hubId)
      .first<{ id: string; rolled_back_at: string | null }>();
    if (!importRecord) return json({ error: "Import not found." }, 404);
    if (importRecord.rolled_back_at) {
      return json({
        importId,
        deletedRoomIds: [],
        retainedRoomIds: [],
        deletedRoleIds: [],
        retainedRoleIds: [],
        message: "This import was already rolled back.",
      });
    }
    // Rollback checks whether a room is referenced by squad state before
    // deleting it. That table is lazily initialized elsewhere, so initialize
    // its schema here as well when rollback is the first collaboration call.
    await ensureSquadFinderSchema(env);

    type ImportRoomRow = {
      room_id: number;
      name: string;
      type: "text" | "voice";
      kind: "chat" | "forum";
      category: string;
      position: number;
      private: number;
      icon: string;
      forum_guidelines: string;
      forum_post_policy: string;
      forum_post_role_ids_json: string;
      forum_post_member_ids_json: string;
      created_at: string;
      updated_at: string;
    };
    type ImportRoleRow = { role_id: string; name: string; color: string; icon: string; created_at: string };
    const importRooms = (
      await env.DB.prepare(
        "SELECT room_id,name,type,kind,category,position,private,icon,forum_guidelines,forum_post_policy,forum_post_role_ids_json,forum_post_member_ids_json,created_at,updated_at FROM decave_hub_import_rooms WHERE import_id=? ORDER BY room_id",
      )
        .bind(importId)
        .all<ImportRoomRow>()
    ).results;
    const importRoles = (
      await env.DB.prepare(
        "SELECT role_id,name,color,icon,created_at FROM decave_hub_import_roles WHERE import_id=? ORDER BY role_id",
      )
        .bind(importId)
        .all<ImportRoleRow>()
    ).results;
    const roomCountRow = await env.DB.prepare(
      "SELECT COUNT(*) AS count, SUM(CASE WHEN type='text' THEN 1 ELSE 0 END) AS text_count FROM decave_rooms WHERE hub_id=?",
    )
      .bind(hubId)
      .first<{ count: number; text_count: number | null }>();
    let remainingRoomCount = Number(roomCountRow?.count ?? 0);
    let remainingTextCount = Number(roomCountRow?.text_count ?? 0);
    const roomDeleteCandidates: Array<{ id: number; statement: D1PreparedStatement }> = [];
    const retainedRoomIds: number[] = [];
    for (const item of importRooms) {
      const room = await env.DB.prepare(
        "SELECT id,name,type,kind,category,position,private,icon,forum_guidelines,forum_post_policy,forum_post_role_ids_json,forum_post_member_ids_json,created_at,updated_at FROM decave_rooms WHERE id=? AND hub_id=? LIMIT 1",
      )
        .bind(item.room_id, hubId)
        .first<ImportRoomRow>();
      if (!room) continue;
      const dependencyRows = await Promise.all([
        env.DB.prepare("SELECT 1 AS found FROM decave_messages WHERE room_id=? LIMIT 1").bind(item.room_id).first(),
        env.DB.prepare("SELECT 1 AS found FROM decave_room_members WHERE room_id=? LIMIT 1").bind(item.room_id).first(),
        env.DB.prepare("SELECT 1 AS found FROM decave_attachment_access WHERE room_id=? LIMIT 1")
          .bind(item.room_id)
          .first(),
        env.DB.prepare("SELECT 1 AS found FROM decave_bot_channels WHERE room_id=? LIMIT 1").bind(item.room_id).first(),
        env.DB.prepare("SELECT 1 AS found FROM decave_squad_rooms WHERE room_id=? LIMIT 1").bind(item.room_id).first(),
        env.DB.prepare("SELECT 1 AS found FROM decave_reports WHERE room_id=? LIMIT 1").bind(item.room_id).first(),
      ]);
      const unchanged =
        room.name === item.name &&
        room.type === item.type &&
        room.kind === item.kind &&
        room.category === item.category &&
        Number(room.position) === Number(item.position) &&
        Number(room.private) === Number(item.private) &&
        room.icon === item.icon &&
        room.forum_guidelines === item.forum_guidelines &&
        room.forum_post_policy === item.forum_post_policy &&
        room.forum_post_role_ids_json === item.forum_post_role_ids_json &&
        room.forum_post_member_ids_json === item.forum_post_member_ids_json &&
        room.created_at === item.created_at &&
        room.updated_at === item.updated_at;
      const hasUserState = dependencyRows.some(Boolean);
      const currentTypeIsText = room.type === "text";
      if (!unchanged || hasUserState || remainingRoomCount <= 1 || (currentTypeIsText && remainingTextCount <= 1)) {
        retainedRoomIds.push(item.room_id);
        continue;
      }
      roomDeleteCandidates.push({
        id: item.room_id,
        statement: env.DB.prepare(
          "DELETE FROM decave_rooms WHERE id=? AND hub_id=? AND name=? AND type=? AND kind=? AND category=? AND position=? AND private=? AND icon=? AND forum_guidelines=? AND forum_post_policy=? AND forum_post_role_ids_json=? AND forum_post_member_ids_json=? AND created_at=? AND updated_at=?",
        ).bind(
          item.room_id,
          hubId,
          item.name,
          item.type,
          item.kind,
          item.category,
          item.position,
          item.private,
          item.icon,
          item.forum_guidelines,
          item.forum_post_policy,
          item.forum_post_role_ids_json,
          item.forum_post_member_ids_json,
          item.created_at,
          item.updated_at,
        ),
      });
      remainingRoomCount -= 1;
      if (currentTypeIsText) remainingTextCount -= 1;
    }

    const roleDeleteCandidates: Array<{ id: string; statement: D1PreparedStatement }> = [];
    const retainedRoleIds: string[] = [];
    for (const item of importRoles) {
      const role = await env.DB.prepare(
        "SELECT id,name,color,icon,created_at FROM decave_custom_roles WHERE id=? AND hub_id=? LIMIT 1",
      )
        .bind(item.role_id, hubId)
        .first<ImportRoleRow>();
      if (!role) continue;
      const assignments = await env.DB.prepare("SELECT 1 AS found FROM decave_member_roles WHERE role_id=? LIMIT 1")
        .bind(item.role_id)
        .first();
      const forumUse = await env.DB.prepare(
        "SELECT 1 AS found FROM decave_rooms WHERE hub_id=? AND forum_post_role_ids_json LIKE ? LIMIT 1",
      )
        .bind(hubId, `%"${item.role_id}"%`)
        .first();
      const unchanged =
        role.name === item.name &&
        role.color === item.color &&
        role.icon === item.icon &&
        role.created_at === item.created_at;
      if (!unchanged || assignments || forumUse) {
        retainedRoleIds.push(item.role_id);
        continue;
      }
      roleDeleteCandidates.push({
        id: item.role_id,
        statement: env.DB.prepare(
          "DELETE FROM decave_custom_roles WHERE id=? AND hub_id=? AND name=? AND color=? AND icon=? AND created_at=?",
        ).bind(item.role_id, hubId, item.name, item.color, item.icon, item.created_at),
      });
    }

    const deleteStatements = [...roomDeleteCandidates, ...roleDeleteCandidates].map((candidate) => candidate.statement);
    const rollbackResults = await env.DB.batch([
      ...deleteStatements,
      env.DB.prepare(
        "UPDATE decave_hub_imports SET rolled_back_at=? WHERE id=? AND hub_id=? AND rolled_back_at IS NULL",
      ).bind(nowIso(), importId, hubId),
    ]);
    const deletedRoomIds: number[] = [];
    const deletedRoleIds: string[] = [];
    for (const [index, candidate] of [...roomDeleteCandidates, ...roleDeleteCandidates].entries()) {
      if (Number(rollbackResults[index]?.meta?.changes ?? 0) > 0) {
        if (index < roomDeleteCandidates.length) deletedRoomIds.push((candidate as { id: number }).id);
        else deletedRoleIds.push((candidate as { id: string }).id);
      } else if (index < roomDeleteCandidates.length) retainedRoomIds.push((candidate as { id: number }).id);
      else retainedRoleIds.push((candidate as { id: string }).id);
    }
    await audit(
      env.DB,
      hubId,
      user.id,
      "hub.import.rollback",
      undefined,
      `${importId}: removed ${deletedRoomIds.length} rooms, ${deletedRoleIds.length} roles`,
    );
    await realtimeBroadcast(env, { type: "SERVERS_REFRESH" }, { hubId });
    return json({
      importId,
      deletedRoomIds,
      retainedRoomIds,
      deletedRoleIds,
      retainedRoleIds,
      message:
        retainedRoomIds.length || retainedRoleIds.length
          ? "Some created records were retained because they changed or gained user data."
          : "Created structure was rolled back.",
    });
  }

  return null;
}
