import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { D1Mock, MediaMock } = await import("../test-support/worker-sqlite-test-fixture.mjs");
const { pruneExpiredPersonalData, RETENTION_DAYS, UNDERAGE_DELETION_REASON } =
  await import("../../worker/retention.ts");

const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();
const ahead = (days) => new Date(Date.now() + days * DAY).toISOString();

function setup() {
  const db = new D1Mock();
  const media = new MediaMock();
  const deleted = [];
  media.delete = async (keys) => {
    for (const key of Array.isArray(keys) ? keys : [keys]) deleted.push(key);
  };
  for (const id of ["alice", "bob", "teen"]) {
    db.exec(
      "INSERT INTO decave_users(id,username,password_salt,password_hash,created_at) VALUES(?,?,?,?,?)",
      id,
      id,
      "s",
      "h",
      ago(400),
    );
  }
  return { db, media, deleted, env: { DB: db, MEDIA: media } };
}

test("retention deletes expired credentials and keeps live ones", async () => {
  const { db, env } = setup();
  db.exec(
    "INSERT INTO decave_sessions(token_hash,user_id,created_at,expires_at) VALUES('live','alice',?,?)",
    ago(1),
    ahead(5),
  );
  db.exec(
    "INSERT INTO decave_sessions(token_hash,user_id,created_at,expires_at) VALUES('dead','alice',?,?)",
    ago(40),
    ago(1),
  );
  db.exec(
    "INSERT INTO decave_session_clients(token_hash,user_id,client,device_label,created_at) VALUES('dead','alice','web','Chrome on Windows',?)",
    ago(40),
  );
  db.exec(
    "INSERT INTO decave_ws_tokens(token_hash,user_id,session_hash,expires_at,created_at,used_at) VALUES('w1','alice','live',?,?,?)",
    ahead(1),
    ago(0),
    ago(0),
  );
  db.exec(
    "INSERT INTO decave_ws_tokens(token_hash,user_id,session_hash,expires_at,created_at,used_at) VALUES('w2','alice','live',?,?,NULL)",
    ahead(1),
    ago(0),
  );

  assert.deepEqual(await pruneExpiredPersonalData(env), []);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_sessions"), 1);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_session_clients"), 0);
  assert.equal(db.scalar("SELECT group_concat(token_hash) FROM decave_ws_tokens"), "w2");
});

test("retention removes security events after the retention period", async () => {
  const { db, env } = setup();
  for (const [id, age] of [
    ["old", RETENTION_DAYS.securityEvents + 1],
    ["recent", 10],
  ]) {
    db.exec(
      "INSERT INTO decave_security_events(id,user_id,event,ip_hash,user_agent,detail,created_at) VALUES(?,?,?,?,?,?,?)",
      id,
      "alice",
      "login.succeeded",
      "",
      "UA",
      "",
      ago(age),
    );
  }
  await pruneExpiredPersonalData(env);
  assert.equal(db.scalar("SELECT group_concat(id) FROM decave_security_events"), "recent");
});

test("the scheduled retention pass keeps legacy credential, presence, push, and media cleanup active", async () => {
  const { db, env, deleted } = setup();
  env.MEDIA.delete = async (keys) => deleted.push(...(Array.isArray(keys) ? keys : [keys]));

  for (const [table, keyColumn, expiredAt] of [
    ["decave_user_login_challenges", "token_hash", ago(1)],
    ["decave_owner_login_challenges", "token_hash", ago(1)],
  ]) {
    db.exec(
      `INSERT INTO ${table}(${keyColumn},user_id,stay_signed_in,expires_at,created_at) VALUES(?,?,0,?,?)`,
      `expired-${table}`,
      "alice",
      expiredAt,
      ago(2),
    );
  }
  db.exec(
    "INSERT INTO decave_user_login_challenges(token_hash,user_id,stay_signed_in,expires_at,created_at) VALUES('live-login','alice',0,?,?)",
    ahead(1),
    ago(0),
  );
  db.exec("INSERT INTO decave_presence_activity(user_id,last_seen_at) VALUES('alice',?)", ago(181));
  db.exec("INSERT INTO decave_presence_activity(user_id,last_seen_at) VALUES('bob',?)", ago(10));
  db.exec(
    "INSERT INTO decave_push_tokens(token,user_id,session_hash,platform,created_at) VALUES(?, 'alice', NULL, 'ios', ?)",
    "legacy-expired-token",
    ago(91),
  );
  db.exec(
    "INSERT INTO decave_push_tokens(token,user_id,session_hash,platform,created_at) VALUES(?, 'alice', NULL, 'ios', ?)",
    "legacy-live-token",
    ago(10),
  );
  db.exec(
    "INSERT INTO decave_push_subscriptions(user_id,hub_id,room_id,created_at) VALUES('alice',999,NULL,?)",
    ago(1),
  );
  db.exec(
    "INSERT INTO decave_attachment_access(r2_key,kind,owner_user_id,created_at) VALUES('attachments/orphan-channel','channel','alice',?)",
    ago(3),
  );
  db.exec(
    "INSERT INTO decave_media_deletion_queue(object_key,queued_at,attempts,last_attempt_at) VALUES('attachments/queued','2020-01-01',0,NULL)",
  );

  assert.deepEqual(await pruneExpiredPersonalData(env), []);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_user_login_challenges"), 1);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_owner_login_challenges"), 0);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_presence_activity WHERE user_id='alice'"), 0);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_presence_activity WHERE user_id='bob'"), 1);
  assert.equal(db.scalar("SELECT group_concat(token) FROM decave_push_tokens"), "legacy-live-token");
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_push_subscriptions"), 0);
  assert.deepEqual(deleted.sort(), ["attachments/orphan-channel", "attachments/queued"]);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_media_deletion_queue"), 0);
});

test("closed cases lose evidence after six months and records after a year, never on legal hold", async () => {
  const { db, env, deleted } = setup();
  db.exec(
    "INSERT INTO decave_trust_safety_keys(key_id,version,algorithm,public_key,active_at) VALUES('k1',1,'x','pk',?)",
    ago(500),
  );
  const addCase = (id, closedDaysAgo, hold = 0) => {
    db.exec(
      `INSERT INTO decave_moderation_cases(id,case_number,category,urgency_recommended,urgency_effective,status,
         created_at,updated_at,closed_at,legal_hold) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      id,
      `C-${id}`,
      "HARASSMENT_BULLYING",
      "medium",
      "medium",
      "closed",
      ago(closedDaysAgo + 1),
      ago(closedDaysAgo),
      ago(closedDaysAgo),
      hold,
    );
    db.exec(
      `INSERT INTO decave_reports(id,reporter_user_id,subject_user_id,target_type,target_id,category,
         urgency_recommended,urgency_effective,case_id,submitted_at,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      `r-${id}`,
      "alice",
      "bob",
      "user",
      "bob",
      "HARASSMENT_BULLYING",
      "medium",
      "medium",
      id,
      ago(closedDaysAgo + 1),
      ago(closedDaysAgo + 1),
      ago(closedDaysAgo),
    );
    db.exec(
      `INSERT INTO decave_report_evidence(id,report_id,case_id,evidence_type,object_key,ciphertext_sha256,
         ciphertext_size,package_version,encryption_version,key_id,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      `e-${id}`,
      `r-${id}`,
      id,
      "message",
      `safety-evidence/${id}`,
      "0".repeat(64),
      10,
      "1",
      "1",
      "k1",
      ago(closedDaysAgo + 1),
    );
  };
  addCase("old", RETENTION_DAYS.closedCaseRecords + 2);
  addCase("mid", RETENTION_DAYS.closedCaseEvidence + 2);
  addCase("held", RETENTION_DAYS.closedCaseRecords + 2, 1);
  addCase("recent", 30);

  assert.deepEqual(await pruneExpiredPersonalData(env), []);
  // Evidence files go after six months: "old" and "mid", never "held" or "recent".
  assert.deepEqual(deleted.sort(), ["safety-evidence/mid", "safety-evidence/old"]);
  assert.equal(
    db.scalar("SELECT group_concat(id) FROM (SELECT id FROM decave_report_evidence ORDER BY id)"),
    "e-held,e-recent",
  );
  // On a later pass, the year-old case (now without evidence) is deleted with its report.
  await pruneExpiredPersonalData(env);
  assert.equal(
    db.scalar("SELECT group_concat(id) FROM (SELECT id FROM decave_moderation_cases ORDER BY id)"),
    "held,mid,recent",
  );
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_reports WHERE case_id='old'"), 0);
});

test("accounts found to be under 18 are scheduled for deletion with a grace period", async () => {
  const { db, env } = setup();
  db.exec(
    `INSERT INTO decave_user_safety_profiles(user_id,age_status,age_band,teen_safety_mode,age_policy_version,
       age_assurance_method,created_at,updated_at)
     VALUES('teen','ineligible','unknown',1,'2026-10-v1-adults','self_attested',?,?)`,
    ago(1),
    ago(1),
  );
  await pruneExpiredPersonalData(env);
  const row = db.sqlite
    .prepare("SELECT deleted_at,delete_after,deletion_reason FROM decave_users WHERE id='teen'")
    .get();
  assert.equal(row.deletion_reason, UNDERAGE_DELETION_REASON);
  const grace = (Date.parse(row.delete_after) - Date.parse(row.deleted_at)) / DAY;
  assert.ok(Math.abs(grace - RETENTION_DAYS.underageAccountGrace) < 0.01);
  assert.equal(db.scalar("SELECT deleted_at FROM decave_users WHERE id='alice'"), null);
});

test("orphaned DM uploads are removed but uploads still in a message are kept", async () => {
  const { db, env, deleted } = setup();
  for (const key of ["attachments/private/kept", "attachments/private/orphan"]) {
    db.exec(
      "INSERT INTO decave_attachment_access(r2_key,kind,owner_user_id,peer_user_id,hub_id,room_id,created_at) VALUES(?,?,?,?,NULL,NULL,?)",
      key,
      "dm",
      "alice",
      "bob",
      ago(3),
    );
  }
  db.exec(
    "INSERT INTO decave_direct_messages(id,from_user_id,to_user_id,text,created_at) VALUES('m1','alice','bob',?,?)",
    '__DECAVE_DM_ATTACHMENT__{"url":"/uploads/attachments/private/kept"}',
    ago(3),
  );
  await pruneExpiredPersonalData(env);
  assert.deepEqual(deleted, ["attachments/private/orphan"]);
  assert.equal(db.scalar("SELECT group_concat(r2_key) FROM decave_attachment_access"), "attachments/private/kept");
});

test("expired DM device-link requests are deleted, sealed keys included", async () => {
  const { db, env } = setup();
  const insert = (id, expiresAt, sealed) =>
    db.exec(
      `INSERT INTO decave_dm_link_requests(id,user_id,requester_session_hash,link_public,created_at,expires_at,sealed,resolved_at)
       VALUES(?,'alice','s','k',?,?,?,?)`,
      id,
      ago(1),
      expiresAt,
      sealed,
      sealed ? ago(0) : null,
    );
  insert("waiting", ahead(0.005), null);
  insert("expired", ago(0.01), null);
  insert("approved-never-collected", ago(0.01), '{"v":1}');
  await pruneExpiredPersonalData(env);
  assert.deepEqual(
    db.sqlite
      .prepare("SELECT id FROM decave_dm_link_requests ORDER BY id")
      .all()
      .map((row) => row.id),
    ["waiting"],
  );
});
