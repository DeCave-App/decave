import type { HubRole } from "../../shared/streamer-mode";
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
  now?: () => number;
  id?: () => string;
};
