// HTTP helpers: JSON responses and request bodies, security headers, same-origin
// write checks, path ids and HTML escaping.

import type { Env } from "./env";
import { tokenHash } from "../db";

export const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

export function authBaseUrlForEnvironment(env: Pick<Env, "TURNSTILE_SECRET_KEY">): string {
  return env.TURNSTILE_SECRET_KEY === "1x0000000000000000000000000000000AA"
    ? "http://127.0.0.1:8787"
    : "https://app.de-cave.com";
}

export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...jsonHeaders, ...(headers ?? {}) },
  });
}

export async function bodyJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function boundedBodyJson(request: Request, maxBytes: number): Promise<Record<string, unknown> | null> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return null;
  try {
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > maxBytes) return null;
    const value = JSON.parse(new TextDecoder().decode(bytes));
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function idFromPath(pathname: string, pattern: RegExp): RegExpMatchArray | null {
  return pathname.match(pattern);
}

export function requestKey(request: Request, suffix: string): string {
  // Cloudflare supplies CF-Connecting-IP at the edge. Hash it before using it
  // as a limiter key so rate limiting is not bypassable by changing User-Agent
  // and the raw address is not retained in the limiter key.
  const ip = request.headers.get("CF-Connecting-IP")?.trim() || "unknown";
  return `${suffix}:${tokenHash(ip).slice(0, 24)}`;
}

/** Realtime socket source for this deployment: the request's own host (wss, or ws for local http). */
function realtimeConnectSource(request?: Request): string {
  if (!request) return "";
  try {
    const url = new URL(request.url);
    const scheme = url.protocol === "http:" ? "ws:" : "wss:";
    return ` ${scheme}//${url.host}`;
  } catch {
    return "";
  }
}

export function securityHeaders(response: Response, request?: Request): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Permissions-Policy", "camera=(self), microphone=(self), display-capture=(self), geolocation=()");
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set(
    "Content-Security-Policy",
    `default-src 'self'; object-src 'none'; worker-src 'self'; script-src-attr 'none'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https://challenges.cloudflare.com https://rtc.live.cloudflare.com${realtimeConnectSource(request)}; frame-src 'self' https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
  );
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function preventHtmlAssetCaching(request: Request, response: Response): Response {
  const pathname = new URL(request.url).pathname;
  const contentType = response.headers.get("content-type") ?? "";
  const isHtml = contentType.toLowerCase().startsWith("text/html");
  if (request.method !== "GET" || (!isHtml && pathname !== "/" && !pathname.endsWith(".html"))) return response;
  const headers = new Headers(response.headers);
  // The HTML shell points at content-hashed JavaScript workers. Keeping the
  // shell cacheable can leave Safari on a previous worker bundle after a
  // deploy, even though the new hashed assets are already published.
  headers.set("Cache-Control", "no-store, max-age=0");
  headers.set("CDN-Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function sameOriginWriteAllowed(request: Request): boolean {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method.toUpperCase())) return true;
  // Browsers send Sec-Fetch-Site on every fetch; native clients (mobile app)
  // send neither it nor Origin. Anything a browser labels as coming from
  // another origin (same-site or cross-site) is refused.
  const fetchSite = request.headers.get("Sec-Fetch-Site")?.trim().toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "::1";
}

/**
 * Origin allowlist for the /ws upgrade (WebSockets are not covered by CORS).
 * Allowed: no Origin (native clients), the request's own host (web app, and
 * the desktop renderer, which is served as https://app.de-cave.com), and,
 * only when the Worker itself is reached on a loopback host, other loopback
 * origins (local Vite dev server proxying /ws to wrangler).
 */
export function webSocketOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  let originUrl: URL;
  let requestUrl: URL;
  try {
    originUrl = new URL(origin);
    requestUrl = new URL(request.url);
  } catch {
    return false;
  }
  if (originUrl.protocol !== "https:" && originUrl.protocol !== "http:") return false;
  if (originUrl.host === requestUrl.host) {
    return originUrl.protocol === "https:" || isLoopbackHost(requestUrl.hostname);
  }
  return isLoopbackHost(requestUrl.hostname) && isLoopbackHost(originUrl.hostname);
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
