import type { HubRole, StreamerConfig } from "../../shared/streamer-mode";
import type { ServerNotice } from "../../shared/i18n/server-notices.ts";
/** Structural subset of D1, allowing the identical route code to be tested against SQLite. */
export interface Statement {
  bind(...values: (string | number | null)[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes?: number }; results?: unknown[] }>;
}
export interface Database {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<{ meta: { changes?: number }; results?: unknown[] }[]>;
}
export type Principal = { id: string };
export type Admission = { principal: Principal; role: HubRole };
export type StreamerDependencies = {
  db: Database;
  enabled: boolean;
  giveawaysEnabled: boolean;
  /** FACEIT linking is configured (FACEIT_API_KEY); shown on the leaderboard. */
  faceitAvailable?: boolean;
  /** Existing requireUser: account suspension, session revocation, etc. must remain enforced. */
  authenticate(request: Request): Promise<Principal | Response>;
  /** Existing Hub-read admission: retained-member bans, private/official-Hub policy,
   * and account/Hub safety restrictions. Runs for GET as well as POST. */
  guardHubAccess(request: Request, hubId: number, userId: string): Promise<Response | null>;
  /** Existing origin/CSRF, per-account limits, official-hub policy, bans/timeouts, safety policy.
   * Required on every mutation including enable. Return a Response to deny; null to allow.
   * This must NOT be implemented as an unconditional `return null` in production.
   */
  guardMutation(request: Request, hubId: number, userId: string): Promise<Response | null>;
  /** Check that a proposed thumbnail is an authorized HUB branding/community image,
   * not a DM attachment or a private-room image. */
  authorizeHubImage(request: Request, hubId: number, userId: string, path: string): Promise<boolean>;
  /** After stream settings are saved (Twitch auto-live link). Returns a notice for the creator, or null. */
  onSettingsSaved?(
    hubId: number,
    config: Omit<StreamerConfig, "version">,
  ): Promise<{ message: string; notice: ServerNotice } | null>;
  /** The member's Twitch link and subscription to this Hub's channel (subRoles Hubs). */
  memberTwitch?(
    hubId: number,
    userId: string,
  ): Promise<{ linked: boolean; login: string | null; subscribed: boolean; tier: string | null }>;
  now?: () => number;
  id?: () => string;
};
