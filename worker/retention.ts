// Data retention: how long DeCave keeps each kind of personal data, and the
// hourly job that deletes it afterwards. The periods are listed in the Privacy
// Policy (docs/legal/PRIVACY-POLICY.md, "How long we keep data"); keep both in
// step. GDPR sets no fixed numbers for these records, only that data is kept no
// longer than needed (Art. 5(1)(e)); the reasoning for each period is noted.

import type { Env } from "./lib/env";
import { nowIso } from "./db";
import { queueOrphanedUploads } from "./lib/retention";
import { drainMediaDeletionQueue } from "./lib/media";

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
} as const;

const before = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();

const BATCH = 500;

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
  await env.MEDIA.delete(evidence.map((row) => row.object_key));
  await env.DB.batch(
    evidence.map((row) => env.DB.prepare("DELETE FROM decave_report_evidence WHERE id=?").bind(row.id)),
  );
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
    // Short-lived credentials: deleted as soon as they expire or are used.
    [
      "sessions",
      () =>
        env.DB.batch([
          env.DB.prepare("DELETE FROM decave_sessions WHERE expires_at<=?").bind(now),
          env.DB.prepare(
            "DELETE FROM decave_session_clients WHERE token_hash NOT IN (SELECT token_hash FROM decave_sessions)",
          ),
          env.DB.prepare(
            "DELETE FROM decave_push_tokens WHERE session_hash IS NOT NULL AND session_hash NOT IN (SELECT token_hash FROM decave_sessions)",
          ),
        ]),
    ],
    [
      "tokens",
      () =>
        env.DB.batch([
          env.DB.prepare("DELETE FROM decave_ws_tokens WHERE used_at IS NOT NULL OR expires_at<=?").bind(now),
          env.DB.prepare("DELETE FROM decave_auth_tokens WHERE consumed_at IS NOT NULL OR expires_at<=?").bind(now),
          env.DB.prepare("DELETE FROM decave_secure_account_tokens WHERE used_at IS NOT NULL OR expires_at<=?").bind(
            now,
          ),
          env.DB.prepare("DELETE FROM decave_owner_reauth WHERE expires_at<=?").bind(now),
        ]),
    ],
    [
      "login-challenges",
      () =>
        env.DB.batch(
          ["decave_user_login_challenges", "decave_owner_login_challenges"].map((table) =>
            env.DB.prepare(
              `DELETE FROM ${table} WHERE rowid IN (
                 SELECT rowid FROM ${table} WHERE expires_at<=? ORDER BY expires_at,rowid LIMIT ?
               )`,
            ).bind(now, BATCH),
          ),
        ),
    ],
    // Created by the Worker on first QR sign-in, so it may not exist yet.
    [
      "qr-challenges",
      () =>
        env.DB.prepare("DELETE FROM decave_qr_login_challenges WHERE expires_at<=? OR claimed_at IS NOT NULL")
          .bind(now)
          .run(),
    ],
    // Device-link requests for DM encryption last ten minutes; an approved one that was
    // never collected holds a sealed key, so it goes too (docs/security/DM-E2EE.md).
    [
      "dm-link-requests",
      () => env.DB.prepare("DELETE FROM decave_dm_link_requests WHERE expires_at<=?").bind(now).run(),
    ],
    ["squad-searches", () => env.DB.prepare("DELETE FROM decave_squad_searches WHERE expires_at<=?").bind(now).run()],
    // Logs and records with a fixed retention period.
    [
      "security-events",
      () =>
        env.DB.prepare("DELETE FROM decave_security_events WHERE created_at<?")
          .bind(before(RETENTION_DAYS.securityEvents))
          .run(),
    ],
    [
      "known-devices",
      () =>
        env.DB.prepare("DELETE FROM decave_known_devices WHERE last_seen_at<?")
          .bind(before(RETENTION_DAYS.knownDevices))
          .run(),
    ],
    [
      "presence-activity",
      () => env.DB.prepare("DELETE FROM decave_presence_activity WHERE last_seen_at<?").bind(before(180)).run(),
    ],
    [
      "push-tokens",
      () =>
        env.DB.prepare("DELETE FROM decave_push_tokens WHERE session_hash IS NULL AND created_at<?")
          .bind(before(90))
          .run(),
    ],
    [
      "push-subscriptions",
      () =>
        env.DB.prepare(
          `DELETE FROM decave_push_subscriptions WHERE rowid IN (
             SELECT p.rowid FROM decave_push_subscriptions p
             WHERE (p.hub_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM decave_hubs h WHERE h.id=p.hub_id))
                OR (p.room_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM decave_rooms r WHERE r.id=p.room_id))
             ORDER BY p.rowid LIMIT ?
           )`,
        )
          .bind(BATCH)
          .run(),
    ],
    [
      "audit-logs",
      () =>
        env.DB.batch([
          env.DB.prepare("DELETE FROM decave_platform_audit WHERE created_at<?").bind(before(RETENTION_DAYS.auditLogs)),
          env.DB.prepare("DELETE FROM decave_moderation_audit_log WHERE created_at<?").bind(
            before(RETENTION_DAYS.auditLogs),
          ),
          env.DB.prepare("DELETE FROM decave_audit WHERE created_at<?").bind(before(RETENTION_DAYS.hubAuditLog)),
        ]),
    ],
    [
      "feedback",
      () =>
        env.DB.prepare("DELETE FROM decave_feedback WHERE created_at<?").bind(before(RETENTION_DAYS.feedback)).run(),
    ],
    ["orphaned-uploads", () => queueOrphanedUploads(env)],
    ["media-deletion-queue", () => drainMediaDeletionQueue(env)],
    ["case-evidence", () => pruneClosedCaseEvidence(env)],
    ["cases", () => pruneClosedCases(env)],
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
