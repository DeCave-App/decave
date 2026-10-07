// Cloudflare Turnstile verification, including the mobile app's bridge page.

import type { Env } from "./env";

export async function verifyTurnstile(
  request: Request,
  env: Env,
  token: unknown,
  expectedAction: string,
): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY) {
    console.warn("[Turnstile] secret missing");
    return false;
  }
  if (typeof token !== "string" || !token || token.length > 2048) {
    console.warn("[Turnstile] token missing or invalid length");
    return false;
  }

  const usingCloudflareTestSecret = env.TURNSTILE_SECRET_KEY === "1x0000000000000000000000000000000AA";

  // Cloudflare's documented always-pass TEST credentials are used only by
  // local development. When that exact test secret is loaded, a non-empty
  // widget token is enough for local auth testing. Production secrets never
  // take this path and must still pass Cloudflare Siteverify below.
  if (usingCloudflareTestSecret) {
    return token.trim().length > 0;
  }

  const form = new FormData();
  form.set("secret", env.TURNSTILE_SECRET_KEY);
  form.set("response", token);
  // remoteip is optional for Siteverify; the visitor's IP is not shared.
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
    });
    if (!response.ok) {
      console.warn("[Turnstile] Siteverify HTTP failure", response.status);
      return false;
    }
    const result = (await response.json()) as {
      success?: boolean;
      action?: string;
      hostname?: string;
      "error-codes"?: string[];
    };

    if (!result.success) {
      console.warn("[Turnstile] validation failed", {
        errorCodes: result["error-codes"] ?? [],
        hostname: result.hostname ?? null,
        action: result.action ?? null,
      });
      return false;
    }

    // Cloudflare's official always-pass Turnstile test credentials return
    // action="test" even when the local widget supplied action="login",
    // "register" or "forgot". Accept that special test response only when
    // the Worker is actually using Cloudflare's documented test secret.
    // Production credentials still require the exact expected action.
    if (result.action && result.action !== expectedAction && !(usingCloudflareTestSecret && result.action === "test")) {
      console.warn("[Turnstile] action mismatch", {
        expected: expectedAction,
        received: result.action,
      });
      return false;
    }

    const allowedHostnames = usingCloudflareTestSecret
      ? new Set(["localhost", "127.0.0.1", "0.0.0.0", "de-cave.com", "app.de-cave.com"])
      : new Set(["de-cave.com", "app.de-cave.com"]);

    if (result.hostname && !allowedHostnames.has(result.hostname)) {
      console.warn("[Turnstile] hostname mismatch", {
        hostname: result.hostname,
        expected: ["de-cave.com", "app.de-cave.com"],
      });
      return false;
    }

    return true;
  } catch (error) {
    console.warn("[Turnstile] Siteverify request threw", error instanceof Error ? error.message : "unknown");
    return false;
  }
}

export function mobileTurnstileBridgeScript(): string {
  return `
(function () {
  function send(payload) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      }
    } catch {}
  }

  window.decaveTurnstileSuccess = function (token) {
    send({ type: "turnstile-success", token: token || "" });
  };

  window.decaveTurnstileError = function (code) {
    send({ type: "turnstile-error", message: String(code || "Turnstile failed") });
  };

  window.decaveTurnstileExpired = function () {
    send({ type: "turnstile-expired" });
  };

  window.addEventListener("DOMContentLoaded", function () {
    send({ type: "turnstile-ready" });
  });
})();`;
}

export function mobileTurnstileResponse(url: URL, env: Env): Response {
  const allowedActions = new Set(["login", "register", "forgot"]);
  const requestedAction = url.searchParams.get("action") ?? "login";
  const action = allowedActions.has(requestedAction) ? requestedAction : "login";
  const siteKey = env.TURNSTILE_SITE_KEY ?? "";

  if (!siteKey) {
    return new Response(
      `<!doctype html>
       <meta charset="utf-8">
       <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
       <title>DeCave Security</title>
       <body style="margin:0;background:#070b16;color:#eef4ff;font-family:Arial,sans-serif;display:grid;place-items:center;min-height:100vh">
         <div style="padding:24px;text-align:center">
           <strong>Security check unavailable</strong>
           <p style="color:#8f9db4">Turnstile is not configured.</p>
         </div>
       </body>`,
      {
        status: 503,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      },
    );
  }

  const safeSiteKey = siteKey.replace(/[^A-Za-z0-9_-]/g, "");
  const safeAction = action.replace(/[^A-Za-z0-9_-]/g, "");

  return new Response(
    `<!doctype html>
     <html>
       <head>
         <meta charset="utf-8">
         <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
         <meta name="color-scheme" content="dark">
         <title>DeCave Security</title>
         <style>
           html,body{margin:0;min-height:100%;background:#070b16;color:#eef4ff;font-family:Arial,sans-serif}
           body{min-height:100vh;display:grid;place-items:center}
           .wrap{width:min(94vw,390px);padding:26px 18px;text-align:center;box-sizing:border-box}
           .kicker{font-size:10px;letter-spacing:.18em;color:#62dfff;font-weight:800}
           h1{font-size:20px;margin:9px 0 6px}
           p{font-size:12px;line-height:1.5;color:#8f9db4;margin:0 0 18px}
           .widget{display:flex;justify-content:center;min-height:70px}
         </style>
         <script src="/mobile/turnstile-bridge.js"></script>
         <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
       </head>
       <body>
         <div class="wrap">
           <div class="kicker">DECAVE SECURITY</div>
           <h1>Confirm you're human</h1>
           <p>This check protects DeCave accounts from automated abuse.</p>
           <div class="widget">
             <div
               class="cf-turnstile"
               data-sitekey="${safeSiteKey}"
               data-action="${safeAction}"
               data-theme="dark"
               data-size="flexible"
               data-appearance="always"
               data-callback="decaveTurnstileSuccess"
               data-error-callback="decaveTurnstileError"
               data-expired-callback="decaveTurnstileExpired">
             </div>
           </div>
         </div>
       </body>
     </html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store, private",
      },
    },
  );
}
