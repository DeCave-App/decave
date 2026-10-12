// Run-time permission guards for builder-bot actions. A bot can never do more
// than the member who published it could do by hand, and only in hub text and
// forum rooms (DMs and group chats are end-to-end encrypted and off limits).
//
// Targets come only from trusted sources: the acting user is event.actorId,
// rooms/messages/roles are the rule's explicit ids or "trigger". Nothing here
// takes a target from rendered text or command arguments.

import { getRole, getRoom, officialHubPostingDecision, type RoomRow, type ServerRole } from "../../db";
import { canAccessRoom } from "../../lib/hubs";
import { storedHubBotRoomIds } from "../../lib/hub-bots";
import type { ActionContext } from "./registry";

export type Refusal = { reason: string };
export type BotRole = { id: string; name: string; position: number };
export type BotMessageRow = {
  id: string;
  room_id: number;
  hub_id: number;
  author_user_id: string;
  text: string;
  reply_to_id: string | null;
  pinned: number;
  attachment_key: string | null;
  bot_id: string | null;
  visible_to_user_id: string | null;
};

export function refused(value: unknown): value is Refusal {
  return Boolean(value) && typeof value === "object" && typeof (value as Refusal).reason === "string";
}

/** The publisher's base role in the hub, or a refusal when they left it. */
export async function guardPublisher(ctx: ActionContext): Promise<ServerRole | Refusal> {
  const role = await getRole(ctx.env.DB, ctx.event.hubId, ctx.publishedBy);
  return role ?? { reason: "Publisher is no longer in this hub" };
}

/** "trigger" (or empty) means the event's room; otherwise a numeric room id. */
export function roomRef(ctx: ActionContext, ref: string | number | null | undefined): number | Refusal {
  if (ref === undefined || ref === null || ref === "" || ref === "trigger") {
    return ctx.event.roomId ?? { reason: "This trigger has no channel" };
  }
  const id = typeof ref === "number" ? ref : /^\d{1,15}$/.test(ref) ? Number(ref) : NaN;
  // DM and group-chat ids are not numeric hub room ids; refuse anything else.
  if (!Number.isSafeInteger(id) || id <= 0) return { reason: "Bots can only act in hub channels" };
  return id;
}

async function isSquadRoom(db: D1Database, roomId: number): Promise<boolean> {
  try {
    const row = await db
      .prepare("SELECT 1 AS found FROM decave_squad_rooms WHERE room_id=? LIMIT 1")
      .bind(roomId)
      .first<{ found: number }>();
    return Boolean(row);
  } catch {
    // The table is created lazily; without it there are no squad rooms.
    return false;
  }
}

/**
 * A room the bot may act in: exists, belongs to this hub, is a hub text or
 * forum room (not voice, not a group chat's linked room), is in the bot's
 * allowed rooms (empty list = all), and the publisher can still see and post
 * in it.
 */
export async function guardRoom(
  ctx: ActionContext,
  ref: string | number | null | undefined,
): Promise<RoomRow | Refusal> {
  const publisher = await guardPublisher(ctx);
  if (refused(publisher)) return publisher;
  const roomId = roomRef(ctx, ref);
  if (refused(roomId)) return roomId;
  const db = ctx.env.DB;
  const room = await getRoom(db, roomId);
  if (!room) return { reason: "Channel no longer exists" };
  if (Number(room.hub_id) !== ctx.event.hubId) return { reason: "Channel isn't in this hub" };
  if (room.type !== "text") return { reason: "Bots can only post in text channels and forums" };
  if (await isSquadRoom(db, room.id)) return { reason: "Bots can only act in hub channels" };
  const allowed = storedHubBotRoomIds(ctx.bot.allowed_room_ids);
  if (allowed.length && !allowed.includes(room.id)) return { reason: "Bot isn't allowed in this channel" };
  if (!(await canAccessRoom(db, room, ctx.publishedBy))) return { reason: "Publisher can't access this channel" };
  if ((await officialHubPostingDecision(db, ctx.event.hubId, ctx.publishedBy)) !== "allow")
    return { reason: "Publisher can't post in this hub" };
  return room;
}

/**
 * A custom role the bot may give or take. Mirrors the member role-assignment
 * route (PATCH /api/servers/:id/members/:user/custom-roles), which only the hub
 * owner may use: admins and members cannot assign custom roles by hand, so a
 * bot they published cannot either. Because only the owner passes, the
 * "strictly below the publisher's highest role" rule never has to rank roles;
 * if the route ever lets others assign roles, add that ranking here too.
 */
export async function guardRole(ctx: ActionContext, roleId: string): Promise<BotRole | Refusal> {
  const publisher = await guardPublisher(ctx);
  if (refused(publisher)) return publisher;
  const role = await ctx.env.DB.prepare("SELECT id,name,position FROM decave_custom_roles WHERE id=? AND hub_id=?")
    .bind(roleId, ctx.event.hubId)
    .first<BotRole>();
  if (!role) return { reason: "Role no longer exists" };
  if (publisher !== "owner") return { reason: "Publisher can't manage this role" };
  return role;
}

/** The acting user, who must still be a member of the hub. */
export async function guardActor(ctx: ActionContext): Promise<string | Refusal> {
  const actor = ctx.event.actorId;
  if (!actor) return { reason: "This trigger has no member" };
  if (!(await getRole(ctx.env.DB, ctx.event.hubId, actor))) return { reason: "Member is no longer in this hub" };
  return actor;
}

/** "trigger" means the event's message; otherwise an explicit message id. The message's room is guarded too. */
export async function guardMessage(
  ctx: ActionContext,
  ref: string | undefined,
): Promise<{ message: BotMessageRow; room: RoomRow } | Refusal> {
  const id = !ref || ref === "trigger" ? ctx.event.data.messageId : ref;
  if (typeof id !== "string" || !id || id.length > 64) return { reason: "This trigger has no message" };
  const message = await ctx.env.DB.prepare(
    `SELECT id,room_id,hub_id,author_user_id,text,reply_to_id,pinned,attachment_key,bot_id,visible_to_user_id
     FROM decave_messages WHERE id=? AND hub_id=?`,
  )
    .bind(id, ctx.event.hubId)
    .first<BotMessageRow>();
  if (!message) return { reason: "Message no longer exists" };
  // Private notices are never acted on by id.
  if (message.visible_to_user_id) return { reason: "Message no longer exists" };
  const room = await guardRoom(ctx, Number(message.room_id));
  if (refused(room)) return room;
  return { message, room };
}

/**
 * The room whose Durable Object hosts a bot timer (role reverts, schedules and
 * waits): the trigger's room, else the bot's first allowed text room, else the
 * hub's first text room. Null when the hub has no text room.
 */
export async function timerHostRoom(ctx: ActionContext): Promise<number | null> {
  return hostRoomFor(ctx.env.DB, ctx.event.hubId, ctx.event.roomId, ctx.bot.allowed_room_ids);
}

export async function hostRoomFor(
  db: D1Database,
  hubId: number,
  roomId: number | null,
  allowedRoomIds: string,
): Promise<number | null> {
  if (roomId !== null) return roomId;
  for (const allowedId of storedHubBotRoomIds(allowedRoomIds)) {
    const room = await getRoom(db, allowedId);
    if (room && Number(room.hub_id) === hubId && room.type === "text") return room.id;
  }
  const first = await db
    .prepare("SELECT id FROM decave_rooms WHERE hub_id=? AND type='text' ORDER BY position, id LIMIT 1")
    .bind(hubId)
    .first<{ id: number }>();
  return first?.id ?? null;
}
