// Twitch clips board for Streamer Hubs. Hourly: each hub that turned on
// "Post my Twitch clips" gets the channel's new clips as posts in its clips
// forum, from a "Twitch Clips" hub bot. Mondays 18:00 UTC: the clip posted in
// the last week with the most members reacting is announced as Clip of the week.

import { DEFAULT_STREAMER_CONFIG, twitchLoginFromUrl, type StreamerConfig } from "../../shared/streamer-mode";
import { FORUM_POST_PREFIX } from "../../shared/forum";
import { createBuilderBot } from "../bots/store";
import { BOT_MESSAGE_PREFIX, botMessageText, postBotMessage } from "../lib/hub-bots";
import { noticeEnglish, noticeOf } from "../lib/notices";
import type { Env } from "../lib/env";
import { authBaseUrlForEnvironment } from "../lib/http";
import { twitchClipThumbnail, twitchClips, twitchClipsById, twitchConfigured, type TwitchClip } from "./client";

const CLIPS_BOT_NAME = "Twitch Clips";
/** How far back the first import of a hub looks. */
const FIRST_IMPORT_MS = 2 * 24 * 60 * 60 * 1000;
const MAX_POSTS_PER_HUB_PER_RUN = 5;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

type HubLink = { hub_id: number; broadcaster_id: string; owner_id: string; config_json: string };

function configOf(json: string): StreamerConfig {
  try {
    return { ...DEFAULT_STREAMER_CONFIG, ...JSON.parse(json) };
  } catch {
    return DEFAULT_STREAMER_CONFIG;
  }
}

async function clipsHubs(env: Env): Promise<HubLink[]> {
  const rows = await env.DB.prepare(
    `SELECT l.hub_id,l.broadcaster_id,h.owner_id,s.config_json FROM decave_twitch_hub_links l
     JOIN decave_hubs h ON h.id=l.hub_id JOIN decave_streamer_hubs s ON s.hub_id=l.hub_id
     WHERE json_extract(s.community_features,'$.twitch')=1`,
  ).all<HubLink>();
  return rows.results.filter((row) => {
    const config = configOf(row.config_json);
    return config.twitchClips && twitchLoginFromUrl(config.streamUrl);
  });
}

async function clipsBot(env: Env, hubId: number, ownerId: string) {
  const existing = await env.DB.prepare(
    "SELECT id,name FROM decave_hub_bots WHERE hub_id=? AND name=? AND kind='builder' LIMIT 1",
  )
    .bind(hubId, CLIPS_BOT_NAME)
    .first<{ id: string; name: string }>();
  if (existing) return existing;
  try {
    const bot = await createBuilderBot(env.DB, {
      hubId,
      name: CLIPS_BOT_NAME,
      description: "Posts the channel's new Twitch clips in the clips forum.",
      createdBy: ownerId,
    });
    return { id: bot.id, name: bot.name };
  } catch {
    return null; // Bot limit reached: no clips until the owner frees a slot.
  }
}

/** The Hub's clips room (text chat or forum with "clip" in its name). */
async function clipsRoom(env: Env, hubId: number): Promise<{ id: number; kind: string } | null> {
  return env.DB.prepare(
    `SELECT id,kind FROM decave_rooms WHERE hub_id=? AND type='text' AND lower(name) LIKE '%clip%'
     ORDER BY position,id LIMIT 1`,
  )
    .bind(hubId)
    .first<{ id: number; kind: string }>();
}

/** Plain chat text for a clip (chat rooms); forum rooms get a forum post instead. */
export function clipChatText(clip: { title: string; creatorName: string; url: string }): string {
  return clipChatMessage(clip).text;
}

/** A clip title from Twitch, as posted (it is the clipper's text and is never translated). */
function clipTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim().slice(0, 100);
}

/**
 * The clip's chat text in English and as a notice clients translate. The title
 * stays as written; a clip without one gets DeCave's "New clip" in each
 * reader's language.
 */
function clipChatMessage(clip: { title: string; creatorName: string; url: string }) {
  const title = clipTitle(clip.title);
  const creator = clip.creatorName;
  const notice = !clip.title
    ? creator
      ? noticeOf("streamer.server.clipPostedUntitled", { creator, url: clip.url })
      : noticeOf("streamer.server.clipPostedUntitledAnonymous", { url: clip.url })
    : creator
      ? noticeOf("streamer.server.clipPosted", { title, creator, url: clip.url })
      : noticeOf("streamer.server.clipPostedAnonymous", { title, url: clip.url });
  return { text: noticeEnglish(notice.code, notice.params), notice };
}

/**
 * A clip's forum post. Title and body stay English for clients without
 * translations; `notice` (the body) and `titleNotice` (only for clips without
 * a title) let current clients show DeCave's wording in the reader's language.
 */
export function clipForumPayload(clip: { title: string; creatorName: string; url: string }) {
  const notice = clip.creatorName
    ? noticeOf("streamer.server.clipForumBody", { creator: clip.creatorName, url: clip.url })
    : noticeOf("streamer.server.clipForumBodyAnonymous", { url: clip.url });
  const titleNotice = clip.title ? null : noticeOf("streamer.server.clipDefaultTitle");
  return {
    version: 1,
    type: "discussion",
    title: clip.title ? clipTitle(clip.title) : noticeEnglish("streamer.server.clipDefaultTitle"),
    tags: [],
    body: noticeEnglish(notice.code, notice.params),
    notice,
    ...(titleNotice ? { titleNotice } : {}),
  };
}

const UNTITLED_CLIP_CODES: ReadonlySet<string> = new Set([
  "streamer.server.clipPostedUntitled",
  "streamer.server.clipPostedUntitledAnonymous",
]);

/**
 * Title and link of a posted clip, from either a chat bot message or a forum
 * post. `untitled`: the clip had no title, so DeCave's "New clip" stands in.
 */
function clipFromMessage(text: string): { title: string; link: string; untitled: boolean } {
  try {
    if (text.startsWith(FORUM_POST_PREFIX)) {
      const payload = JSON.parse(text.slice(FORUM_POST_PREFIX.length)) as {
        title?: string;
        body?: string;
        titleNotice?: unknown;
      };
      return {
        title: payload.title ?? "",
        link: /https:\/\/\S+/.exec(payload.body ?? "")?.[0] ?? "",
        untitled: Boolean(payload.titleNotice),
      };
    }
    const wrapped = text.startsWith(BOT_MESSAGE_PREFIX)
      ? (JSON.parse(text.slice(BOT_MESSAGE_PREFIX.length)) as { text?: string; notice?: { code?: unknown } })
      : null;
    const body = wrapped ? String(wrapped.text ?? "") : text;
    return {
      title: /^🎬 (.+)$/m.exec(body)?.[1] ?? "",
      link: /https:\/\/\S+/.exec(body)?.[0] ?? "",
      untitled: typeof wrapped?.notice?.code === "string" && UNTITLED_CLIP_CODES.has(wrapped.notice.code),
    };
  } catch {
    return { title: "", link: "", untitled: false };
  }
}

const BACKFILL_PER_RUN = 20;

/**
 * Copies a clip's thumbnail into the Hub's media (R2 hub-media/<hub>/clip/<id>)
 * and returns the card that shows it, or null when Twitch has no usable image.
 */
async function storeClipThumbnail(env: Env, hubId: number, clip: TwitchClip) {
  if (!clip.thumbnailUrl) return null;
  let image;
  try {
    image = await twitchClipThumbnail(clip.thumbnailUrl);
  } catch (error) {
    console.warn("Clip thumbnail download failed", error instanceof Error ? error.message : "UnknownError");
    image = null;
  }
  if (!image) return null;
  const key = `hub-media/${hubId}/clip/${crypto.randomUUID()}`;
  await env.MEDIA.put(key, image.bytes, { httpMetadata: { contentType: image.type } });
  return {
    key,
    card: { color: "#9146ff", imageUrl: `${authBaseUrlForEnvironment(env)}/uploads/${key}` },
  };
}

/** Adds thumbnails to clips posted before thumbnails existed (bounded per run). */
async function backfillClipThumbnails(env: Env, hubId: number): Promise<void> {
  const missing = await env.DB.prepare(
    `SELECT clip_id,message_id FROM decave_twitch_clips_posted
     WHERE hub_id=? AND thumbnail_key IS NULL AND clip_id NOT LIKE 'week:%' LIMIT ?`,
  )
    .bind(hubId, BACKFILL_PER_RUN)
    .all<{ clip_id: string; message_id: string }>();
  if (!missing.results.length) return;
  let clips: TwitchClip[];
  try {
    clips = await twitchClipsById(
      env,
      missing.results.map((row) => row.clip_id),
    );
  } catch {
    return; // Try again next hour.
  }
  const byId = new Map(clips.map((clip) => [clip.id, clip]));
  for (const row of missing.results) {
    const clip = byId.get(row.clip_id);
    const stored = clip ? await storeClipThumbnail(env, hubId, clip) : null;
    // "" marks clips without a usable thumbnail so they aren't retried every hour.
    await env.DB.prepare("UPDATE decave_twitch_clips_posted SET thumbnail_key=? WHERE hub_id=? AND clip_id=?")
      .bind(stored?.key ?? "", hubId, row.clip_id)
      .run();
    if (stored)
      await env.DB.prepare("UPDATE decave_messages SET card_json=? WHERE id=? AND hub_id=? AND bot_id IS NOT NULL")
        .bind(JSON.stringify(stored.card), row.message_id, hubId)
        .run();
  }
}

/** Hourly: post new clips for every hub that turned clips on. */
export async function importTwitchClips(env: Env, now = Date.now()): Promise<void> {
  if (!twitchConfigured(env)) return;
  for (const hub of await clipsHubs(env)) {
    const room = await clipsRoom(env, hub.hub_id);
    if (!room) continue;
    const roomId = room.id;
    if (room.kind !== "forum") await backfillClipThumbnails(env, hub.hub_id);
    const last = await env.DB.prepare("SELECT MAX(posted_at) AS at FROM decave_twitch_clips_posted WHERE hub_id=?")
      .bind(hub.hub_id)
      .first<{ at: string | null }>();
    const since = last?.at ? Math.min(Date.parse(last.at) - 3_600_000, now) : now - FIRST_IMPORT_MS;
    let clips;
    try {
      clips = await twitchClips(env, hub.broadcaster_id, new Date(since).toISOString());
    } catch (error) {
      console.error("Twitch clips import failed", error instanceof Error ? error.message : "UnknownError");
      return;
    }
    const known = new Set(
      (
        await env.DB.prepare("SELECT clip_id FROM decave_twitch_clips_posted WHERE hub_id=?")
          .bind(hub.hub_id)
          .all<{ clip_id: string }>()
      ).results.map((row) => row.clip_id),
    );
    const fresh = clips
      .filter((clip) => !known.has(clip.id))
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
      .slice(0, MAX_POSTS_PER_HUB_PER_RUN);
    if (!fresh.length) continue;
    const bot = await clipsBot(env, hub.hub_id, hub.owner_id);
    if (!bot) continue;
    for (const clip of fresh) {
      const payload = clipForumPayload(clip);
      const thumbnail = room.kind === "forum" ? null : await storeClipThumbnail(env, hub.hub_id, clip);
      const chat = clipChatMessage(clip);
      const message = await postBotMessage(env, {
        hubId: hub.hub_id,
        roomId,
        botId: bot.id,
        authorUserId: hub.owner_id,
        text:
          room.kind === "forum"
            ? `${FORUM_POST_PREFIX}${JSON.stringify(payload)}`
            : botMessageText(bot, chat.text, chat.notice),
        card: thumbnail?.card ?? null,
      });
      if (!message) {
        if (thumbnail) await env.MEDIA.delete(thumbnail.key);
        continue;
      }
      await env.DB.prepare(
        "INSERT OR IGNORE INTO decave_twitch_clips_posted(hub_id,clip_id,message_id,posted_at,thumbnail_key) VALUES(?,?,?,?,?)",
      )
        .bind(hub.hub_id, clip.id, message.id, new Date(now).toISOString(), thumbnail?.key ?? "")
        .run();
    }
  }
}

function isoWeek(now: number): string {
  const date = new Date(now);
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86_400_000 - 3) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Mondays 18:00 UTC: announce the most-reacted clip of the past week (once per hub per week). */
export async function announceClipOfTheWeek(env: Env, now = Date.now()): Promise<void> {
  const date = new Date(now);
  if (date.getUTCDay() !== 1 || date.getUTCHours() !== 18) return;
  const marker = `week:${isoWeek(now)}`;
  for (const hub of await clipsHubs(env)) {
    const top = await env.DB.prepare(
      `SELECT c.message_id,m.text,COUNT(DISTINCT r.user_id) AS votes FROM decave_twitch_clips_posted c
       JOIN decave_messages m ON m.id=c.message_id
       JOIN decave_message_reactions r ON r.message_id=c.message_id
       WHERE c.hub_id=? AND c.posted_at>=? AND c.clip_id NOT LIKE 'week:%'
       GROUP BY c.message_id ORDER BY votes DESC,c.posted_at LIMIT 1`,
    )
      .bind(hub.hub_id, new Date(now - WEEK_MS).toISOString())
      .first<{ message_id: string; text: string; votes: number }>();
    if (!top) continue;
    const claimed = await env.DB.prepare(
      "INSERT OR IGNORE INTO decave_twitch_clips_posted(hub_id,clip_id,message_id,posted_at) VALUES(?,?,?,?)",
    )
      .bind(hub.hub_id, marker, top.message_id, new Date(now).toISOString())
      .run();
    if (!claimed.meta.changes) continue;
    const { title, link, untitled } = clipFromMessage(top.text);
    const room = await env.DB.prepare(
      `SELECT id FROM decave_rooms WHERE hub_id=? AND type='text' AND kind='chat'
       ORDER BY lower(name)='announcements' DESC,position,id LIMIT 1`,
    )
      .bind(hub.hub_id)
      .first<{ id: number }>();
    const bot = room ? await clipsBot(env, hub.hub_id, hub.owner_id) : null;
    if (!room || !bot) continue;
    const notice = untitled
      ? noticeOf("streamer.server.clipOfTheWeekUntitled", { count: top.votes, link })
      : noticeOf("streamer.server.clipOfTheWeek", { count: top.votes, title, link });
    await postBotMessage(env, {
      hubId: hub.hub_id,
      roomId: room.id,
      botId: bot.id,
      authorUserId: hub.owner_id,
      text: botMessageText(bot, noticeEnglish(notice.code, notice.params).trim(), notice),
    });
  }
}
