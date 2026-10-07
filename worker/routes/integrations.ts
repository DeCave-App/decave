// Third-party integrations: GIF search and media proxy (GIPHY) and the Steam
// link.

import { requireUser } from "../lib/sessions";
import { json } from "../lib/http";
import {
  ensureActivitySchema,
  steamOpenIdUrl,
  steamCallbackPage,
  verifySteamOpenIdCallback,
  steamPlayerSummary,
  type SteamLinkRow,
} from "../lib/activity";
import { createRawToken, nowIso } from "../db";
import type { ApiContext } from "./context";

/** Path the clients load GIF media through, so viewers never contact GIPHY. */
export const GIPHY_MEDIA_PROXY_PATH = "/api/giphy/media";
/** Largest GIF/WebP/MP4 the proxy relays. */
export const GIPHY_MEDIA_MAX_BYTES = 20 * 1024 * 1024;
const GIPHY_MEDIA_CACHE_SECONDS = 30 * 24 * 60 * 60;
const GIPHY_MEDIA_MAX_REDIRECTS = 2;
const GIPHY_MEDIA_CONTENT_TYPES = new Set(["image/gif", "image/webp", "video/mp4"]);

function isGiphyMediaHost(hostname: string): boolean {
  return hostname === "media.giphy.com" || hostname === "i.giphy.com" || /^media[0-9]\.giphy\.com$/.test(hostname);
}

/**
 * Canonical GIPHY media URL for a client-supplied value, or null.
 * Only https media hosts (media.giphy.com, mediaN.giphy.com, i.giphy.com) on the
 * default port, without credentials, with a plain media path ending in
 * .gif/.webp/.mp4. Query and fragment (GIPHY analytics ids) are dropped.
 */
export function giphyMediaTarget(value: string | null | undefined): URL | null {
  if (typeof value !== "string" || !value || value.length > 2048) return null;
  // Percent-encoded or backslash path bytes are never part of a GIPHY media path.
  if (/[%\\]/.test(value.split(/[?#]/, 1)[0] ?? "")) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return null;
  const hostname = parsed.hostname.toLowerCase();
  if (!isGiphyMediaHost(hostname)) return null;
  const segments = parsed.pathname.split("/").slice(1);
  if (segments.length < 1 || segments.length > 6) return null;
  if (segments.some((segment) => !/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,159}$/.test(segment) || segment.includes(".."))) {
    return null;
  }
  if (!/\.(?:gif|webp|mp4)$/i.test(segments[segments.length - 1] ?? "")) return null;
  return new URL(`https://${hostname}/${segments.join("/")}`);
}

function giphyMediaError(message: string, status: number): Response {
  return json({ error: message }, status, { "Cache-Control": "no-store" });
}

/** Caps a body stream at GIPHY_MEDIA_MAX_BYTES, erroring the stream past it. */
function cappedBody(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  let total = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > GIPHY_MEDIA_MAX_BYTES) {
          controller.error(new Error("GIF exceeds the proxy size limit."));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

async function proxyGiphyMedia(target: URL): Promise<Response> {
  let current = target;
  for (let hop = 0; hop <= GIPHY_MEDIA_MAX_REDIRECTS; hop += 1) {
    let upstream: Response;
    try {
      // A fresh request: no viewer cookies, IP, referrer or user agent reach GIPHY.
      upstream = await fetch(current.toString(), {
        method: "GET",
        redirect: "manual",
        headers: { Accept: "image/webp,image/gif,video/mp4", "User-Agent": "DeCave-Media-Proxy/1.0" },
        cf: { cacheEverything: true, cacheTtl: GIPHY_MEDIA_CACHE_SECONDS },
      });
    } catch {
      return giphyMediaError("Could not load the GIF.", 502);
    }

    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get("Location");
      let next: URL | null = null;
      try {
        next = location ? giphyMediaTarget(new URL(location, current).toString()) : null;
      } catch {
        next = null;
      }
      void upstream.body?.cancel();
      if (!next) return giphyMediaError("The GIF redirected to an unapproved host.", 502);
      current = next;
      continue;
    }

    if (!upstream.ok || !upstream.body) {
      void upstream.body?.cancel();
      return giphyMediaError("The GIF is unavailable.", upstream.status === 404 ? 404 : 502);
    }
    const contentType = (upstream.headers.get("Content-Type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
    if (!GIPHY_MEDIA_CONTENT_TYPES.has(contentType)) {
      void upstream.body.cancel();
      return giphyMediaError("The GIF has an unsupported media type.", 502);
    }
    const lengthHeader = upstream.headers.get("Content-Length");
    const length = lengthHeader && /^\d+$/.test(lengthHeader) ? Number(lengthHeader) : null;
    if (length !== null && length > GIPHY_MEDIA_MAX_BYTES) {
      void upstream.body.cancel();
      return giphyMediaError("The GIF is too large.", 502);
    }

    const headers = new Headers({
      "Content-Type": contentType,
      // Authenticated route: browsers and the app may cache it, shared caches must not.
      "Cache-Control": `private, max-age=${GIPHY_MEDIA_CACHE_SECONDS}, immutable`,
      "Content-Disposition": "inline",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    });
    if (length !== null) headers.set("Content-Length", String(length));
    return new Response(cappedBody(upstream.body), { status: 200, headers });
  }
  return giphyMediaError("The GIF redirected too many times.", 502);
}

export async function handleGiphyRoutes({ request, env, url, p, method }: ApiContext): Promise<Response | null> {
  if (method === "GET" && p === GIPHY_MEDIA_PROXY_PATH) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    void user;
    const target = giphyMediaTarget(url.searchParams.get("u"));
    if (!target) return giphyMediaError("That GIF address is not allowed.", 400);
    return proxyGiphyMedia(target);
  }

  if (method === "GET" && p === "/api/giphy") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    void user;

    const apiKey = env.GIPHY_API_KEY?.trim() ?? "";
    if (!apiKey) return json({ error: "GIPHY is not configured on this DeCave deployment." }, 503);

    const query = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
    const endpoint = query ? "search" : "trending";
    const upstream = new URL(`https://api.giphy.com/v1/gifs/${endpoint}`);
    upstream.searchParams.set("api_key", apiKey);
    upstream.searchParams.set("limit", "24");
    upstream.searchParams.set("rating", "pg-13");
    if (query) {
      upstream.searchParams.set("q", query);
      upstream.searchParams.set("lang", "en");
    }

    try {
      const response = await fetch(upstream.toString(), {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        return json({ error: "GIPHY search is temporarily unavailable." }, 502);
      }
      const payload = (await response.json()) as {
        data?: Array<{
          id?: string;
          title?: string;
          images?: {
            fixed_width_small?: { webp?: string; url?: string; width?: string; height?: string };
            fixed_width?: { webp?: string; url?: string; width?: string; height?: string };
            original?: { webp?: string; url?: string; width?: string; height?: string };
          };
        }>;
      };
      const gifs = (Array.isArray(payload.data) ? payload.data : []).flatMap((item) => {
        const id = typeof item.id === "string" ? item.id : "";
        const original = item.images?.original;
        const preview = item.images?.fixed_width_small ?? item.images?.fixed_width ?? original;
        // Only media the proxy will relay is offered; analytics query ids are stripped.
        const urlValue = giphyMediaTarget(original?.webp || original?.url)?.toString() ?? "";
        const previewValue = giphyMediaTarget(preview?.webp || preview?.url)?.toString() || urlValue;
        if (!id || !urlValue || !previewValue) return [];
        return [
          {
            id,
            title: typeof item.title === "string" ? item.title.slice(0, 160) : "GIF",
            url: urlValue,
            previewUrl: previewValue,
            width: Number(original?.width ?? 0) || undefined,
            height: Number(original?.height ?? 0) || undefined,
          },
        ];
      });
      return json({ gifs }, 200, { "Cache-Control": "private, no-store" });
    } catch {
      return json({ error: "Could not connect to GIPHY." }, 502);
    }
  }

  return null;
}

export async function handleSteamRoutes({ request, env, url, p, method }: ApiContext): Promise<Response | null> {
  if (method === "POST" && p === "/api/integrations/steam/connect") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    await ensureActivitySchema(env);
    const state = createRawToken();
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    await env.DB.prepare("DELETE FROM decave_steam_link_states WHERE user_id=? OR expires_at<=?")
      .bind(user.id, createdAt)
      .run();
    await env.DB.prepare("INSERT INTO decave_steam_link_states(state,user_id,expires_at,created_at) VALUES(?,?,?,?)")
      .bind(state, user.id, expiresAt, createdAt)
      .run();
    return json({ url: steamOpenIdUrl(request, state), expiresAt });
  }

  if (method === "GET" && p === "/api/integrations/steam/callback") {
    await ensureActivitySchema(env);
    const state = url.searchParams.get("state") ?? "";
    const linkState = state
      ? await env.DB.prepare("SELECT user_id,expires_at FROM decave_steam_link_states WHERE state=?")
          .bind(state)
          .first<{ user_id: string; expires_at: string }>()
      : null;
    if (!linkState || linkState.expires_at <= nowIso()) {
      if (state) await env.DB.prepare("DELETE FROM decave_steam_link_states WHERE state=?").bind(state).run();
      return steamCallbackPage("Steam link expired", "Start the Steam connection again from DeCave.", false);
    }

    const steamId = await verifySteamOpenIdCallback(url);
    await env.DB.prepare("DELETE FROM decave_steam_link_states WHERE state=?").bind(state).run();
    if (!steamId) {
      return steamCallbackPage("Steam verification failed", "Steam did not return a valid identity response.", false);
    }

    const alreadyLinked = await env.DB.prepare("SELECT user_id FROM decave_steam_links WHERE steam_id=?")
      .bind(steamId)
      .first<{ user_id: string }>();
    if (alreadyLinked && alreadyLinked.user_id !== linkState.user_id) {
      return steamCallbackPage(
        "Steam account already linked",
        "That Steam account is connected to another DeCave account.",
        false,
      );
    }

    const summary = await steamPlayerSummary(env, steamId);
    const stamp = nowIso();
    await env.DB.prepare(
      `INSERT INTO decave_steam_links
         (user_id,steam_id,persona_name,avatar_url,profile_url,linked_at,updated_at)
         VALUES(?,?,?,?,?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET
           steam_id=excluded.steam_id,
           persona_name=excluded.persona_name,
           avatar_url=excluded.avatar_url,
           profile_url=excluded.profile_url,
           updated_at=excluded.updated_at`,
    )
      .bind(
        linkState.user_id,
        steamId,
        summary?.personaname ?? "",
        summary?.avatarfull ?? summary?.avatarmedium ?? "",
        summary?.profileurl ?? `https://steamcommunity.com/profiles/${steamId}/`,
        stamp,
        stamp,
      )
      .run();
    return steamCallbackPage("Steam connected", "Your Steam account is now linked to DeCave.", true);
  }

  if (method === "GET" && p === "/api/integrations/steam/status") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    await ensureActivitySchema(env);
    const link = await env.DB.prepare("SELECT * FROM decave_steam_links WHERE user_id=?")
      .bind(user.id)
      .first<SteamLinkRow>();
    if (!link) return json({ linked: false, apiConfigured: Boolean(env.STEAM_WEB_API_KEY) });

    const summary = await steamPlayerSummary(env, link.steam_id);
    if (summary) {
      const personaName = summary.personaname ?? link.persona_name;
      const avatarUrl = summary.avatarfull ?? summary.avatarmedium ?? link.avatar_url;
      const profileUrl = summary.profileurl ?? link.profile_url;
      await env.DB.prepare(
        "UPDATE decave_steam_links SET persona_name=?,avatar_url=?,profile_url=?,updated_at=? WHERE user_id=?",
      )
        .bind(personaName, avatarUrl, profileUrl, nowIso(), user.id)
        .run();
      return json({
        linked: true,
        apiConfigured: true,
        steamId: link.steam_id,
        personaName,
        avatarUrl,
        profileUrl,
        gameName: summary.gameextrainfo ?? "",
        gameId: summary.gameid ?? "",
      });
    }

    return json({
      linked: true,
      apiConfigured: Boolean(env.STEAM_WEB_API_KEY),
      steamId: link.steam_id,
      personaName: link.persona_name,
      avatarUrl: link.avatar_url,
      profileUrl: link.profile_url,
      gameName: "",
      gameId: "",
    });
  }

  if (method === "DELETE" && p === "/api/integrations/steam") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    await ensureActivitySchema(env);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM decave_steam_links WHERE user_id=?").bind(user.id),
      env.DB.prepare("DELETE FROM decave_steam_link_states WHERE user_id=?").bind(user.id),
    ]);
    return json({ success: true });
  }

  return null;
}
