import { HubRoom } from "./HubRoom";
import type { Env } from "./lib/env";
import {
  sameOriginWriteAllowed,
  webSocketOriginAllowed,
  json,
  securityHeaders,
  preventHtmlAssetCaching,
} from "./lib/http";
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
} from "./lib/streamer";
import { requireUser } from "./lib/sessions";
import { mobileTurnstileBridgeScript, mobileTurnstileResponse } from "./lib/turnstile";
import { globalRoom } from "./lib/realtime";
import { serveR2 } from "./lib/media";
import { API_ROUTES } from "./routes/index";
import type { ApiContext } from "./routes/context";

export type { Env } from "./lib/env";
export { describeSessionDevice } from "./lib/sessions";
export { isLegacyHistoryReadRoute } from "./lib/messages";

export { HubRoom };

export async function handleApi(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const p = url.pathname;
  const method = request.method.toUpperCase();

  const sameOriginAllowed = sameOriginWriteAllowed(request);

  await ensureHubFeatureSchema(env);
  try {
    await ensureOfficialHubSchema(env);
  } catch (error) {
    console.error("Could not verify official Hub policy schema", error instanceof Error ? error.name : "UnknownError");
    return json(
      {
        error: "Official Hub posting policy is temporarily unavailable.",
        code: "HUB_POLICY_UNAVAILABLE",
      },
      503,
    );
  }

  if (!sameOriginAllowed) {
    return json({ error: "Cross-site request blocked" }, 403);
  }

  // Trust & Safety reports and evidence are a separate API surface from chat;
  // they must never be mistaken for a request to read or send messages.
  const trustSafetyResponse = await handleTrustSafetyApi(request, env, p, method);
  if (trustSafetyResponse) return trustSafetyResponse;

  const streamerRoute = /^\/api\/servers\/\d+\/streamer(?:\/.*)?$/.test(p);
  if (streamerRoute) {
    const migrationPresent = await streamerMigrationExists(env.DB);
    const response = await handleStreamerRequest(request, {
      db: env.DB,
      enabled: migrationPresent && streamerHubsEnabled(env),
      giveawaysEnabled: migrationPresent && streamerGiveawaysEnabled(env),
      authenticate: async (streamerRequest) => {
        const user = await requireUser(streamerRequest, env);
        return user instanceof Response ? user : { id: user.id };
      },
      guardHubAccess: (streamerRequest, hubId, userId) => streamerHubAccessGuard(streamerRequest, env, hubId, userId),
      guardMutation: (streamerRequest, hubId, userId) => streamerMutationGuard(streamerRequest, env, hubId, userId),
    });
    if (response) return response;
  }

  const context: ApiContext = { request, env, url, p, method, ctx };
  for (const routes of API_ROUTES) {
    const response = await routes(context);
    if (response) return response;
  }

  return json({ error: "Not found", path: p }, 404);
}

async function handleWebSocket(request: Request, env: Env): Promise<Response> {
  if ((request.headers.get("Upgrade") ?? "").toLowerCase() !== "websocket") {
    return securityHeaders(json({ error: "Expected WebSocket upgrade" }, 426), request);
  }
  if (!webSocketOriginAllowed(request)) {
    return securityHeaders(json({ error: "Cross-origin WebSocket upgrade blocked" }, 403), request);
  }
  const room = await globalRoom(env);
  return securityHeaders(await room.fetch(new Request("https://internal.decave/connect", request)), request);
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
    // Delete personal data past its retention period (see worker/retention.ts).
    for (const step of await pruneExpiredPersonalData(env)) failures.push(`retention:${step}`);
    if (failures.length) throw new Error(`Scheduled maintenance failed: ${failures.join(", ")}.`);
  },
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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
