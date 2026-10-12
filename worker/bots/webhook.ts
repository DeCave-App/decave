// Guarded outbound fetch for the bot webhook action. Admin-configured URLs are
// called from the Worker, so every URL is checked before any network I/O.
//
// DNS rebinding cannot be fully prevented here: Workers have no resolve API, so
// a public hostname that resolves to a private address is not detectable. The
// literal checks below are the main guard; Cloudflare's fetch also does not
// reach private networks from a Worker, which backs them up.

export type GuardedFetchResult = { ok: true; status: number; json: unknown } | { ok: false; reason: string };

export type GuardedFetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

export const WEBHOOK_TIMEOUT_MS = 5000;
export const WEBHOOK_MAX_BYTES = 65536;

/** The app's own domains: a webhook may not call back into DeCave itself. */
const OWN_DOMAINS = ["de-cave.com"];
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal"];

/** Legacy inet_aton forms: 1-4 dot parts, each decimal, 0octal or 0xhex. Null when not an IPv4 literal. */
function parseLegacyIPv4(host: string): number[] | null | "invalid" {
  const parts = host.split(".");
  if (parts.length > 4 || parts.some((p) => p === "")) return null;
  if (!/^(0x[0-9a-f]+|[0-9]+)$/i.test(parts[parts.length - 1])) return null;
  const nums: number[] = [];
  for (const p of parts) {
    let n: number;
    if (/^0x[0-9a-f]+$/i.test(p)) n = parseInt(p.slice(2), 16);
    else if (/^0[0-7]+$/.test(p)) n = parseInt(p, 8);
    else if (/^[0-9]+$/.test(p)) n = parseInt(p, 10);
    else return "invalid";
    if (!Number.isFinite(n)) return "invalid";
    nums.push(n);
  }
  const last = nums.pop() as number;
  if (nums.some((n) => n > 255) || last >= 256 ** (4 - nums.length)) return "invalid";
  const full = [...nums];
  for (let i = 3 - nums.length; i >= 0; i--) full.push(Math.floor(last / 256 ** i) % 256);
  return full;
}

function privateV4([a, b, c, d]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 ||
    (a === 255 && b === 255 && c === 255 && d === 255)
  );
}

/** Eight 16-bit groups from an IPv6 literal (no brackets), or null when malformed. */
function parseIPv6(raw: string): number[] | null {
  let host = raw.split("%")[0];
  const dotted = host.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const v4 = parseLegacyIPv4(dotted[1]);
    if (!Array.isArray(v4) || v4.length !== 4) return null;
    host =
      host.slice(0, -dotted[1].length) +
      ((v4[0] << 8) | v4[1]).toString(16) +
      ":" +
      ((v4[2] << 8) | v4[3]).toString(16);
  }
  const halves = host.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  const out = groups.map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN));
  return out.some(Number.isNaN) ? null : out;
}

function privateV6(g: number[]): boolean {
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  const embedded = [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255];
  const first5Zero = g.slice(0, 5).every((x) => x === 0);
  if (first5Zero && (g[5] === 0xffff || g[5] === 0)) return privateV4(embedded); // IPv4-mapped / compatible
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return privateV4(embedded); // NAT64
  if (g[0] === 0x2002) return privateV4([g[1] >> 8, g[1] & 255, g[2] >> 8, g[2] & 255]); // 6to4
  return false;
}

/** Why a URL may not be called, or null when it passes every static check. */
export function webhookUrlProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Webhook URL isn't valid";
  }
  if (url.protocol !== "https:") return "Webhook URL must use https";
  if (url.username || url.password) return "Webhook URL can't contain a login";
  if (url.port && url.port !== "443") return "Webhook URL can't use a custom port";
  const refusedHost = "Webhook host isn't allowed";
  let host = url.hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) {
    const groups = parseIPv6(host.slice(1, -1));
    return !groups || privateV6(groups) ? refusedHost : null;
  }
  while (host.endsWith(".")) host = host.slice(0, -1);
  if (!host) return refusedHost;
  const v4 = parseLegacyIPv4(host);
  if (v4 === "invalid") return refusedHost;
  if (v4) return v4.length === 4 && !privateV4(v4) ? null : refusedHost;
  if (host === "localhost" || host === "internal" || host === "local") return refusedHost;
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return refusedHost;
  if (OWN_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) return refusedHost;
  return null;
}

async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  if (!response.body) {
    const buf = new Uint8Array(await response.arrayBuffer());
    return buf.byteLength > maxBytes ? null : buf;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

export async function guardedFetch(
  url: string,
  init: { method: "GET" | "POST"; body?: string },
  fetchImpl: typeof fetch = fetch,
  options: GuardedFetchOptions = {},
): Promise<GuardedFetchResult> {
  const problem = webhookUrlProblem(url);
  if (problem) return { ok: false, reason: problem };
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const controller = new AbortController();
  let timedOut = false;
  const handle = setTimer(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? WEBHOOK_TIMEOUT_MS);
  // Only the rendered body and fixed headers go out: no cookies, no user data.
  const headers: Record<string, string> = { "User-Agent": "DeCave-Bot/1" };
  if (init.method === "POST") headers["Content-Type"] = "application/json";
  try {
    const response = await fetchImpl(url, {
      method: init.method,
      headers,
      body: init.method === "POST" ? (init.body ?? "") : undefined,
      redirect: "manual",
      signal: controller.signal,
    });
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, reason: "Webhook redirects aren't followed" };
    }
    const bytes = await readCapped(response, options.maxBytes ?? WEBHOOK_MAX_BYTES);
    if (!bytes) return { ok: false, reason: "Webhook response too large" };
    let json: unknown = null;
    try {
      json = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      json = null;
    }
    return { ok: true, status: response.status, json };
  } catch {
    return { ok: false, reason: timedOut ? "Webhook timed out" : "Webhook request failed" };
  } finally {
    clearTimer(handle);
  }
}
