// Media in R2: public URLs and serving stored files.

import type { Env } from "./env";
import { requireUser } from "./sessions";
import { apiError } from "./http";
import { getRoom, getHub, getRole } from "../db";
import { canAccessRoom } from "./hubs";

const INLINE_MEDIA_PREFIXES = [
  "attachments/",
  "hub-media/",
  "hub-assets/",
  "avatars/",
  "profile-banners/",
  "soundboard/",
  "safety-evidence/",
] as const;

export const MEDIA_DELETION_QUEUE_BATCH_SIZE = 100;

export function sniffRasterImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    (bytes.length >= 6 && String.fromCharCode(...bytes.subarray(0, 6)) === "GIF87a") ||
    (bytes.length >= 6 && String.fromCharCode(...bytes.subarray(0, 6)) === "GIF89a")
  )
    return "image/gif";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  )
    return "image/webp";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(4, 8)) === "ftyp" &&
    String.fromCharCode(...bytes.subarray(8, Math.min(bytes.length, 16))).includes("avif")
  )
    return "image/avif";
  return null;
}

/** Recognize a finite set of passive media formats from bytes, never the upload header. */
export function sniffSafeMediaMime(bytes: Uint8Array): string | null {
  const raster = sniffRasterImageMime(bytes);
  if (raster) return raster;
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "audio/wav";
  if (bytes.length >= 4 && ascii(0, 4) === "OggS") return "audio/ogg";
  if (bytes.length >= 4 && ascii(0, 4) === "fLaC") return "audio/flac";
  if (bytes.length >= 3 && ascii(0, 3) === "ID3") return "audio/mpeg";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) return "audio/mpeg";
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)
    return "video/webm";
  if (bytes.length >= 12 && ascii(4, 8) === "ftyp") {
    const brand = ascii(8, Math.min(bytes.length, 16));
    if (brand.includes("qt  ")) return "video/quicktime";
    if (/^(isom|iso[2-9]|mp4|avc1|M4V)/.test(brand)) return "video/mp4";
  }
  return null;
}

export function safeUploadedContentType(declaredMime: string, bytes: Uint8Array): string {
  const declared = declaredMime.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const safeMime = sniffSafeMediaMime(bytes);
  if (declared.startsWith("image/") && !sniffRasterImageMime(bytes)) {
    throw new TypeError("Image uploads must be PNG, JPG, GIF, WebP or AVIF image data.");
  }
  return safeMime ?? "application/octet-stream";
}

function preserveAttachmentDisposition(value: string | null): string {
  if (!value || !/^attachment(?:\s*;|$)/i.test(value)) return "attachment";
  // Keep a harmless stored filename while stripping header injection and path components.
  const match = value.match(/filename\s*=\s*(?:"([^"]*)"|([^;]*))/i);
  const raw = (match?.[1] ?? match?.[2] ?? "").trim();
  const filename = raw.replace(/[\\/\x00-\x1f\x7f";]/g, "_").slice(0, 180);
  return filename ? `attachment; filename="${filename}"` : "attachment";
}

function isQueueableMediaKey(key: string): boolean {
  return (
    key.length <= 1024 &&
    !key.includes("..") &&
    !key.includes("\\") &&
    !key.startsWith("/") &&
    INLINE_MEDIA_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

export function mediaDeletionQueueStatement(db: D1Database, key: string, queuedAt: string): D1PreparedStatement {
  if (!isQueueableMediaKey(key)) throw new TypeError("Refusing to queue an unsupported R2 key.");
  return db
    .prepare(
      "INSERT OR IGNORE INTO decave_media_deletion_queue(object_key,queued_at,attempts,last_attempt_at) VALUES(?,?,0,NULL)",
    )
    .bind(key, queuedAt);
}

/**
 * Reconcile attachment cleanup after deleting messages. A retry can leave
 * multiple message rows pointing at one upload, so only unreferenced keys may
 * lose their access row or enter the durable deletion queue.
 */
export function reconcileAttachmentDeletionStatements(
  db: D1Database,
  keys: Iterable<string>,
  queuedAt: string,
): D1PreparedStatement[] {
  const uniqueKeys = [...new Set(keys)].filter(Boolean);
  for (const key of uniqueKeys) {
    if (!isQueueableMediaKey(key)) throw new TypeError("Refusing to queue an unsupported R2 key.");
  }

  const statements: D1PreparedStatement[] = [];
  for (let offset = 0; offset < uniqueKeys.length; offset += 90) {
    const chunk = uniqueKeys.slice(offset, offset + 90);
    const placeholders = chunk.map(() => "?").join(",");
    statements.push(
      db
        .prepare(
          `DELETE FROM decave_media_deletion_queue
           WHERE object_key IN (${placeholders})
             AND EXISTS(SELECT 1 FROM decave_messages WHERE attachment_key=decave_media_deletion_queue.object_key)`,
        )
        .bind(...chunk),
      db
        .prepare(
          `DELETE FROM decave_attachment_access
           WHERE r2_key IN (${placeholders})
             AND NOT EXISTS(SELECT 1 FROM decave_messages WHERE attachment_key=decave_attachment_access.r2_key)`,
        )
        .bind(...chunk),
      db
        .prepare(
          `INSERT OR IGNORE INTO decave_media_deletion_queue(object_key,queued_at,attempts,last_attempt_at)
           SELECT candidate.object_key,?,0,NULL FROM (
             SELECT ? AS object_key${chunk.map(() => " UNION ALL SELECT ?").join("")}
           ) candidate
           WHERE NOT EXISTS(SELECT 1 FROM decave_messages WHERE attachment_key=candidate.object_key)
             AND NOT EXISTS(SELECT 1 FROM decave_attachment_access WHERE r2_key=candidate.object_key)`,
        )
        .bind(queuedAt, ...chunk),
    );
  }
  return statements;
}

/**
 * Every R2 object owned by one Hub (channel attachments, assets, soundboard and
 * artwork, room backgrounds, clip thumbnails). Bind the Hub id
 * HUB_MEDIA_OBJECT_KEYS_BINDS times. Callers must run
 * ensureHubFeatureSchema and ensureSoundboardSchema first.
 */
export const HUB_MEDIA_OBJECT_KEYS_SQL = `SELECT attachment_key AS object_key FROM decave_messages WHERE hub_id=? AND attachment_key IS NOT NULL
  UNION SELECT r2_key AS object_key FROM decave_attachment_access WHERE hub_id=?
  UNION SELECT r2_key AS object_key FROM decave_hub_assets WHERE hub_id=?
  UNION SELECT r2_key AS object_key FROM decave_soundboard_sounds WHERE hub_id=?
  UNION SELECT icon_key AS object_key FROM decave_hubs WHERE id=? AND icon_key IS NOT NULL
  UNION SELECT banner_key AS object_key FROM decave_hubs WHERE id=? AND banner_key IS NOT NULL
  UNION SELECT chat_background_key AS object_key FROM decave_hubs WHERE id=? AND chat_background_key IS NOT NULL
  UNION SELECT header_key AS object_key FROM decave_hubs WHERE id=? AND header_key IS NOT NULL
  UNION SELECT background_key AS object_key FROM decave_rooms WHERE hub_id=? AND background_key IS NOT NULL
  UNION SELECT thumbnail_key AS object_key FROM decave_twitch_clips_posted WHERE hub_id=? AND thumbnail_key IS NOT NULL AND thumbnail_key<>''`;
export const HUB_MEDIA_OBJECT_KEYS_BINDS = 10;

export async function hubMediaObjectKeys(db: D1Database, hubId: number): Promise<string[]> {
  const rows = await db
    .prepare(HUB_MEDIA_OBJECT_KEYS_SQL)
    .bind(...Array<number>(HUB_MEDIA_OBJECT_KEYS_BINDS).fill(hubId))
    .all<{ object_key: string }>();
  return [...new Set(rows.results.map((row) => row.object_key).filter(Boolean))];
}

/**
 * Queue a Hub's R2 objects for deletion inside the same D1 batch that deletes
 * the Hub. `guardSql` (with `guardBindings`) is appended as an extra WHERE
 * condition so a guarded Hub deletion only queues media when it will succeed.
 */
export function queueHubMediaDeletionStatement(
  db: D1Database,
  hubId: number,
  queuedAt: string,
  guardSql = "1=1",
  guardBindings: unknown[] = [],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO decave_media_deletion_queue(object_key,queued_at,attempts,last_attempt_at)
       SELECT object_key,?,0,NULL FROM (${HUB_MEDIA_OBJECT_KEYS_SQL})
       WHERE object_key IS NOT NULL AND (${guardSql})`,
    )
    .bind(queuedAt, ...Array<number>(HUB_MEDIA_OBJECT_KEYS_BINDS).fill(hubId), ...guardBindings);
}

/** Attempt R2 deletion only for keys that are actually queued (a guarded batch may have skipped them). */
export async function attemptQueuedMediaDeletionIfQueued(env: Env, keys: Iterable<string>): Promise<void> {
  const unique = [...new Set(keys)].filter(isQueueableMediaKey);
  const queued: string[] = [];
  for (let offset = 0; offset < unique.length; offset += 90) {
    const chunk = unique.slice(offset, offset + 90);
    const rows = await env.DB.prepare(
      `SELECT object_key FROM decave_media_deletion_queue WHERE object_key IN (${chunk.map(() => "?").join(",")})`,
    )
      .bind(...chunk)
      .all<{ object_key: string }>();
    queued.push(...rows.results.map((row) => row.object_key));
  }
  await attemptQueuedMediaDeletion(env, queued);
}

export async function attemptQueuedMediaDeletion(env: Env, keys: Iterable<string>): Promise<void> {
  const uniqueKeys = [...new Set(keys)].filter(isQueueableMediaKey);
  for (const key of uniqueKeys) {
    try {
      await env.MEDIA.delete(key);
      await env.DB.prepare("DELETE FROM decave_media_deletion_queue WHERE object_key=?").bind(key).run();
    } catch (error) {
      await env.DB.prepare(
        "UPDATE decave_media_deletion_queue SET attempts=attempts+1,last_attempt_at=? WHERE object_key=?",
      )
        .bind(new Date().toISOString(), key)
        .run();
      console.error(
        "Queued media deletion failed; object remains scheduled for retry.",
        error instanceof Error ? error.name : "UnknownError",
      );
    }
  }
}

/** Clean an R2 object after its D1 ownership row failed to commit. */
export async function deleteUnlinkedMedia(env: Env, key: string): Promise<void> {
  try {
    await mediaDeletionQueueStatement(env.DB, key, new Date().toISOString()).run();
  } catch (error) {
    console.error(
      "Could not record a retry for an unlinked media object.",
      error instanceof Error ? error.name : "UnknownError",
    );
    try {
      await env.MEDIA.delete(key);
    } catch (deleteError) {
      console.error(
        "Unlinked media cleanup failed; manual recovery may be required.",
        deleteError instanceof Error ? deleteError.name : "UnknownError",
      );
    }
    return;
  }
  await attemptQueuedMediaDeletion(env, [key]);
}

export async function drainMediaDeletionQueue(env: Env): Promise<number> {
  const pending = await env.DB.prepare(
    `SELECT object_key FROM decave_media_deletion_queue
     ORDER BY queued_at,object_key LIMIT ?`,
  )
    .bind(MEDIA_DELETION_QUEUE_BATCH_SIZE)
    .all<{ object_key: string }>();
  await attemptQueuedMediaDeletion(
    env,
    pending.results.map((row) => row.object_key),
  );
  const stillPending = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM decave_media_deletion_queue
     WHERE object_key IN (${pending.results.map(() => "?").join(",") || "NULL"})`,
  )
    .bind(...pending.results.map((row) => row.object_key))
    .first<{ count: number }>();
  if (Number(stillPending?.count ?? 0) > 0) throw new Error("Some queued media objects remain retryable.");
  return pending.results.length;
}

export function mediaUrl(key: string | null): string | null {
  return key ? `/uploads/${key}` : null;
}

export async function serveR2(request: Request, env: Env, exportOwnerUserId?: string): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  const url = new URL(request.url);
  const mediaPrefix = url.pathname.startsWith("/uploads/")
    ? "/uploads/"
    : url.pathname.startsWith("/api/media/")
      ? "/api/media/"
      : null;
  if (!mediaPrefix) return new Response("Not found", { status: 404 });
  let key: string;
  try {
    // Both public Hub artwork URLs and Streamer thumbnails use the same
    // authenticated R2 authorization below. Decode exactly once so a
    // double-encoded traversal or private-media key cannot be smuggled in.
    key = decodeURIComponent(url.pathname.slice(mediaPrefix.length));
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!key || key.includes("..") || key.startsWith("/") || key.includes("\\")) {
    return new Response("Not found", { status: 404 });
  }

  // Never expose raw profile-avatar object names. Avatar delivery goes through
  // /api/users/<public DeCave ID>/avatar, which performs relationship/context
  // authorization and does not reveal the internal account UUID in the R2 key.
  if (key.startsWith("avatars/") || key.startsWith("profile-banners/")) {
    return new Response("Not found", { status: 404 });
  }

  if (key.startsWith("attachments/")) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;

    const access = await env.DB.prepare(
      `SELECT kind,owner_user_id,peer_user_id,hub_id,room_id
         FROM decave_attachment_access WHERE r2_key=? LIMIT 1`,
    )
      .bind(key)
      .first<{
        kind: "dm" | "channel";
        owner_user_id: string;
        peer_user_id: string | null;
        hub_id: number | null;
        room_id: number | null;
      }>();

    if (access) {
      if (access.kind === "dm") {
        if (user.id !== access.owner_user_id && user.id !== access.peer_user_id) {
          return apiError("media.privateAttachmentDenied", 403);
        }
      } else {
        const room = access.room_id ? await getRoom(env.DB, access.room_id) : null;
        if (access.owner_user_id !== exportOwnerUserId && (!room || !(await canAccessRoom(env.DB, room, user.id)))) {
          return apiError("media.roomAttachmentDenied", 403);
        }
      }
    } else if (key.startsWith("attachments/dms/")) {
      // Compatibility with historical objects whose key encoded internal UUIDs.
      // This is authorization only; new uploads never use this key shape.
      const parts = key.split("/");
      const userA = parts[2] ?? "";
      const userB = parts[3] ?? "";
      if (!userA || !userB || (user.id !== userA && user.id !== userB)) {
        return apiError("media.privateAttachmentDenied", 403);
      }
    } else {
      // Historical Hub attachments used attachments/<hub>/<room>/<object>.
      const parts = key.split("/");
      const hubId = Number(parts[1]);
      const roomId = Number(parts[2]);
      const room = Number.isInteger(roomId) && roomId > 0 ? await getRoom(env.DB, roomId) : null;
      const exportAuthor =
        exportOwnerUserId === user.id
          ? await env.DB.prepare(
              "SELECT 1 AS present FROM decave_messages WHERE attachment_key=? AND author_user_id=? LIMIT 1",
            )
              .bind(key, user.id)
              .first<{ present: number }>()
          : null;
      if (
        !room ||
        !Number.isInteger(hubId) ||
        room.hub_id !== hubId ||
        (!(await canAccessRoom(env.DB, room, user.id)) && !exportAuthor)
      ) {
        return apiError("media.roomAttachmentDenied", 403);
      }
    }
  } else if (key.startsWith("hub-media/") || key.startsWith("hub-assets/")) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const parts = key.split("/");
    const hubId = Number(parts[1]);
    if (!Number.isInteger(hubId) || hubId <= 0) return new Response("Not found", { status: 404 });
    const hub = await getHub(env.DB, hubId);
    if (!hub) return new Response("Not found", { status: 404 });
    // Public Hub artwork is visible to authenticated users browsing Hubs.
    // Private Hub artwork/assets require membership.
    if (hub.visibility !== "public" && !(await getRole(env.DB, hubId, user.id))) {
      return apiError("media.hubMediaDenied", 403);
    }
    // A room's own background is visible only to people who can open that
    // room, so a private room's art never leaks through the public-Hub rule.
    if (parts[0] === "hub-media" && parts[2] === "room-background") {
      const room = await getRoom(env.DB, Number(parts[3]));
      if (
        !room ||
        room.hub_id !== hubId ||
        room.background_key !== key ||
        !(await canAccessRoom(env.DB, room, user.id))
      )
        return new Response("Not found", { status: 404 });
    }
  } else {
    // Fail closed for unknown R2 prefixes. The app Worker must never become a
    // generic proxy for arbitrary objects that happen to share the bucket.
    return new Response("Not found", { status: 404 });
  }

  const object = await env.MEDIA.get(key);
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  const isUserMedia = INLINE_MEDIA_PREFIXES.some((prefix) => key.startsWith(prefix));
  const storedDisposition = headers.get("content-disposition");
  let body: ReadableStream<Uint8Array> | null = null;
  const reader = object.body.getReader();
  const prefixChunks: Uint8Array[] = [];
  let prefixLength = 0;
  let done = false;
  while (prefixLength < 32 && !done) {
    const next = await reader.read();
    done = next.done;
    if (next.value?.length) {
      prefixChunks.push(next.value);
      prefixLength += next.value.length;
    }
  }
  const prefix = new Uint8Array(Math.min(prefixLength, 32));
  let offset = 0;
  for (const chunk of prefixChunks) {
    const take = Math.min(chunk.length, prefix.length - offset);
    if (take <= 0) break;
    prefix.set(chunk.subarray(0, take), offset);
    offset += take;
  }
  const actualMime = sniffSafeMediaMime(prefix);
  const safeRaster = actualMime?.startsWith("image/") ?? false;
  const safePassiveMedia = actualMime?.startsWith("audio/") || actualMime?.startsWith("video/");
  const canServeInline = isUserMedia && Boolean(actualMime) && (safeRaster || safePassiveMedia);
  headers.set("content-type", canServeInline ? actualMime! : "application/octet-stream");
  if (storedDisposition && /^attachment(?:\s*;|$)/i.test(storedDisposition)) {
    headers.set("content-disposition", preserveAttachmentDisposition(storedDisposition));
  } else if (!canServeInline) {
    headers.set("content-type", "application/octet-stream");
    headers.set("content-disposition", "attachment");
  } else {
    headers.delete("content-disposition");
  }
  if (request.method === "HEAD") {
    await reader.cancel();
  } else {
    body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of prefixChunks) controller.enqueue(chunk);
        if (done) controller.close();
      },
      async pull(controller) {
        if (done) return;
        const next = await reader.read();
        if (next.done) {
          done = true;
          controller.close();
        } else if (next.value) {
          controller.enqueue(next.value);
        }
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });
  }
  headers.set("etag", object.httpEtag);
  headers.set("content-length", String(object.size));
  headers.set("x-decave-attachment-size", String(object.size));
  headers.set("x-content-type-options", "nosniff");
  headers.set("cache-control", "private, max-age=300");
  return new Response(body, { headers });
}

// ---------------------------------------------------------------------------
// Durable R2 deletion. An object key is written to decave_media_deletion_queue
// in the same D1 batch that drops the last row pointing at it; the R2 delete is
// then tried at once and, if R2 is unavailable, again by the hourly retention
// job (worker/retention.ts) until R2 confirms. Migration 0074 creates the
// table; the lazy schema below keeps a Worker deployed before the migration
// working.

let mediaDeletionQueueReady: Promise<void> | null = null;

export function ensureMediaDeletionQueueSchema(db: D1Database): Promise<void> {
  mediaDeletionQueueReady ??= db
    .prepare(
      `CREATE TABLE IF NOT EXISTS decave_media_deletion_queue (
        object_key TEXT PRIMARY KEY,
        queued_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT
      )`,
    )
    .run()
    .then(() => undefined)
    .catch((error) => {
      mediaDeletionQueueReady = null;
      throw error;
    });
  return mediaDeletionQueueReady;
}

/**
 * SQL condition (correlated on `access`, a decave_attachment_access row) that is
 * true while any DM still carries the upload: plaintext DMs name it in `text`,
 * end-to-end encrypted DMs list it in `attachment_refs` (the ciphertext itself is
 * opaque to the server, so the client sends the refs next to the envelope).
 * Messages either way between the owner and the peer are checked.
 */
export const DM_UPLOAD_REFERENCED_SQL = `EXISTS(
  SELECT 1 FROM decave_direct_messages dm
  WHERE (dm.from_user_id=access.owner_user_id
         OR (access.peer_user_id IS NOT NULL AND dm.from_user_id=access.peer_user_id AND dm.to_user_id=access.owner_user_id))
    AND (instr(dm.text, access.r2_key)>0 OR instr(COALESCE(dm.attachment_refs, ''), access.r2_key)>0)
)`;

/** True while a Hub channel message (or legacy message) still points at the key. */
export const CHANNEL_UPLOAD_REFERENCED_SQL = `EXISTS(
  SELECT 1 FROM decave_messages m WHERE m.attachment_key=access.r2_key
)`;

export function queueMediaDeletionStatements(db: D1Database, keys: Iterable<string>, now: string) {
  return [...new Set(keys)]
    .filter(Boolean)
    .map((key) =>
      db
        .prepare("INSERT OR IGNORE INTO decave_media_deletion_queue(object_key,queued_at,attempts) VALUES(?,?,0)")
        .bind(key, now),
    );
}

/**
 * Try to delete queued keys from R2. Keys R2 confirmed are dequeued; failures
 * stay queued with an attempt count. A key that is referenced again (an
 * attachment access row or a channel message) is dequeued without deleting.
 * Returns the keys still queued.
 */
export async function deleteQueuedMedia(env: Env, keys: string[]): Promise<string[]> {
  const unique = [...new Set(keys)].filter(Boolean);
  if (!unique.length) return [];
  const live: string[] = [];
  const stillUsed: string[] = [];
  for (const key of unique) {
    const used = await env.DB.prepare(
      `SELECT 1 AS used FROM decave_attachment_access WHERE r2_key=?
       UNION ALL SELECT 1 FROM decave_messages WHERE attachment_key=? LIMIT 1`,
    )
      .bind(key, key)
      .first<{ used: number }>();
    (used ? stillUsed : live).push(key);
  }
  const dequeue = (list: string[]) =>
    list.length
      ? env.DB.batch(
          list.map((key) => env.DB.prepare("DELETE FROM decave_media_deletion_queue WHERE object_key=?").bind(key)),
        )
      : Promise.resolve([]);
  await dequeue(stillUsed);
  // One key at a time so each confirmed delete is dequeued on its own.
  const deleted: string[] = [];
  const failed: string[] = [];
  for (const key of live) {
    try {
      await env.MEDIA.delete(key);
      deleted.push(key);
    } catch {
      failed.push(key);
    }
  }
  await dequeue(deleted);
  if (failed.length) {
    const now = new Date().toISOString();
    await env.DB.batch(
      failed.map((key) =>
        env.DB.prepare(
          "UPDATE decave_media_deletion_queue SET attempts=attempts+1, last_attempt_at=? WHERE object_key=?",
        ).bind(now, key),
      ),
    );
  }
  return failed;
}

/** deleteQueuedMedia for only those keys a (possibly guarded) batch really queued. */
export async function deleteQueuedMediaIfQueued(env: Env, keys: Iterable<string>): Promise<string[]> {
  const unique = [...new Set(keys)].filter(Boolean);
  const queued: string[] = [];
  for (let offset = 0; offset < unique.length; offset += 90) {
    const chunk = unique.slice(offset, offset + 90);
    const rows = await env.DB.prepare(
      `SELECT object_key FROM decave_media_deletion_queue WHERE object_key IN (${chunk.map(() => "?").join(",")})`,
    )
      .bind(...chunk)
      .all<{ object_key: string }>();
    queued.push(...rows.results.map((row) => row.object_key));
  }
  return deleteQueuedMedia(env, queued);
}
