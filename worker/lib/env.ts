// Bindings and secrets the Worker receives (wrangler.jsonc and Worker secrets).

import type { HubRoom } from "../HubRoom";

export type SendEmailBinding = {
  send(message: {
    to: string;
    from: string | { email: string; name?: string };
    subject: string;
    html?: string;
    text?: string;
  }): Promise<{ messageId: string }>;
};

export type RateLimitBinding = {
  limit(input: { key: string }): Promise<{ success: boolean }>;
};

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  HUB_ROOM: DurableObjectNamespace<HubRoom>;
  EMAIL: SendEmailBinding;
  AUTH_RATE_LIMITER: RateLimitBinding;
  RECOVERY_RATE_LIMITER: RateLimitBinding;
  CLOUDFLARE_TURN_KEY_ID?: string;
  CLOUDFLARE_TURN_API_TOKEN?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  OWNER_MFA_ENCRYPTION_KEY?: string;
  SECURITY_IP_HASH_KEY?: string;
  FEEDBACK_TO_EMAIL?: string;
  STEAM_WEB_API_KEY?: string;
  GIPHY_API_KEY?: string;
  STREAMER_HUBS_ENABLED?: string;
  STREAMER_GIVEAWAYS_ENABLED?: string;
}
