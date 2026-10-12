// Data retention: how long DeCave keeps each kind of personal data, and the
// hourly job that deletes it afterwards. The periods are listed in the Privacy
// Policy (docs/legal/PRIVACY-POLICY.md, "How long we keep data"); keep both in
// step. GDPR sets no fixed numbers for these records, only that data is kept no
// longer than needed (Art. 5(1)(e)); the reasoning for each period is noted.

import type { Env } from "./lib/env";
import { nowIso } from "./db";
import { BOT_LIMITS } from "../shared/bots/types";
import {
  CHANNEL_UPLOAD_REFERENCED_SQL,
  DM_UPLOAD_REFERENCED_SQL,
  deleteQueuedMedia,
  ensureMediaDeletionQueueSchema,
  queueMediaDeletionStatements,
} from "./lib/media";

const DAY_MS = 24 * 60 * 60 * 1000;

export const RETENTION_DAYS = {
  /** Sign-in and account security events (user agent, event, time). Security
   * logging guidance from EU data-protection authorities (e.g. CNIL) points to
   * 6–12 months; we use the lower bound. */
  securityEvents: 180,
  /** Devices used to recognise new sign-ins; forgotten after a year unused. */
  knownDevices: 365,
  /** Evidence attached to a report, after its case is closed. Covers the six
   * months in which the people involved can contest a moderation decision
   * (EU Digital Services Act, Art. 20). Never while under legal hold. */
  closedCaseEvidence: 183,
  /** Closed reports, cases, actions and notes: kept a year after closing so
   * repeated misuse can be recognised (DSA Art. 23), then deleted. */
  closedCaseRecords: 365,
  /** Moderation and platform-owner audit logs. */
  auditLogs: 365,
  /** Per-Hub moderation history (kicks, bans, role changes). */
  hubAuditLog: 183,
  /** Feedback and support messages. */
  feedback: 365,
  /** Accounts found to be under 18 are scheduled for deletion after this grace
   * period, which leaves time to correct a mistyped birth date. */
  underageAccountGrace: 30,
  /** No-code bot run log (rule, trigger type, outcome, short detail). Long
   * enough for a Hub admin to debug a bot over a few weeks; it holds no
   * message text. */
  botRuns: BOT_LIMITS.runLogDays,
  /** Uploads never sent in a message (DM or Hub channel). */
  unsentUploads: 1,
  /** "Last online" time shown to friends; forgotten after six months away. */
  presenceLastSeen: 180,
} as const;

const before = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();

const BATCH = 500;
/** Rows one retention step deletes per hourly run, so the cron stays within
 * the Worker CPU limit; a backlog drains over the following runs. */
export const SWEEP_LIMIT = 1000;
/** Queued R2 deletions retried per run. */
export const MEDIA_QUEUE_BATCH = 200;

/** Bounded DELETE: at most `limit` matching rows of `table`. */
function boundedDelete(env: Env, table: string, where: string, binds: unknown[] = [], limit = SWEEP_LIMIT) {
  return env.DB.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE ${where} LIMIT ?)`).bind(
    ...binds,
    limit,
  );
}

/** Delete evidence objects (encrypted files in R2) and their rows for closed
 * cases past the evidence retention period. */
async function pruneClosedCaseEvidence(env: Env): Promise<void> {
  const rows = await env.DB.prepare(
    `SELECT evidence.id, evidence.object_key
     FROM decave_report_evidence evidence
     JOIN decave_moderation_cases cases ON cases.id=evidence.case_id
     WHERE evidence.legal_hold=0 AND cases.legal_hold=0
       AND cases.closed_at IS NOT NULL AND cases.closed_at<?
     LIMIT ?`,
  )
    .bind(before(RETENTION_DAYS.closedCaseEvidence), BATCH)
    .all<{ id: string; object_key: string }>();
  const evidence = rows.results ?? [];
  if (!evidence.length) return;
  // Queue the files in the batch that drops their rows; the R2 delete is retried
  // from the queue until it succeeds.
  await ensureMediaDeletionQueueSchema(env.DB);
  const keys = evidence.map((row) => row.object_key);
  await env.DB.batch([
    ...queueMediaDeletionStatements(env.DB, keys, nowIso()),
    ...evidence.map((row) => env.DB.prepare("DELETE FROM decave_report_evidence WHERE id=?").bind(row.id)),
  ]);
  await deleteQueuedMedia(env, keys);
}

/** Delete closed cases (and their reports, actions and notes) past the record
 * retention period. Evidence is already gone by then. */
async function pruneClosedCases(env: Env): Promise<void> {
  const rows = await env.DB.prepare(
    `SELECT id FROM decave_moderation_cases
     WHERE legal_hold=0 AND closed_at IS NOT NULL AND closed_at<?
       AND NOT EXISTS(SELECT 1 FROM decave_report_evidence e WHERE e.case_id=decave_moderation_cases.id)
     LIMIT 100`,
  )
    .bind(before(RETENTION_DAYS.closedCaseRecords))
    .all<{ id: string }>();
  for (const { id } of rows.results ?? []) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM decave_moderation_actions WHERE case_id=?").bind(id),
      env.DB.prepare("DELETE FROM decave_reports WHERE case_id=?").bind(id),
      env.DB.prepare("DELETE FROM decave_moderation_cases WHERE id=?").bind(id),
    ]);
  }
}

/** Delete uploads that no message refers to (an upload that was never sent,
 * or whose message was deleted) a day after upload.
 *
 * DM uploads: plaintext DMs name them in `text`; end-to-end encrypted DMs list
 * them in `attachment_refs` next to the envelope (the server cannot read the
 * ciphertext, so these refs are the only server-visible reference and are
 * checked for every DM either way between owner and peer). Hub channel
 * uploads: referenced by `decave_messages.attachment_key`. Anything else
 * (group chats carry no uploads) is never treated as orphaned. Files are
 * queued for R2 deletion in the batch that drops their access rows. */
async function pruneOrphanedUploads(env: Env): Promise<void> {
  const rows = await env.DB.prepare(
    `SELECT access.r2_key FROM decave_attachment_access access
     WHERE access.created_at<?
       AND ((access.kind='dm' AND NOT ${DM_UPLOAD_REFERENCED_SQL})
         OR (access.kind='channel' AND NOT ${CHANNEL_UPLOAD_REFERENCED_SQL}))
     LIMIT 100`,
  )
    .bind(before(RETENTION_DAYS.unsentUploads))
    .all<{ r2_key: string }>();
  const keys = (rows.results ?? []).map((row) => row.r2_key);
  if (!keys.length) return;
  await ensureMediaDeletionQueueSchema(env.DB);
  await env.DB.batch([
    ...queueMediaDeletionStatements(env.DB, keys, nowIso()),
    ...keys.map((key) => env.DB.prepare("DELETE FROM decave_attachment_access WHERE r2_key=?").bind(key)),
  ]);
  await deleteQueuedMedia(env, keys);
}

/** Retry R2 deletions that did not go through when first tried. */
async function drainMediaDeletionQueue(env: Env): Promise<void> {
  const rows = await env.DB.prepare(
    "SELECT object_key FROM decave_media_deletion_queue ORDER BY attempts, queued_at LIMIT ?",
  )
    .bind(MEDIA_QUEUE_BATCH)
    .all<{ object_key: string }>();
  await deleteQueuedMedia(
    env,
    (rows.results ?? []).map((row) => row.object_key),
  );
}

/** Schedule deletion of accounts found to be under 18, through the normal
 * account-erasure pipeline (eraseDueAccounts). */
async function scheduleUnderageAccountDeletion(env: Env): Promise<void> {
  const now = nowIso();
  const deleteAfter = new Date(Date.now() + RETENTION_DAYS.underageAccountGrace * DAY_MS).toISOString();
  await env.DB.prepare(
    `UPDATE decave_users
     SET deleted_at=?, delete_after=?, deletion_reason=?
     WHERE deleted_at IS NULL AND erased_at IS NULL
       AND id IN (SELECT user_id FROM decave_user_safety_profiles WHERE age_status='ineligible')`,
  )
    .bind(now, deleteAfter, UNDERAGE_DELETION_REASON)
    .run();
}

export const UNDERAGE_DELETION_REASON = "Under the minimum age (18)";

/** One retention pass. Each step runs independently so one failure does not
 * stop the rest; the caller logs failures by name only. */
export async function pruneExpiredPersonalData(env: Env): Promise<string[]> {
  const now = nowIso();
  const steps: Array<[string, () => Promise<unknown>]> = [
    [
      "bot-runs",
      () => env.DB.prepare("DELETE FROM decave_bot_runs WHERE created_at<?").bind(before(RETENTION_DAYS.botRuns)).run(),
    ],
    // Short-lived credentials: deleted as soon as they expire or are used.
    [
      "sessions",
      () =>
        env.DB.batch([
          boundedDelete(env, "decave_sessions", "expires_at<=?", [now]),
          boundedDelete(env, "decave_session_clients", "token_hash NOT IN (SELECT token_hash FROM decave_sessions)"),
          boundedDelete(
            env,
            "decave_push_tokens",
            "session_hash IS NOT NULL AND session_hash NOT IN (SELECT token_hash FROM decave_sessions)",
          ),
        ]),
    ],
    // Push tokens registered before tokens were bound to a sign-in (session_hash
    // NULL) are never used for delivery any more (worker/push.ts), so they go.
    ["legacy-push-tokens", () => boundedDelete(env, "decave_push_tokens", "session_hash IS NULL").run()],
    [
      "tokens",
      () =>
        env.DB.batch([
          boundedDelete(env, "decave_ws_tokens", "used_at IS NOT NULL OR expires_at<=?", [now]),
          boundedDelete(env, "decave_auth_tokens", "consumed_at IS NOT NULL OR expires_at<=?", [now]),
          boundedDelete(env, "decave_secure_account_tokens", "used_at IS NOT NULL OR expires_at<=?", [now]),
          boundedDelete(env, "decave_owner_reauth", "expires_at<=?", [now]),
        ]),
    ],
    // Pending password-then-MFA sign-in steps (created lazily).
    [
      "login-challenges",
      () =>
        env.DB.batch([
          boundedDelete(env, "decave_user_login_challenges", "expires_at<=?", [now]),
          boundedDelete(env, "decave_owner_login_challenges", "expires_at<=?", [now]),
        ]),
    ],
    // Steam account-link states expire after a few minutes (created lazily).
    ["steam-link-states", () => boundedDelete(env, "decave_steam_link_states", "expires_at<=?", [now]).run()],
    ["faceit-link-states", () => boundedDelete(env, "decave_faceit_link_states", "expires_at<=?", [now]).run()],
    ["twitch-link-states", () => boundedDelete(env, "decave_twitch_member_link_states", "expires_at<=?", [now]).run()],
    // Created by the Worker on first QR sign-in, so it may not exist yet.
    [
      "qr-challenges",
      () => boundedDelete(env, "decave_qr_login_challenges", "expires_at<=? OR claimed_at IS NOT NULL", [now]).run(),
    ],
    // Device-link requests for DM encryption last ten minutes; an approved one that was
    // never collected holds a sealed key, so it goes too (docs/security/DM-E2EE.md).
    ["dm-link-requests", () => boundedDelete(env, "decave_dm_link_requests", "expires_at<=?", [now]).run()],
    ["squad-searches", () => boundedDelete(env, "decave_squad_searches", "expires_at<=?", [now]).run()],
    // Logs and records with a fixed retention period.
    [
      "security-events",
      () => boundedDelete(env, "decave_security_events", "created_at<?", [before(RETENTION_DAYS.securityEvents)]).run(),
    ],
    [
      "known-devices",
      () => boundedDelete(env, "decave_known_devices", "last_seen_at<?", [before(RETENTION_DAYS.knownDevices)]).run(),
    ],
    // "Last online" times of accounts not seen for six months (created lazily).
    [
      "presence",
      () =>
        boundedDelete(env, "decave_presence_activity", "last_seen_at<?", [
          before(RETENTION_DAYS.presenceLastSeen),
        ]).run(),
    ],
    [
      "audit-logs",
      () =>
        env.DB.batch([
          boundedDelete(env, "decave_platform_audit", "created_at<?", [before(RETENTION_DAYS.auditLogs)]),
          boundedDelete(env, "decave_moderation_audit_log", "created_at<?", [before(RETENTION_DAYS.auditLogs)]),
          boundedDelete(env, "decave_audit", "created_at<?", [before(RETENTION_DAYS.hubAuditLog)]),
        ]),
    ],
    // "All messages" push subscriptions pointing at a deleted Hub or room.
    [
      "push-subscriptions",
      () =>
        boundedDelete(
          env,
          "decave_push_subscriptions",
          `(hub_id IS NOT NULL AND hub_id NOT IN (SELECT id FROM decave_hubs))
           OR (room_id IS NOT NULL AND room_id NOT IN (SELECT id FROM decave_rooms))`,
        ).run(),
    ],
    ["feedback", () => boundedDelete(env, "decave_feedback", "created_at<?", [before(RETENTION_DAYS.feedback)]).run()],
    ["uploads", () => pruneOrphanedUploads(env)],
    ["case-evidence", () => pruneClosedCaseEvidence(env)],
    ["cases", () => pruneClosedCases(env)],
    // Last, so files queued by the steps above (or by message deletes and
    // earlier runs) are retried in this same run.
    ["media-queue", () => drainMediaDeletionQueue(env)],
    ["underage-accounts", () => scheduleUnderageAccountDeletion(env)],
  ];
  const failures: string[] = [];
  for (const [name, step] of steps) {
    try {
      await step();
    } catch (error) {
      // A table the Worker creates lazily may not exist on a fresh database.
      if (error instanceof Error && /no such table/i.test(error.message)) continue;
      failures.push(name);
      console.error(`Retention step ${name} failed.`, error instanceof Error ? error.name : "UnknownError");
    }
  }
  return failures;
}
