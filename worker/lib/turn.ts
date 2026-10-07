// Cloudflare TURN credentials for voice, cached until shortly before they expire.

import type { Env } from "./env";

export type CloudflareTurnIceServerCache = {
  keyId: string;
  apiToken: string;
  iceServers: unknown[];
  expiresAt: number;
};

export const CLOUDFLARE_TURN_CACHE_TTL_MS = 45_000;

export let cloudflareTurnIceServerCache: CloudflareTurnIceServerCache | null = null;

export async function cloudflareTurnIceServers(
  env: Pick<Env, "CLOUDFLARE_TURN_KEY_ID" | "CLOUDFLARE_TURN_API_TOKEN">,
): Promise<unknown[] | null> {
  const keyId = env.CLOUDFLARE_TURN_KEY_ID?.trim() ?? "";
  const apiToken = env.CLOUDFLARE_TURN_API_TOKEN?.trim() ?? "";
  if (!keyId || !apiToken) return null;

  const cached = cloudflareTurnIceServerCache;
  if (cached && cached.keyId === keyId && cached.apiToken === apiToken && cached.expiresAt > Date.now()) {
    return cached.iceServers;
  }

  try {
    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ttl: 3600 }),
      },
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { iceServers?: unknown[] };
    if (!Array.isArray(data.iceServers) || data.iceServers.length === 0) return null;
    cloudflareTurnIceServerCache = {
      keyId,
      apiToken,
      iceServers: data.iceServers,
      expiresAt: Date.now() + CLOUDFLARE_TURN_CACHE_TTL_MS,
    };
    return data.iceServers;
  } catch {
    return null;
  }
}
