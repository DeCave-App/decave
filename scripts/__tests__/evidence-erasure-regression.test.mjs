import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { register } from "node:module";
import { test } from "node:test";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { D1Mock, MediaMock } = await import("../test-support/worker-sqlite-test-fixture.mjs");
const { EVIDENCE_UPLOAD_LIMITS, handleTrustSafetyApi, pruneExpiredEvidenceUploadReservations } =
  await import("../../worker/routes/trust-safety.ts");
const { claimAccountErasure, eraseDueAccounts } = await import("../../worker/account-erasure.ts");
const { drainMediaDeletionQueue } = await import("../../worker/lib/media.ts");

const db = new D1Mock();
const media = new MediaMock();
const deleteMediaObject = media.delete.bind(media);
media.delete = async (keys) => {
  for (const key of Array.isArray(keys) ? keys : [keys]) await deleteMediaObject(key);
};
const env = {
  DB: db,
  MEDIA: media,
  HUB_ROOM: {
    idFromName: () => "global",
    get: () => ({ fetch: async () => Response.json({ success: true }) }),
  },
};
const now = new Date().toISOString();
const sessionToken = "evidence-regression-session";
const sessionHash = createHash("sha256").update(sessionToken).digest("hex");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function addUser(id, overrides = {}) {
  db.exec(
    `INSERT INTO decave_users(id,username,password_salt,password_hash,created_at,platform_role,
       deleted_at,delete_after,erased_at,erasure_started_at,avatar_key)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    id,
    `user-${id}`,
    "salt",
    "password-hash",
    now,
    overrides.platformRole ?? "user",
    overrides.deletedAt ?? null,
    overrides.deleteAfter ?? null,
    overrides.erasedAt ?? null,
    null,
    overrides.avatarKey ?? null,
  );
}

function addReport(reportId, caseId, userId = "reporter") {
  db.exec(
    `INSERT INTO decave_moderation_cases
       (id,case_number,category,urgency_recommended,urgency_effective,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?)`,
    caseId,
    `CASE-${caseId}`,
    "harassment",
    "low",
    "low",
    now,
    now,
  );
  db.exec(
    `INSERT INTO decave_reports
       (id,reporter_user_id,target_type,target_id,category,urgency_recommended,urgency_effective,
        status,case_id,submitted_at,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    reportId,
    userId,
    "user",
    "reported-user",
    "harassment",
    "low",
    "low",
    "submitted",
    caseId,
    now,
    now,
    now,
  );
}

function upload(reportId, bytes, extraHeaders = {}, authToken = sessionToken) {
  return handleTrustSafetyApi(
    new Request(`https://test.invalid/api/safety/reports/${reportId}/evidence`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${authToken}`,
        "content-type": "application/octet-stream",
        ...extraHeaders,
      },
      body: bytes,
    }),
    env,
    `/api/safety/reports/${reportId}/evidence`,
    "POST",
  );
}

function addReporterSession(userId) {
  const token = `evidence-regression-session-${userId}`;
  const hash = createHash("sha256").update(token).digest("hex");
  addUser(userId);
  db.exec(
    "INSERT INTO decave_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
    hash,
    userId,
    new Date(Date.now() + 60 * 60_000).toISOString(),
    now,
  );
  return token;
}

function addStoredEvidence(id, reportId, size, createdAt = now) {
  db.exec(
    `INSERT INTO decave_report_evidence
       (id,report_id,case_id,evidence_type,object_key,ciphertext_sha256,ciphertext_size,
        package_version,encryption_version,key_id,created_at,legal_hold)
     SELECT ?,r.id,r.case_id,'context',?,?,?,'test-package','test-envelope','test-key',?,0
     FROM decave_reports r WHERE r.id=?`,
    id,
    `safety-evidence/legacy/${id}.bin`,
    sha256(id),
    size,
    createdAt,
    reportId,
  );
}

addUser("reporter");
db.exec(
  "INSERT INTO decave_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
  sessionHash,
  "reporter",
  new Date(Date.now() + 60 * 60_000).toISOString(),
  now,
);
db.exec(
  `INSERT INTO decave_trust_safety_keys(key_id,version,algorithm,public_key,active_at,retired_at)
   VALUES('test-key',1,'test','public-key',?,NULL)`,
  now,
);
addReport("report-main", "case-main");
addReport("report-concurrent", "case-concurrent");
addReport("report-r2-failure", "case-r2-failure");

test("erasure claims require a due, unowned, non-owner account and block cancellation after claim", async () => {
  const dueAt = new Date(Date.now() - 31 * 24 * 60 * 60_000).toISOString();
  addUser("not-due", { deletedAt: now, deleteAfter: new Date(Date.now() + 24 * 60 * 60_000).toISOString() });
  addUser("cancelled", {});
  addUser("owner-due", { platformRole: "owner", deletedAt: dueAt, deleteAfter: dueAt });
  addUser("hub-owner-due", { deletedAt: dueAt, deleteAfter: dueAt });
  addUser("claimable", { deletedAt: dueAt, deleteAfter: dueAt });
  db.exec(
    `INSERT INTO decave_hubs(name,icon,owner_id,visibility,created_at,updated_at)
     VALUES('Owned hub','',?,'private',?,?)`,
    "hub-owner-due",
    now,
    now,
  );

  assert.equal(await claimAccountErasure(env, "not-due"), null);
  assert.equal(await claimAccountErasure(env, "cancelled"), null);
  assert.equal(await claimAccountErasure(env, "owner-due"), null);
  assert.equal(await claimAccountErasure(env, "hub-owner-due"), null);

  const claim = await claimAccountErasure(env, "claimable");
  assert.ok(claim);
  const cancelledAfterClaim = db.exec(
    `UPDATE decave_users SET deleted_at=NULL,delete_after=NULL
     WHERE id='claimable' AND erasure_started_at IS NULL`,
  );
  assert.equal(Number(cancelledAfterClaim.changes), 0, "the atomic erasure claim wins over a restore/cancel mutation");
});

test("evidence reservations enforce concurrent caps, deduplicate retries and recover storage failures", async () => {
  const tooLarge = await upload("report-main", new Uint8Array(12 * 1024 * 1024 + 1));
  assert.equal(tooLarge.status, 413);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_report_evidence_upload_reservations"), 0);

  const firstBytes = new TextEncoder().encode("ciphertext-original");
  const first = await upload("report-main", firstBytes, {
    "X-DeCave-Evidence-Sha256": sha256(firstBytes),
  });
  assert.equal(first.status, 201);
  const firstReceipt = await first.json();
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_report_evidence WHERE report_id='report-main'"), 1);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_report_evidence_upload_reservations"), 0);

  const duplicate = await upload("report-main", firstBytes);
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).unchanged, true);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_report_evidence WHERE report_id='report-main'"), 1);

  const parallel = await Promise.all(
    Array.from({ length: 6 }, (_, index) => upload("report-concurrent", new TextEncoder().encode(`parallel-${index}`))),
  );
  assert.equal(parallel.filter((response) => response.status === 201).length, 4);
  assert.equal(parallel.filter((response) => response.status === 429).length, 2);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_report_evidence WHERE report_id='report-concurrent'"), 4);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_report_evidence_upload_reservations"), 0);

  const previousPut = media.put.bind(media);
  const previousDelete = media.delete.bind(media);
  media.put = async () => {
    throw new Error("storage unavailable");
  };
  media.delete = async () => {
    throw new Error("cleanup unavailable");
  };
  const failed = await upload("report-r2-failure", new TextEncoder().encode("retry-me"));
  assert.equal(failed.status, 503);
  const reservationId = db.scalar(
    "SELECT id FROM decave_report_evidence_upload_reservations WHERE report_id='report-r2-failure'",
  );
  assert.ok(reservationId, "failed compensation retains a quota reservation for retry");

  media.put = previousPut;
  media.delete = previousDelete;
  db.exec(
    "UPDATE decave_report_evidence_upload_reservations SET created_at=? WHERE id=?",
    new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
    reservationId,
  );
  assert.equal(await pruneExpiredEvidenceUploadReservations(env), 1);
  assert.equal(
    db.scalar("SELECT COUNT(*) FROM decave_report_evidence_upload_reservations WHERE id=?", reservationId),
    0,
  );
  assert.ok(firstReceipt.evidence.id);
});

test("evidence quotas include legacy rows across reports and reject before R2 writes", async () => {
  let putCalls = 0;
  const previousPut = media.put.bind(media);
  media.put = async (...args) => {
    putCalls += 1;
    return previousPut(...args);
  };

  const reportByteUser = "report-byte-cap-user";
  const reportByteToken = addReporterSession(reportByteUser);
  addReport("report-byte-cap", "case-report-byte-cap", reportByteUser);
  addStoredEvidence("report-byte-legacy", "report-byte-cap", EVIDENCE_UPLOAD_LIMITS.reportBytes - 5);
  const reportBytesRejected = await upload("report-byte-cap", new Uint8Array(6), {}, reportByteToken);
  assert.equal(reportBytesRejected.status, 429, "stored legacy bytes count toward the per-report aggregate");

  const userByteUser = "user-byte-cap-user";
  const userByteToken = addReporterSession(userByteUser);
  addReport("user-byte-legacy-report", "case-user-byte-legacy", userByteUser);
  addStoredEvidence("user-byte-legacy", "user-byte-legacy-report", EVIDENCE_UPLOAD_LIMITS.userBytesPerDay - 1);
  addReport("user-byte-upload-report", "case-user-byte-upload", userByteUser);
  const userBytesRejected = await upload("user-byte-upload-report", new Uint8Array(2), {}, userByteToken);
  assert.equal(
    userBytesRejected.status,
    429,
    "legacy bytes from another report count toward the user's daily aggregate",
  );

  const hourlyUser = "hour-cap-user";
  const hourlyToken = addReporterSession(hourlyUser);
  for (let index = 0; index < EVIDENCE_UPLOAD_LIMITS.userItemsPerHour; index += 1) {
    const reportId = `hour-existing-${index}`;
    addReport(reportId, `case-${reportId}`, hourlyUser);
    addStoredEvidence(`evidence-${reportId}`, reportId, 1);
  }
  addReport("hour-upload-report", "case-hour-upload", hourlyUser);
  const hourlyRejected = await upload("hour-upload-report", new Uint8Array([1]), {}, hourlyToken);
  assert.equal(hourlyRejected.status, 429, "hourly count includes evidence stored on other reports");

  const dailyUser = "day-cap-user";
  const dailyToken = addReporterSession(dailyUser);
  const outsideHour = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
  for (let index = 0; index < EVIDENCE_UPLOAD_LIMITS.userItemsPerDay; index += 1) {
    const reportId = `day-existing-${index}`;
    addReport(reportId, `case-${reportId}`, dailyUser);
    addStoredEvidence(`evidence-${reportId}`, reportId, 1, outsideHour);
  }
  addReport("day-upload-report", "case-day-upload", dailyUser);
  const dailyRejected = await upload("day-upload-report", new Uint8Array([1]), {}, dailyToken);
  assert.equal(
    dailyRejected.status,
    429,
    "daily count includes evidence stored across reports, independent of hourly count",
  );

  assert.equal(putCalls, 0, "quota rejection occurs before any R2 write");
  media.put = previousPut;
});

test("scheduled erasure durably queues R2 failures and scrubs preferences", async () => {
  const dueAt = new Date(Date.now() - 31 * 24 * 60 * 60_000).toISOString();
  addUser("due-user", { deletedAt: dueAt, deleteAfter: dueAt, avatarKey: "avatars/due-user.png" });
  db.exec(
    `INSERT INTO decave_account_preferences(user_id,phone_number,client_settings_json,updated_at)
     VALUES('due-user','+15555550123','{"theme":"private"}',?)`,
    now,
  );
  addReport("report-held", "case-held", "due-user");
  addReport("report-unheld", "case-unheld", "due-user");
  db.exec("UPDATE decave_moderation_cases SET legal_hold=1 WHERE id='case-held'");
  for (const item of [
    { id: "evidence-held", report: "report-held", case: "case-held", object: "safety-evidence/held.bin" },
    { id: "evidence-unheld", report: "report-unheld", case: "case-unheld", object: "safety-evidence/unheld.bin" },
  ]) {
    db.exec(
      `INSERT INTO decave_report_evidence
       (id,report_id,case_id,evidence_type,object_key,ciphertext_sha256,ciphertext_size,
        package_version,encryption_version,key_id,created_at,legal_hold)
       VALUES(?,?,?,'context',?,?,1,'test-package','test-envelope','test-key',?,0)`,
      item.id,
      item.report,
      item.case,
      item.object,
      sha256(item.id),
      now,
    );
    media.objects.set(item.object, new Uint8Array([1]));
  }
  db.exec(
    `INSERT INTO decave_report_evidence_upload_reservations
     (id,report_id,user_id,ciphertext_sha256,ciphertext_size,object_key,created_at)
     VALUES('pending-erasure','report-unheld','due-user',?,1,'safety-evidence/pending.bin',?)`,
    sha256("pending-erasure"),
    now,
  );
  media.objects.set("safety-evidence/pending.bin", new Uint8Array([1]));
  addUser("legacy-erased-user", { erasedAt: now });
  db.exec(
    `INSERT INTO decave_account_preferences(user_id,phone_number,client_settings_json,updated_at)
     VALUES('legacy-erased-user','+15555550999','{"old":"private"}',?)`,
    now,
  );
  media.objects.set("avatars/due-user.png", new Uint8Array([1, 2, 3]));
  const previousDelete = media.delete.bind(media);
  media.delete = async () => {
    throw new Error("R2 unavailable");
  };

  assert.equal(await eraseDueAccounts(env), 1);
  const erasedAccount = await db
    .prepare("SELECT erased_at,erasure_started_at,avatar_key FROM decave_users WHERE id='due-user'")
    .first();
  assert.ok(erasedAccount.erased_at, "database erasure completes while the queue retains failed object keys");
  assert.equal(erasedAccount.erasure_started_at, null);
  assert.equal(erasedAccount.avatar_key, null);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_account_preferences WHERE user_id='due-user'"), 0);
  const queuedKeys = await db.prepare("SELECT object_key FROM decave_media_deletion_queue ORDER BY object_key").all();
  assert.deepEqual(
    queuedKeys.results.map((row) => row.object_key),
    ["avatars/due-user.png", "safety-evidence/pending.bin", "safety-evidence/unheld.bin"],
  );
  assert.equal(
    db.scalar("SELECT COUNT(*) FROM decave_account_preferences WHERE user_id='legacy-erased-user'"),
    0,
    "recurring cleanup reaches existing preference rows for legacy tombstones",
  );
  media.delete = previousDelete;
  assert.equal(await drainMediaDeletionQueue(env), 3);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_media_deletion_queue"), 0);
  assert.equal(media.objects.has("avatars/due-user.png"), false);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_report_evidence WHERE id='evidence-held'"), 1);
  assert.equal(db.scalar("SELECT reporter_user_id FROM decave_reports WHERE id='report-held'"), null);
  assert.equal(media.objects.has("safety-evidence/held.bin"), true, "legal hold preserves retained evidence objects");
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_report_evidence WHERE id='evidence-unheld'"), 0);
  assert.equal(media.objects.has("safety-evidence/unheld.bin"), false);
  assert.equal(
    db.scalar("SELECT COUNT(*) FROM decave_report_evidence_upload_reservations WHERE user_id='due-user'"),
    0,
  );
  assert.equal(media.objects.has("safety-evidence/pending.bin"), false);
});
