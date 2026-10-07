// Third-party integrations: GIF search (GIPHY) and the Steam link.

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

const GIPHY_MEDIA_HOSTS = new Set([
  "media.giphy.com",
  "media0.giphy.com",
  "media1.giphy.com",
  "media2.giphy.com",
  "media3.giphy.com",
  "media4.giphy.com",
  "giphy.com",
]);

function giphyMediaUrl(request: Request, value: string | undefined): string | null {
  if (!value) return null;
  try {
    const source = new URL(value);
    if (
      source.protocol !== "https:" ||
      source.port ||
      source.username ||
      source.password ||
      !GIPHY_MEDIA_HOSTS.has(source.hostname.toLowerCase()) ||
      (source.hostname.toLowerCase() === "giphy.com" && !source.pathname.startsWith("/media/"))
    )
      return null;
    const proxy = new URL("/api/giphy/media", request.url);
    proxy.searchParams.set("url", source.toString());
    return `${proxy.pathname}${proxy.search}`;
  } catch {
    return null;
  }
}

export async function handleGiphyRoutes({ request, env, url, p, method }: ApiContext): Promise<Response | null> {
  if (method === "GET" && p === "/api/giphy/media") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const target = giphyMediaUrl(request, url.searchParams.get("url") ?? undefined);
    if (!target) return json({ error: "Unsupported GIPHY media URL." }, 400);
    const upstreamUrl = new URL(target, url.origin);
    const original = upstreamUrl.searchParams.get("url");
    if (!original) return new Response(null, { status: 400 });
    try {
      const upstream = await fetch(original, {
        redirect: "manual",
        headers: { Accept: "image/gif,image/webp,image/png,image/jpeg" },
      });
      const type = (upstream.headers.get("content-type") ?? "").split(";", 1)[0].toLowerCase();
      const size = Number(upstream.headers.get("content-length") ?? 0);
      if (
        !upstream.ok ||
        upstream.status >= 300 ||
        !["image/gif", "image/webp", "image/png", "image/jpeg"].includes(type) ||
        size > 20 * 1024 * 1024 ||
        !upstream.body
      ) {
        await upstream.body?.cancel();
        return new Response(null, { status: 502 });
      }
      let total = 0;
      const body = upstream.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            total += chunk.byteLength;
            if (total > 20 * 1024 * 1024) throw new Error("GIPHY media too large");
            controller.enqueue(chunk);
          },
        }),
      );
      return new Response(body, {
        headers: {
          "Content-Type": type,
          "Cache-Control": "private, max-age=300",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; sandbox",
        },
      });
    } catch {
      return new Response(null, { status: 502 });
    }
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
        const urlValue = giphyMediaUrl(request, original?.webp || original?.url);
        const previewValue = giphyMediaUrl(request, preview?.webp || preview?.url) || urlValue;
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
