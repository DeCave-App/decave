// Stored media files and Hub icon, banner and chat background uploads.

import {
  attemptQueuedMediaDeletion,
  deleteUnlinkedMedia,
  mediaDeletionQueueStatement,
  safeUploadedContentType,
  serveR2,
} from "../lib/media";
import { idFromPath, json } from "../lib/http";
import { requireUser } from "../lib/sessions";
import { getHub, nowIso, audit } from "../db";
import { realtimeBroadcast } from "../lib/realtime";
import { readImageDimensions, validateHubMediaDimensions, type HubMediaKind } from "../../shared/hub-media-specs";
import type { ApiContext } from "./context";

export async function handleMediaRoutes({ request, env, p, method }: ApiContext): Promise<Response | null> {
  // Streamer package thumbnails use encoded existing-media paths. Keep this
  // adapter on the API router so it inherits the same authenticated serveR2
  // authorization as legacy /uploads/* URLs.
  if (p.startsWith("/api/media/")) return serveR2(request, env);

  const mediaRoute = idFromPath(p, /^\/api\/servers\/(\d+)\/media\/(icon|banner|chat-background)$/);
  if (method === "DELETE" && mediaRoute && mediaRoute[2] !== "icon") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const hubId = Number(mediaRoute[1]);
    const kind = mediaRoute[2];
    const hub = await getHub(env.DB, hubId);
    if (!hub) return json({ error: "Hub not found" }, 404);
    if (hub.owner_id !== user.id) return json({ error: "Only the Hub owner can change Hub artwork" }, 403);
    const old = kind === "banner" ? hub.banner_key : hub.chat_background_key;
    await env.DB.batch([
      ...(old ? [mediaDeletionQueueStatement(env.DB, old, nowIso())] : []),
      ...(kind === "banner"
        ? [
            env.DB.prepare(
              "UPDATE decave_hubs SET banner_key=NULL,use_banner_background=0,updated_at=? WHERE id=?",
            ).bind(nowIso(), hubId),
          ]
        : [
            env.DB.prepare(
              "UPDATE decave_hubs SET chat_background_key=NULL,use_chat_background=0,updated_at=? WHERE id=?",
            ).bind(nowIso(), hubId),
          ]),
    ]);
    if (old) await attemptQueuedMediaDeletion(env, [old]);
    await audit(env.DB, hubId, user.id, `hub.${kind}.remove`);
    await realtimeBroadcast(env, { type: "SERVERS_REFRESH" }, { hubId });
    return json({ ok: true });
  }
  if (method === "POST" && mediaRoute) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const hubId = Number(mediaRoute[1]);
    const kind = mediaRoute[2];
    const hub = await getHub(env.DB, hubId);
    if (!hub) return json({ error: "Hub not found" }, 404);
    if (hub.owner_id !== user.id) return json({ error: "Only the Hub owner can change Hub artwork" }, 403);
    const limit = kind === "icon" ? 3 * 1024 * 1024 : 8 * 1024 * 1024;
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > limit) return json({ error: "Hub artwork exceeds the size limit" }, 413);
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > limit)
      return json({ error: "Hub artwork exceeds the size limit" }, 413);
    let mime: string;
    try {
      mime = safeUploadedContentType(request.headers.get("X-File-Type") ?? "", new Uint8Array(bytes));
    } catch {
      return json({ error: "Hub artwork must contain PNG, JPG, WebP or GIF image data" }, 400);
    }
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mime))
      return json({ error: "Hub artwork must be PNG, JPG, WebP or GIF" }, 400);
    if (kind !== "icon") {
      const dims = readImageDimensions(bytes);
      const dimError = dims
        ? validateHubMediaDimensions(kind as HubMediaKind, dims.width, dims.height)
        : validateHubMediaDimensions(kind as HubMediaKind, NaN, NaN);
      if (dimError) return json({ error: dimError }, 400);
    }
    const key = `hub-media/${hubId}/${kind}/${crypto.randomUUID()}`;
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: mime } });
    const column = kind === "icon" ? "icon_key" : kind === "banner" ? "banner_key" : "chat_background_key";
    const old = kind === "icon" ? hub.icon_key : kind === "banner" ? hub.banner_key : hub.chat_background_key;
    let updateResults: D1Result[];
    try {
      updateResults = await env.DB.batch([
        ...(old ? [mediaDeletionQueueStatement(env.DB, old, nowIso())] : []),
        env.DB.prepare(`UPDATE decave_hubs SET ${column}=?,updated_at=? WHERE id=?`).bind(key, nowIso(), hubId),
      ]);
    } catch (error) {
      await deleteUnlinkedMedia(env, key);
      throw error;
    }
    if (Number(updateResults[updateResults.length - 1]?.meta.changes ?? 0) !== 1) {
      await deleteUnlinkedMedia(env, key);
      return json({ error: "The Hub changed while artwork was uploading." }, 409);
    }
    if (old) await attemptQueuedMediaDeletion(env, [old]);
    await audit(env.DB, hubId, user.id, `hub.${kind}.update`);
    await realtimeBroadcast(env, { type: "SERVERS_REFRESH" }, { hubId });
    return json({ url: `/uploads/${key}` });
  }

  return null;
}
