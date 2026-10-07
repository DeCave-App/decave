import type { Env } from "./env";
import { ensureActivitySchema } from "./activity";
import { ensurePushSchema } from "../push";
import { ensureQrLoginSchema, ensureSessionClientSchema } from "./sessions";
import { attemptQueuedMediaDeletion, attemptQueuedMediaDeletionIfQueued, drainMediaDeletionQueue } from "./media";

export const PRIVACY_RETENTION_DAYS = 365;
export const PRIVACY_RETENTION_BATCH_SIZE = 500;
export const EVIDENCE_RETENTION_BATCH_SIZE = 100;
/** Hub moderation audit (decave_audit): kick/ban/role history inside one Hub. */
export const HUB_AUDIT_RETENTION_DAYS = 365;
/** Platform staff audit (decave_platform_audit): who accessed or changed which account. */
export const PLATFORM_AUDIT_RETENTION_DAYS = 730;
/** Remembered sign-in devices (new-device alerts) unused for this long are forgotten. */
export const KNOWN_DEVICE_RETENTION_DAYS = 180;
/** "Last online" timestamps older than this are dropped. */
export const PRESENCE_ACTIVITY_RETENTION_DAYS = 180;
/** Push tokens from before session binding (session_hash IS NULL). */
export const LEGACY_PUSH_TOKEN_RETENTION_DAYS = 90;
/** Uploaded attachments never referenced by a message after this long are deleted. */
export const ORPHAN_UPLOAD_GRACE_HOURS = 24;
export const ORPHAN_UPLOAD_BATCH_SIZE = 100;

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBefore(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

/**
 * Upload rows in decave_attachment_access (alias `a`) that no message refers to.
 * Channel uploads link through decave_messages.attachment_key (or a payload in
 * the same room); DM uploads are referenced by URL inside a DM between the
 * same two accounts. Group chats have no upload route.
 */
const ORPHANED_UPLOAD_CONDITION = `(
  (a.kind='channel' AND NOT EXISTS(
    SELECT 1 FROM decave_messages m
    WHERE m.room_id=a.room_id AND (m.attachment_key=a.r2_key OR instr(m.text,a.r2_key)>0)
  ))
  OR (a.kind='dm' AND NOT EXISTS(
    SELECT 1 FROM decave_direct_messages d
    WHERE ((d.from_user_id=a.owner_user_id AND d.to_user_id=a.peer_user_id)
        OR (d.from_user_id=a.peer_user_id AND d.to_user_id=a.owner_user_id))
      AND instr(d.text,a.r2_key)>0
  ))
)`;

/** Queue R2 deletion for uploads that were never attached to a message within the grace period. */
export async function queueOrphanedUploads(env: Env, now = new Date()): Promise<number> {
  const stamp = now.toISOString();
  const cutoff = new Date(now.getTime() - ORPHAN_UPLOAD_GRACE_HOURS * 60 * 60 * 1000).toISOString();
  const candidates = await env.DB.prepare(
    `SELECT a.r2_key FROM decave_attachment_access a
     WHERE a.created_at<=? AND ${ORPHANED_UPLOAD_CONDITION}
     ORDER BY a.created_at,a.r2_key LIMIT ?`,
  )
    .bind(cutoff, ORPHAN_UPLOAD_BATCH_SIZE)
    .all<{ r2_key: string }>();
  if (!candidates.results.length) return 0;
  // Re-check the orphan condition inside the write batch so a message that
  // attached the file after the read above keeps it.
  await env.DB.batch(
    candidates.results.flatMap(({ r2_key: key }) => [
      env.DB.prepare(
        `INSERT OR IGNORE INTO decave_media_deletion_queue(object_key,queued_at,attempts,last_attempt_at)
         SELECT a.r2_key,?,0,NULL FROM decave_attachment_access a
         WHERE a.r2_key=? AND a.created_at<=? AND ${ORPHANED_UPLOAD_CONDITION}`,
      ).bind(stamp, key, cutoff),
      env.DB.prepare(
        `DELETE FROM decave_attachment_access WHERE r2_key IN (
           SELECT a.r2_key FROM decave_attachment_access a
           WHERE a.r2_key=? AND a.created_at<=? AND ${ORPHANED_UPLOAD_CONDITION}
         )`,
      ).bind(key, cutoff),
    ]),
  );
  const keys = candidates.results.map((row) => row.r2_key);
  await attemptQueuedMediaDeletionIfQueued(env, keys);
  return keys.length;
}

/** Remove one bounded page of expired credentials and finite-retention records. */
export async function pruneExpiredPrivacyData(
  env: Env,
  now = new Date(),
): Promise<{
  expiredCredentials: number;
  oldSecurityEvents: number;
  oldFeedback: number;
  evidenceObjectsQueued: number;
  mediaObjectsDrained: number;
  staleRecords: number;
  orphanedUploadsQueued: number;
}> {
  await ensureSessionClientSchema(env);
  await ensureQrLoginSchema(env);
  await ensurePushSchema(env.DB);
  // Independent sweeps record a failure and continue, so one missing or
  // locked table never blocks the others; the run still reports failure.
  const failures: string[] = [];
  async function isolated<T>(name: string, fallback: T, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      failures.push(name);
      console.error(
        `Privacy retention step "${name}" failed; it is retried next run.`,
        error instanceof Error ? error.name : "UnknownError",
      );
      return fallback;
    }
  }
  const stamp = now.toISOString();
  const retentionCutoff = daysBefore(now, PRIVACY_RETENTION_DAYS);
  const limit = PRIVACY_RETENTION_BATCH_SIZE;

  const credentialResults = await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM decave_session_clients WHERE token_hash IN (
         SELECT token_hash FROM decave_sessions WHERE expires_at<=? ORDER BY expires_at,token_hash LIMIT ?
       )`,
    ).bind(stamp, limit),
    env.DB.prepare(
      `DELETE FROM decave_ws_tokens WHERE session_hash IN (
         SELECT token_hash FROM decave_sessions WHERE expires_at<=? ORDER BY expires_at,token_hash LIMIT ?
       ) OR rowid IN (SELECT rowid FROM decave_ws_tokens WHERE expires_at<=? ORDER BY expires_at,token_hash LIMIT ?)`,
    ).bind(stamp, limit, stamp, limit),
    env.DB.prepare(
      `DELETE FROM decave_push_tokens WHERE session_hash IN (
         SELECT token_hash FROM decave_sessions WHERE expires_at<=? ORDER BY expires_at,token_hash LIMIT ?
       )`,
    ).bind(stamp, limit),
    env.DB.prepare(
      `DELETE FROM decave_sessions WHERE rowid IN (
         SELECT rowid FROM decave_sessions WHERE expires_at<=? ORDER BY expires_at,token_hash LIMIT ?
       )`,
    ).bind(stamp, limit),
    ...[
      "decave_auth_tokens",
      "decave_secure_account_tokens",
      "decave_user_login_challenges",
      "decave_owner_login_challenges",
      "decave_owner_reauth",
      "decave_qr_login_challenges",
    ].map((table) =>
      env.DB.prepare(
        `DELETE FROM ${table} WHERE rowid IN (
           SELECT rowid FROM ${table} WHERE expires_at<=? ORDER BY expires_at,rowid LIMIT ?
         )`,
      ).bind(stamp, limit),
    ),
  ]);
  let expiredCredentials = credentialResults.reduce((count, result) => count + Number(result.meta.changes ?? 0), 0);

  // Steam link states have historically been Worker-lazy (migration 0067 now
  // defines them). Keep this outside the atomic credential batch so a missing
  // table can never roll back the session and token purge above.
  expiredCredentials += await isolated("steam-link-states", 0, async () => {
    await ensureActivitySchema(env);
    const result = await env.DB.prepare(
      `DELETE FROM decave_steam_link_states WHERE rowid IN (
         SELECT rowid FROM decave_steam_link_states WHERE expires_at<=? ORDER BY expires_at,rowid LIMIT ?
       )`,
    )
      .bind(stamp, limit)
      .run();
    return Number(result.meta.changes ?? 0);
  });

  const staleSweeps: Array<{ name: string; sql: string; binds: unknown[] }> = [
    {
      name: "hub-audit",
      sql: `DELETE FROM decave_audit WHERE rowid IN (
        SELECT rowid FROM decave_audit WHERE created_at<=? ORDER BY created_at,rowid LIMIT ?)`,
      binds: [daysBefore(now, HUB_AUDIT_RETENTION_DAYS), limit],
    },
    {
      name: "platform-audit",
      sql: `DELETE FROM decave_platform_audit WHERE rowid IN (
        SELECT rowid FROM decave_platform_audit WHERE created_at<=? ORDER BY created_at,rowid LIMIT ?)`,
      binds: [daysBefore(now, PLATFORM_AUDIT_RETENTION_DAYS), limit],
    },
    {
      name: "known-devices",
      sql: `DELETE FROM decave_known_devices WHERE rowid IN (
        SELECT rowid FROM decave_known_devices WHERE last_seen_at<=? ORDER BY last_seen_at,rowid LIMIT ?)`,
      binds: [daysBefore(now, KNOWN_DEVICE_RETENTION_DAYS), limit],
    },
    {
      name: "presence-activity",
      sql: `DELETE FROM decave_presence_activity WHERE rowid IN (
        SELECT rowid FROM decave_presence_activity WHERE last_seen_at<=? ORDER BY last_seen_at,rowid LIMIT ?)`,
      binds: [daysBefore(now, PRESENCE_ACTIVITY_RETENTION_DAYS), limit],
    },
    {
      // Session-bound tokens whose session was revoked or already purged, and
      // pre-binding tokens that can no longer be tied to a live sign-in.
      name: "push-tokens",
      sql: `DELETE FROM decave_push_tokens WHERE rowid IN (
        SELECT t.rowid FROM decave_push_tokens t
        WHERE (t.session_hash IS NOT NULL
               AND NOT EXISTS(SELECT 1 FROM decave_sessions s WHERE s.token_hash=t.session_hash))
           OR (t.session_hash IS NULL AND t.created_at<=?)
        ORDER BY t.created_at,t.rowid LIMIT ?)`,
      binds: [daysBefore(now, LEGACY_PUSH_TOKEN_RETENTION_DAYS), limit],
    },
    {
      // "All messages" subscriptions that point at a deleted Hub or room.
      name: "push-subscriptions",
      sql: `DELETE FROM decave_push_subscriptions WHERE rowid IN (
        SELECT p.rowid FROM decave_push_subscriptions p
        WHERE (p.hub_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM decave_hubs h WHERE h.id=p.hub_id))
           OR (p.room_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM decave_rooms r WHERE r.id=p.room_id))
        ORDER BY p.rowid LIMIT ?)`,
      binds: [limit],
    },
  ];
  let staleRecords = 0;
  for (const sweep of staleSweeps) {
    staleRecords += await isolated(sweep.name, 0, async () => {
      const result = await env.DB.prepare(sweep.sql)
        .bind(...sweep.binds)
        .run();
      return Number(result.meta.changes ?? 0);
    });
  }

  const [securityEvents, feedback] = await Promise.all([
    env.DB.prepare(
      `DELETE FROM decave_security_events WHERE rowid IN (
         SELECT rowid FROM decave_security_events WHERE created_at<=? ORDER BY created_at,rowid LIMIT ?
       )`,
    )
      .bind(retentionCutoff, limit)
      .run(),
    env.DB.prepare(
      `DELETE FROM decave_feedback WHERE rowid IN (
         SELECT rowid FROM decave_feedback WHERE created_at<=? ORDER BY created_at,rowid LIMIT ?
       )`,
    )
      .bind(retentionCutoff, limit)
      .run(),
  ]);

  const expiredEvidence = await env.DB.prepare(
    `SELECT id,object_key FROM decave_report_evidence e
     WHERE e.deleted_at IS NULL AND e.legal_hold=0
       AND julianday(COALESCE(e.retention_expires_at, datetime(e.created_at, '+365 days'))) <= julianday(?)
       AND NOT EXISTS(SELECT 1 FROM decave_moderation_cases c WHERE c.id=e.case_id AND c.legal_hold=1)
     ORDER BY COALESCE(e.retention_expires_at,e.created_at),e.id LIMIT ?`,
  )
    .bind(stamp, EVIDENCE_RETENTION_BATCH_SIZE)
    .all<{ id: string; object_key: string }>();

  if (expiredEvidence.results.length) {
    const enqueueAndDelete = expiredEvidence.results.flatMap(({ id }) => [
      env.DB.prepare(
        `INSERT OR IGNORE INTO decave_media_deletion_queue(object_key,queued_at,attempts,last_attempt_at)
         SELECT object_key,?,0,NULL FROM decave_report_evidence e
         WHERE e.id=? AND e.deleted_at IS NULL AND e.legal_hold=0
           AND julianday(COALESCE(e.retention_expires_at, datetime(e.created_at, '+365 days'))) <= julianday(?)
           AND NOT EXISTS(SELECT 1 FROM decave_moderation_cases c WHERE c.id=e.case_id AND c.legal_hold=1)`,
      ).bind(stamp, id, stamp),
      env.DB.prepare(
        `DELETE FROM decave_report_evidence WHERE id=? AND deleted_at IS NULL AND legal_hold=0
           AND julianday(COALESCE(retention_expires_at, datetime(created_at, '+365 days'))) <= julianday(?)
           AND NOT EXISTS(SELECT 1 FROM decave_moderation_cases c WHERE c.id=decave_report_evidence.case_id AND c.legal_hold=1)`,
      ).bind(id, stamp),
    ]);
    await env.DB.batch(enqueueAndDelete);
    await attemptQueuedMediaDeletion(
      env,
      expiredEvidence.results.map(({ object_key }) => object_key),
    );
  }

  const orphanedUploadsQueued = await isolated("orphaned-uploads", 0, () => queueOrphanedUploads(env, now));

  const mediaObjectsDrained = await drainMediaDeletionQueue(env);
  if (failures.length) throw new Error(`Privacy retention steps failed: ${failures.join(", ")}.`);
  return {
    expiredCredentials,
    oldSecurityEvents: Number(securityEvents.meta.changes ?? 0),
    oldFeedback: Number(feedback.meta.changes ?? 0),
    evidenceObjectsQueued: expiredEvidence.results.length,
    mediaObjectsDrained,
    staleRecords,
    orphanedUploadsQueued,
  };
}
