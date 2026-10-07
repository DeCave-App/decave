import type { UserRow } from "./db";
import { createRawToken, hashPassword, nowIso } from "./db";
import type { Env } from "./lib/env";
import { ensureAccountPreferencesSchema } from "./lib/account-preferences";
import { ensureCollaborationSchema, ensureHubFeatureSchema } from "./lib/hub-schema";
import { ensureActivitySchema } from "./lib/activity";
import { ensureSquadFinderSchema, ensureSquadGameSuggestionsSchema } from "./lib/squad";
import { ensureSoundboardSchema } from "./lib/soundboard";
import { ensureSessionClientSchema, ensureQrLoginSchema, revokeAccountSessions } from "./lib/sessions";
import { ensurePushSchema } from "./push";
import { ensureReadStateSchema } from "./read-state";
import { ensureGroupChatSchema } from "./db";
import { streamerMigrationExists, streamerUserErasureStatements } from "./streamer/index.ts";
import { attemptQueuedMediaDeletion, mediaDeletionQueueStatement } from "./lib/media";

export type AccountErasureObjectStore = {
  delete(keys: string | string[]): Promise<void>;
};

export const ACCOUNT_ERASURE_LEASE_MS = 60 * 60 * 1000;
export const ACCOUNT_ERASURE_BATCH_SIZE = 5;

export const ACCOUNT_ERASURE_OBJECT_QUERIES = Object.freeze({
  legacyMessageAttachments: `SELECT attachment_key AS object_key
    FROM decave_messages
    WHERE author_user_id=? AND attachment_key IS NOT NULL`,
  ownedAttachmentAccess: `SELECT r2_key AS object_key
    FROM decave_attachment_access
    WHERE owner_user_id=? OR peer_user_id=?`,
  ownedHubAssets: `SELECT r2_key AS object_key
    FROM decave_hub_assets
    WHERE created_by=?`,
  ownedSoundboardSounds: `SELECT r2_key AS object_key
    FROM decave_soundboard_sounds
    WHERE user_id=?`,
  trustSafetyEvidence: `SELECT evidence.object_key
    FROM decave_report_evidence evidence
    JOIN decave_reports report ON report.id=evidence.report_id
    JOIN decave_moderation_cases cases ON cases.id=report.case_id
    WHERE report.reporter_user_id=?
      AND evidence.legal_hold=0
      AND cases.legal_hold=0
      AND evidence.deleted_at IS NULL`,
  pendingEvidenceUploads: `SELECT object_key
    FROM decave_report_evidence_upload_reservations
    WHERE user_id=?`,
});

export const ACCOUNT_ERASURE_CLEANUP_SQL = Object.freeze({
  deleteOwnedAttachmentAccess: "DELETE FROM decave_attachment_access WHERE owner_user_id=? OR peer_user_id=?",
  deleteOwnedHubAssets: "DELETE FROM decave_hub_assets WHERE created_by=?",
  deleteOwnedSoundboardSounds: "DELETE FROM decave_soundboard_sounds WHERE user_id=?",
  deleteEvidenceReservations: "DELETE FROM decave_report_evidence_upload_reservations WHERE user_id=?",
  deleteAccountPreferences: "DELETE FROM decave_account_preferences WHERE user_id=?",
  scrubAttachmentPeers: `UPDATE decave_attachment_access
    SET peer_user_id=NULL
    WHERE peer_user_id=?`,
  deleteSafetyProfile: "DELETE FROM decave_user_safety_profiles WHERE user_id=?",
  deleteUserBlocks: `DELETE FROM decave_user_blocks
    WHERE blocker_user_id=? OR blocked_user_id=?`,
  deleteUserMutes: `DELETE FROM decave_user_mutes
    WHERE muter_user_id=? OR muted_user_id=?`,
  deleteReporterEvidence: `DELETE FROM decave_report_evidence
    WHERE report_id IN (
      SELECT reports.id FROM decave_reports reports
      JOIN decave_moderation_cases cases ON cases.id=reports.case_id
      WHERE reports.reporter_user_id=? AND cases.legal_hold=0
    ) AND legal_hold=0`,
  scrubReportReporter: `UPDATE decave_reports
    SET reporter_user_id=NULL
    WHERE reporter_user_id=?`,
});

/**
 * Tables that keep a reference to an erased account on purpose. Every other
 * table with a user-reference column must be cleaned up by eraseAccountData
 * (enforced by scripts/__tests__/account-erasure-coverage.test.mjs).
 */
export const ACCOUNT_ERASURE_RETAINED_REFERENCES: Readonly<Record<string, string>> = Object.freeze({
  decave_moderation_case_notes:
    "Staff-authored moderation notes are retained for case history. author_user_id is NOT NULL with ON DELETE RESTRICT, so it keeps pointing at the anonymized tombstone row (no name, email or public id remains).",
  decave_moderation_actions:
    "created_by_user_id (staff actor, NOT NULL, RESTRICT) keeps pointing at the anonymized tombstone; target_user_id is cleared by eraseAccountData.",
  decave_case_links:
    "created_by_user_id (staff actor, NOT NULL, RESTRICT) keeps pointing at the anonymized tombstone; links carry no personal content.",
  decave_platform_audit:
    "actor_user_id is NOT NULL with ON DELETE RESTRICT; it keeps the anonymized tombstone id while detail_json and target_user_id are cleared. Rows expire after PLATFORM_AUDIT_RETENTION_DAYS.",
  decave_audit:
    "actor_user_id is NOT NULL; it keeps the anonymized tombstone id while detail and target_user_id are cleared. Rows expire after HUB_AUDIT_RETENTION_DAYS.",
  decave_moderation_audit_log:
    "Append-only by database trigger (decave_moderation_audit_no_update/no_delete). actor_user_id keeps the anonymized tombstone id; rows hold no account profile data.",
  decave_sessions: "Deleted by revokeAccountSessions (worker/lib/sessions.ts) before the erasure batch.",
  decave_session_clients: "Deleted by revokeAccountSessions (worker/lib/sessions.ts) before the erasure batch.",
  decave_ws_tokens: "Deleted by revokeAccountSessions (worker/lib/sessions.ts) before the erasure batch.",
  decave_owner_reauth: "Deleted by revokeAccountSessions (worker/lib/sessions.ts) before the erasure batch.",
  decave_owner_login_challenges: "Deleted by revokeAccountSessions (worker/lib/sessions.ts) before the erasure batch.",
  decave_hubs: "Accounts that own a Hub cannot be claimed for erasure (claimAccountErasure).",
});

/**
 * Pre-DeCave tables from migrations/0001_initial.sql. The current Worker does
 * not write them, but rows may exist in older databases. Each statement runs
 * only when its table exists. Order matters: legacy hubs use ON DELETE
 * RESTRICT on owner_user_id, so owned hubs go first and users go last.
 */
export const LEGACY_ACCOUNT_ERASURE_SQL: ReadonlyArray<{ table: string; sql: string; binds: number }> = Object.freeze([
  { table: "hubs", sql: "DELETE FROM hubs WHERE owner_user_id=?", binds: 1 },
  { table: "message_reactions", sql: "DELETE FROM message_reactions WHERE user_id=?", binds: 1 },
  { table: "message_pins", sql: "DELETE FROM message_pins WHERE pinned_by_user_id=?", binds: 1 },
  { table: "attachments", sql: "DELETE FROM attachments WHERE owner_user_id=?", binds: 1 },
  { table: "messages", sql: "DELETE FROM messages WHERE author_user_id=?", binds: 1 },
  { table: "dm_messages", sql: "DELETE FROM dm_messages WHERE author_user_id=?", binds: 1 },
  { table: "dm_members", sql: "DELETE FROM dm_members WHERE user_id=?", binds: 1 },
  {
    table: "friend_requests",
    sql: "DELETE FROM friend_requests WHERE sender_user_id=? OR recipient_user_id=?",
    binds: 2,
  },
  { table: "friendships", sql: "DELETE FROM friendships WHERE user_id_a=? OR user_id_b=?", binds: 2 },
  { table: "member_roles", sql: "DELETE FROM member_roles WHERE user_id=?", binds: 1 },
  { table: "hub_members", sql: "DELETE FROM hub_members WHERE user_id=?", binds: 1 },
  { table: "invites", sql: "DELETE FROM invites WHERE created_by_user_id=?", binds: 1 },
  { table: "bans", sql: "DELETE FROM bans WHERE user_id=? OR banned_by_user_id=?", binds: 2 },
  { table: "timeouts", sql: "DELETE FROM timeouts WHERE user_id=? OR timed_out_by_user_id=?", binds: 2 },
  {
    table: "audit_log",
    sql: `UPDATE audit_log SET
      actor_user_id=CASE WHEN actor_user_id=? THEN NULL ELSE actor_user_id END,
      target_user_id=CASE WHEN target_user_id=? THEN NULL ELSE target_user_id END,
      details_json='{}'
      WHERE actor_user_id=? OR target_user_id=?`,
    binds: 4,
  },
  { table: "sessions", sql: "DELETE FROM sessions WHERE user_id=?", binds: 1 },
  { table: "users", sql: "DELETE FROM users WHERE id=?", binds: 1 },
]);

async function legacyAccountErasureStatements(env: Env, userId: string): Promise<D1PreparedStatement[]> {
  const tables = [...new Set(LEGACY_ACCOUNT_ERASURE_SQL.map((entry) => entry.table))];
  const present = await env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name IN (${tables.map(() => "?").join(",")})`,
  )
    .bind(...tables)
    .all<{ name: string }>();
  const existing = new Set(present.results.map((row) => row.name));
  return LEGACY_ACCOUNT_ERASURE_SQL.filter((entry) => existing.has(entry.table)).map((entry) =>
    env.DB.prepare(entry.sql).bind(...Array.from({ length: entry.binds }, () => userId)),
  );
}

export class AccountErasureStorageError extends Error {
  constructor(cause: unknown) {
    super("Permanent account erasure could not delete stored objects.", { cause });
    this.name = "AccountErasureStorageError";
  }
}

export async function claimAccountErasure(env: Env, userId: string): Promise<string | null> {
  const claimedAt = nowIso();
  const reclaimBefore = new Date(Date.parse(claimedAt) - ACCOUNT_ERASURE_LEASE_MS).toISOString();
  const result = await env.DB.prepare(
    `UPDATE decave_users
     SET erasure_started_at=?
     WHERE id=?
       AND COALESCE(platform_role,'user')<>'owner'
       AND NOT EXISTS(SELECT 1 FROM decave_hubs WHERE owner_id=decave_users.id)
       AND (erased_at IS NOT NULL OR (deleted_at IS NOT NULL AND delete_after IS NOT NULL AND delete_after<=?))
       AND (erasure_started_at IS NULL OR erasure_started_at<?)`,
  )
    .bind(claimedAt, userId, claimedAt, reclaimBefore)
    .run();
  return Number(result.meta.changes ?? 0) === 1 ? claimedAt : null;
}

export async function eraseAccountData(
  env: Env,
  userId: string,
  claimedAt: string,
): Promise<{ target: UserRow; erasedAt: string; alreadyErased: boolean }> {
  const target = await env.DB.prepare("SELECT * FROM decave_users WHERE id=? AND erasure_started_at=? LIMIT 1")
    .bind(userId, claimedAt)
    .first<UserRow>();
  if (!target) throw new Error("Account erasure claim was lost before cleanup started.");
  const alreadyErased = Boolean(target.erased_at);

  await ensureGroupChatSchema(env.DB);
  await ensureSessionClientSchema(env);
  await ensureCollaborationSchema(env);
  await ensureActivitySchema(env);
  await ensureQrLoginSchema(env);
  await ensureSquadFinderSchema(env);
  await ensureSquadGameSuggestionsSchema(env);
  await ensureHubFeatureSchema(env);
  await ensureSoundboardSchema(env);
  await ensureAccountPreferencesSchema(env);

  const [
    legacyAttachmentRows,
    attachmentAccessRows,
    hubAssetRows,
    soundboardRows,
    trustSafetyEvidenceRows,
    pendingUploadRows,
  ] = await Promise.all([
    env.DB.prepare(ACCOUNT_ERASURE_OBJECT_QUERIES.legacyMessageAttachments)
      .bind(target.id)
      .all<{ object_key: string }>(),
    env.DB.prepare(ACCOUNT_ERASURE_OBJECT_QUERIES.ownedAttachmentAccess)
      .bind(target.id, target.id)
      .all<{ object_key: string }>(),
    env.DB.prepare(ACCOUNT_ERASURE_OBJECT_QUERIES.ownedHubAssets).bind(target.id).all<{ object_key: string }>(),
    env.DB.prepare(ACCOUNT_ERASURE_OBJECT_QUERIES.ownedSoundboardSounds).bind(target.id).all<{ object_key: string }>(),
    env.DB.prepare(ACCOUNT_ERASURE_OBJECT_QUERIES.trustSafetyEvidence).bind(target.id).all<{ object_key: string }>(),
    env.DB.prepare(ACCOUNT_ERASURE_OBJECT_QUERIES.pendingEvidenceUploads).bind(target.id).all<{ object_key: string }>(),
  ]);

  await ensurePushSchema(env.DB);
  await ensureReadStateSchema(env.DB);

  const r2Keys = new Set<string>();
  if (target.avatar_key) r2Keys.add(target.avatar_key);
  if (target.banner_key) r2Keys.add(target.banner_key);
  for (const row of [
    ...legacyAttachmentRows.results,
    ...attachmentAccessRows.results,
    ...hubAssetRows.results,
    ...soundboardRows.results,
    ...trustSafetyEvidenceRows.results,
    ...pendingUploadRows.results,
  ]) {
    if (row.object_key) r2Keys.add(row.object_key);
  }

  try {
    await env.DB.batch([...r2Keys].map((key) => mediaDeletionQueueStatement(env.DB, key, nowIso())));
    await attemptQueuedMediaDeletion(env, r2Keys);
  } catch (error) {
    throw new AccountErasureStorageError(error);
  }

  // Revoke sessions through the common path so realtime credentials and
  // session-bound push registrations receive the same treatment everywhere.
  await revokeAccountSessions(env, target.id, "account_erased");

  const erasedAt = target.erased_at ?? nowIso();
  const erasureStatements = [
    env.DB.prepare(ACCOUNT_ERASURE_CLEANUP_SQL.deleteOwnedAttachmentAccess).bind(target.id, target.id),
    env.DB.prepare(ACCOUNT_ERASURE_CLEANUP_SQL.deleteOwnedHubAssets).bind(target.id),
    env.DB.prepare(ACCOUNT_ERASURE_CLEANUP_SQL.deleteOwnedSoundboardSounds).bind(target.id),
    env.DB.prepare(ACCOUNT_ERASURE_CLEANUP_SQL.deleteEvidenceReservations).bind(target.id),
    env.DB.prepare(ACCOUNT_ERASURE_CLEANUP_SQL.deleteAccountPreferences).bind(target.id),
    env.DB.prepare(ACCOUNT_ERASURE_CLEANUP_SQL.scrubAttachmentPeers).bind(target.id),
    env.DB.prepare(ACCOUNT_ERASURE_CLEANUP_SQL.deleteReporterEvidence).bind(target.id),
    env.DB.prepare(ACCOUNT_ERASURE_CLEANUP_SQL.scrubReportReporter).bind(target.id),
    env.DB.prepare(ACCOUNT_ERASURE_CLEANUP_SQL.deleteSafetyProfile).bind(target.id),
    env.DB.prepare(ACCOUNT_ERASURE_CLEANUP_SQL.deleteUserBlocks).bind(target.id, target.id),
    env.DB.prepare(ACCOUNT_ERASURE_CLEANUP_SQL.deleteUserMutes).bind(target.id, target.id),
    env.DB.prepare("DELETE FROM decave_push_tokens WHERE user_id=?").bind(target.id),
    env.DB.prepare("DELETE FROM decave_read_state WHERE user_id=? OR (scope='dm' AND target=?)").bind(
      target.id,
      target.id,
    ),
    env.DB.prepare("DELETE FROM decave_auth_tokens WHERE user_id=?").bind(target.id),
    env.DB.prepare("DELETE FROM decave_owner_mfa WHERE user_id=?").bind(target.id),
    env.DB.prepare("DELETE FROM decave_owner_recovery_codes WHERE user_id=?").bind(target.id),
    env.DB.prepare("DELETE FROM decave_user_mfa WHERE user_id=?").bind(target.id),
    env.DB.prepare("DELETE FROM decave_user_recovery_codes WHERE user_id=?").bind(target.id),
    env.DB.prepare("DELETE FROM decave_user_login_challenges WHERE user_id=?").bind(target.id),
    env.DB.prepare("DELETE FROM decave_known_devices WHERE user_id=?").bind(target.id),
    env.DB.prepare("DELETE FROM decave_push_subscriptions WHERE user_id=?").bind(target.id),
    env.DB.prepare("DELETE FROM decave_secure_account_tokens WHERE user_id=?").bind(target.id),
    env.DB.prepare("DELETE FROM decave_qr_login_challenges WHERE user_id=?").bind(target.id),
    env.DB.prepare("DELETE FROM decave_presence_activity WHERE user_id=?").bind(target.id),
    env.DB.prepare("DELETE FROM decave_activity_state WHERE user_id=?").bind(target.id),
    env.DB.prepare("DELETE FROM decave_steam_link_states WHERE user_id=?").bind(target.id),
    env.DB.prepare("DELETE FROM decave_steam_links WHERE user_id=?").bind(target.id),
    env.DB.prepare("DELETE FROM decave_dm_preferences WHERE user_id=? OR peer_user_id=?").bind(target.id, target.id),
    env.DB.prepare("DELETE FROM decave_squad_searches WHERE user_id=?").bind(target.id),
    env.DB.prepare("DELETE FROM decave_hub_event_rsvps WHERE user_id=?").bind(target.id),
    env.DB.prepare("DELETE FROM decave_squad_game_suggestions WHERE user_id=?").bind(target.id),
    env.DB.prepare("UPDATE decave_squad_game_suggestions SET reviewed_by=NULL WHERE reviewed_by=?").bind(target.id),
    env.DB.prepare("DELETE FROM decave_room_members WHERE user_id=?").bind(target.id),
    env.DB.prepare("DELETE FROM decave_hub_bots WHERE created_by=?").bind(target.id),
    env.DB.prepare("UPDATE decave_bots SET created_by=NULL WHERE created_by=?").bind(target.id),
    env.DB.prepare(
      "DELETE FROM decave_dm_reaction_envelopes WHERE user_id=? OR message_id IN (SELECT id FROM decave_direct_messages WHERE from_user_id=? OR to_user_id=?)",
    ).bind(target.id, target.id, target.id),
    env.DB.prepare(
      "DELETE FROM decave_dm_reactions WHERE user_id=? OR message_id IN (SELECT id FROM decave_direct_messages WHERE from_user_id=? OR to_user_id=?)",
    ).bind(target.id, target.id, target.id),
    env.DB.prepare("DELETE FROM decave_direct_messages WHERE from_user_id=? OR to_user_id=?").bind(
      target.id,
      target.id,
    ),
    env.DB.prepare("DELETE FROM decave_dm_key_settings WHERE user_id=?").bind(target.id),
    env.DB.prepare("DELETE FROM decave_dm_link_requests WHERE user_id=?").bind(target.id),
    env.DB.prepare("DELETE FROM decave_dm_key_backups WHERE user_id=?").bind(target.id),
    env.DB.prepare("DELETE FROM decave_dm_keys WHERE user_id=?").bind(target.id),
    env.DB.prepare("DELETE FROM decave_dm_conversation_clears WHERE user_id=? OR partner_id=?").bind(
      target.id,
      target.id,
    ),
    env.DB.prepare("DELETE FROM decave_friend_requests WHERE sender_id=? OR recipient_id=?").bind(target.id, target.id),
    env.DB.prepare("DELETE FROM decave_friendships WHERE user_a=? OR user_b=?").bind(target.id, target.id),
    env.DB.prepare(
      "DELETE FROM decave_group_chat_messages WHERE group_id IN (SELECT id FROM decave_group_chats WHERE owner_user_id=?) OR from_user_id=?",
    ).bind(target.id, target.id),
    env.DB.prepare(
      "DELETE FROM decave_group_chat_members WHERE group_id IN (SELECT id FROM decave_group_chats WHERE owner_user_id=?) OR user_id=?",
    ).bind(target.id, target.id),
    env.DB.prepare("DELETE FROM decave_group_chats WHERE owner_user_id=?").bind(target.id),
    env.DB.prepare("DELETE FROM decave_feedback WHERE user_id=?").bind(target.id),
    env.DB.prepare("DELETE FROM decave_hub_event_rsvps WHERE user_id=?").bind(target.id),
    env.DB.prepare("DELETE FROM decave_hub_events WHERE created_by=?").bind(target.id),
    env.DB.prepare("DELETE FROM decave_hub_imports WHERE created_by=?").bind(target.id),
    env.DB.prepare("DELETE FROM decave_message_reactions WHERE user_id=?").bind(target.id),
    env.DB.prepare("DELETE FROM decave_messages WHERE author_user_id=?").bind(target.id),
    env.DB.prepare("DELETE FROM decave_member_roles WHERE user_id=?").bind(target.id),
    env.DB.prepare("DELETE FROM decave_hub_members WHERE user_id=?").bind(target.id),
    env.DB.prepare("DELETE FROM decave_invites WHERE created_by=?").bind(target.id),
    env.DB.prepare("DELETE FROM decave_bans WHERE user_id=? OR banned_by=?").bind(target.id, target.id),
    env.DB.prepare("DELETE FROM decave_timeouts WHERE user_id=? OR timed_out_by=?").bind(target.id, target.id),
    env.DB.prepare(
      "UPDATE decave_moderation_cases SET primary_subject_user_id=NULL,subject_public_id_snapshot=NULL,subject_username_snapshot=NULL WHERE primary_subject_user_id=?",
    ).bind(target.id),
    env.DB.prepare(
      "UPDATE decave_reports SET subject_user_id=NULL,target_public_id_snapshot=NULL,target_username_snapshot=NULL WHERE subject_user_id=?",
    ).bind(target.id),
    env.DB.prepare(
      "UPDATE decave_platform_audit SET target_user_id=NULL,detail_json='{}' WHERE target_user_id=? OR actor_user_id=?",
    ).bind(target.id, target.id),
    env.DB.prepare(
      "UPDATE decave_audit SET target_user_id=NULL,detail='' WHERE target_user_id=? OR actor_user_id=?",
    ).bind(target.id, target.id),
    env.DB.prepare(
      `UPDATE decave_security_events
       SET ip_hash='erased',user_agent='',detail=''
       WHERE user_id=?`,
    ).bind(target.id),
    // Keep a Hub's share link working but stop attributing it to this account.
    env.DB.prepare(
      `UPDATE decave_hub_share_links
       SET created_by=(SELECT owner_id FROM decave_hubs WHERE decave_hubs.id=decave_hub_share_links.hub_id)
       WHERE created_by=?`,
    ).bind(target.id),
    env.DB.prepare("UPDATE decave_hub_home SET updated_by=NULL WHERE updated_by=?").bind(target.id),
    env.DB.prepare("UPDATE decave_moderation_actions SET target_user_id=NULL WHERE target_user_id=?").bind(target.id),
    ...(await legacyAccountErasureStatements(env, target.id)),
  ];

  if (await streamerMigrationExists(env.DB)) {
    erasureStatements.push(...streamerUserErasureStatements(env.DB, target.id));
  }

  if (!alreadyErased) {
    const anonymizedUsername = `Deleted-${target.id.slice(0, 8)}-${crypto.randomUUID().slice(0, 4)}`;
    const anonymizedPublicId = `DC-${crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`;
    const randomizedPassword = await hashPassword(createRawToken());

    // Keep an anonymized user tombstone because audit rows and foreign keys
    // require a stable id.
    erasureStatements.push(
      env.DB.prepare(
        `UPDATE decave_users SET
         username=?,
         password_salt=?,
         password_hash=?,
         avatar_key=NULL,
         avatar_updated_at=NULL,
         display_name='',
         pronouns='',
         banner_key=NULL,
         banner_updated_at=NULL,
         bio='',
         status='invisible',
         status_text='',
         activity_text='',
         accent='#7c5cff',
         email=NULL,
         email_normalized=NULL,
         email_verified_at=NULL,
         public_id=?,
         terms_accepted_at=NULL,
         terms_version=NULL,
         privacy_version=NULL,
         requires_email_verification=0,
         platform_role='user',
         suspended_at=NULL,
         suspended_until=NULL,
         suspension_reason='',
         must_reset_password=0,
         deleted_at=?,
         delete_after=NULL,
         deletion_reason='',
         erased_at=?,
         erasure_started_at=NULL
         WHERE id=? AND erasure_started_at=?`,
      ).bind(
        anonymizedUsername,
        randomizedPassword.salt,
        randomizedPassword.hash,
        anonymizedPublicId,
        target.deleted_at,
        erasedAt,
        target.id,
        claimedAt,
      ),
    );
  } else {
    erasureStatements.push(
      env.DB.prepare(
        "UPDATE decave_users SET erasure_started_at=NULL WHERE id=? AND erased_at IS NOT NULL AND erasure_started_at=?",
      ).bind(target.id, claimedAt),
    );
  }

  await env.DB.batch(erasureStatements);
  return { target, erasedAt, alreadyErased };
}

export async function eraseDueAccounts(env: Env): Promise<number> {
  await ensureAccountPreferencesSchema(env);
  // Clean up preference rows retained by pre-fix tombstones without an
  // unbounded read into Worker memory. The migration performs the initial pass.
  await env.DB.prepare(
    `DELETE FROM decave_account_preferences
     WHERE user_id IN (
       SELECT preferences.user_id
       FROM decave_account_preferences preferences
       JOIN decave_users users ON users.id=preferences.user_id
       WHERE users.erased_at IS NOT NULL
       LIMIT 500
     )`,
  ).run();

  const now = nowIso();
  const staleClaimBefore = new Date(Date.parse(now) - ACCOUNT_ERASURE_LEASE_MS).toISOString();
  const candidates = await env.DB.prepare(
    `SELECT id FROM decave_users
     WHERE erased_at IS NULL
       AND deleted_at IS NOT NULL AND delete_after IS NOT NULL AND delete_after<=?
       AND COALESCE(platform_role,'user')<>'owner'
       AND NOT EXISTS(SELECT 1 FROM decave_hubs WHERE owner_id=decave_users.id)
       AND (erasure_started_at IS NULL OR erasure_started_at<?)
     ORDER BY delete_after,id LIMIT ?`,
  )
    .bind(now, staleClaimBefore, ACCOUNT_ERASURE_BATCH_SIZE)
    .all<{ id: string }>();

  let completed = 0;
  let failed = 0;
  for (const candidate of candidates.results) {
    const claimedAt = await claimAccountErasure(env, candidate.id);
    if (!claimedAt) continue;
    try {
      await eraseAccountData(env, candidate.id, claimedAt);
      completed += 1;
    } catch (error) {
      failed += 1;
      console.error(
        "Scheduled account erasure failed; account metadata was retained for retry.",
        error instanceof Error ? error.name : "UnknownError",
      );
    }
  }
  if (failed) throw new Error(`Scheduled account erasure failed for ${failed} account(s); they remain retryable.`);
  return completed;
}

export async function deleteAccountErasureObjects(
  store: AccountErasureObjectStore,
  objectKeys: Iterable<string>,
): Promise<void> {
  const keys = Array.from(new Set(objectKeys)).filter(Boolean).sort();

  // R2 accepts at most 1,000 keys in one multi-object delete. A failed chunk
  // aborts account erasure before D1 is changed; deleting an already-missing
  // key is safe, so the complete operation can be retried.
  for (let offset = 0; offset < keys.length; offset += 1_000) {
    const chunk = keys.slice(offset, offset + 1_000);
    try {
      await store.delete(chunk);
    } catch (cause) {
      throw new Error(`Permanent account erasure could not delete ${chunk.length} stored object(s).`, { cause });
    }
  }
}
