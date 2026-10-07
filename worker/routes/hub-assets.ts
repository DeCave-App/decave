// Hub emotes and stickers.

import { idFromPath, json } from "../lib/http";
import { requireUser } from "../lib/sessions";
import { getRole, hasPermission, nowIso, audit } from "../db";
import type { ApiContext } from "./context";

export async function handleHubAssetRoutes({ request, env, p, method }: ApiContext): Promise<Response | null> {
  const listHubAssets = idFromPath(p, /^\/api\/servers\/(\d+)\/assets$/);
  if (method === "GET" && listHubAssets) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const hubId = Number(listHubAssets[1]);
    if (!(await getRole(env.DB, hubId, user.id))) return json({ error: "No access" }, 403);
    const rows = await env.DB.prepare(
      "SELECT id,kind,name,r2_key,mime_type,created_at FROM decave_hub_assets WHERE hub_id=? ORDER BY created_at ASC LIMIT 500",
    )
      .bind(hubId)
      .all<{ id: string; kind: string; name: string; r2_key: string; mime_type: string; created_at: string }>();
    return json(
      (rows.results ?? []).map((row) => ({
        id: row.id,
        kind: row.kind,
        name: row.name,
        mimeType: row.mime_type,
        url: `/uploads/${row.r2_key}`,
        createdAt: row.created_at,
      })),
    );
  }

  const uploadHubAsset = idFromPath(p, /^\/api\/servers\/(\d+)\/assets\/(emote|sticker)$/);
  if (method === "POST" && uploadHubAsset) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const hubId = Number(uploadHubAsset[1]);
    const kind = uploadHubAsset[2] as "emote" | "sticker";
    if (!(await hasPermission(env.DB, hubId, user.id, "manageRooms")))
      return json({ error: "Manage Rooms permission required" }, 403);
    const limit = kind === "emote" ? 1024 * 1024 : 5 * 1024 * 1024;
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > limit)
      return json({ error: `${kind === "emote" ? "Emote" : "Sticker"} exceeds the size limit` }, 413);
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > limit)
      return json({ error: `${kind === "emote" ? "Emote" : "Sticker"} exceeds the size limit` }, 413);
    const mime = (request.headers.get("X-File-Type") ?? "").slice(0, 100);
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mime))
      return json({ error: "Use PNG, JPG, WebP or GIF" }, 400);
    let name = "custom";
    try {
      name =
        decodeURIComponent(request.headers.get("X-Asset-Name") ?? "custom")
          .replace(/[^\p{L}\p{N}_-]/gu, "")
          .slice(0, 32) || "custom";
    } catch {}
    const id = crypto.randomUUID();
    const key = `hub-assets/${hubId}/${kind}/${id}`;
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: mime } });
    await env.DB.prepare(
      "INSERT INTO decave_hub_assets(id,hub_id,kind,name,r2_key,mime_type,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)",
    )
      .bind(id, hubId, kind, name, key, mime, user.id, nowIso())
      .run();
    await audit(env.DB, hubId, user.id, `asset.${kind}.create`, undefined, name);
    return json({ id, kind, name, mimeType: mime, url: `/uploads/${key}` }, 201);
  }

  const hubAssetFile = idFromPath(p, /^\/api\/servers\/(\d+)\/assets\/([^/]+)\/file$/);
  if (method === "GET" && hubAssetFile) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const hubId = Number(hubAssetFile[1]);
    if (!(await getRole(env.DB, hubId, user.id))) return json({ error: "No access" }, 403);
    const asset = await env.DB.prepare("SELECT r2_key,mime_type FROM decave_hub_assets WHERE id=? AND hub_id=?")
      .bind(decodeURIComponent(hubAssetFile[2]), hubId)
      .first<{ r2_key: string; mime_type: string }>();
    if (!asset) return json({ error: "Asset not found" }, 404);
    const object = await env.MEDIA.get(asset.r2_key);
    if (!object) return json({ error: "Asset file missing" }, 404);
    return new Response(object.body, {
      headers: {
        "content-type": asset.mime_type,
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff",
      },
    });
  }

  const hubAssetItem = idFromPath(p, /^\/api\/servers\/(\d+)\/assets\/([^/]+)$/);
  if (method === "DELETE" && hubAssetItem) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const hubId = Number(hubAssetItem[1]);
    if (!(await hasPermission(env.DB, hubId, user.id, "manageRooms")))
      return json({ error: "Manage Rooms permission required" }, 403);
    const id = decodeURIComponent(hubAssetItem[2]);
    const asset = await env.DB.prepare("SELECT r2_key FROM decave_hub_assets WHERE id=? AND hub_id=?")
      .bind(id, hubId)
      .first<{ r2_key: string }>();
    if (!asset) return json({ error: "Asset not found" }, 404);
    await env.MEDIA.delete(asset.r2_key);
    await env.DB.prepare("DELETE FROM decave_hub_assets WHERE id=? AND hub_id=?").bind(id, hubId).run();
    return json({ success: true });
  }

  return null;
}
