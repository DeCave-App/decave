import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { register } from "node:module";
import { test } from "node:test";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { D1Mock, MediaMock } = await import("../test-support/worker-sqlite-test-fixture.mjs");
const { handleAccountSecurityRoutes } = await import("../../worker/routes/account.ts");
const { pruneExpiredPrivacyData } = await import("../../worker/lib/retention.ts");

const db = new D1Mock();
const media = new MediaMock();
const env = {
  DB: db,
  MEDIA: media,
  AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  HUB_ROOM: {
    idFromName: () => "global",
    get: () => ({ fetch: async () => Response.json({ success: true }) }),
  },
};
const now = "2026-10-05T12:00:00.000Z";
const sessionToken = "privacy-lifecycle-session";
const sessionHash = createHash("sha256").update(sessionToken).digest("hex");
const ipHash = "secret-password-hash-never-export";

function addUser(id, { publicId = `DC-${id.padStart(16, "0")}`, terms = false } = {}) {
  db.exec(
    `INSERT INTO decave_users
       (id,username,password_salt,password_hash,created_at,public_id,email,email_normalized,
        email_verified_at,platform_role,terms_accepted_at,terms_version,privacy_version)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id,
    `user-${id}`,
    "salt-value",
    ipHash,
    "2025-01-01T00:00:00.000Z",
    publicId,
    `${id}@example.test`,
    `${id}@example.test`,
    now,
    "user",
    terms ? "2025-02-01T00:00:00.000Z" : null,
    terms ? "terms-2025-02" : null,
    terms ? "privacy-2025-02" : null,
  );
}

addUser("u1", { terms: true });
addUser("u2");
db.exec(
  "INSERT INTO decave_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
  sessionHash,
  "u1",
  "2099-01-01T00:00:00.000Z",
  now,
);
db.exec(
  `INSERT INTO decave_user_mfa(user_id,secret_ciphertext,enabled_at,created_at,updated_at)
   VALUES('u1','MFA-DO-NOT-EXPORT',?,?,?)`,
  now,
  now,
  now,
);
db.exec("INSERT INTO decave_account_preferences(user_id,phone_number,updated_at) VALUES('u1','+15555550123',?)", now);
db.exec(
  `INSERT INTO decave_feedback(id,user_id,username,contact_email,type,message,status,created_at)
   VALUES('own-feedback','u1','user-u1','u1@example.test','bug','my own feedback','open',?)`,
  now,
);
db.exec(
  `INSERT INTO decave_feedback(id,user_id,username,contact_email,type,message,status,created_at)
   VALUES('other-feedback','u2','user-u2','u2@example.test','feature','private feedback','open',?)`,
  now,
);

const mediaKeys = {
  channel: "attachments/private/own-channel-html",
  legacyChannel: "attachments/1/1/legacy-own-image",
  dm1: "attachments/private/own-dm-one",
  dm2: "attachments/private/own-dm-two",
  otherDm: "attachments/private/other-user-file",
};
db.exec(
  `INSERT INTO decave_hubs(id,name,icon,owner_id,visibility,created_at,updated_at)
   VALUES(1,'Own hub','','u1','private',?,?)`,
  now,
  now,
);
db.exec(
  `INSERT INTO decave_rooms(id,hub_id,name,type,created_at,updated_at)
   VALUES(1,1,'general','text',?,?)`,
  now,
  now,
);
db.exec(
  `INSERT INTO decave_messages
     (id,room_id,hub_id,author_user_id,text,created_at,attachment_name,attachment_mime,attachment_size,attachment_key)
   VALUES('channel-attachment',1,1,'u1','photo',?,'unsafe.html','text/html',21,?)`,
  now,
  mediaKeys.channel,
);
db.exec(
  `INSERT INTO decave_attachment_access(r2_key,kind,owner_user_id,peer_user_id,hub_id,room_id,created_at)
   VALUES(?,'channel','u1',NULL,1,1,?)`,
  mediaKeys.channel,
  now,
);
db.exec(
  `INSERT INTO decave_messages
     (id,room_id,hub_id,author_user_id,text,created_at,attachment_name,attachment_mime,attachment_size,attachment_key)
   VALUES('legacy-channel-attachment',1,1,'u1','old photo',?,'legacy.png','image/png',3,?)`,
  now,
  mediaKeys.legacyChannel,
);

const dmAttachmentPayload = JSON.stringify({
  type: "attachments",
  items: [mediaKeys.dm1, mediaKeys.dm2].map((key) => ({ url: `/uploads/${key}` })),
});
db.exec(
  `INSERT INTO decave_direct_messages(id,from_user_id,to_user_id,text,created_at)
   VALUES('own-dm-attachments','u1','u2',?,?)`,
  dmAttachmentPayload,
  now,
);
for (const key of [mediaKeys.dm1, mediaKeys.dm2]) {
  db.exec(
    `INSERT INTO decave_attachment_access(r2_key,kind,owner_user_id,peer_user_id,created_at)
     VALUES(?,'dm','u1','u2',?)`,
    key,
    now,
  );
}
db.exec(
  `INSERT INTO decave_direct_messages(id,from_user_id,to_user_id,text,created_at)
   VALUES('other-dm-attachment','u2','u1',?,?)`,
  JSON.stringify({ url: `/uploads/${mediaKeys.otherDm}` }),
  now,
);
db.exec(
  `INSERT INTO decave_attachment_access(r2_key,kind,owner_user_id,peer_user_id,created_at)
   VALUES(?,'dm','u2','u1',?)`,
  mediaKeys.otherDm,
  now,
);

for (const key of Object.values(mediaKeys)) {
  media.put(key, new TextEncoder().encode("<script>unsafe()</script>"), {
    httpMetadata: { contentType: "text/html", contentDisposition: 'attachment; filename="stored-name.html"' },
  });
}
const mediaGet = media.get.bind(media);
media.get = async (key) => {
  const object = await mediaGet(key);
  if (!object) return null;
  const bytes = object.body;
  const metadata = media.metadata.get(key) ?? {};
  return {
    ...object,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    writeHttpMetadata(headers) {
      if (metadata.contentType) headers.set("content-type", metadata.contentType);
      if (metadata.contentDisposition) headers.set("content-disposition", metadata.contentDisposition);
    },
  };
};

function accountRequest(path) {
  return new Request(`https://test.invalid${path}`, {
    headers: { authorization: `Bearer ${sessionToken}`, "user-agent": "privacy-lifecycle-test" },
  });
}

async function accountRoute(path) {
  const request = accountRequest(path);
  return handleAccountSecurityRoutes({ request, env, p: new URL(request.url).pathname, method: request.method });
}

test("account export streams complete own records, consent, feedback and safe attachment downloads", async () => {
  const insert = db.sqlite.prepare(
    `INSERT INTO decave_direct_messages(id,from_user_id,to_user_id,text,created_at)
     VALUES(?,?,?,?,?)`,
  );
  db.sqlite.exec("BEGIN");
  try {
    for (let i = 0; i < 20_001; i += 1) {
      insert.run(`own-message-${i}`, "u1", "u2", `own message ${i}`, now);
    }
    insert.run("private-peer-message", "u2", "u1", "private peer reply", now);
    db.sqlite.exec("COMMIT");
  } catch (error) {
    db.sqlite.exec("ROLLBACK");
    throw error;
  }

  const response = await accountRoute("/api/account/export");
  assert.equal(response.status, 200);
  const text = await response.text();
  const data = JSON.parse(text);
  assert.equal(data.complete, true);
  assert.equal(data.format, "decave-account-export-v2");
  assert.equal(data.account.consent.terms_version, "terms-2025-02");
  assert.equal(data.account.consent.privacy_version, "privacy-2025-02");
  assert.equal(data.account.phoneNumber, "+15555550123");
  assert.equal(data.account.twoFactorEnabled, true);
  assert.ok(!text.includes("MFA-DO-NOT-EXPORT"));
  assert.ok(!text.includes(ipHash));
  assert.equal(data.directMessagesReceived.length, 2, "DMs received by the account are part of its export");
  assert.ok(data.directMessagesReceived.some((row) => row.text === "private peer reply" && row.sender === "user-u2"));
  assert.equal(data.feedback.length, 1);
  assert.equal(data.feedback[0].message, "my own feedback");
  assert.equal(data.directMessagesSent.length, 20_002);
  assert.equal(data.hubRoomAttachments.length, 1);
  assert.equal(data.legacyHubRoomAttachments.length, 1);
  assert.equal(data.directMessageAttachments.length, 2, "pagination emits both attachments referenced by one DM row");

  const ownDownload = await accountRoute(`/api/account/export/attachment?key=${encodeURIComponent(mediaKeys.channel)}`);
  assert.equal(ownDownload.status, 200);
  assert.equal(ownDownload.headers.get("content-type"), "application/octet-stream");
  assert.match(ownDownload.headers.get("content-disposition") ?? "", /attachment; filename="stored-name.html"/);
  assert.equal(await ownDownload.text(), "<script>unsafe()</script>");

  const legacyDownload = await accountRoute(
    `/api/account/export/attachment?key=${encodeURIComponent(mediaKeys.legacyChannel)}`,
  );
  assert.equal(legacyDownload.status, 200, "own-authored legacy channel files remain downloadable from export");
  const otherUserDownload = await accountRoute(
    `/api/account/export/attachment?key=${encodeURIComponent(mediaKeys.otherDm)}`,
  );
  assert.equal(otherUserDownload.status, 404, "export download cannot expose a counterpart-owned file");
});

test("account export marks streamed database failures incomplete instead of returning empty sections", async () => {
  db.sqlite.exec("DROP TABLE decave_known_devices");
  const response = await accountRoute("/api/account/export");
  assert.equal(response.status, 200);
  const data = JSON.parse(await response.text());
  assert.equal(data.complete, false);
  assert.equal(data.error, "The export could not be completed. Retry the download.");
  // Restore the table for the retention test below.
  db.sqlite.exec(`CREATE TABLE decave_known_devices (
    user_id TEXT NOT NULL, fingerprint TEXT NOT NULL, label TEXT NOT NULL DEFAULT '',
    first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, PRIMARY KEY (user_id, fingerprint))`);
});

test("scheduled privacy cleanup is bounded, expires credentials, defaults old evidence to 365 days and respects holds", async () => {
  const expired = "2026-10-04T00:00:00.000Z";
  const active = "2026-11-04T00:00:00.000Z";
  const old = "2024-01-01T00:00:00.000Z";
  const fresh = "2026-08-01T00:00:00.000Z";
  const expiredHash = "expired-session-hash";
  const activeHash = "active-session-hash";
  db.exec(
    "INSERT INTO decave_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
    expiredHash,
    "u1",
    expired,
    old,
  );
  db.exec(
    "INSERT INTO decave_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
    activeHash,
    "u1",
    active,
    old,
  );
  db.exec(
    "INSERT INTO decave_session_clients(token_hash,user_id,client,device_label,created_at) VALUES(?,?,?,?,?)",
    expiredHash,
    "u1",
    "web",
    "expired device",
    old,
  );
  db.exec(
    "INSERT INTO decave_session_clients(token_hash,user_id,client,device_label,created_at) VALUES(?,?,?,?,?)",
    activeHash,
    "u1",
    "web",
    "active device",
    old,
  );
  db.exec(
    "INSERT INTO decave_ws_tokens(token_hash,user_id,expires_at,created_at,session_hash) VALUES(?,?,?,?,?)",
    "expired-ws",
    "u1",
    active,
    old,
    expiredHash,
  );
  db.exec(
    "INSERT INTO decave_ws_tokens(token_hash,user_id,expires_at,created_at,session_hash) VALUES(?,?,?,?,?)",
    "old-ws-direct-expiry",
    "u1",
    expired,
    old,
    activeHash,
  );
  db.exec(
    "INSERT INTO decave_auth_tokens(id,user_id,purpose,token_hash,expires_at,created_at) VALUES(?,?,?,?,?,?)",
    "expired-auth",
    "u1",
    "reset_password",
    "expired-auth-hash",
    expired,
    old,
  );
  db.exec(
    "INSERT INTO decave_auth_tokens(id,user_id,purpose,token_hash,expires_at,created_at) VALUES(?,?,?,?,?,?)",
    "active-auth",
    "u1",
    "reset_password",
    "active-auth-hash",
    active,
    old,
  );

  db.sqlite.exec("BEGIN");
  try {
    const event = db.sqlite.prepare(
      `INSERT INTO decave_security_events(id,user_id,event,ip_hash,user_agent,detail,created_at)
       VALUES(?, 'u1','test.event','hmac:v1:secret','test','private',?)`,
    );
    const feedback = db.sqlite.prepare(
      `INSERT INTO decave_feedback(id,user_id,username,type,message,created_at)
       VALUES(?, 'u1','user-u1','bug','old feedback',?)`,
    );
    for (let i = 0; i < 501; i += 1) {
      event.run(`old-event-${i}`, old);
      feedback.run(`old-feedback-${i}`, old);
    }
    event.run("fresh-event", fresh);
    feedback.run("fresh-feedback", fresh);
    db.sqlite.exec("COMMIT");
  } catch (error) {
    db.sqlite.exec("ROLLBACK");
    throw error;
  }

  db.exec(
    `INSERT INTO decave_trust_safety_keys(key_id,version,algorithm,public_key,active_at)
     VALUES('retention-test-key',1,'test','public',?)`,
    now,
  );
  for (const item of [
    { id: "expired-evidence-explicit", hold: 0, caseHold: 0, expires: old, created: old },
    { id: "expired-evidence-null-default", hold: 0, caseHold: 0, expires: null, created: old },
    { id: "held-evidence-item", hold: 0, caseHold: 1, expires: old, created: old },
    { id: "fresh-evidence-item", hold: 0, caseHold: 0, expires: active, created: fresh },
  ]) {
    const caseId = `case-${item.id}`;
    const reportId = `report-${item.id}`;
    db.exec(
      `INSERT INTO decave_moderation_cases
         (id,case_number,category,urgency_recommended,urgency_effective,created_at,updated_at,legal_hold)
       VALUES(?,?, 'harassment','low','low',?,?,?)`,
      caseId,
      `CASE-${caseId}`,
      item.created,
      item.created,
      item.caseHold,
    );
    db.exec(
      `INSERT INTO decave_reports
         (id,reporter_user_id,target_type,target_id,category,urgency_recommended,urgency_effective,status,case_id,submitted_at,created_at,updated_at)
       VALUES(?, 'u1','user','target','harassment','low','low','submitted',?,?,?,?)`,
      reportId,
      caseId,
      item.created,
      item.created,
      item.created,
    );
    const key = `safety-evidence/${item.id}.bin`;
    db.exec(
      `INSERT INTO decave_report_evidence
         (id,report_id,case_id,evidence_type,object_key,ciphertext_sha256,ciphertext_size,
          package_version,encryption_version,key_id,created_at,retention_expires_at,legal_hold)
       VALUES(?,?,?,'context',?,'hash',1,'test','test','retention-test-key',?,?,?)`,
      item.id,
      reportId,
      caseId,
      key,
      item.created,
      item.expires,
      item.hold,
    );
    media.put(key, new Uint8Array([1]));
  }

  const previousDelete = media.delete.bind(media);
  media.delete = async () => {
    throw new Error("temporary R2 failure");
  };
  await assert.rejects(pruneExpiredPrivacyData(env, new Date(now)), /remain retryable/);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_sessions WHERE token_hash=?", expiredHash), 0);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_sessions WHERE token_hash=?", activeHash), 1);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_session_clients WHERE token_hash=?", expiredHash), 0);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_ws_tokens WHERE token_hash='expired-ws'"), 0);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_ws_tokens WHERE token_hash='old-ws-direct-expiry'"), 0);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_auth_tokens WHERE id='expired-auth'"), 0);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_auth_tokens WHERE id='active-auth'"), 1);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_security_events WHERE created_at=?", old), 1);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_feedback WHERE created_at=?", old), 1);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_report_evidence WHERE id='expired-evidence-explicit'"), 0);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_report_evidence WHERE id='expired-evidence-null-default'"), 0);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_report_evidence WHERE id='held-evidence-item'"), 1);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_report_evidence WHERE id='fresh-evidence-item'"), 1);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_media_deletion_queue"), 2);
  assert.equal(media.objects.has("safety-evidence/held-evidence-item.bin"), true);

  media.delete = previousDelete;
  await pruneExpiredPrivacyData(env, new Date(now));
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_security_events WHERE created_at=?", old), 0);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_feedback WHERE created_at=?", old), 0);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_media_deletion_queue"), 0);
  assert.equal(media.objects.has("safety-evidence/expired-evidence-explicit.bin"), false);
  assert.equal(media.objects.has("safety-evidence/expired-evidence-null-default.bin"), false);
  assert.equal(media.objects.has("safety-evidence/held-evidence-item.bin"), true);
});
