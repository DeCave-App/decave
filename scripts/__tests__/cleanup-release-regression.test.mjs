import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { D1Mock } from "../test-support/worker-sqlite-test-fixture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);

function columnNames(db, table) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((column) => column.name);
}

function seedLazyPreferences(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS decave_account_preferences (
      user_id TEXT PRIMARY KEY,
      phone_number TEXT NOT NULL DEFAULT '',
      username_changed_at TEXT,
      friend_request_policy TEXT NOT NULL DEFAULT 'everyone',
      allow_stream_previews INTEGER NOT NULL DEFAULT 1,
      streamer_mode INTEGER NOT NULL DEFAULT 0,
      language TEXT NOT NULL DEFAULT 'en',
      time_format TEXT NOT NULL DEFAULT 'system',
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
    )
  `);
}

test("fresh migration chain contains only the intended session and erasure additions", () => {
  const db = new D1Mock();
  try {
    assert.ok(columnNames(db.sqlite, "decave_push_tokens").includes("session_hash"));
    assert.ok(columnNames(db.sqlite, "decave_ws_tokens").includes("session_hash"));
    assert.ok(columnNames(db.sqlite, "decave_users").includes("erasure_started_at"));
    assert.equal(
      db.scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND (name LIKE 'decave_e2ee_%' OR name LIKE 'decave_v5_%')",
      ),
      0,
    );
    assert.ok(
      db.scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='decave_report_evidence_upload_reservations'",
      ),
    );
  } finally {
    db.sqlite.close();
  }
});

test("an existing retirement-cutpoint database upgrades and keeps old push rows unbound", () => {
  const db = new DatabaseSync(":memory:");
  try {
    seedLazyPreferences(db);
    const migrationsDir = path.join(root, "migrations");
    const migrationNames = fs
      .readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    for (const name of migrationNames.filter((file) => file < "0063_session_bound_push_ws_tokens.sql")) {
      db.exec(fs.readFileSync(path.join(migrationsDir, name), "utf8"));
    }

    db.prepare(
      `INSERT INTO decave_users(id,username,password_salt,password_hash,created_at,erased_at)
      VALUES('erased-user','erased-user','salt','hash','2026-01-01','2026-02-01')`,
    ).run();
    db.prepare("INSERT INTO decave_account_preferences(user_id,updated_at) VALUES('erased-user','2026-01-01')").run();
    db.exec(`CREATE TABLE decave_push_tokens (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
    )`);
    db.prepare(
      `INSERT INTO decave_push_tokens(token,user_id,platform,created_at)
      VALUES('legacy-token','erased-user','ios','2026-01-01')`,
    ).run();

    for (const name of migrationNames.filter((file) => file >= "0063_session_bound_push_ws_tokens.sql")) {
      db.exec(fs.readFileSync(path.join(root, "migrations", name), "utf8"));
    }

    assert.equal(
      db.prepare("SELECT session_hash FROM decave_push_tokens WHERE token='legacy-token'").get().session_hash,
      null,
    );
    assert.ok(columnNames(db, "decave_ws_tokens").includes("session_hash"));
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM decave_account_preferences WHERE user_id='erased-user'").get().count,
      0,
    );
    assert.ok(
      db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_decave_push_tokens_user_session_hash'")
        .get(),
    );
    assert.ok(
      db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_decave_ws_tokens_user_session_hash'")
        .get(),
    );

    db.prepare(
      `INSERT INTO decave_report_evidence_upload_reservations
      (id,report_id,user_id,ciphertext_sha256,ciphertext_size,object_key,created_at)
      VALUES('r1','report-1','user-1',? ,12,'evidence/r1','2026-01-01')`,
    ).run("a".repeat(64));
    assert.throws(() =>
      db
        .prepare(
          `INSERT INTO decave_report_evidence_upload_reservations
      (id,report_id,user_id,ciphertext_sha256,ciphertext_size,object_key,created_at)
      VALUES('r2','report-1','user-1',? ,12,'evidence/r2','2026-01-01')`,
        )
        .run("a".repeat(64)),
    );
  } finally {
    db.close();
  }
});

test("DMG notarization uses a keychain profile and never passes the app-specific password in argv", async () => {
  const childProcess = require("node:child_process");
  const originalExecFileSync = childProcess.execFileSync;
  const originalEnv = { ...process.env };
  const password = "canary-notary-password";
  const calls = [];
  childProcess.execFileSync = (command, args, options) => {
    calls.push({ command, args: [...args], options });
    return command === "xcrun" && args.includes("submit") ? "status: Accepted" : "";
  };
  process.env.APPLE_KEYCHAIN_PROFILE = "decave-notary-profile";
  process.env.APPLE_APP_SPECIFIC_PASSWORD = password;
  process.env.APPLE_ID = "build@example.test";
  process.env.APPLE_TEAM_ID = "TEAM123456";

  try {
    const modulePath = require.resolve("../../scripts/release/notarize-dmg.cjs");
    delete require.cache[modulePath];
    const notarizeDmgs = require(modulePath);
    await notarizeDmgs({ artifactPaths: ["/tmp/DeCave.dmg"] });
    const submit = calls.find((call) => call.args.includes("submit"));
    assert.ok(submit);
    assert.ok(submit.args.includes("--keychain-profile"));
    assert.ok(submit.args.includes("decave-notary-profile"));
    assert.ok(calls.every((call) => !call.args.includes(password)));
    assert.ok(calls.every((call) => !JSON.stringify(call.args).includes(password)));
  } finally {
    childProcess.execFileSync = originalExecFileSync;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  }
});
