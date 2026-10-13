// Official Hub #rules and #faq posts in the viewer's language
// (decave_official_post_translations, migration 0091). Patch notes and every
// other room keep the original; so does the post's author, who edits it.

import { FORUM_POST_PREFIX } from "../../shared/forum";
import { DEFAULT_LOCALE } from "../../shared/i18n/languages.ts";
import type { RoomRow, UserRow } from "../db";
import { storedLocale } from "./i18n";

/** Official Hub rooms whose posts have translations. */
export const TRANSLATED_OFFICIAL_ROOMS: ReadonlySet<string> = new Set(["rules", "faq"]);

type ClientMessage = { id: string; userId?: string; text?: unknown };

async function isOfficialHub(db: D1Database, hubId: number): Promise<boolean> {
  try {
    const row = await db
      .prepare("SELECT 1 AS found FROM decave_official_hubs WHERE hub_id=? LIMIT 1")
      .bind(hubId)
      .first<{ found: number }>();
    return Boolean(row);
  } catch {
    return false;
  }
}

/** Swaps the title and body of official rules/FAQ posts for the viewer's language version. */
export async function localizeOfficialPosts<T extends ClientMessage>(
  db: D1Database,
  room: Pick<RoomRow, "hub_id" | "name">,
  viewer: Pick<UserRow, "public_id" | "locale">,
  messages: T[],
): Promise<T[]> {
  const locale = storedLocale(viewer.locale);
  if (!locale || locale === DEFAULT_LOCALE || !messages.length) return messages;
  if (!TRANSLATED_OFFICIAL_ROOMS.has(room.name)) return messages;
  const candidates = messages.filter(
    (message) =>
      typeof message.text === "string" &&
      message.text.startsWith(FORUM_POST_PREFIX) &&
      message.userId !== viewer.public_id,
  );
  if (!candidates.length || !(await isOfficialHub(db, room.hub_id))) return messages;

  let rows: { post_id: string; title: string; body: string }[] = [];
  try {
    const ids = candidates.map((message) => message.id);
    rows = (
      await db
        .prepare(
          `SELECT post_id, title, body FROM decave_official_post_translations
           WHERE locale=? AND post_id IN (${ids.map(() => "?").join(",")})`,
        )
        .bind(locale, ...ids)
        .all<{ post_id: string; title: string; body: string }>()
    ).results;
  } catch {
    // Before migration 0091 runs there is nothing to translate.
    return messages;
  }
  if (!rows.length) return messages;
  const byId = new Map(rows.map((row) => [row.post_id, row]));

  return messages.map((message) => {
    const translation = byId.get(message.id);
    if (!translation || typeof message.text !== "string") return message;
    try {
      const payload = JSON.parse(message.text.slice(FORUM_POST_PREFIX.length)) as Record<string, unknown>;
      if (!payload || typeof payload !== "object") return message;
      const text = `${FORUM_POST_PREFIX}${JSON.stringify({ ...payload, title: translation.title, body: translation.body })}`;
      return { ...message, text };
    } catch {
      return message;
    }
  });
}
