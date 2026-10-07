import { nowIso, publicIdOf, type UserRow } from "./db";

export const AGE_POLICY_VERSION = "2026-10-v1";

export const REPORT_CATEGORIES = [
  "HARASSMENT_BULLYING",
  "HATE_SPEECH",
  "SEXUAL_INAPPROPRIATE",
  "SUSPECTED_GROOMING",
  "CHILD_SAFETY",
  "THREATS_VIOLENCE",
  "SPAM_SCAM",
  "IMPERSONATION",
  "UNDERAGE_USER",
  "INAPPROPRIATE_MEDIA",
  "SELF_HARM",
  "OTHER",
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const REPORT_URGENCIES = ["critical", "high", "medium", "low", "spam_invalid"] as const;

export type ReportUrgency = (typeof REPORT_URGENCIES)[number];

export const REPORT_STATUSES = [
  "submitted",
  "under_review",
  "awaiting_information",
  "action_taken",
  "no_violation",
  "escalated",
  "appealed",
  "closed",
] as const;

export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_TARGET_TYPES = [
  "user",
  "message",
  "content",
  "attachment",
  "profile",
  "voice_participant",
] as const;

export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export type SafetyAgeStatus = "unconfirmed" | "eligible" | "ineligible" | "review";
export type SafetyAgeBand = "unknown" | "teen" | "adult";

export type UserSafetyProfileRow = {
  user_id: string;
  age_status: SafetyAgeStatus;
  age_band: SafetyAgeBand;
  teen_safety_mode: number;
  age_policy_version: string;
  age_assurance_method: "unknown" | "self_attested" | "reviewed";
  age_acknowledged_at: string | null;
  age_verified_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TrustSafetyReportRow = {
  id: string;
  reporter_user_id: string | null;
  reporter_public_id?: string | null;
  reporter_username?: string | null;
  subject_user_id: string | null;
  subject_public_id_snapshot: string | null;
  subject_username_snapshot: string | null;
  target_type: ReportTargetType;
  target_id: string;
  target_public_id_snapshot: string | null;
  target_username_snapshot: string | null;
  context_type: string | null;
  context_id: string | null;
  context_label: string | null;
  hub_id: number | null;
  room_id: number | null;
  category: ReportCategory;
  description: string;
  urgency_recommended: ReportUrgency;
  urgency_effective: ReportUrgency;
  urgency_source: "system" | "reporter" | "owner";
  status: ReportStatus;
  case_id: string;
  case_number?: string | null;
  client_version: string | null;
  submitted_at: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

export type TrustSafetyCaseRow = {
  id: string;
  case_number: string;
  primary_subject_user_id: string | null;
  subject_public_id_snapshot: string | null;
  subject_username_snapshot: string | null;
  category: ReportCategory;
  urgency_recommended: ReportUrgency;
  urgency_effective: ReportUrgency;
  urgency_source: "system" | "reporter" | "owner";
  status: ReportStatus;
  assigned_owner_user_id: string | null;
  assigned_owner_public_id?: string | null;
  assigned_owner_username?: string | null;
  resolution_code: string | null;
  resolution_notes: string;
  critical: number;
  legal_hold: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

export type TrustSafetyEvidenceKeyRow = {
  key_id: string;
  version: number;
  algorithm: string;
  public_key: string;
  active_at: string;
  retired_at: string | null;
};

const DEFAULT_SAFETY_PROFILE = Object.freeze({
  age_status: "unconfirmed" as SafetyAgeStatus,
  age_band: "unknown" as SafetyAgeBand,
  teen_safety_mode: 1,
  age_policy_version: AGE_POLICY_VERSION,
  age_assurance_method: "unknown" as const,
  age_acknowledged_at: null,
  age_verified_at: null,
});

export function isReportCategory(value: unknown): value is ReportCategory {
  return typeof value === "string" && (REPORT_CATEGORIES as readonly string[]).includes(value);
}

export function isReportUrgency(value: unknown): value is ReportUrgency {
  return typeof value === "string" && (REPORT_URGENCIES as readonly string[]).includes(value);
}

export function isReportStatus(value: unknown): value is ReportStatus {
  return typeof value === "string" && (REPORT_STATUSES as readonly string[]).includes(value);
}

export function isReportTargetType(value: unknown): value is ReportTargetType {
  return typeof value === "string" && (REPORT_TARGET_TYPES as readonly string[]).includes(value);
}

export function recommendedUrgencyForCategory(category: ReportCategory): ReportUrgency {
  if (category === "SUSPECTED_GROOMING" || category === "CHILD_SAFETY" || category === "UNDERAGE_USER") {
    return "critical";
  }
  if (category === "SEXUAL_INAPPROPRIATE" || category === "THREATS_VIOLENCE" || category === "SELF_HARM") {
    return "high";
  }
  if (category === "SPAM_SCAM") return "low";
  return "medium";
}

export function safetyProfileForClient(profile: UserSafetyProfileRow | null | undefined) {
  const value = profile ?? DEFAULT_SAFETY_PROFILE;
  return {
    ageStatus: value.age_status,
    ageBand: value.age_band,
    teenSafetyMode: value.teen_safety_mode === 1,
    agePolicyVersion: value.age_policy_version,
    ageAcknowledgedAt: value.age_acknowledged_at,
    ageVerifiedAt: value.age_verified_at,
    ageGateRequired: value.age_status === "unconfirmed",
  };
}

export async function getSafetyProfile(db: D1Database, userId: string): Promise<UserSafetyProfileRow | null> {
  return (
    (await db
      .prepare("SELECT * FROM decave_user_safety_profiles WHERE user_id=? LIMIT 1")
      .bind(userId)
      .first<UserSafetyProfileRow>()) ?? null
  );
}

export async function ensureSafetyProfile(db: D1Database, userId: string, createdAt = nowIso()): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO decave_user_safety_profiles
       (user_id,age_status,age_band,teen_safety_mode,age_policy_version,
        age_assurance_method,age_acknowledged_at,age_verified_at,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      userId,
      DEFAULT_SAFETY_PROFILE.age_status,
      DEFAULT_SAFETY_PROFILE.age_band,
      DEFAULT_SAFETY_PROFILE.teen_safety_mode,
      DEFAULT_SAFETY_PROFILE.age_policy_version,
      DEFAULT_SAFETY_PROFILE.age_assurance_method,
      null,
      null,
      createdAt,
      createdAt,
    )
    .run();
}

export function deriveAgeProfile(
  birthDateValue: unknown,
  now = new Date(),
  minimumAge = 13,
): {
  ageStatus: SafetyAgeStatus;
  ageBand: SafetyAgeBand;
  teenSafetyMode: boolean;
  ageAssuranceMethod: "self_attested";
} | null {
  if (typeof birthDateValue !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(birthDateValue)) return null;
  const [year, month, day] = birthDateValue.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getTime() > now.getTime() ||
    year < now.getUTCFullYear() - 121
  )
    return null;

  let age = now.getUTCFullYear() - year;
  const birthdayPassed = now.getUTCMonth() + 1 > month || (now.getUTCMonth() + 1 === month && now.getUTCDate() >= day);
  if (!birthdayPassed) age -= 1;

  if (age < minimumAge) {
    return { ageStatus: "ineligible", ageBand: "unknown", teenSafetyMode: true, ageAssuranceMethod: "self_attested" };
  }
  if (age < 18) {
    return { ageStatus: "eligible", ageBand: "teen", teenSafetyMode: true, ageAssuranceMethod: "self_attested" };
  }
  return { ageStatus: "eligible", ageBand: "adult", teenSafetyMode: false, ageAssuranceMethod: "self_attested" };
}

export async function saveAgeProfile(
  db: D1Database,
  userId: string,
  profile: NonNullable<ReturnType<typeof deriveAgeProfile>>,
  acknowledgedAt = nowIso(),
  assuranceMethod: UserSafetyProfileRow["age_assurance_method"] = profile.ageAssuranceMethod,
): Promise<void> {
  const verifiedAt = profile.ageStatus === "eligible" ? acknowledgedAt : null;
  await db
    .prepare(
      `INSERT INTO decave_user_safety_profiles
       (user_id,age_status,age_band,teen_safety_mode,age_policy_version,
        age_assurance_method,age_acknowledged_at,age_verified_at,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET
         age_status=excluded.age_status,
         age_band=excluded.age_band,
         teen_safety_mode=excluded.teen_safety_mode,
         age_policy_version=excluded.age_policy_version,
         age_assurance_method=excluded.age_assurance_method,
         age_acknowledged_at=excluded.age_acknowledged_at,
         age_verified_at=excluded.age_verified_at,
         updated_at=excluded.updated_at`,
    )
    .bind(
      userId,
      profile.ageStatus,
      profile.ageBand,
      profile.teenSafetyMode ? 1 : 0,
      AGE_POLICY_VERSION,
      assuranceMethod,
      acknowledgedAt,
      verifiedAt,
      acknowledgedAt,
      acknowledgedAt,
    )
    .run();
}

export async function isBlockedBy(db: D1Database, blockerUserId: string, blockedUserId: string): Promise<boolean> {
  if (!blockerUserId || !blockedUserId || blockerUserId === blockedUserId) return false;
  const row = await db
    .prepare(
      `SELECT 1 AS found FROM decave_user_blocks
       WHERE blocker_user_id=? AND blocked_user_id=? LIMIT 1`,
    )
    .bind(blockerUserId, blockedUserId)
    .first<{ found: number }>();
  return Boolean(row?.found);
}

export async function isBlockedEitherDirection(
  db: D1Database,
  firstUserId: string,
  secondUserId: string,
): Promise<boolean> {
  if (!firstUserId || !secondUserId || firstUserId === secondUserId) return false;
  const row = await db
    .prepare(
      `SELECT 1 AS found FROM decave_user_blocks
       WHERE (blocker_user_id=? AND blocked_user_id=?)
          OR (blocker_user_id=? AND blocked_user_id=?)
       LIMIT 1`,
    )
    .bind(firstUserId, secondUserId, secondUserId, firstUserId)
    .first<{ found: number }>();
  return Boolean(row?.found);
}

export function reportDescription(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 4000);
}

export function reportReference(value: unknown, max = 256): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

export type CreateReportInput = {
  reporter: UserRow;
  subject: UserRow | null;
  targetType: ReportTargetType;
  targetId: string;
  targetPublicIdSnapshot: string | null;
  targetUsernameSnapshot: string | null;
  contextType: string | null;
  contextId: string | null;
  contextLabel: string | null;
  hubId: number | null;
  roomId: number | null;
  category: ReportCategory;
  description: string;
  requestedUrgency: ReportUrgency | null;
  clientVersion: string | null;
};

export async function createTrustSafetyReport(
  db: D1Database,
  input: CreateReportInput,
): Promise<{
  reportId: string;
  caseId: string;
  caseNumber: string;
  urgencyRecommended: ReportUrgency;
  urgencyEffective: ReportUrgency;
}> {
  const reportId = crypto.randomUUID();
  const caseId = crypto.randomUUID();
  const caseNumber = `TS-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const createdAt = nowIso();
  const urgencyRecommended = recommendedUrgencyForCategory(input.category);
  const urgencyEffective = input.requestedUrgency ?? urgencyRecommended;
  const critical = urgencyRecommended === "critical" || urgencyEffective === "critical" ? 1 : 0;

  await db.batch([
    db
      .prepare(
        `INSERT INTO decave_moderation_cases
         (id,case_number,primary_subject_user_id,subject_public_id_snapshot,
          subject_username_snapshot,category,urgency_recommended,urgency_effective,
          urgency_source,status,assigned_owner_user_id,resolution_code,resolution_notes,
          critical,legal_hold,created_at,updated_at,closed_at)
         VALUES(?,?,?,?,?,?,?,?,?,'submitted',NULL,NULL,'',?,0,?,?,NULL)`,
      )
      .bind(
        caseId,
        caseNumber,
        input.subject?.id ?? null,
        input.subject ? publicIdOf(input.subject) || null : null,
        input.subject?.username ?? null,
        input.category,
        urgencyRecommended,
        urgencyEffective,
        input.requestedUrgency ? "reporter" : "system",
        critical,
        createdAt,
        createdAt,
      ),
    db
      .prepare(
        `INSERT INTO decave_reports
         (id,reporter_user_id,subject_user_id,target_type,target_id,
          target_public_id_snapshot,target_username_snapshot,context_type,context_id,
          context_label,hub_id,room_id,category,description,urgency_recommended,
          urgency_effective,urgency_source,status,case_id,client_version,submitted_at,
          created_at,updated_at,closed_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'submitted',?,?,?,?,?,NULL)`,
      )
      .bind(
        reportId,
        input.reporter.id,
        input.subject?.id ?? null,
        input.targetType,
        input.targetId,
        input.targetPublicIdSnapshot,
        input.targetUsernameSnapshot,
        input.contextType,
        input.contextId,
        input.contextLabel,
        input.hubId,
        input.roomId,
        input.category,
        input.description,
        urgencyRecommended,
        urgencyEffective,
        input.requestedUrgency ? "reporter" : "system",
        caseId,
        input.clientVersion,
        createdAt,
        createdAt,
        createdAt,
      ),
  ]);

  return { reportId, caseId, caseNumber, urgencyRecommended, urgencyEffective };
}

export function reportForClient(row: TrustSafetyReportRow, ownerView = false) {
  // Content reports snapshot the reported author into the target fields. Older
  // rows may not have the newer subject snapshot populated, so preserve the
  // reported-user identity from the target snapshot when it is available.
  const subjectPublicId = row.subject_public_id_snapshot ?? row.target_public_id_snapshot;
  const subjectUsername = row.subject_username_snapshot ?? row.target_username_snapshot;
  return {
    id: row.id,
    caseId: row.case_id,
    caseNumber: row.case_number ?? null,
    targetType: row.target_type,
    targetId: row.target_id,
    targetIdSnapshot: row.target_public_id_snapshot,
    targetUsername: row.target_username_snapshot,
    subjectUserId: subjectPublicId,
    subjectUsername,
    contextType: row.context_type,
    contextId: row.context_id,
    contextLabel: row.context_label,
    hubId: row.hub_id,
    roomId: row.room_id,
    category: row.category,
    description: row.description,
    urgencyRecommended: row.urgency_recommended,
    urgency: row.urgency_effective,
    urgencySource: row.urgency_source,
    status: row.status,
    reporterUserId: ownerView ? (row.reporter_public_id ?? null) : undefined,
    reporterUsername: ownerView ? (row.reporter_username ?? null) : undefined,
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
  };
}

export function caseForClient(row: TrustSafetyCaseRow) {
  return {
    id: row.id,
    caseNumber: row.case_number,
    subjectUserId: row.subject_public_id_snapshot,
    subjectUsername: row.subject_username_snapshot,
    category: row.category,
    urgencyRecommended: row.urgency_recommended,
    urgency: row.urgency_effective,
    urgencySource: row.urgency_source,
    status: row.status,
    assignedOwnerUserId: row.assigned_owner_public_id ?? null,
    assignedOwnerUsername: row.assigned_owner_username ?? null,
    resolutionCode: row.resolution_code,
    resolutionNotes: row.resolution_notes,
    critical: row.critical === 1,
    legalHold: row.legal_hold === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
  };
}

export async function activeTrustSafetyKey(db: D1Database, at = nowIso()): Promise<TrustSafetyEvidenceKeyRow | null> {
  return (
    (await db
      .prepare(
        `SELECT key_id,version,algorithm,public_key,active_at,retired_at
         FROM decave_trust_safety_keys
         WHERE active_at<=? AND (retired_at IS NULL OR retired_at>?)
         ORDER BY version DESC LIMIT 1`,
      )
      .bind(at, at)
      .first<TrustSafetyEvidenceKeyRow>()) ?? null
  );
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function trustSafetyAuditStatement(
  db: D1Database,
  input: {
    actorUserId: string | null;
    caseId?: string | null;
    reportId?: string | null;
    actionId?: string | null;
    evidenceId?: string | null;
    eventType: string;
    oldValue?: Record<string, unknown>;
    newValue?: Record<string, unknown>;
    reason?: string;
    request?: Request;
  },
): D1PreparedStatement {
  const ray = (input.request?.headers.get("CF-Ray") ?? "").slice(0, 80);
  const country = (input.request?.headers.get("CF-IPCountry") ?? "").slice(0, 8);
  return db
    .prepare(
      `INSERT INTO decave_moderation_audit_log
       (id,actor_user_id,case_id,report_id,action_id,evidence_id,event_type,
        old_value_json,new_value_json,reason,request_ray,request_country,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.actorUserId,
      input.caseId ?? null,
      input.reportId ?? null,
      input.actionId ?? null,
      input.evidenceId ?? null,
      input.eventType.slice(0, 120),
      JSON.stringify(input.oldValue ?? {}).slice(0, 2000),
      JSON.stringify(input.newValue ?? {}).slice(0, 2000),
      (input.reason ?? "").slice(0, 1000),
      ray || null,
      country || null,
      nowIso(),
    );
}
