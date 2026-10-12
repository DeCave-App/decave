import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { D1Mock, MediaMock } = await import("../test-support/worker-sqlite-test-fixture.mjs");
const { pruneExpiredPersonalData, RETENTION_DAYS, SWEEP_LIMIT } = await import("../../worker/retention.ts");

const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();
const ahead = (days) => new Date(Date.now() + days * DAY).toISOString();
const key = (n) => `attachments/private/00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function setup() {
  const db = new D1Mock();
  db.exec("PRAGMA foreign_keys=OFF");
  const media = new MediaMock();
  const deleted = [];
  let failing = false;
  media.delete = async (keys) => {
    if (failing) throw new Error("R2 unavailable");
    for (const item of Array.isArray(keys) ? keys : [keys]) deleted.push(item);
  };
  for (const id of ["alice", "bob"])
    db.exec(
      "INSERT INTO decave_users(id,username,password_salt,password_hash,created_at) VALUES(?,?,?,?,?)",
      id,
      id,
      "s",
      "h",
      ago(400),
    );
  const access = (r2Key, kind, owner, peer, age) =>
    db.exec(
      "INSERT INTO decave_attachment_access(r2_key,kind,owner_user_id,peer_user_id,hub_id,room_id,created_at) VALUES(?,?,?,?,?,?,?)",
      r2Key,
      kind,
      owner,
      peer,
      kind === "channel" ? 1 : null,
      kind === "channel" ? 1 : null,
      ago(age),
    );
  const dm = (id, from, to, text, refs = null) =>
    db.exec(
      "INSERT INTO decave_direct_messages(id,from_user_id,to_user_id,text,envelope,attachment_refs,created_at) VALUES(?,?,?,?,?,?,?)",
      id,
      from,
      to,
      text,
      refs ? '{"v":1}' : null,
      refs,
      ago(3),
    );
  return {
    db,
    deleted,
    access,
    dm,
    setFailing: (value) => (failing = value),
    env: { DB: db, MEDIA: media },
  };
}

test("migration 0074 creates the media deletion queue", () => {
  const { db } = setup();
  assert.equal(db.scalar("SELECT COUNT(*) FROM sqlite_master WHERE name='decave_media_deletion_queue'"), 1);
});

test("orphaned uploads go, but encrypted DM attachments referenced only by attachment_refs stay", async () => {
  const { db, deleted, access, dm, env } = setup();
  access(key(1), "dm", "alice", "bob", 5); // E2EE: only the refs next to the envelope name it
  dm("m1", "alice", "bob", "", key(1));
  access(key(2), "dm", "alice", "bob", 5); // legacy plaintext DM names it in text
  dm("m2", "alice", "bob", `__DECAVE_DM_ATTACHMENT__{"url":"/uploads/${key(2)}"}`);
  access(key(3), "dm", "alice", "bob", 5); // carried by a message from the peer back to the owner
  dm("m3", "bob", "alice", "", `${key(9)} ${key(3)}`);
  access(key(4), "dm", "alice", "bob", 5); // never sent
  access(key(5), "dm", "alice", "bob", 0); // never sent, still inside the grace period
  access(key(6), "channel", "alice", null, 5); // posted in a Hub channel
  db.exec(
    "INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at,attachment_key) VALUES('c1',1,1,'alice','',?,?)",
    ago(3),
    key(6),
  );
  access(key(7), "channel", "alice", null, 5); // channel upload whose message is gone

  assert.deepEqual(await pruneExpiredPersonalData(env), []);
  assert.deepEqual(deleted.sort(), [key(4), key(7)]);
  assert.deepEqual(
    db.sqlite
      .prepare("SELECT r2_key FROM decave_attachment_access ORDER BY r2_key")
      .all()
      .map((row) => row.r2_key),
    [key(1), key(2), key(3), key(5), key(6)],
  );
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_media_deletion_queue"), 0);
});

test("a failed R2 delete stays queued and is retried until R2 confirms", async () => {
  const { db, deleted, access, env, setFailing } = setup();
  access(key(1), "dm", "alice", "bob", 5);
  setFailing(true);
  await pruneExpiredPersonalData(env);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_attachment_access"), 0, "the access row is gone");
  assert.equal(db.scalar("SELECT object_key FROM decave_media_deletion_queue"), key(1));
  assert.ok(db.scalar("SELECT attempts FROM decave_media_deletion_queue") >= 1);
  setFailing(false);
  await pruneExpiredPersonalData(env);
  assert.deepEqual(deleted, [key(1)]);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_media_deletion_queue"), 0);
});

test("a queued key that a message still uses is dequeued without deleting the file", async () => {
  const { db, deleted, env } = setup();
  db.exec(
    "INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at,attachment_key) VALUES('c1',1,1,'alice','',?,?)",
    ago(1),
    key(1),
  );
  db.exec("INSERT INTO decave_media_deletion_queue(object_key,queued_at,attempts) VALUES(?,?,0)", key(1), ago(1));
  await pruneExpiredPersonalData(env);
  assert.deepEqual(deleted, []);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_media_deletion_queue"), 0);
});

test("stale presence rows and legacy push tokens are pruned", async () => {
  const { db, env } = setup();
  db.exec(
    "INSERT INTO decave_presence_activity(user_id,last_seen_at) VALUES('alice',?),('bob',?)",
    ago(RETENTION_DAYS.presenceLastSeen + 1),
    ago(2),
  );
  db.exec(
    "INSERT INTO decave_sessions(token_hash,user_id,created_at,expires_at) VALUES('live','alice',?,?)",
    ago(1),
    ahead(5),
  );
  db.exec(
    "INSERT INTO decave_push_tokens(token,user_id,session_hash,platform,created_at) VALUES('legacy','alice',NULL,'ios',?),('bound','alice','live','ios',?)",
    ago(10),
    ago(1),
  );
  assert.deepEqual(await pruneExpiredPersonalData(env), []);
  assert.equal(db.scalar("SELECT group_concat(user_id) FROM decave_presence_activity"), "bob");
  assert.equal(db.scalar("SELECT group_concat(token) FROM decave_push_tokens"), "bound");
});

test("each sweep deletes a bounded number of rows per run", async () => {
  const { db, env } = setup();
  const old = ago(RETENTION_DAYS.securityEvents + 1);
  for (let i = 0; i < SWEEP_LIMIT + 5; i += 1)
    db.exec(
      "INSERT INTO decave_security_events(id,user_id,event,ip_hash,user_agent,detail,created_at) VALUES(?,?,?,?,?,?,?)",
      `e${i}`,
      "alice",
      "login.succeeded",
      "",
      "",
      "",
      old,
    );
  await pruneExpiredPersonalData(env);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_security_events"), 5);
  await pruneExpiredPersonalData(env);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_security_events"), 0);
});
