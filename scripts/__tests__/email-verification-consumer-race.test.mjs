import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { D1Mock } from "../test-support/worker-sqlite-test-fixture.mjs";
import { tokenHash } from "../../worker/db.ts";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { handleApi } = await import("../../worker/index.ts");

function fixture(t) {
  const db = new D1Mock();
  t.after(() => db.sqlite.close());
  const now = new Date().toISOString();
  db.exec(
    `INSERT INTO decave_users(id,username,password_salt,password_hash,created_at,email,email_normalized,requires_email_verification)
    VALUES(?,?,?,?,?,?,?,1)`,
    "verify-account",
    "verify-user",
    "fixture-salt",
    "fixture-hash",
    now,
    "original@example.test",
    "original@example.test",
  );
  db.exec(
    `INSERT INTO decave_auth_tokens(id,user_id,purpose,token_hash,expires_at,created_at)
    VALUES(?,?,'verify_email',?,?,?)`,
    "verify-token",
    "verify-account",
    tokenHash("copied-old-token"),
    new Date(Date.now() + 3600_000).toISOString(),
    now,
  );
  const verify = () =>
    handleApi(
      new Request("https://test.invalid/api/auth/verify-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "copied-old-token" }),
      }),
      { DB: db },
    );
  const legacyGet = () =>
    handleApi(new Request("https://test.invalid/api/auth/verify-email?token=copied-old-token"), { DB: db });
  return { db, verify, legacyGet };
}

test("verification accepts a current token once and preserves account identity", async (t) => {
  const { db, verify } = fixture(t);
  assert.equal((await verify()).status, 200);
  assert(db.scalar("SELECT email_verified_at FROM decave_users WHERE id='verify-account'"));
  assert.equal(db.scalar("SELECT requires_email_verification FROM decave_users"), 0);
  assert.equal(db.scalar("SELECT email FROM decave_users"), "original@example.test");
  assert.equal((await verify()).status, 400);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_security_events WHERE event='email.verified'"), 1);
});

test("legacy verification GET only redirects the token into the fragment", async (t) => {
  const { db, legacyGet } = fixture(t);
  const response = await legacyGet();
  assert.equal(response.status, 302);
  assert.match(response.headers.get("location") ?? "", /#token=copied-old-token$/);
  assert.equal(response.headers.get("cache-control"), "no-store, private");
  assert.equal(db.scalar("SELECT email_verified_at FROM decave_users"), null);
  assert.equal(db.scalar("SELECT consumed_at FROM decave_auth_tokens"), null);
});

test("in-flight copied old verification token cannot verify a replaced address", async (t) => {
  const { db, verify } = fixture(t);
  const batch = db.batch.bind(db);
  db.batch = async (statements) => {
    db.exec(
      "UPDATE decave_users SET email='changed@example.test',email_normalized='changed@example.test',email_verified_at=NULL",
    );
    db.exec("UPDATE decave_auth_tokens SET consumed_at=? WHERE id='verify-token'", new Date().toISOString());
    return batch(statements);
  };
  assert.equal((await verify()).status, 400);
  assert.equal(db.scalar("SELECT email_verified_at FROM decave_users"), null);
  assert.equal(db.scalar("SELECT requires_email_verification FROM decave_users"), 1);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_security_events WHERE event='email.verified'"), 0);
});

test("verification rechecks email, token consumption and expiry at the transaction boundary", async (t) => {
  for (const change of [
    (db) => db.exec("UPDATE decave_users SET email='different@example.test',email_normalized='different@example.test'"),
    (db) => db.exec("UPDATE decave_auth_tokens SET consumed_at=?", new Date().toISOString()),
    (db) => db.exec("UPDATE decave_auth_tokens SET expires_at='2000-01-01T00:00:00.000Z'"),
  ]) {
    const { db, verify } = fixture(t);
    const batch = db.batch.bind(db);
    db.batch = async (statements) => {
      change(db);
      return batch(statements);
    };
    assert.equal((await verify()).status, 400);
    assert.equal(db.scalar("SELECT email_verified_at FROM decave_users"), null);
    assert.equal(db.scalar("SELECT requires_email_verification FROM decave_users"), 1);
    assert.equal(db.scalar("SELECT COUNT(*) FROM decave_security_events WHERE event='email.verified'"), 0);
  }
});

test("verification token write failure rolls back verification and leaves token retryable", async (t) => {
  const { db, verify } = fixture(t);
  db.sqlite.exec(`CREATE TRIGGER reject_verification_token BEFORE UPDATE OF consumed_at ON decave_auth_tokens
    BEGIN SELECT RAISE(ABORT,'fixture token write failure'); END`);
  await assert.rejects(verify(), /fixture token write failure/);
  assert.equal(db.scalar("SELECT email_verified_at FROM decave_users"), null);
  assert.equal(db.scalar("SELECT consumed_at FROM decave_auth_tokens"), null);
  db.sqlite.exec("DROP TRIGGER reject_verification_token");
  assert.equal((await verify()).status, 200);
});
