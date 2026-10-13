import { HubRoom } from "./HubRoom";
import type { Env } from "./lib/env";
import {
  sameOriginWriteAllowed,
  webSocketOriginAllowed,
  apiError,
  apiErrorLegacy,
  RequestBodyTooLargeError,
  securityHeaders,
  preventHtmlAssetCaching,
} from "./lib/http";
import { apiErrorWithFields } from "./lib/api-error-fields";
import { ensureHubFeatureSchema } from "./lib/hub-schema";
import { ensureOfficialHubSchema } from "./lib/official-hubs";
import { handleTrustSafetyApi, pruneExpiredEvidenceUploadReservations } from "./routes/trust-safety";
import { eraseDueAccounts } from "./account-erasure";
import { pruneExpiredPersonalData } from "./retention";
import {
  streamerMigrationExists,
  handleStreamerRequest,
  pruneStreamerData,
  STREAMER_MIGRATION_ID,
} from "./streamer/index.ts";
import {
  streamerHubsEnabled,
  streamerGiveawaysEnabled,
  streamerHubAccessGuard,
  streamerMutationGuard,
  authorizeStreamerHubImage,
} from "./lib/streamer";
import { requireUser } from "./lib/sessions";
import { mobileTurnstileBridgeScript, mobileTurnstileResponse } from "./lib/turnstile";
import { globalRoom } from "./lib/realtime";
import { serveR2 } from "./lib/media";
import { API_ROUTES } from "./routes/index";
import { handleTwitchEventSub, syncTwitchAutoLive, TWITCH_EVENTSUB_PATH } from "./twitch/auto-live";
import { refreshFaceitLinks } from "./faceit/links";
import { announceClipOfTheWeek, importTwitchClips } from "./twitch/clips";
import { memberTwitchStatus, recheckTwitchSubscribers } from "./twitch/subs";
import type { ApiContext } from "./routes/context";

export type { Env } from "./lib/env";
export { describeSessionDevice } from "./lib/sessions";
export { isLegacyHistoryReadRoute } from "./lib/messages";

export { HubRoom };

export async function handleApi(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  try {
    return await dispatchApiRequest(request, env, ctx);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return apiError("api.requestTooLarge", 413);
    throw error;
  }
}

async function dispatchApiRequest(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const p = url.pathname;
  const method = request.method.toUpperCase();

  const sameOriginAllowed = sameOriginWriteAllowed(request);

  await ensureHubFeatureSchema(env);
  try {
    await ensureOfficialHubSchema(env);
  } catch (error) {
    console.error("Could not verify official Hub policy schema", error instanceof Error ? error.name : "UnknownError");
    return apiErrorLegacy("HUB_POLICY_UNAVAILABLE", "officialHub.postingPolicyUnavailable", 503);
  }

  if (!sameOriginAllowed) {
    return apiError("api.crossSiteBlocked", 403);
  }

  // Trust & Safety reports and evidence are a separate API surface from chat;
  // they must never be mistaken for a request to read or send messages.
  const trustSafetyResponse = await handleTrustSafetyApi(request, env, p, method);
  if (trustSafetyResponse) return trustSafetyResponse;

  if (method === "POST" && p === TWITCH_EVENTSUB_PATH) {
    return handleTwitchEventSub(request, env, ctx ? (work) => ctx.waitUntil(work) : undefined);
  }

  const streamerRoute = /^\/api\/servers\/\d+\/streamer(?:\/.*)?$/.test(p);
  if (streamerRoute) {
    const migrationPresent = await streamerMigrationExists(env.DB);
    const response = await handleStreamerRequest(request, {
      db: env.DB,
      enabled: migrationPresent && streamerHubsEnabled(env),
      giveawaysEnabled: migrationPresent && streamerGiveawaysEnabled(env),
      faceitAvailable: Boolean(env.FACEIT_API_KEY && env.FACEIT_CLIENT_ID),
      authenticate: async (streamerRequest) => {
        const user = await requireUser(streamerRequest, env);
        return user instanceof Response ? user : { id: user.id };
      },
      guardHubAccess: (streamerRequest, hubId, userId) => streamerHubAccessGuard(streamerRequest, env, hubId, userId),
      guardMutation: (streamerRequest, hubId, userId) => streamerMutationGuard(streamerRequest, env, hubId, userId),
      authorizeHubImage: (streamerRequest, hubId, userId, path) =>
        authorizeStreamerHubImage(streamerRequest, env, hubId, userId, path),
      onSettingsSaved: (hubId, config) => syncTwitchAutoLive(env, hubId, config),
      memberTwitch: (hubId, userId) => memberTwitchStatus(env, hubId, userId),
    });
    if (response) return response;
  }

  const context: ApiContext = { request, env, url, p, method, ctx };
  for (const routes of API_ROUTES) {
    const response = await routes(context);
    if (response) return response;
  }

  return apiErrorWithFields("api.notFound", 404, { path: p });
}

async function handleWebSocket(request: Request, env: Env): Promise<Response> {
  if ((request.headers.get("Upgrade") ?? "").toLowerCase() !== "websocket") {
    return apiError("api.websocketExpected", 426);
  }
  // Cross-site WebSocket hijacking guard: browsers attach Origin to the
  // upgrade; native clients may omit it.
  if (!webSocketOriginAllowed(request)) {
    return apiError("api.crossSiteWebSocketBlocked", 403);
  }
  const room = await globalRoom(env);
  return room.fetch(new Request("https://internal.decave/connect", request));
}

export default {
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const failures: string[] = [];
    // Each scheduled cleanup runs independently so a temporarily unavailable
    // subsystem does not prevent account erasure or evidence cleanup.
    try {
      if (await streamerMigrationExists(env.DB)) await pruneStreamerData(env.DB);
    } catch (error) {
      failures.push("streamer");
      console.error(
        `Scheduled Streamer Mode maintenance failed after migration ${STREAMER_MIGRATION_ID}.`,
        error instanceof Error ? error.name : "UnknownError",
      );
    }
    try {
      await eraseDueAccounts(env);
    } catch (error) {
      failures.push("account-erasure");
      console.error(
        "Scheduled account erasure failed; claimed account metadata remains retryable.",
        error instanceof Error ? error.name : "UnknownError",
      );
    }
    try {
      await pruneExpiredEvidenceUploadReservations(env);
    } catch (error) {
      failures.push("evidence-reservations");
      console.error(
        "Scheduled safety evidence cleanup failed; reservation metadata remains retryable.",
        error instanceof Error ? error.name : "UnknownError",
      );
    }
    try {
      await recheckTwitchSubscribers(env);
    } catch (error) {
      failures.push("twitch-subs");
      console.error(
        "Scheduled Twitch subscriber re-check failed",
        error instanceof Error ? error.name : "UnknownError",
      );
    }
    try {
      await importTwitchClips(env);
      await announceClipOfTheWeek(env);
    } catch (error) {
      failures.push("twitch-clips");
      console.error("Scheduled Twitch clips import failed", error instanceof Error ? error.name : "UnknownError");
    }
    try {
      await refreshFaceitLinks(env);
    } catch (error) {
      failures.push("faceit");
      console.error("Scheduled FACEIT refresh failed", error instanceof Error ? error.name : "UnknownError");
    }
    // Delete personal data past its retention period (see worker/retention.ts).
    for (const step of await pruneExpiredPersonalData(env)) failures.push(`retention:${step}`);
    if (failures.length) throw new Error(`Scheduled maintenance failed: ${failures.join(", ")}.`);
  },
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws" || url.pathname.startsWith("/ws/")) {
      return handleWebSocket(request, env);
    }

    // Lets the iOS app open https://app.de-cave.com/join/hub/<code> invite links directly.
    if (url.pathname === "/.well-known/apple-app-site-association" || url.pathname === "/apple-app-site-association") {
      return new Response(
        JSON.stringify({
          applinks: { details: [{ appIDs: ["EXAMPLE000.com.example.decave"], components: [{ "/": "/join/hub/*" }] }] },
        }),
        { headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" } },
      );
    }

    if (url.pathname === "/mobile/turnstile-bridge.js") {
      return securityHeaders(
        new Response(mobileTurnstileBridgeScript(), {
          headers: {
            "content-type": "application/javascript; charset=utf-8",
            "cache-control": "no-store, private",
          },
        }),
        request,
      );
    }

    if (url.pathname === "/mobile/turnstile") {
      return securityHeaders(mobileTurnstileResponse(url, env), request);
    }

    let response: Response;
    if (url.pathname.startsWith("/api/")) response = await handleApi(request, env, ctx);
    else if (url.pathname.startsWith("/uploads/")) response = await serveR2(request, env);
    else if (request.method === "GET" && /^\/join\/hub\/[^/]+\/?$/i.test(url.pathname)) {
      const appUrl = new URL("/", request.url);
      response = await env.ASSETS.fetch(new Request(appUrl, request));
    } else response = await env.ASSETS.fetch(request);

    return securityHeaders(preventHtmlAssetCaching(request, response), request);
  },
} satisfies ExportedHandler<Env>;
