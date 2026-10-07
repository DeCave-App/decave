// Your profile: game activity, presence status, profile fields, avatar and
// banner, and other users' public profiles.

import { requireUser } from "../lib/sessions";
import { ensureActivityRow, type SteamLinkRow, activitySource } from "../lib/activity";
import { json, bodyJson, idFromPath } from "../lib/http";
import {
  nowIso,
  type UserRow,
  privateUser,
  userByReference,
  usersSharePublicContext,
  usersAreFriends,
  publicUser,
  activityTextFor,
} from "../db";
import { broadcastProfileUpdate, realtimeFetch } from "../lib/realtime";
import type { ApiContext } from "./context";

export async function handleActivityStatusRoutes({ request, env, p, method }: ApiContext): Promise<Response | null> {
  if (method === "GET" && p === "/api/profile/activity") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const activity = await ensureActivityRow(env, user);
    const steam = await env.DB.prepare("SELECT * FROM decave_steam_links WHERE user_id=?")
      .bind(user.id)
      .first<SteamLinkRow>();
    return json({
      manualText: activity.manual_text,
      automaticText: activity.automatic_text,
      effectiveText: activity.automatic_text,
      source: activity.source,
      appId: activity.source_app_id,
      startedAt: activity.started_at,
      steam: steam
        ? {
            linked: true,
            steamId: steam.steam_id,
            personaName: steam.persona_name,
            avatarUrl: steam.avatar_url,
            profileUrl: steam.profile_url,
            apiConfigured: Boolean(env.STEAM_WEB_API_KEY),
          }
        : { linked: false, apiConfigured: Boolean(env.STEAM_WEB_API_KEY) },
    });
  }

  if (method === "PUT" && p === "/api/profile/activity/automatic") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const body = await bodyJson(request);
    const activity = await ensureActivityRow(env, user);
    const automaticText = typeof body.text === "string" ? body.text.trim().slice(0, 80) : "";
    const source = automaticText ? activitySource(body.source) : "";
    if (automaticText && !source) return json({ error: "Invalid activity source." }, 400);
    const appId = automaticText && typeof body.appId === "string" ? body.appId.trim().slice(0, 100) : "";
    const startedAt =
      automaticText && typeof body.startedAt === "string" && !Number.isNaN(Date.parse(body.startedAt))
        ? new Date(body.startedAt).toISOString()
        : automaticText
          ? nowIso()
          : null;
    const stamp = nowIso();
    await env.DB.prepare(
      `UPDATE decave_activity_state
         SET automatic_text=?, source=?, source_app_id=?, started_at=?, updated_at=?
         WHERE user_id=?`,
    )
      .bind(automaticText, source, appId, startedAt, stamp, user.id)
      .run();
    const effectiveText = automaticText;
    await env.DB.prepare("UPDATE decave_users SET activity_text=? WHERE id=?").bind(effectiveText, user.id).run();
    const updated = await env.DB.prepare("SELECT * FROM decave_users WHERE id=?").bind(user.id).first<UserRow>();
    if (!updated) return json({ error: "User not found." }, 404);
    await broadcastProfileUpdate(env, updated);
    return json({
      user: privateUser(updated),
      activity: {
        manualText: activity.manual_text,
        automaticText,
        effectiveText,
        source,
        appId,
        startedAt,
      },
    });
  }

  return null;
}

export async function handleProfileRoutes({ request, env, p, method }: ApiContext): Promise<Response | null> {
  if (method === "PUT" && p === "/api/profile/status") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;

    const body = await bodyJson(request);
    const status =
      body.status === "online" || body.status === "idle" || body.status === "dnd" || body.status === "invisible"
        ? body.status
        : null;

    if (!status) {
      return json({ error: "Invalid status." }, 400);
    }

    await env.DB.prepare("UPDATE decave_users SET status=? WHERE id=?").bind(status, user.id).run();

    const updated = await env.DB.prepare("SELECT * FROM decave_users WHERE id=?").bind(user.id).first<UserRow>();

    if (!updated) return json({ error: "User not found." }, 404);

    await broadcastProfileUpdate(env, updated);

    return json({ user: privateUser(updated) });
  }

  if (method === "PUT" && p === "/api/profile") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const body = await bodyJson(request);
    const status =
      body.status === "idle" || body.status === "dnd" || body.status === "invisible" ? body.status : "online";
    const bio = typeof body.bio === "string" ? body.bio.trim().slice(0, 190) : user.bio;
    const statusText = typeof body.statusText === "string" ? body.statusText.trim().slice(0, 80) : user.status_text;
    const activity = await ensureActivityRow(env, user);
    const effectiveActivityText = activity.automatic_text;
    const accent = typeof body.accent === "string" && /^#[0-9a-fA-F]{6}$/.test(body.accent) ? body.accent : user.accent;
    await env.DB.prepare("UPDATE decave_users SET bio=?, status=?, status_text=?, activity_text=?, accent=? WHERE id=?")
      .bind(bio, status, statusText, effectiveActivityText, accent, user.id)
      .run();
    // Display name and pronouns are optional extras (migration 0060); only
    // touch them when the client sends them.
    if (typeof body.displayName === "string" || typeof body.pronouns === "string") {
      const clean = (value: unknown, max: number, fallback: string) =>
        typeof value === "string"
          ? value
              .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, max)
          : fallback;
      await env.DB.prepare("UPDATE decave_users SET display_name=?, pronouns=? WHERE id=?")
        .bind(
          clean(body.displayName, 32, user.display_name ?? ""),
          clean(body.pronouns, 24, user.pronouns ?? ""),
          user.id,
        )
        .run();
    }
    const updated = await env.DB.prepare("SELECT * FROM decave_users WHERE id=?").bind(user.id).first<UserRow>();
    await broadcastProfileUpdate(env, updated!);
    return json({ user: privateUser(updated!) });
  }

  const publicProfileGet = idFromPath(p, /^\/api\/users\/([^/]+)\/profile$/);
  if (method === "GET" && publicProfileGet) {
    const viewer = await requireUser(request, env);
    if (viewer instanceof Response) return viewer;
    const reference = decodeURIComponent(publicProfileGet[1]);
    const row = await userByReference(env.DB, reference);
    if (!row || row.deleted_at) return json({ error: "User not found" }, 404);
    if (!(await usersSharePublicContext(env.DB, viewer.id, row.id))) {
      return json({ error: "No shared context with this account." }, 403);
    }
    const onlineResponse = await realtimeFetch(env, "/internal/online-users");
    const onlineData = onlineResponse.ok ? ((await onlineResponse.json()) as { userIds?: string[] }) : {};
    const online = row.status !== "invisible" && (onlineData.userIds ?? []).includes(row.id);
    const presence =
      row.status === "invisible"
        ? null
        : await env.DB.prepare("SELECT last_seen_at FROM decave_presence_activity WHERE user_id=?")
            .bind(row.id)
            .first<{ last_seen_at: string }>();
    const relation =
      row.id === viewer.id ? "self" : (await usersAreFriends(env.DB, viewer.id, row.id)) ? "friend" : "other";
    return json(
      {
        ...publicUser(row),
        ...(relation === "self" || relation === "friend"
          ? { createdAt: row.created_at, lastOnlineAt: presence?.last_seen_at ?? null }
          : {}),
        status: online ? row.status : "invisible",
        statusText: online ? row.status_text : "",
        activityText: online ? activityTextFor(row, relation) : "",
        online,
      },
      200,
      { "Cache-Control": "no-store, private" },
    );
  }

  const avatarGet = idFromPath(p, /^\/api\/users\/([^/]+)\/avatar$/);
  if (method === "GET" && avatarGet) {
    const viewer = await requireUser(request, env);
    if (viewer instanceof Response) return viewer;
    const reference = decodeURIComponent(avatarGet[1]);
    const row = await userByReference(env.DB, reference);
    if (!row?.avatar_key || row.deleted_at) return new Response(null, { status: 404 });
    if (!(await usersSharePublicContext(env.DB, viewer.id, row.id))) return new Response(null, { status: 403 });
    const object = await env.MEDIA.get(row.avatar_key);
    if (!object) return new Response(null, { status: 404 });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("cache-control", "private, max-age=300");
    headers.set("x-content-type-options", "nosniff");
    return new Response(object.body, { headers });
  }

  const bannerGet = idFromPath(p, /^\/api\/users\/([^/]+)\/banner$/);
  if (method === "GET" && bannerGet) {
    const viewer = await requireUser(request, env);
    if (viewer instanceof Response) return viewer;
    const row = await userByReference(env.DB, decodeURIComponent(bannerGet[1]));
    if (!row?.banner_key || row.deleted_at) return new Response(null, { status: 404 });
    if (row.id !== viewer.id && !(await usersSharePublicContext(env.DB, viewer.id, row.id)))
      return new Response(null, { status: 403 });
    const object = await env.MEDIA.get(row.banner_key);
    if (!object) return new Response(null, { status: 404 });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("cache-control", "private, max-age=300");
    headers.set("x-content-type-options", "nosniff");
    return new Response(object.body, { headers });
  }

  if ((method === "PUT" || method === "DELETE") && p === "/api/profile/banner") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    if (method === "DELETE") {
      if (user.banner_key) await env.MEDIA.delete(user.banner_key);
      await env.DB.prepare("UPDATE decave_users SET banner_key=NULL, banner_updated_at=? WHERE id=?")
        .bind(nowIso(), user.id)
        .run();
    } else {
      const declaredLength = Number(request.headers.get("content-length") ?? 0);
      if (declaredLength > 5 * 1024 * 1024) return json({ error: "Banner image request is too large." }, 413);
      const body = await bodyJson(request);
      const dataUrl = typeof body.imageDataUrl === "string" ? body.imageDataUrl : "";
      const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
      if (!match) return json({ error: "Upload a PNG, JPEG or WebP image." }, 400);
      const bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0));
      if (!bytes.length || bytes.length > 3 * 1024 * 1024)
        return json({ error: "Banner images must be 3 MB or smaller." }, 400);
      const ext = match[1] === "image/png" ? "png" : match[1] === "image/webp" ? "webp" : "jpg";
      // Opaque key: the media route refuses profile-banners/ so the account
      // UUID in the path never reaches clients; delivery goes through
      // /api/users/<public ID>/banner with the same checks as avatars.
      const key = `profile-banners/${user.id}/${crypto.randomUUID()}.${ext}`;
      if (user.banner_key) await env.MEDIA.delete(user.banner_key);
      await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: match[1] } });
      await env.DB.prepare("UPDATE decave_users SET banner_key=?, banner_updated_at=? WHERE id=?")
        .bind(key, nowIso(), user.id)
        .run();
    }
    const updated = await env.DB.prepare("SELECT * FROM decave_users WHERE id=?").bind(user.id).first<UserRow>();
    await broadcastProfileUpdate(env, updated!);
    return json({ user: privateUser(updated!) });
  }

  if ((method === "PUT" || method === "DELETE") && p === "/api/profile/avatar") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;

    if (method === "DELETE") {
      if (user.avatar_key) await env.MEDIA.delete(user.avatar_key);
      const stamp = nowIso();
      await env.DB.prepare("UPDATE decave_users SET avatar_key=NULL, avatar_updated_at=? WHERE id=?")
        .bind(stamp, user.id)
        .run();
    } else {
      const declaredLength = Number(request.headers.get("content-length") ?? 0);
      if (declaredLength > 3 * 1024 * 1024) return json({ error: "Profile image request is too large." }, 413);
      const body = await bodyJson(request);
      const dataUrl = typeof body.imageDataUrl === "string" ? body.imageDataUrl : "";
      const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
      if (!match) return json({ error: "Upload a PNG, JPEG or WebP image." }, 400);
      const bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0));
      if (!bytes.length || bytes.length > 2 * 1024 * 1024)
        return json({ error: "Profile images must be 2 MB or smaller." }, 400);
      const ext = match[1] === "image/png" ? "png" : match[1] === "image/webp" ? "webp" : "jpg";
      const key = `avatars/${user.id}/${crypto.randomUUID()}.${ext}`;
      if (user.avatar_key) await env.MEDIA.delete(user.avatar_key);
      await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: match[1] } });
      await env.DB.prepare("UPDATE decave_users SET avatar_key=?, avatar_updated_at=? WHERE id=?")
        .bind(key, nowIso(), user.id)
        .run();
    }
    const updated = await env.DB.prepare("SELECT * FROM decave_users WHERE id=?").bind(user.id).first<UserRow>();
    await broadcastProfileUpdate(env, updated!);
    return json({ user: privateUser(updated!) });
  }

  return null;
}
