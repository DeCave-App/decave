// Voice room soundboard: listing, uploading, playing and deleting sounds.

import { requireUser } from "../lib/sessions";
import { ensureSoundboardSchema, type SoundboardRow, soundboardSoundForClient } from "../lib/soundboard";
import { getRole, nowIso, hasPermission } from "../db";
import { json, bodyJson, idFromPath } from "../lib/http";
import { realtimeBroadcast } from "../lib/realtime";
import type { ApiContext } from "./context";

export async function handleSoundboardRoutes({ request, env, p, method }: ApiContext): Promise<Response | null> {
  if (method === "GET" && p === "/api/soundboard") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    await ensureSoundboardSchema(env);
    const hubId = Number(new URL(request.url).searchParams.get("hubId"));
    if (!Number.isSafeInteger(hubId) || hubId <= 0 || !(await getRole(env.DB, hubId, user.id)))
      return json({ error: "Hub access required." }, 403);
    // Preserve pre-Hub soundboards: the uploader's first Hub soundboard visit
    // adopts their existing personal sounds, after which every Hub member sees them.
    await env.DB.prepare("UPDATE decave_soundboard_sounds SET hub_id=? WHERE hub_id IS NULL AND user_id=?")
      .bind(hubId, user.id)
      .run();
    const rows = await env.DB.prepare(
      "SELECT * FROM decave_soundboard_sounds WHERE hub_id=? ORDER BY created_at DESC LIMIT 48",
    )
      .bind(hubId)
      .all<SoundboardRow>();
    return json({ sounds: rows.results.map(soundboardSoundForClient) }, 200, { "Cache-Control": "no-store, private" });
  }

  if (method === "POST" && p === "/api/soundboard") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    await ensureSoundboardSchema(env);

    const body = await bodyJson(request);
    const hubId = Number(body.hubId);
    if (!Number.isSafeInteger(hubId) || hubId <= 0 || !(await getRole(env.DB, hubId, user.id)))
      return json({ error: "Hub access required." }, 403);

    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM decave_soundboard_sounds WHERE hub_id=?")
      .bind(hubId)
      .first<{ count: number }>();
    if (Number(count?.count ?? 0) >= 48) {
      return json({ error: "This Hub can save up to 48 soundboard sounds." }, 409);
    }

    const name =
      typeof body.name === "string"
        ? Array.from(
            body.name
              .normalize("NFC")
              .replace(/[\u0000-\u001f\u007f]/g, " ")
              .replace(/\s+/g, " ")
              .trim(),
          )
            .slice(0, 32)
            .join("")
        : "";
    const dataUrl = typeof body.dataUrl === "string" ? body.dataUrl : "";
    const match = /^data:(audio\/(?:mpeg|wav|x-wav|ogg|mp4|webm));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!name) return json({ error: "Give the sound a name." }, 400);
    if (!match) return json({ error: "Upload an MP3, WAV, OGG, M4A or WebM audio file." }, 400);

    const bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0));
    if (!bytes.length || bytes.length > 1536 * 1024) {
      return json({ error: "Soundboard files must be 1.5 MB or smaller." }, 400);
    }

    const mimeType = match[1] === "audio/x-wav" ? "audio/wav" : match[1];
    const ext =
      mimeType === "audio/mpeg"
        ? "mp3"
        : mimeType === "audio/wav"
          ? "wav"
          : mimeType === "audio/ogg"
            ? "ogg"
            : mimeType === "audio/mp4"
              ? "m4a"
              : "webm";
    const id = crypto.randomUUID();
    const key = `soundboard/hub-${hubId}/${id}.${ext}`;
    const createdAt = nowIso();
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: mimeType } });
    await env.DB.prepare(
      `INSERT INTO decave_soundboard_sounds(id,user_id,hub_id,name,mime_type,size_bytes,r2_key,created_at)
       VALUES(?,?,?,?,?,?,?,?)`,
    )
      .bind(id, user.id, hubId, name, mimeType, bytes.length, key, createdAt)
      .run();
    const row = await env.DB.prepare("SELECT * FROM decave_soundboard_sounds WHERE id=?")
      .bind(id)
      .first<SoundboardRow>();
    await realtimeBroadcast(env, { type: "SOUNDBOARD_REFRESH", hubId }, { hubId });
    return json({ sound: soundboardSoundForClient(row!) }, 201);
  }

  const soundboardMediaRoute = idFromPath(p, /^\/api\/soundboard\/([^/]+)\/media$/);
  if (method === "GET" && soundboardMediaRoute) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    await ensureSoundboardSchema(env);
    const id = decodeURIComponent(soundboardMediaRoute[1]);
    const row = await env.DB.prepare("SELECT * FROM decave_soundboard_sounds WHERE id=?")
      .bind(id)
      .first<SoundboardRow>();
    if (!row) return new Response(null, { status: 404 });
    if (!row.hub_id || !(await getRole(env.DB, row.hub_id, user.id))) return new Response(null, { status: 403 });
    const object = await env.MEDIA.get(row.r2_key);
    if (!object) return new Response(null, { status: 404 });
    const headers = new Headers({
      "Content-Type": row.mime_type,
      "Cache-Control": "private, max-age=3600",
      "Content-Length": String(row.size_bytes),
      "X-Content-Type-Options": "nosniff",
    });
    return new Response(object.body, { headers });
  }

  const soundboardDeleteRoute = idFromPath(p, /^\/api\/soundboard\/([^/]+)$/);
  if (method === "DELETE" && soundboardDeleteRoute) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    await ensureSoundboardSchema(env);
    const id = decodeURIComponent(soundboardDeleteRoute[1]);
    const row = await env.DB.prepare("SELECT * FROM decave_soundboard_sounds WHERE id=?")
      .bind(id)
      .first<SoundboardRow>();
    if (!row) return json({ error: "Sound not found." }, 404);
    if (!row.hub_id || (row.user_id !== user.id && !(await hasPermission(env.DB, row.hub_id, user.id, "manageRooms"))))
      return json({ error: "Only the uploader or a Hub manager can delete this sound." }, 403);
    await env.MEDIA.delete(row.r2_key);
    await env.DB.prepare("DELETE FROM decave_soundboard_sounds WHERE id=?").bind(id).run();
    await realtimeBroadcast(env, { type: "SOUNDBOARD_REFRESH", hubId: row.hub_id }, { hubId: row.hub_id });
    return json({ success: true });
  }

  return null;
}
