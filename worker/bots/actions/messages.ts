// Message actions: send, reply, private notice, edit (own messages only), pin,
// unpin, delete the trigger message, react and start a forum thread. Every
// action that posts a message spends the hub's per-minute message budget.

import type { BotCard } from "../../../shared/bots/types";
import { renderTemplate } from "../../../shared/bots/render";
import { FORUM_POST_PREFIX } from "../../../shared/forum";
import { audit, canCreateForumPost, getRole, hasPermission, isForumStaff, nowIso, type RoomRow } from "../../db";
import { canAccessRoom } from "../../lib/hubs";
import { BOT_MESSAGE_PREFIX, botMessageText, postBotMessage } from "../../lib/hub-bots";
import { messageForClient } from "../../lib/messages";
import { realtimeBroadcast } from "../../lib/realtime";
import { queueHubMessage } from "../events";
import { takeBudget } from "../limits";
import { guardActor, guardMessage, guardRoom, refused } from "./guard";
import { registerAction, type ActionContext, type ActionResult } from "./registry";

const OK: ActionResult = { ok: true };

export function render(ctx: ActionContext, text: string): string {
  return renderTemplate(text, ctx.vars);
}

function renderCard(ctx: ActionContext, card: BotCard | undefined): BotCard | null {
  if (!card) return null;
  const out: BotCard = { ...card };
  if (card.title !== undefined) out.title = render(ctx, card.title).slice(0, 256);
  if (card.text !== undefined) out.text = render(ctx, card.text);
  if (card.fields) out.fields = card.fields.map((f) => ({ name: render(ctx, f.name), value: render(ctx, f.value) }));
  return out;
}

function spendMessage(ctx: ActionContext): ActionResult | null {
  return takeBudget(ctx.event.hubId, "messages") ? null : { ok: false, reason: "Message limit reached", limited: true };
}

/** Posts plain bot text (wrapped for current clients) unless it is a structured payload. */
export async function postFromBot(
  ctx: ActionContext,
  room: RoomRow,
  text: string,
  extra: { card?: BotCard | null; visibleToUserId?: string | null; replyToId?: string | null; raw?: boolean } = {},
): Promise<ActionResult> {
  const message = await postBotMessage(ctx.env, {
    hubId: ctx.event.hubId,
    roomId: room.id,
    botId: ctx.bot.id,
    authorUserId: ctx.publishedBy,
    text: extra.raw ? text : botMessageText(ctx.bot, text),
    card: extra.card ?? null,
    visibleToUserId: extra.visibleToUserId ?? null,
    replyToId: extra.replyToId ?? null,
  });
  if (!message) return { ok: false, reason: "Could not post the message" };
  // Other bots (rules that opt in to bot triggers) see public bot messages one chain level deeper.
  if (!extra.visibleToUserId && !extra.raw)
    queueHubMessage(ctx.env, {
      hubId: ctx.event.hubId,
      roomId: room.id,
      messageId: message.id,
      text,
      actorId: ctx.publishedBy,
      actorIsBot: true,
      chainDepth: ctx.event.chainDepth + 1,
    });
  return OK;
}

registerAction("sendMessage", {
  capability: "send_messages",
  async run(ctx, action) {
    if (action.type !== "sendMessage") return OK;
    const room = await guardRoom(ctx, action.channel);
    if (refused(room)) return { ok: false, reason: room.reason };
    if (ctx.dryRun) return OK;
    const limited = spendMessage(ctx);
    if (limited) return limited;
    return postFromBot(ctx, room, render(ctx, action.text), { card: renderCard(ctx, action.card) });
  },
});

registerAction("reply", {
  capability: "send_messages",
  async run(ctx, action) {
    if (action.type !== "reply") return OK;
    const target = await guardMessage(ctx, "trigger");
    if (refused(target)) return { ok: false, reason: target.reason };
    // In a forum a reply belongs to the thread's post, not to another reply.
    const replyToId =
      target.room.kind === "forum" && target.message.reply_to_id ? target.message.reply_to_id : target.message.id;
    if (target.room.kind === "forum") {
      // Same lock rule as human replies (HubRoom): staff may still reply.
      const post = await ctx.env.DB.prepare("SELECT locked FROM decave_forum_post_state WHERE message_id=? LIMIT 1")
        .bind(replyToId)
        .first<{ locked: number }>();
      if (!post) return { ok: false, reason: "Forum replies must target a forum post" };
      if (post.locked === 1 && !(await isForumStaff(ctx.env.DB, ctx.event.hubId, ctx.publishedBy)))
        return { ok: false, reason: "This post is locked" };
    }
    if (ctx.dryRun) return OK;
    const limited = spendMessage(ctx);
    if (limited) return limited;
    return postFromBot(ctx, target.room, render(ctx, action.text), { card: renderCard(ctx, action.card), replyToId });
  },
});

registerAction("privateNotice", {
  capability: "send_messages",
  async run(ctx, action) {
    if (action.type !== "privateNotice") return OK;
    const room = await guardRoom(ctx, "trigger");
    if (refused(room)) return { ok: false, reason: room.reason };
    const actor = await guardActor(ctx);
    if (refused(actor)) return { ok: false, reason: actor.reason };
    if (!(await canAccessRoom(ctx.env.DB, room, actor))) return { ok: false, reason: "Member can't see this channel" };
    if (ctx.dryRun) return OK;
    const limited = spendMessage(ctx);
    if (limited) return limited;
    return postFromBot(ctx, room, render(ctx, action.text), { visibleToUserId: actor });
  },
});

registerAction("editMessage", {
  capability: "send_messages",
  async run(ctx, action) {
    if (action.type !== "editMessage") return OK;
    const target = await guardMessage(ctx, action.messageRef);
    if (refused(target)) return { ok: false, reason: target.reason };
    if (target.message.bot_id !== ctx.bot.id) return { ok: false, reason: "Bots can only edit their own messages" };
    if (!target.message.text.startsWith(BOT_MESSAGE_PREFIX))
      return { ok: false, reason: "This message can't be edited" };
    if (ctx.dryRun) return OK;
    const limited = spendMessage(ctx);
    if (limited) return limited;
    await ctx.env.DB.prepare("UPDATE decave_messages SET text=?,edited_at=? WHERE id=?")
      .bind(botMessageText(ctx.bot, render(ctx, action.text)), nowIso(), target.message.id)
      .run();
    const message = await messageForClient(ctx.env, target.message.id);
    await realtimeBroadcast(ctx.env, { type: "MESSAGE_UPDATED", message }, { channelId: target.room.id });
    return OK;
  },
});

async function setPinned(ctx: ActionContext, ref: string, pinned: 0 | 1): Promise<ActionResult> {
  const target = await guardMessage(ctx, ref);
  if (refused(target)) return { ok: false, reason: target.reason };
  // Mirrors the pin route: Moderate Messages is required.
  if (!(await hasPermission(ctx.env.DB, ctx.event.hubId, ctx.publishedBy, "moderateMessages")))
    return { ok: false, reason: "Publisher can't moderate messages" };
  if (ctx.dryRun || target.message.pinned === pinned) return OK;
  const limited = spendMessage(ctx);
  if (limited) return limited;
  await ctx.env.DB.prepare("UPDATE decave_messages SET pinned=? WHERE id=?").bind(pinned, target.message.id).run();
  await audit(
    ctx.env.DB,
    ctx.event.hubId,
    ctx.publishedBy,
    pinned ? "bot.message.pin" : "bot.message.unpin",
    target.message.author_user_id,
    `${ctx.bot.name}:${target.message.id}`,
  );
  const message = await messageForClient(ctx.env, target.message.id);
  await realtimeBroadcast(ctx.env, { type: "MESSAGE_UPDATED", message }, { channelId: target.room.id });
  return OK;
}

registerAction("pin", {
  capability: "manage_messages",
  run: (ctx, action) => (action.type === "pin" ? setPinned(ctx, action.messageRef, 1) : Promise.resolve(OK)),
});

registerAction("unpin", {
  capability: "manage_messages",
  run: (ctx, action) => (action.type === "unpin" ? setPinned(ctx, action.messageRef, 0) : Promise.resolve(OK)),
});

registerAction("deleteTrigger", {
  capability: "manage_messages",
  async run(ctx) {
    const target = await guardMessage(ctx, "trigger");
    if (refused(target)) return { ok: false, reason: target.reason };
    const { message, room } = target;
    // Mirrors the delete route: owners and admins may delete any message.
    const role = await getRole(ctx.env.DB, ctx.event.hubId, ctx.publishedBy);
    if (message.bot_id !== ctx.bot.id && role !== "owner" && role !== "admin")
      return { ok: false, reason: "Publisher can't delete this message" };
    // Attachments and forum threads need the full delete route (media queue, thread replies).
    if (message.attachment_key || (room.kind === "forum" && message.reply_to_id === null))
      return { ok: false, reason: "Bots can't delete this kind of message" };
    if (ctx.dryRun) return OK;
    await ctx.env.DB.prepare("DELETE FROM decave_messages WHERE id=?").bind(message.id).run();
    await audit(
      ctx.env.DB,
      ctx.event.hubId,
      ctx.publishedBy,
      "bot.message.delete",
      message.author_user_id,
      `${ctx.bot.name}:${message.id}`,
    );
    await realtimeBroadcast(
      ctx.env,
      { type: "MESSAGE_DELETED", channelId: room.id, messageId: message.id, deletedByUserId: null },
      { channelId: room.id },
    );
    return OK;
  },
});

registerAction("react", {
  capability: "send_messages",
  async run(ctx, action) {
    if (action.type !== "react") return OK;
    const emoji = action.emoji.trim().slice(0, 24);
    if (!emoji) return { ok: false, reason: "Emoji required" };
    // Poll votes and forum votes are reactions too; a bot must not cast them.
    if (/^(poll_|forum_vote_)/.test(emoji)) return { ok: false, reason: "That emoji is reserved" };
    const target = await guardMessage(ctx, "trigger");
    if (refused(target)) return { ok: false, reason: target.reason };
    if (ctx.dryRun) return OK;
    const limited = spendMessage(ctx);
    if (limited) return limited;
    // Reactions are stored per user; a bot reacts as its publisher.
    await ctx.env.DB.prepare(
      "INSERT OR IGNORE INTO decave_message_reactions(message_id,user_id,emoji,created_at) VALUES(?,?,?,?)",
    )
      .bind(target.message.id, ctx.publishedBy, emoji, nowIso())
      .run();
    const message = await messageForClient(ctx.env, target.message.id);
    await realtimeBroadcast(ctx.env, { type: "MESSAGE_UPDATED", message }, { channelId: target.room.id });
    return OK;
  },
});

registerAction("createThread", {
  capability: "send_messages",
  async run(ctx, action) {
    if (action.type !== "createThread") return OK;
    const room = await guardRoom(ctx, "trigger");
    if (refused(room)) return { ok: false, reason: room.reason };
    if (room.kind !== "forum") return { ok: false, reason: "Threads need a forum channel" };
    if (!(await canCreateForumPost(ctx.env.DB, room, ctx.publishedBy)))
      return { ok: false, reason: "Publisher can't post in this forum" };
    const title = render(ctx, action.name).replace(/\s+/g, " ").trim().slice(0, 100);
    if (!title) return { ok: false, reason: "Thread name is empty" };
    if (ctx.dryRun) return OK;
    const limited = spendMessage(ctx);
    if (limited) return limited;
    const payload = { version: 1, title, tags: [], body: "" };
    return postFromBot(ctx, room, `${FORUM_POST_PREFIX}${JSON.stringify(payload)}`, { raw: true });
  },
});
