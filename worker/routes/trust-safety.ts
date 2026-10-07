// Trust & Safety API: reports, cases, evidence and moderation actions.

import {
  type TrustSafetyReportRow,
  type TrustSafetyCaseRow,
  type ReportTargetType,
  activeTrustSafetyKey,
  deriveAgeProfile,
  saveAgeProfile,
  safetyProfileForClient,
  getSafetyProfile,
  reportForClient,
  sha256Hex,
  reportReference,
  trustSafetyAuditStatement,
  isReportTargetType,
  REPORT_TARGET_TYPES,
  isReportCategory,
  isReportUrgency,
  createTrustSafetyReport,
  reportDescription,
  isReportStatus,
  caseForClient,
  REPORT_STATUSES,
  REPORT_URGENCIES,
} from "../trust-safety";
import type { Env } from "../lib/env";
import { PRIVACY_RETENTION_DAYS } from "../lib/retention";
import {
  type UserRow,
  userByReference,
  getRoom,
  canAccessRoom as dbCanAccessRoom,
  ensureGroupChatSchema,
  isGroupChatMember,
  publicIdOf,
  nowIso,
  rawSessionTokenFromRequest,
  tokenHash,
} from "../db";
import { json, boundedBodyJson, idFromPath, bodyJson } from "../lib/http";
import { requireUser, securityEvent, revokeAccountSessions } from "../lib/sessions";
import { unreadSummary, markRead } from "../read-state";
import { canAccessRoom } from "../lib/hubs";
import { realtimeBroadcast } from "../lib/realtime";
import { isExpoPushToken, removePushToken, registerPushToken } from "../push";
import { requirePlatformOwner, platformAudit } from "../lib/platform-owner";
import { ownerRequireReauth } from "../lib/mfa";
import { streamerMigrationExists, streamerRevokeParticipantStatements } from "../streamer/index.ts";

export const EVIDENCE_UPLOAD_LIMITS = Object.freeze({
  requestBytes: 12 * 1024 * 1024,
  reportItems: 4,
  reportBytes: 24 * 1024 * 1024,
  userItemsPerDay: 20,
  userBytesPerDay: 120 * 1024 * 1024,
  userItemsPerHour: 10,
  reservationLifetimeMs: 2 * 60 * 60 * 1000,
});

async function readBoundedEvidence(request: Request, maximumBytes: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function pruneExpiredEvidenceUploadReservations(env: Env, limit = 50): Promise<number> {
  const boundedLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
  const expiredBefore = new Date(Date.now() - EVIDENCE_UPLOAD_LIMITS.reservationLifetimeMs).toISOString();
  const reservations = await env.DB.prepare(
    `SELECT id,object_key,created_at
     FROM decave_report_evidence_upload_reservations
     WHERE created_at<=?
     ORDER BY created_at,id LIMIT ?`,
  )
    .bind(expiredBefore, boundedLimit)
    .all<{ id: string; object_key: string; created_at: string }>();
  let cleaned = 0;
  let failed = 0;
  for (const reservation of reservations.results) {
    try {
      const committed = await env.DB.prepare(
        "SELECT 1 AS present FROM decave_report_evidence WHERE object_key=? LIMIT 1",
      )
        .bind(reservation.object_key)
        .first<{ present: number }>();
      if (!committed) await env.MEDIA.delete(reservation.object_key);
      const result = await env.DB.prepare(
        `DELETE FROM decave_report_evidence_upload_reservations
         WHERE id=? AND created_at<=?`,
      )
        .bind(reservation.id, expiredBefore)
        .run();
      cleaned += Number(result.meta.changes ?? 0);
    } catch (error) {
      failed += 1;
      console.error(
        "Expired safety evidence upload cleanup failed; reservation retained for retry.",
        error instanceof Error ? error.name : "UnknownError",
      );
    }
  }
  if (failed) throw new Error(`Expired evidence upload cleanup failed for ${failed} reservation(s).`);
  return cleaned;
}

export type SafetyReportQueryRow = TrustSafetyReportRow & {
  case_number: string;
  reporter_public_id: string | null;
  reporter_username: string | null;
};

export type SafetyCaseQueryRow = TrustSafetyCaseRow;

export function safetyReportLimit(url: URL, fallback = 50, maximum = 100): number {
  const requested = Number(url.searchParams.get("limit") ?? fallback);
  return Number.isFinite(requested) ? Math.max(1, Math.min(maximum, Math.trunc(requested))) : fallback;
}

export async function safetyReportRow(env: Env, reportId: string): Promise<SafetyReportQueryRow | null> {
  return (
    (await env.DB.prepare(
      `SELECT r.*,c.case_number,
                reporter.public_id AS reporter_public_id,
                reporter.username AS reporter_username
         FROM decave_reports r
         JOIN decave_moderation_cases c ON c.id=r.case_id
         LEFT JOIN decave_users reporter ON reporter.id=r.reporter_user_id
         WHERE r.id=? LIMIT 1`,
    )
      .bind(reportId)
      .first<SafetyReportQueryRow>()) ?? null
  );
}

export async function safetyCaseRow(env: Env, caseId: string): Promise<SafetyCaseQueryRow | null> {
  return (
    (await env.DB.prepare(
      `SELECT c.*,
                owner.public_id AS assigned_owner_public_id,
                owner.username AS assigned_owner_username
         FROM decave_moderation_cases c
         LEFT JOIN decave_users owner ON owner.id=c.assigned_owner_user_id
         WHERE c.id=? LIMIT 1`,
    )
      .bind(caseId)
      .first<SafetyCaseQueryRow>()) ?? null
  );
}

export type SafetyEvidenceQueryRow = {
  id: string;
  report_id?: string | null;
  evidence_type: string;
  source_message_id?: string | null;
  source_context_type?: string | null;
  source_context_id?: string | null;
  ciphertext_sha256: string;
  ciphertext_size: number;
  package_version: string;
  encryption_version: string;
  key_id: string;
  created_at: string;
};

export type SafetyReportedMessageRow = {
  id: string;
  author_user_id: string;
  author_public_id: string | null;
  author_username: string;
  text: string;
  created_at: string;
  edited_at: string | null;
  attachment_id: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  attachment_size: number | null;
};

export function safetyEvidenceForClient(row: SafetyEvidenceQueryRow) {
  return {
    id: row.id,
    reportId: row.report_id ?? null,
    evidenceType: row.evidence_type,
    sourceMessageId: row.source_message_id ?? null,
    sourceContextType: row.source_context_type ?? null,
    sourceContextId: row.source_context_id ?? null,
    ciphertextSha256: row.ciphertext_sha256,
    ciphertextSize: Number(row.ciphertext_size),
    packageVersion: row.package_version,
    encryptionVersion: row.encryption_version,
    keyId: row.key_id,
    createdAt: row.created_at,
  };
}

export function safetyCaseNoteForClient(row: {
  id: string;
  note: string;
  created_at: string;
  author_public_id?: string | null;
  author_username?: string | null;
}) {
  return {
    id: row.id,
    note: row.note,
    createdAt: row.created_at,
    authorUserId: row.author_public_id ?? null,
    authorUsername: row.author_username ?? null,
  };
}

export function safetyActionForClient(row: {
  id: string;
  case_id: string;
  report_id?: string | null;
  target_public_id?: string | null;
  action_type: string;
  reason_code: string;
  reason: string;
  duration_hours: number | null;
  starts_at: string;
  expires_at: string | null;
  reversed_at: string | null;
  created_by_public_id?: string | null;
  created_by_username?: string | null;
  created_at: string;
}) {
  // The Phase 1 action table predates disposition-only decisions and its
  // CHECK constraint does not include a no-action value. Store that decision
  // with a reserved reason code, then restore the user-facing action type here.
  const actionType = row.reason_code === "no_action_taken" ? "no_action_taken" : row.action_type;
  return {
    id: row.id,
    caseId: row.case_id,
    reportId: row.report_id ?? null,
    targetUserId: row.target_public_id ?? null,
    actionType,
    reasonCode: row.reason_code,
    reason: row.reason,
    durationHours: row.duration_hours == null ? null : Number(row.duration_hours),
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
    reversedAt: row.reversed_at,
    createdByUserId: row.created_by_public_id ?? null,
    createdByUsername: row.created_by_username ?? null,
    createdAt: row.created_at,
  };
}

export function safetyCaseLinkForClient(row: {
  case_id: string;
  linked_case_id: string;
  relation: string;
  created_at: string;
  created_by_public_id?: string | null;
}) {
  return {
    caseId: row.case_id,
    linkedCaseId: row.linked_case_id,
    relation: row.relation,
    createdAt: row.created_at,
    createdByUserId: row.created_by_public_id ?? null,
  };
}

export async function safetyReportedContent(
  env: Env,
  row: TrustSafetyReportRow,
): Promise<{
  kind: "channel_message";
  id: string;
  text: string;
  authorUserId: string | null;
  authorUsername: string;
  createdAt: string;
  editedAt: string | null;
  attachment: { id: string; name: string; mimeType: string; size: number } | null;
} | null> {
  // Only server-stored Hub messages are eligible here. Direct and group
  // messages are available only when the reporter explicitly attached
  // evidence through the Trust & Safety flow.
  if (!(["message", "content", "attachment"] as string[]).includes(row.target_type)) return null;
  if (row.context_type !== "channel" && row.context_type !== "forum") return null;
  const message = await env.DB.prepare(
    `SELECT m.id,m.author_user_id,m.text,m.created_at,m.edited_at,
            m.attachment_id,m.attachment_name,m.attachment_mime,m.attachment_size,
            u.public_id AS author_public_id,u.username AS author_username
     FROM decave_messages m
     JOIN decave_users u ON u.id=m.author_user_id
     WHERE m.id=? LIMIT 1`,
  )
    .bind(row.target_id)
    .first<SafetyReportedMessageRow>();
  if (!message || (row.subject_user_id && message.author_user_id !== row.subject_user_id)) return null;
  return {
    kind: "channel_message",
    id: message.id,
    text: message.text,
    authorUserId: message.author_public_id,
    authorUsername: message.author_username,
    createdAt: message.created_at,
    editedAt: message.edited_at,
    attachment: message.attachment_id
      ? {
          id: message.attachment_id,
          name: message.attachment_name ?? "attachment",
          mimeType: message.attachment_mime ?? "application/octet-stream",
          size: Number(message.attachment_size ?? 0),
        }
      : null,
  };
}

export async function safetyResolveTarget(
  env: Env,
  reporter: UserRow,
  targetType: ReportTargetType,
  targetId: string,
  subjectReference: string,
  contextType: string | null,
): Promise<
  | {
      subject: UserRow | null;
      targetPublicIdSnapshot: string | null;
      targetUsernameSnapshot: string | null;
      hubId: number | null;
      roomId: number | null;
      contextType: string | null;
    }
  | Response
> {
  const userTarget = targetType === "user" || targetType === "profile" || targetType === "voice_participant";
  let subject: UserRow | null = null;
  let hubId: number | null = null;
  let roomId: number | null = null;
  let resolvedContextType = contextType;

  if (userTarget) {
    subject = await userByReference(env.DB, targetId);
    if (!subject || subject.deleted_at || subject.erased_at)
      return json({ error: "The reported user was not found." }, 404);
    if (subject.id === reporter.id) return json({ error: "You cannot report your own account." }, 400);
    if (targetType === "voice_participant") resolvedContextType = contextType ?? "voice";
  } else {
    const channelMessage = await env.DB.prepare(
      "SELECT id,author_user_id,hub_id,room_id FROM decave_messages WHERE id=? LIMIT 1",
    )
      .bind(targetId)
      .first<{ id: string; author_user_id: string; hub_id: number; room_id: number }>();

    if (channelMessage) {
      const room = await getRoom(env.DB, channelMessage.room_id);
      if (!room || !(await dbCanAccessRoom(env.DB, room, reporter.id))) {
        return json({ error: "You do not have access to that message." }, 403);
      }
      subject = await env.DB.prepare("SELECT * FROM decave_users WHERE id=? LIMIT 1")
        .bind(channelMessage.author_user_id)
        .first<UserRow>();
      hubId = channelMessage.hub_id;
      roomId = channelMessage.room_id;
      resolvedContextType = contextType ?? "channel";
    } else {
      const directMessage = await env.DB.prepare(
        "SELECT id,from_user_id,to_user_id FROM decave_direct_messages WHERE id=? LIMIT 1",
      )
        .bind(targetId)
        .first<{ id: string; from_user_id: string; to_user_id: string }>();
      if (directMessage) {
        if (directMessage.from_user_id !== reporter.id && directMessage.to_user_id !== reporter.id) {
          return json({ error: "You do not have access to that private message." }, 403);
        }
        const subjectId =
          directMessage.from_user_id === reporter.id ? directMessage.to_user_id : directMessage.from_user_id;
        subject = await env.DB.prepare("SELECT * FROM decave_users WHERE id=? LIMIT 1")
          .bind(subjectId)
          .first<UserRow>();
        resolvedContextType = contextType ?? "dm";
      } else {
        try {
          await ensureGroupChatSchema(env.DB);
          const groupMessage = await env.DB.prepare(
            "SELECT id,group_id,from_user_id FROM decave_group_chat_messages WHERE id=? LIMIT 1",
          )
            .bind(targetId)
            .first<{ id: string; group_id: string; from_user_id: string }>();
          if (groupMessage) {
            if (!(await isGroupChatMember(env.DB, groupMessage.group_id, reporter.id))) {
              return json({ error: "You do not have access to that group message." }, 403);
            }
            subject = await env.DB.prepare("SELECT * FROM decave_users WHERE id=? LIMIT 1")
              .bind(groupMessage.from_user_id)
              .first<UserRow>();
            resolvedContextType = contextType ?? "group";
          }
        } catch {
          // A reported message may already be deleted. The explicit subject
          // reference below still identifies it for the case.
        }
      }
    }

    if (!subject && subjectReference) {
      subject = await userByReference(env.DB, subjectReference);
    }
    if (!subject) {
      return json({ error: "Include the reported user's DeCave ID for protected content." }, 400);
    }
    if (subject.id === reporter.id) return json({ error: "You cannot report your own content." }, 400);
  }

  return {
    subject,
    targetPublicIdSnapshot: subject ? publicIdOf(subject) || null : null,
    targetUsernameSnapshot: subject?.username ?? null,
    hubId,
    roomId,
    contextType: resolvedContextType,
  };
}

export async function handleTrustSafetyApi(
  request: Request,
  env: Env,
  pathname: string,
  method: string,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (method === "GET" && pathname === "/api/safety/report-key") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    void user;
    const key = await activeTrustSafetyKey(env.DB);
    if (!key)
      return json(
        { error: "Encrypted evidence submission is not configured yet.", code: "EVIDENCE_KEY_UNAVAILABLE" },
        503,
      );
    return json(
      {
        keyId: key.key_id,
        version: key.version,
        algorithm: key.algorithm,
        publicKey: key.public_key,
      },
      200,
      { "Cache-Control": "no-store, private" },
    );
  }

  const ageRoute = pathname === "/api/auth/age";
  if (method === "POST" && ageRoute) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const body = await boundedBodyJson(request, 16 * 1024);
    if (!body) return json({ error: "Age information is too large." }, 413);
    const profile = deriveAgeProfile(body.birthDate);
    if (!profile) return json({ error: "Enter a valid birth date." }, 400);
    await saveAgeProfile(env.DB, user.id, profile);
    await securityEvent(env, user.id, profile.ageStatus === "ineligible" ? "age.ineligible" : "age.confirmed", request);
    if (profile.ageStatus === "ineligible") {
      return json(
        { error: "DeCave accounts are available only to people aged 13 or older.", code: "AGE_RESTRICTED" },
        403,
      );
    }
    return json({ safety: safetyProfileForClient(await getSafetyProfile(env.DB, user.id)) });
  }

  if (method === "GET" && pathname === "/api/safety/reports") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const rows = await env.DB.prepare(
      `SELECT r.*,c.case_number,NULL AS reporter_public_id,NULL AS reporter_username
       FROM decave_reports r JOIN decave_moderation_cases c ON c.id=r.case_id
       WHERE r.reporter_user_id=? ORDER BY r.created_at DESC LIMIT ?`,
    )
      .bind(user.id, safetyReportLimit(url, 50, 100))
      .all<SafetyReportQueryRow>();
    return json({ reports: rows.results.map((row) => reportForClient(row)) }, 200, {
      "Cache-Control": "no-store, private",
    });
  }

  const userReportDetail = idFromPath(pathname, /^\/api\/safety\/reports\/([^/]+)$/);
  if (method === "GET" && userReportDetail) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const row = await safetyReportRow(env, decodeURIComponent(userReportDetail[1]));
    if (!row || row.reporter_user_id !== user.id) return json({ error: "Report not found." }, 404);
    const evidence = await env.DB.prepare(
      `SELECT id,report_id,evidence_type,source_message_id,source_context_type,source_context_id,
              ciphertext_sha256,ciphertext_size,package_version,encryption_version,key_id,created_at
       FROM decave_report_evidence WHERE report_id=? ORDER BY created_at ASC`,
    )
      .bind(row.id)
      .all();
    return json(
      {
        report: reportForClient(row),
        evidence: evidence.results.map((item) => ({
          id: item.id,
          evidenceType: item.evidence_type,
          sourceMessageId: item.source_message_id,
          sourceContextType: item.source_context_type,
          sourceContextId: item.source_context_id,
          ciphertextSha256: item.ciphertext_sha256,
          ciphertextSize: Number(item.ciphertext_size),
          packageVersion: item.package_version,
          encryptionVersion: item.encryption_version,
          keyId: item.key_id,
          createdAt: item.created_at,
        })),
      },
      200,
      { "Cache-Control": "no-store, private" },
    );
  }

  const reportEvidenceRoute = idFromPath(pathname, /^\/api\/safety\/reports\/([^/]+)\/evidence$/);
  if (method === "POST" && reportEvidenceRoute) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const reportId = decodeURIComponent(reportEvidenceRoute[1]);
    const report = await safetyReportRow(env, reportId);
    if (!report || report.reporter_user_id !== user.id) return json({ error: "Report not found." }, 404);
    const maxBytes = EVIDENCE_UPLOAD_LIMITS.requestBytes;
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes)
      return json({ error: "Evidence is too large." }, 413);
    const boundedBytes = await readBoundedEvidence(request, maxBytes);
    if (!boundedBytes) return json({ error: "Evidence is too large." }, 413);
    const bytes = boundedBytes;
    if (!bytes.byteLength) return json({ error: "Evidence is empty." }, 400);

    const expectedHash = (request.headers.get("X-DeCave-Evidence-Sha256") ?? "").trim().toLowerCase();
    if (expectedHash && !/^[a-f0-9]{64}$/.test(expectedHash)) return json({ error: "Evidence hash is invalid." }, 400);
    const hash = await sha256Hex(bytes.buffer as ArrayBuffer);
    if (expectedHash && expectedHash !== hash)
      return json({ error: "Evidence hash does not match the uploaded ciphertext." }, 400);
    const headerKeyId = reportReference(request.headers.get("X-DeCave-Evidence-Key-Id"), 128);

    const evidenceType = request.headers.get("X-DeCave-Evidence-Type") ?? "context";
    if (!(
      evidenceType === "message" ||
      evidenceType === "attachment" ||
      evidenceType === "profile" ||
      evidenceType === "context" ||
      evidenceType === "voice_participant"
    )) {
      return json({ error: "Evidence type is invalid." }, 400);
    }

    const existingEvidence = await env.DB.prepare(
      `SELECT id,ciphertext_sha256,ciphertext_size,key_id
       FROM decave_report_evidence
       WHERE report_id=? AND ciphertext_sha256=? AND deleted_at IS NULL
       ORDER BY created_at ASC LIMIT 1`,
    )
      .bind(reportId, hash)
      .first<{ id: string; ciphertext_sha256: string; ciphertext_size: number; key_id: string }>();
    if (existingEvidence)
      return json(
        {
          evidence: {
            id: existingEvidence.id,
            ciphertextSha256: existingEvidence.ciphertext_sha256,
            ciphertextSize: Number(existingEvidence.ciphertext_size),
            keyId: existingEvidence.key_id,
          },
          unchanged: true,
        },
        200,
      );

    const key = await activeTrustSafetyKey(env.DB);
    if (!key)
      return json(
        { error: "Encrypted evidence submission is not configured yet.", code: "EVIDENCE_KEY_UNAVAILABLE" },
        503,
      );
    if (headerKeyId && headerKeyId !== key.key_id)
      return json({ error: "Evidence key is no longer active. Refresh and try again." }, 409);

    const evidenceId = crypto.randomUUID();
    const objectKey = `safety-evidence/v1/${reportId}/${evidenceId}.bin`;
    const packageVersion =
      reportReference(request.headers.get("X-DeCave-Evidence-Package-Version"), 64) || "report-package-v1";
    const encryptionVersion =
      reportReference(request.headers.get("X-DeCave-Evidence-Encryption-Version"), 64) || "report-envelope-v1";
    const sourceMessageId = reportReference(request.headers.get("X-DeCave-Evidence-Message-Id"), 256) || null;
    const sourceContextType = reportReference(request.headers.get("X-DeCave-Evidence-Context-Type"), 64) || null;
    const sourceContextId = reportReference(request.headers.get("X-DeCave-Evidence-Context-Id"), 256) || null;

    const reservedAt = nowIso();
    const dayAgo = new Date(Date.parse(reservedAt) - 24 * 60 * 60 * 1000).toISOString();
    const hourAgo = new Date(Date.parse(reservedAt) - 60 * 60 * 1000).toISOString();
    let reservationChanges = 0;
    try {
      const reservation = await env.DB.prepare(
        `INSERT INTO decave_report_evidence_upload_reservations
           (id,report_id,user_id,ciphertext_sha256,ciphertext_size,object_key,created_at)
         SELECT ?,?,?,?,?,?,?
         WHERE EXISTS(
           SELECT 1 FROM decave_reports r JOIN decave_users u ON u.id=r.reporter_user_id
           WHERE r.id=? AND r.reporter_user_id=?
             AND u.deleted_at IS NULL AND u.erased_at IS NULL AND u.erasure_started_at IS NULL
         )
           AND ((SELECT COUNT(*) FROM decave_report_evidence e WHERE e.report_id=?)
             + (SELECT COUNT(*) FROM decave_report_evidence_upload_reservations r
                WHERE r.report_id=? AND NOT EXISTS(
                  SELECT 1 FROM decave_report_evidence e WHERE e.object_key=r.object_key
                ))) < ?
           AND ((SELECT COALESCE(SUM(e.ciphertext_size),0) FROM decave_report_evidence e WHERE e.report_id=?)
             + (SELECT COALESCE(SUM(r.ciphertext_size),0) FROM decave_report_evidence_upload_reservations r
                WHERE r.report_id=? AND NOT EXISTS(
                  SELECT 1 FROM decave_report_evidence e WHERE e.object_key=r.object_key
                )) + ?) <= ?
           AND ((SELECT COUNT(*) FROM decave_report_evidence e JOIN decave_reports r ON r.id=e.report_id
                 WHERE r.reporter_user_id=? AND e.created_at>=? AND (e.deleted_at IS NULL OR e.legal_hold=1))
             + (SELECT COUNT(*) FROM decave_report_evidence_upload_reservations r
                WHERE r.user_id=? AND r.created_at>=? AND NOT EXISTS(
                  SELECT 1 FROM decave_report_evidence e WHERE e.object_key=r.object_key
                ))) < ?
           AND ((SELECT COALESCE(SUM(e.ciphertext_size),0) FROM decave_report_evidence e
                 JOIN decave_reports r ON r.id=e.report_id
                 WHERE r.reporter_user_id=? AND e.created_at>=? AND (e.deleted_at IS NULL OR e.legal_hold=1))
             + (SELECT COALESCE(SUM(r.ciphertext_size),0) FROM decave_report_evidence_upload_reservations r
                WHERE r.user_id=? AND r.created_at>=? AND NOT EXISTS(
                  SELECT 1 FROM decave_report_evidence e WHERE e.object_key=r.object_key
                )) + ?) <= ?
           AND ((SELECT COUNT(*) FROM decave_report_evidence e JOIN decave_reports r ON r.id=e.report_id
                 WHERE r.reporter_user_id=? AND e.created_at>=? AND (e.deleted_at IS NULL OR e.legal_hold=1))
             + (SELECT COUNT(*) FROM decave_report_evidence_upload_reservations r
                WHERE r.user_id=? AND r.created_at>=? AND NOT EXISTS(
                  SELECT 1 FROM decave_report_evidence e WHERE e.object_key=r.object_key
                ))) < ?`,
      )
        .bind(
          evidenceId,
          reportId,
          user.id,
          hash,
          bytes.byteLength,
          objectKey,
          reservedAt,
          reportId,
          user.id,
          reportId,
          reportId,
          EVIDENCE_UPLOAD_LIMITS.reportItems,
          reportId,
          reportId,
          bytes.byteLength,
          EVIDENCE_UPLOAD_LIMITS.reportBytes,
          user.id,
          dayAgo,
          user.id,
          dayAgo,
          EVIDENCE_UPLOAD_LIMITS.userItemsPerDay,
          user.id,
          dayAgo,
          user.id,
          dayAgo,
          bytes.byteLength,
          EVIDENCE_UPLOAD_LIMITS.userBytesPerDay,
          user.id,
          hourAgo,
          user.id,
          hourAgo,
          EVIDENCE_UPLOAD_LIMITS.userItemsPerHour,
        )
        .run();
      reservationChanges = Number(reservation.meta.changes ?? 0);
    } catch (error) {
      const existingReservation = await env.DB.prepare(
        `SELECT id,created_at FROM decave_report_evidence_upload_reservations
         WHERE report_id=? AND ciphertext_sha256=? LIMIT 1`,
      )
        .bind(reportId, hash)
        .first<{ id: string; created_at: string }>();
      const duplicate = await env.DB.prepare(
        `SELECT id,ciphertext_size,key_id FROM decave_report_evidence
         WHERE report_id=? AND ciphertext_sha256=? AND deleted_at IS NULL LIMIT 1`,
      )
        .bind(reportId, hash)
        .first<{ id: string; ciphertext_size: number; key_id: string }>();
      if (duplicate)
        return json(
          {
            evidence: {
              id: duplicate.id,
              ciphertextSha256: hash,
              ciphertextSize: Number(duplicate.ciphertext_size),
              keyId: duplicate.key_id,
            },
            unchanged: true,
          },
          200,
        );
      if (existingReservation) return json({ error: "This evidence upload is already in progress." }, 409);
      throw error;
    }

    if (reservationChanges !== 1) {
      const activeReport = await env.DB.prepare(
        `SELECT 1 AS active FROM decave_reports r JOIN decave_users u ON u.id=r.reporter_user_id
         WHERE r.id=? AND r.reporter_user_id=? AND u.deleted_at IS NULL
           AND u.erased_at IS NULL AND u.erasure_started_at IS NULL LIMIT 1`,
      )
        .bind(reportId, user.id)
        .first<{ active: number }>();
      if (!activeReport) return json({ error: "Report not found." }, 404);
      const existingReservation = await env.DB.prepare(
        `SELECT id FROM decave_report_evidence_upload_reservations
         WHERE report_id=? AND ciphertext_sha256=? LIMIT 1`,
      )
        .bind(reportId, hash)
        .first<{ id: string }>();
      if (existingReservation) return json({ error: "This evidence upload is already in progress." }, 409);
      return json({ error: "Evidence upload quota exceeded." }, 429);
    }

    const compensateReservation = async (): Promise<boolean> => {
      try {
        await env.MEDIA.delete(objectKey);
        await env.DB.prepare("DELETE FROM decave_report_evidence_upload_reservations WHERE id=?")
          .bind(evidenceId)
          .run();
        return true;
      } catch {
        return false;
      }
    };
    try {
      await env.MEDIA.put(objectKey, bytes, {
        httpMetadata: { contentType: "application/octet-stream", cacheControl: "no-store" },
      });
    } catch {
      await compensateReservation();
      return json({ error: "Evidence storage is temporarily unavailable." }, 503);
    }

    const evidenceInsert = env.DB.prepare(
      `INSERT INTO decave_report_evidence
       (id,report_id,case_id,evidence_type,source_message_id,source_context_type,
        source_context_id,object_key,ciphertext_sha256,ciphertext_size,package_version,
        encryption_version,key_id,created_at,retention_expires_at,legal_hold,deleted_at)
       SELECT ?,r.id,r.case_id,?,?,?,?,?,?,?,?,?,?,?,?,0,NULL
       FROM decave_report_evidence_upload_reservations reservation
       JOIN decave_reports r ON r.id=reservation.report_id
       JOIN decave_users u ON u.id=r.reporter_user_id
       WHERE reservation.id=? AND reservation.report_id=? AND reservation.user_id=?
         AND reservation.ciphertext_sha256=? AND reservation.ciphertext_size=?
         AND reservation.object_key=? AND reservation.created_at>?
         AND r.reporter_user_id=? AND u.deleted_at IS NULL AND u.erased_at IS NULL
         AND u.erasure_started_at IS NULL`,
    ).bind(
      evidenceId,
      evidenceType,
      sourceMessageId,
      sourceContextType,
      sourceContextId,
      objectKey,
      hash,
      bytes.byteLength,
      packageVersion,
      encryptionVersion,
      key.key_id,
      reservedAt,
      new Date(Date.now() + PRIVACY_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      evidenceId,
      reportId,
      user.id,
      hash,
      bytes.byteLength,
      objectKey,
      new Date(Date.now() - EVIDENCE_UPLOAD_LIMITS.reservationLifetimeMs).toISOString(),
      user.id,
    );
    const auditRay = (request.headers.get("CF-Ray") ?? "").slice(0, 80) || null;
    const auditCountry = (request.headers.get("CF-IPCountry") ?? "").slice(0, 8) || null;
    const auditId = crypto.randomUUID();
    try {
      const commit = await env.DB.batch([
        evidenceInsert,
        env.DB.prepare(
          `INSERT INTO decave_moderation_audit_log
           (id,actor_user_id,case_id,report_id,action_id,evidence_id,event_type,
            old_value_json,new_value_json,reason,request_ray,request_country,created_at)
           SELECT ?,?,?,?,?,?,'evidence.added','{}',?,'',?,?,?
           WHERE EXISTS(SELECT 1 FROM decave_report_evidence WHERE id=?)`,
        ).bind(
          auditId,
          user.id,
          report.case_id,
          reportId,
          null,
          evidenceId,
          JSON.stringify({ evidenceType, ciphertextSize: bytes.byteLength, keyId: key.key_id }).slice(0, 2000),
          auditRay,
          auditCountry,
          nowIso(),
          evidenceId,
        ),
      ]);
      if (Number(commit[0]?.meta.changes ?? 0) !== 1) {
        const committed = await env.DB.prepare("SELECT 1 AS present FROM decave_report_evidence WHERE id=? LIMIT 1")
          .bind(evidenceId)
          .first<{ present: number }>();
        if (!committed) {
          await compensateReservation();
          return json({ error: "The report changed while evidence was uploading." }, 409);
        }
      }
      await env.DB.prepare("DELETE FROM decave_report_evidence_upload_reservations WHERE id=?").bind(evidenceId).run();
    } catch (error) {
      const committed = await env.DB.prepare("SELECT 1 AS present FROM decave_report_evidence WHERE id=? LIMIT 1")
        .bind(evidenceId)
        .first<{ present: number }>()
        .catch(() => null);
      if (!committed) {
        await compensateReservation();
        throw error;
      }
      await env.DB.prepare("DELETE FROM decave_report_evidence_upload_reservations WHERE id=?")
        .bind(evidenceId)
        .run()
        .catch(() => undefined);
    }
    return json(
      { evidence: { id: evidenceId, ciphertextSha256: hash, ciphertextSize: bytes.byteLength, keyId: key.key_id } },
      201,
    );
  }

  const blockDetail = idFromPath(pathname, /^\/api\/safety\/blocks\/([^/]+)$/);
  if ((method === "PUT" || method === "POST" || method === "DELETE") && blockDetail) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const target = await userByReference(env.DB, decodeURIComponent(blockDetail[1]));
    if (!target || target.id === user.id || target.deleted_at || target.erased_at)
      return json({ error: "User not found." }, 404);
    if (method === "DELETE") {
      await env.DB.prepare("DELETE FROM decave_user_blocks WHERE blocker_user_id=? AND blocked_user_id=?")
        .bind(user.id, target.id)
        .run();
      return json({ success: true, blocked: false, userId: publicIdOf(target) });
    }
    await env.DB.prepare(
      "INSERT OR IGNORE INTO decave_user_blocks(blocker_user_id,blocked_user_id,created_at) VALUES(?,?,?)",
    )
      .bind(user.id, target.id, nowIso())
      .run();
    return json({ success: true, blocked: true, userId: publicIdOf(target) }, 201);
  }

  if (method === "GET" && pathname === "/api/safety/blocks") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const rows = await env.DB.prepare(
      `SELECT u.public_id,u.username,b.created_at
       FROM decave_user_blocks b JOIN decave_users u ON u.id=b.blocked_user_id
       WHERE b.blocker_user_id=? ORDER BY b.created_at DESC`,
    )
      .bind(user.id)
      .all<{ public_id: string | null; username: string; created_at: string }>();
    return json(
      {
        blocks: rows.results
          .filter((row) => row.public_id)
          .map((row) => ({ userId: row.public_id, username: row.username, createdAt: row.created_at })),
      },
      200,
      { "Cache-Control": "no-store, private" },
    );
  }

  const muteDetail = idFromPath(pathname, /^\/api\/safety\/mutes\/([^/]+)$/);
  if ((method === "PUT" || method === "POST" || method === "DELETE") && muteDetail) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const target = await userByReference(env.DB, decodeURIComponent(muteDetail[1]));
    if (!target || target.id === user.id || target.deleted_at || target.erased_at)
      return json({ error: "User not found." }, 404);
    if (method === "DELETE") {
      await env.DB.prepare("DELETE FROM decave_user_mutes WHERE muter_user_id=? AND muted_user_id=?")
        .bind(user.id, target.id)
        .run();
      return json({ success: true, muted: false, userId: publicIdOf(target) });
    }
    await env.DB.prepare(
      "INSERT OR IGNORE INTO decave_user_mutes(muter_user_id,muted_user_id,created_at) VALUES(?,?,?)",
    )
      .bind(user.id, target.id, nowIso())
      .run();
    return json({ success: true, muted: true, userId: publicIdOf(target) }, 201);
  }

  if (pathname === "/api/read-state" && method === "GET") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const summary = await unreadSummary(env.DB, user.id, user.username, async (roomId) => {
      const room = await getRoom(env.DB, roomId);
      return !!room && (await canAccessRoom(env.DB, room, user.id));
    });
    return json(summary, 200, { "Cache-Control": "no-store, private" });
  }

  if (pathname === "/api/read-state" && method === "PUT") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const body = await bodyJson(request);
    if (body.scope === "room") {
      const roomId = Number(body.channelId);
      const room = Number.isSafeInteger(roomId) && roomId > 0 ? await getRoom(env.DB, roomId) : null;
      if (!room || !(await canAccessRoom(env.DB, room, user.id))) return json({ error: "Room not found." }, 404);
      await markRead(env.DB, user.id, "room", String(roomId));
    } else if (body.scope === "dm") {
      const other = typeof body.userId === "string" ? await userByReference(env.DB, body.userId) : null;
      if (!other || other.id === user.id) return json({ error: "User not found." }, 404);
      await markRead(env.DB, user.id, "dm", other.id);
      // Lets the sender's open chat flip "Sent" to "Seen" without reloading.
      await realtimeBroadcast(
        env,
        { type: "DM_READ", readerId: publicIdOf(user), readAt: nowIso() },
        { userIds: [other.id] },
      ).catch(() => undefined);
    } else {
      return json({ error: "Scope must be room or dm." }, 400);
    }
    return json({ success: true });
  }

  if (pathname === "/api/push-tokens" && (method === "PUT" || method === "DELETE")) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const sessionToken = rawSessionTokenFromRequest(request);
    if (!sessionToken) return json({ error: "An active session is required." }, 401);
    const sessionHash = tokenHash(sessionToken);
    const body = await bodyJson(request);
    if (!isExpoPushToken(body.token)) return json({ error: "Invalid push token." }, 400);
    if (method === "DELETE") await removePushToken(env, user.id, sessionHash, body.token);
    else
      await registerPushToken(
        env,
        user.id,
        sessionHash,
        body.token,
        typeof body.platform === "string" ? body.platform : "ios",
      );
    return json({ success: true });
  }

  if (method === "GET" && pathname === "/api/safety/mutes") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const rows = await env.DB.prepare(
      `SELECT u.public_id,u.username,m.created_at
       FROM decave_user_mutes m JOIN decave_users u ON u.id=m.muted_user_id
       WHERE m.muter_user_id=? ORDER BY m.created_at DESC`,
    )
      .bind(user.id)
      .all<{ public_id: string | null; username: string; created_at: string }>();
    return json(
      {
        mutes: rows.results
          .filter((row) => row.public_id)
          .map((row) => ({ userId: row.public_id, username: row.username, createdAt: row.created_at })),
      },
      200,
      { "Cache-Control": "no-store, private" },
    );
  }

  const reportCreate = pathname === "/api/safety/reports" && method === "POST";
  if (reportCreate) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const limited = await env.AUTH_RATE_LIMITER.limit({ key: `trust-safety-report:${user.id}` });
    if (!limited.success) return json({ error: "Too many reports submitted. Try again shortly." }, 429);
    const body = await boundedBodyJson(request, 32 * 1024);
    if (!body) return json({ error: "Report is too large." }, 413);
    const targetType = body.targetType;
    const category = body.category;
    if (!isReportTargetType(targetType))
      return json({ error: `Target type must be one of: ${REPORT_TARGET_TYPES.join(", ")}.` }, 400);
    if (!isReportCategory(category)) return json({ error: `Choose a report category.` }, 400);
    const targetId = reportReference(body.targetId);
    if (!targetId) return json({ error: "Choose the content or user to report." }, 400);
    const contextType = reportReference(body.contextType, 64) || null;
    const contextId = reportReference(body.contextId, 256) || null;
    const contextLabel = reportReference(body.contextLabel, 160) || null;
    const subjectReference = reportReference(body.subjectUserId ?? body.reportedUserId, 128);
    const resolved = await safetyResolveTarget(env, user, targetType, targetId, subjectReference, contextType);
    if (resolved instanceof Response) return resolved;
    const requestedUrgency = isReportUrgency(body.urgency) ? body.urgency : null;
    const report = await createTrustSafetyReport(env.DB, {
      reporter: user,
      subject: resolved.subject,
      targetType,
      targetId,
      targetPublicIdSnapshot: resolved.targetPublicIdSnapshot,
      targetUsernameSnapshot: resolved.targetUsernameSnapshot,
      contextType: resolved.contextType,
      contextId,
      contextLabel,
      hubId: Number.isInteger(Number(body.hubId)) && Number(body.hubId) > 0 ? Number(body.hubId) : resolved.hubId,
      roomId: Number.isInteger(Number(body.roomId)) && Number(body.roomId) > 0 ? Number(body.roomId) : resolved.roomId,
      category,
      description: reportDescription(body.description),
      requestedUrgency,
      clientVersion: reportReference(body.clientVersion, 80) || null,
    });
    await env.DB.prepare(
      `INSERT INTO decave_moderation_audit_log
       (id,actor_user_id,case_id,report_id,event_type,new_value_json,created_at)
       VALUES(?,?,?,?,?,?,?)`,
    )
      .bind(
        crypto.randomUUID(),
        user.id,
        report.caseId,
        report.reportId,
        "report.submitted",
        JSON.stringify({ category, urgency: report.urgencyEffective, targetType }),
        nowIso(),
      )
      .run();
    return json(
      {
        report: {
          id: report.reportId,
          caseId: report.caseId,
          caseNumber: report.caseNumber,
          urgencyRecommended: report.urgencyRecommended,
          urgency: report.urgencyEffective,
          status: "submitted",
        },
      },
      201,
    );
  }

  const adminPrefix = "/api/admin/trust-safety";
  if (!pathname.startsWith(adminPrefix)) return null;
  const owner = await requirePlatformOwner(request, env);
  if (owner instanceof Response) return owner;

  if (method === "GET" && pathname === `${adminPrefix}/overview`) {
    const [open, critical, submitted, evidence] = await Promise.all([
      env.DB.prepare(
        "SELECT COUNT(*) AS count FROM decave_moderation_cases WHERE status NOT IN ('closed','no_violation')",
      ).first<{ count: number }>(),
      env.DB.prepare(
        "SELECT COUNT(*) AS count FROM decave_moderation_cases WHERE critical=1 AND status NOT IN ('closed','no_violation')",
      ).first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM decave_reports WHERE status='submitted'").first<{
        count: number;
      }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM decave_report_evidence WHERE deleted_at IS NULL").first<{
        count: number;
      }>(),
    ]);
    return json(
      {
        generatedAt: nowIso(),
        openCases: Number(open?.count ?? 0),
        criticalCases: Number(critical?.count ?? 0),
        submittedReports: Number(submitted?.count ?? 0),
        evidenceObjects: Number(evidence?.count ?? 0),
      },
      200,
      { "Cache-Control": "no-store, private" },
    );
  }

  if (method === "GET" && (pathname === `${adminPrefix}/reports` || pathname === `${adminPrefix}/critical`)) {
    const conditions: string[] = [];
    const binds: unknown[] = [];
    if (pathname.endsWith("/critical")) conditions.push("(r.urgency_effective='critical' OR c.critical=1)");
    const status = url.searchParams.get("status");
    if (isReportStatus(status)) {
      conditions.push("r.status=?");
      binds.push(status);
    }
    const urgency = url.searchParams.get("urgency");
    if (isReportUrgency(urgency)) {
      conditions.push("r.urgency_effective=?");
      binds.push(urgency);
    }
    const category = url.searchParams.get("category");
    if (isReportCategory(category)) {
      conditions.push("r.category=?");
      binds.push(category);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = await env.DB.prepare(
      `SELECT r.*,c.case_number,NULL AS reporter_public_id,NULL AS reporter_username
       FROM decave_reports r JOIN decave_moderation_cases c ON c.id=r.case_id
       ${where} ORDER BY c.critical DESC, r.created_at DESC LIMIT ?`,
    )
      .bind(...binds, safetyReportLimit(url, 75, 150))
      .all<SafetyReportQueryRow>();
    return json({ reports: rows.results.map((row) => reportForClient(row, false)) }, 200, {
      "Cache-Control": "no-store, private",
    });
  }

  const adminReportDetail = idFromPath(
    pathname,
    new RegExp(`^${adminPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/reports/([^/]+)$`),
  );
  if (method === "GET" && adminReportDetail) {
    const row = await safetyReportRow(env, decodeURIComponent(adminReportDetail[1]));
    if (!row) return json({ error: "Report not found." }, 404);
    const revealReporter = url.searchParams.get("revealReporter") === "1";
    if (revealReporter) {
      const reauthError = await ownerRequireReauth(request, env, owner.id);
      if (reauthError) return reauthError;
    }
    await trustSafetyAuditStatement(env.DB, {
      actorUserId: owner.id,
      caseId: row.case_id,
      reportId: row.id,
      eventType: "report.viewed",
      newValue: { revealReporter },
      request,
    }).run();
    const evidence = await env.DB.prepare(
      `SELECT id,evidence_type,source_message_id,source_context_type,source_context_id,
              ciphertext_sha256,ciphertext_size,package_version,encryption_version,key_id,created_at
       FROM decave_report_evidence WHERE report_id=? AND deleted_at IS NULL ORDER BY created_at ASC`,
    )
      .bind(row.id)
      .all<SafetyEvidenceQueryRow>();
    return json(
      {
        report: { ...reportForClient(row, revealReporter), reportedContent: await safetyReportedContent(env, row) },
        evidence: evidence.results.map(safetyEvidenceForClient),
      },
      200,
      { "Cache-Control": "no-store, private" },
    );
  }

  if (method === "GET" && pathname === `${adminPrefix}/cases`) {
    const status = url.searchParams.get("status");
    const conditions = isReportStatus(status) ? "WHERE c.status=?" : "";
    const binds = isReportStatus(status) ? [status] : [];
    const rows = await env.DB.prepare(
      `SELECT c.*,owner.public_id AS assigned_owner_public_id,owner.username AS assigned_owner_username
       FROM decave_moderation_cases c LEFT JOIN decave_users owner ON owner.id=c.assigned_owner_user_id
       ${conditions} ORDER BY c.critical DESC,c.updated_at DESC LIMIT ?`,
    )
      .bind(...binds, safetyReportLimit(url, 75, 150))
      .all<SafetyCaseQueryRow>();
    return json({ cases: rows.results.map(caseForClient) }, 200, { "Cache-Control": "no-store, private" });
  }

  const adminCaseDetail = idFromPath(
    pathname,
    new RegExp(`^${adminPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/cases/([^/]+)$`),
  );
  if (method === "GET" && adminCaseDetail) {
    const caseId = decodeURIComponent(adminCaseDetail[1]);
    const caseRow = await safetyCaseRow(env, caseId);
    if (!caseRow) return json({ error: "Case not found." }, 404);
    await trustSafetyAuditStatement(env.DB, {
      actorUserId: owner.id,
      caseId,
      eventType: "case.viewed",
      request,
    }).run();
    const [reports, notes, actions, links, evidence] = await Promise.all([
      env.DB.prepare(
        `SELECT r.*,c.case_number,reporter.public_id AS reporter_public_id,reporter.username AS reporter_username
         FROM decave_reports r JOIN decave_moderation_cases c ON c.id=r.case_id
         LEFT JOIN decave_users reporter ON reporter.id=r.reporter_user_id
         WHERE r.case_id=? ORDER BY r.created_at ASC`,
      )
        .bind(caseId)
        .all<SafetyReportQueryRow>(),
      env.DB.prepare(
        `SELECT n.id,n.note,n.created_at,u.public_id AS author_public_id,u.username AS author_username
         FROM decave_moderation_case_notes n JOIN decave_users u ON u.id=n.author_user_id
         WHERE n.case_id=? ORDER BY n.created_at DESC`,
      )
        .bind(caseId)
        .all(),
      env.DB.prepare(
        `SELECT a.*,target.public_id AS target_public_id,actor.public_id AS created_by_public_id,actor.username AS created_by_username
         FROM decave_moderation_actions a
         LEFT JOIN decave_users target ON target.id=a.target_user_id
         LEFT JOIN decave_users actor ON actor.id=a.created_by_user_id
         WHERE a.case_id=? ORDER BY a.created_at DESC`,
      )
        .bind(caseId)
        .all(),
      env.DB.prepare(
        `SELECT l.case_id,l.linked_case_id,l.relation,l.created_at,u.public_id AS created_by_public_id
         FROM decave_case_links l JOIN decave_users u ON u.id=l.created_by_user_id
         WHERE l.case_id=? OR l.linked_case_id=? ORDER BY l.created_at DESC`,
      )
        .bind(caseId, caseId)
        .all(),
      env.DB.prepare(
        `SELECT id,report_id,evidence_type,source_message_id,source_context_type,source_context_id,
                ciphertext_sha256,ciphertext_size,package_version,encryption_version,key_id,created_at
         FROM decave_report_evidence WHERE case_id=? AND deleted_at IS NULL ORDER BY created_at ASC`,
      )
        .bind(caseId)
        .all(),
    ]);
    const caseReports = await Promise.all(
      reports.results.map(async (row) => ({
        ...reportForClient(row, false),
        reportedContent: await safetyReportedContent(env, row),
      })),
    );
    return json(
      {
        case: caseForClient(caseRow),
        reports: caseReports,
        notes: notes.results.map((row) =>
          safetyCaseNoteForClient(
            row as {
              id: string;
              note: string;
              created_at: string;
              author_public_id?: string | null;
              author_username?: string | null;
            },
          ),
        ),
        actions: actions.results.map((row) =>
          safetyActionForClient(
            row as {
              id: string;
              case_id: string;
              report_id?: string | null;
              target_public_id?: string | null;
              action_type: string;
              reason_code: string;
              reason: string;
              duration_hours: number | null;
              starts_at: string;
              expires_at: string | null;
              reversed_at: string | null;
              created_by_public_id?: string | null;
              created_by_username?: string | null;
              created_at: string;
            },
          ),
        ),
        links: links.results.map((row) =>
          safetyCaseLinkForClient(
            row as {
              case_id: string;
              linked_case_id: string;
              relation: string;
              created_at: string;
              created_by_public_id?: string | null;
            },
          ),
        ),
        evidence: evidence.results.map((row) => safetyEvidenceForClient(row as SafetyEvidenceQueryRow)),
      },
      200,
      { "Cache-Control": "no-store, private" },
    );
  }

  const reportStatusRoute = idFromPath(
    pathname,
    new RegExp(`^${adminPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/reports/([^/]+)/status$`),
  );
  if (method === "POST" && reportStatusRoute) {
    const reauthError = await ownerRequireReauth(request, env, owner.id);
    if (reauthError) return reauthError;
    const report = await safetyReportRow(env, decodeURIComponent(reportStatusRoute[1]));
    if (!report) return json({ error: "Report not found." }, 404);
    const body = await boundedBodyJson(request, 16 * 1024);
    if (!body || !isReportStatus(body.status))
      return json({ error: `Status must be one of: ${REPORT_STATUSES.join(", ")}.` }, 400);
    const resolutionCode = reportReference(body.resolutionCode, 80) || null;
    const resolutionNotes = reportDescription(body.resolutionNotes);
    const closedAt =
      body.status === "closed" || body.status === "no_violation" || body.status === "action_taken" ? nowIso() : null;
    await env.DB.batch([
      env.DB.prepare("UPDATE decave_reports SET status=?,updated_at=?,closed_at=? WHERE id=?").bind(
        body.status,
        nowIso(),
        closedAt,
        report.id,
      ),
      env.DB.prepare(
        "UPDATE decave_moderation_cases SET status=?,resolution_code=COALESCE(?,resolution_code),resolution_notes=CASE WHEN ?<>'' THEN ? ELSE resolution_notes END,updated_at=?,closed_at=? WHERE id=?",
      ).bind(body.status, resolutionCode, resolutionNotes, resolutionNotes, nowIso(), closedAt, report.case_id),
      trustSafetyAuditStatement(env.DB, {
        actorUserId: owner.id,
        caseId: report.case_id,
        reportId: report.id,
        eventType: "status.changed",
        oldValue: { status: report.status },
        newValue: { status: body.status, resolutionCode },
        reason: resolutionNotes,
        request,
      }),
    ]);
    return json({ success: true, status: body.status });
  }

  const reportUrgencyRoute = idFromPath(
    pathname,
    new RegExp(`^${adminPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/reports/([^/]+)/urgency$`),
  );
  if (method === "POST" && reportUrgencyRoute) {
    const reauthError = await ownerRequireReauth(request, env, owner.id);
    if (reauthError) return reauthError;
    const report = await safetyReportRow(env, decodeURIComponent(reportUrgencyRoute[1]));
    if (!report) return json({ error: "Report not found." }, 404);
    const body = await boundedBodyJson(request, 16 * 1024);
    if (!body || !isReportUrgency(body.urgency))
      return json({ error: `Urgency must be one of: ${REPORT_URGENCIES.join(", ")}.` }, 400);
    const reason = reportDescription(body.reason);
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE decave_reports SET urgency_effective=?,urgency_source='owner',updated_at=? WHERE id=?",
      ).bind(body.urgency, nowIso(), report.id),
      env.DB.prepare(
        "UPDATE decave_moderation_cases SET urgency_effective=?,urgency_source='owner',critical=CASE WHEN ?='critical' THEN 1 ELSE critical END,updated_at=? WHERE id=?",
      ).bind(body.urgency, body.urgency, nowIso(), report.case_id),
      trustSafetyAuditStatement(env.DB, {
        actorUserId: owner.id,
        caseId: report.case_id,
        reportId: report.id,
        eventType: "urgency.overridden",
        oldValue: { urgency: report.urgency_effective },
        newValue: { urgency: body.urgency },
        reason,
        request,
      }),
    ]);
    return json({ success: true, urgency: body.urgency });
  }

  const caseNoteRoute = idFromPath(
    pathname,
    new RegExp(`^${adminPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/cases/([^/]+)/notes$`),
  );
  if (method === "POST" && caseNoteRoute) {
    const reauthError = await ownerRequireReauth(request, env, owner.id);
    if (reauthError) return reauthError;
    const caseId = decodeURIComponent(caseNoteRoute[1]);
    if (!(await safetyCaseRow(env, caseId))) return json({ error: "Case not found." }, 404);
    const body = await boundedBodyJson(request, 16 * 1024);
    const note = reportDescription(body?.note);
    if (!note) return json({ error: "Note cannot be empty." }, 400);
    const noteId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO decave_moderation_case_notes(id,case_id,author_user_id,note,created_at) VALUES(?,?,?,?,?)",
      ).bind(noteId, caseId, owner.id, note, nowIso()),
      trustSafetyAuditStatement(env.DB, {
        actorUserId: owner.id,
        caseId,
        eventType: "case.note_added",
        newValue: { noteId },
        request,
      }),
    ]);
    return json({ success: true, noteId }, 201);
  }

  const caseLinkRoute = idFromPath(
    pathname,
    new RegExp(`^${adminPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/cases/([^/]+)/link$`),
  );
  if (method === "POST" && caseLinkRoute) {
    const reauthError = await ownerRequireReauth(request, env, owner.id);
    if (reauthError) return reauthError;
    const caseId = decodeURIComponent(caseLinkRoute[1]);
    const body = await boundedBodyJson(request, 16 * 1024);
    const linkedCaseId = reportReference(body?.linkedCaseId, 128);
    if (!linkedCaseId || linkedCaseId === caseId) return json({ error: "Choose a different case to link." }, 400);
    if (!(await safetyCaseRow(env, caseId)) || !(await safetyCaseRow(env, linkedCaseId)))
      return json({ error: "Case not found." }, 404);
    const [first, second] = [caseId, linkedCaseId].sort();
    const relation = body?.relation === "duplicate" || body?.relation === "escalated_from" ? body.relation : "related";
    await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO decave_case_links(case_id,linked_case_id,relation,created_by_user_id,created_at) VALUES(?,?,?,?,?)",
      ).bind(first, second, relation, owner.id, nowIso()),
      trustSafetyAuditStatement(env.DB, {
        actorUserId: owner.id,
        caseId,
        eventType: "case.linked",
        newValue: { linkedCaseId: second, relation },
        request,
      }),
    ]);
    return json({ success: true, caseId: first, linkedCaseId: second, relation });
  }

  const caseActionRoute = idFromPath(
    pathname,
    new RegExp(`^${adminPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/cases/([^/]+)/actions$`),
  );
  if (method === "POST" && caseActionRoute) {
    const reauthError = await ownerRequireReauth(request, env, owner.id);
    if (reauthError) return reauthError;
    const caseId = decodeURIComponent(caseActionRoute[1]);
    const caseRow = await safetyCaseRow(env, caseId);
    if (!caseRow) return json({ error: "Case not found." }, 404);
    const body = await boundedBodyJson(request, 16 * 1024);
    const actionType = body?.actionType;
    if (
      actionType !== "warning" &&
      actionType !== "suspend" &&
      actionType !== "unsuspend" &&
      actionType !== "restrict" &&
      actionType !== "no_action_taken"
    )
      return json({ error: "This action is not available in Phase 1." }, 400);
    const noActionTaken = actionType === "no_action_taken";
    const storedActionType = noActionTaken ? "warning" : actionType;
    const storedReasonCode = noActionTaken ? "no_action_taken" : "";
    const finalStatus = noActionTaken ? "no_violation" : "action_taken";
    const reason = reportDescription(body?.reason);
    if (!reason) return json({ error: "Action reason is required." }, 400);
    const targetReference = reportReference(body?.targetUserId, 128);
    const target = targetReference
      ? await userByReference(env.DB, targetReference)
      : caseRow.primary_subject_user_id
        ? await env.DB.prepare("SELECT * FROM decave_users WHERE id=? LIMIT 1")
            .bind(caseRow.primary_subject_user_id)
            .first<UserRow>()
        : null;
    if (
      (actionType === "suspend" || actionType === "unsuspend") &&
      (!target || target.id === owner.id || target.platform_role === "owner")
    )
      return json({ error: "This account cannot be changed by this action." }, 409);
    const durationRaw = Number(body?.durationHours);
    const durationHours =
      actionType === "suspend" && Number.isFinite(durationRaw) && durationRaw > 0
        ? Math.min(8760, Math.trunc(durationRaw))
        : null;
    const startsAt = nowIso();
    const expiresAt = durationHours ? new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString() : null;
    const actionId = crypto.randomUUID();
    const updates: D1PreparedStatement[] = [
      env.DB.prepare(
        `INSERT INTO decave_moderation_actions
         (id,case_id,report_id,target_user_id,action_type,reason_code,reason,duration_hours,starts_at,expires_at,reversed_at,created_by_user_id,created_at)
         VALUES(?,?,NULL,?,?,?,?,?,?,?,NULL,?,?)`,
      ).bind(
        actionId,
        caseId,
        target?.id ?? caseRow.primary_subject_user_id,
        storedActionType,
        storedReasonCode,
        reason,
        durationHours,
        startsAt,
        expiresAt,
        owner.id,
        startsAt,
      ),
      trustSafetyAuditStatement(env.DB, {
        actorUserId: owner.id,
        caseId,
        actionId,
        eventType: "action.created",
        newValue: { actionType, targetUserId: target ? publicIdOf(target) : null, durationHours },
        reason,
        request,
      }),
    ];
    if (actionType === "suspend" && target) {
      updates.push(
        env.DB.prepare("UPDATE decave_users SET suspended_at=?,suspended_until=?,suspension_reason=? WHERE id=?").bind(
          startsAt,
          expiresAt,
          reason.slice(0, 300),
          target.id,
        ),
      );
      if (await streamerMigrationExists(env.DB)) {
        const memberships = await env.DB.prepare("SELECT hub_id FROM decave_hub_members WHERE user_id=?")
          .bind(target.id)
          .all<{ hub_id: number }>();
        for (const membership of memberships.results) {
          updates.push(...streamerRevokeParticipantStatements(env.DB, membership.hub_id, target.id));
        }
      }
    } else if (actionType === "unsuspend" && target) {
      updates.push(
        env.DB.prepare(
          "UPDATE decave_users SET suspended_at=NULL,suspended_until=NULL,suspension_reason='' WHERE id=?",
        ).bind(target.id),
      );
    }
    updates.push(
      env.DB.prepare(
        "UPDATE decave_reports SET status=?,updated_at=?,closed_at=? WHERE case_id=? AND status NOT IN ('closed','no_violation')",
      ).bind(finalStatus, startsAt, startsAt, caseId),
      env.DB.prepare("UPDATE decave_moderation_cases SET status=?,updated_at=?,closed_at=? WHERE id=?").bind(
        finalStatus,
        startsAt,
        noActionTaken ? startsAt : null,
        caseId,
      ),
    );
    await env.DB.batch(updates);
    if (target && (actionType === "suspend" || actionType === "unsuspend")) {
      await platformAudit(env, owner.id, `trust_safety.${actionType}`, request, target.id, { caseId, actionId });
      if (actionType === "suspend") await revokeAccountSessions(env, target.id, "trust_safety_suspension");
    }
    return json({ success: true, actionId, actionType, targetUserId: target ? publicIdOf(target) : null });
  }

  const subjectHistoryRoute = idFromPath(
    pathname,
    new RegExp(`^${adminPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/users/([^/]+)/history$`),
  );
  if (method === "GET" && subjectHistoryRoute) {
    const target = await userByReference(env.DB, decodeURIComponent(subjectHistoryRoute[1]));
    if (!target) return json({ error: "User not found." }, 404);
    const [reports, cases, actions] = await Promise.all([
      env.DB.prepare(
        "SELECT r.*,c.case_number,NULL AS reporter_public_id,NULL AS reporter_username FROM decave_reports r JOIN decave_moderation_cases c ON c.id=r.case_id WHERE r.subject_user_id=? ORDER BY r.created_at DESC LIMIT 100",
      )
        .bind(target.id)
        .all<SafetyReportQueryRow>(),
      env.DB.prepare(
        "SELECT c.*,owner.public_id AS assigned_owner_public_id,owner.username AS assigned_owner_username FROM decave_moderation_cases c LEFT JOIN decave_users owner ON owner.id=c.assigned_owner_user_id WHERE c.primary_subject_user_id=? ORDER BY c.created_at DESC LIMIT 100",
      )
        .bind(target.id)
        .all<SafetyCaseQueryRow>(),
      env.DB.prepare(
        "SELECT * FROM decave_moderation_actions WHERE target_user_id=? ORDER BY created_at DESC LIMIT 100",
      )
        .bind(target.id)
        .all(),
    ]);
    return json(
      {
        user: { id: publicIdOf(target), username: target.username },
        reports: reports.results.map((row) => reportForClient(row, false)),
        cases: cases.results.map(caseForClient),
        actions: actions.results,
      },
      200,
      { "Cache-Control": "no-store, private" },
    );
  }

  const evidenceGetRoute = idFromPath(
    pathname,
    new RegExp(`^${adminPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/cases/([^/]+)/evidence/([^/]+)$`),
  );
  if (method === "GET" && evidenceGetRoute) {
    const reauthError = await ownerRequireReauth(request, env, owner.id);
    if (reauthError) return reauthError;
    const caseId = decodeURIComponent(evidenceGetRoute[1]);
    const evidenceId = decodeURIComponent(evidenceGetRoute[2]);
    const evidence = await env.DB.prepare(
      "SELECT * FROM decave_report_evidence WHERE id=? AND case_id=? AND deleted_at IS NULL LIMIT 1",
    )
      .bind(evidenceId, caseId)
      .first<{
        id: string;
        report_id: string;
        object_key: string;
        ciphertext_sha256: string;
        ciphertext_size: number;
        key_id: string;
        evidence_type: string;
      }>();
    if (!evidence) return json({ error: "Evidence not found." }, 404);
    const object = await env.MEDIA.get(evidence.object_key);
    if (!object) return json({ error: "Evidence object is no longer available." }, 410);
    await env.DB.prepare(
      `INSERT INTO decave_moderation_audit_log
       (id,actor_user_id,case_id,report_id,evidence_id,event_type,new_value_json,created_at)
       VALUES(?,?,?,?,?,?,?,?)`,
    )
      .bind(
        crypto.randomUUID(),
        owner.id,
        caseId,
        evidence.report_id,
        evidence.id,
        "evidence.viewed",
        JSON.stringify({ ciphertextSize: evidence.ciphertext_size, keyId: evidence.key_id }),
        nowIso(),
      )
      .run();
    const headers = new Headers({
      "content-type": "application/octet-stream",
      "cache-control": "no-store, private",
      "x-content-type-options": "nosniff",
      "content-length": String(evidence.ciphertext_size),
      "x-decave-evidence-sha256": evidence.ciphertext_sha256,
    });
    return new Response(object.body, { headers });
  }

  if (method === "GET" && pathname === `${adminPrefix}/audit`) {
    const rows = await env.DB.prepare(
      `SELECT a.*,u.public_id AS actor_public_id,u.username AS actor_username
       FROM decave_moderation_audit_log a LEFT JOIN decave_users u ON u.id=a.actor_user_id
       ORDER BY a.created_at DESC LIMIT ?`,
    )
      .bind(safetyReportLimit(url, 100, 200))
      .all();
    return json({ events: rows.results }, 200, { "Cache-Control": "no-store, private" });
  }

  return json({ error: "Trust & Safety endpoint not found." }, 404);
}
