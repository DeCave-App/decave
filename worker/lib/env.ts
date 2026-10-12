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
  BOTS_BUILDER_ENABLED?: string;
  ANTHROPIC_API_KEY?: string;
  STREAMER_GIVEAWAYS_ENABLED?: string;
  /** Twitch app credentials for Streamer Hub auto-live (EventSub). All three unset = feature off. */
  TWITCH_CLIENT_ID?: string;
  TWITCH_CLIENT_SECRET?: string;
  /** 10–100 character secret Twitch signs EventSub deliveries with. */
  TWITCH_EVENTSUB_SECRET?: string;
  /** FACEIT Data API server key for the Streamer Hub leaderboard (FACEIT ELO). Unset = linking off. */
  FACEIT_API_KEY?: string;
  /** FACEIT Connect (OAuth, PKCE) client for verified FACEIT linking; redirect URI /api/account/faceit/callback. */
  FACEIT_CLIENT_ID?: string;
  /** Only for a confidential FACEIT client; App Studio PKCE clients have none. */
  FACEIT_CLIENT_SECRET?: string;
  /** "true" turns on end-to-end encrypted DMs (docs/security/DM-E2EE.md). */
  DM_E2EE_ENABLED?: string;
  /** Cloudflare Realtime (SFU) app for encrypted screen share. */
  CLOUDFLARE_REALTIME_APP_ID?: string;
  CLOUDFLARE_REALTIME_APP_TOKEN?: string;
  /** "true" routes screen share through the SFU; anything else keeps it off. */
  SCREEN_SFU_ENABLED?: string;
}
