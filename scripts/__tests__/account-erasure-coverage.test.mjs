import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { D1Mock, MediaMock } = await import("../test-support/worker-sqlite-test-fixture.mjs");
const { ACCOUNT_ERASURE_RETAINED_REFERENCES, LEGACY_ACCOUNT_ERASURE_SQL, eraseDueAccounts } =
  await import("../../worker/account-erasure.ts");

// Shared by the runtime tests below (one long-lived database, like production).
const db = new D1Mock();
const env = {
  DB: db,
  MEDIA: new MediaMock(),
  HUB_ROOM: { idFromName: () => "global", get: () => ({ fetch: async () => Response.json({ success: true }) }) },
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

// Columns that hold an account id. Generic ids such as target_id are excluded.
const USER_REFERENCE_COLUMN =
  /^(user_id|[a-z_]+_user_id|user_id_[ab]|user_[ab]|created_by|[a-z_]+_by|author_[a-z_]+|owner_id|actor_[a-z_]+|from_user_id|to_user_id|sender_id|recipient_id|partner_id)$/;

function addColumn(tables, table, column, source) {
  if (!USER_REFERENCE_COLUMN.test(column)) return;
  if (!tables.has(table)) tables.set(table, new Set());
  tables.get(table).add(`${column} (${source})`);
}

function scanCreateBody(tables, table, body, source) {
  for (const line of body.split("\n").flatMap((part) => part.split(/,(?![^(]*\))/))) {
    const column = line.trim().match(/^([a-z_][a-z0-9_]*)\s+(TEXT|INTEGER)\b/i);
    if (column) addColumn(tables, table, column[1], source);
  }
}

function userReferenceTables() {
  const tables = new Map();
  const migrationDir = path.join(root, "migrations");
  for (const file of fs.readdirSync(migrationDir).filter((name) => name.endsWith(".sql"))) {
    const sql = fs.readFileSync(path.join(migrationDir, file), "utf8");
    for (const match of sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\n\s*\)\s*;/gi))
      scanCreateBody(tables, match[1], match[2], file);
    for (const match of sql.matchAll(/ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(\w+)/gi))
      addColumn(tables, match[1], match[2], file);
  }
  // Tables the Worker creates lazily (not only through migrations).
  const walk = (dir) =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((entry) =>
        entry.isDirectory()
          ? walk(path.join(dir, entry.name))
          : entry.name.endsWith(".ts")
            ? [path.join(dir, entry.name)]
            : [],
      );
  for (const file of walk(path.join(root, "worker"))) {
    const source = fs.readFileSync(file, "utf8");
    const label = path.relative(root, file);
    for (const match of source.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\)\s*`/g))
      scanCreateBody(tables, match[1], match[2], label);
  }
  return tables;
}

test("every table with a user-reference column is erased, anonymized, or explicitly retained with a reason", () => {
  const erasureSource = read("worker/account-erasure.ts") + read("worker/streamer/routes.ts");
  const handled = new Set();
  for (const match of erasureSource.matchAll(/\b(?:FROM|UPDATE|INTO|JOIN)\s+([a-z_][a-z0-9_]*)/gi))
    handled.add(match[1]);
  const tables = userReferenceTables();
  assert.ok(tables.size > 40, "the migration scan found the schema");
  const uncovered = [];
  for (const [table, columns] of tables) {
    if (handled.has(table)) continue;
    const reason = ACCOUNT_ERASURE_RETAINED_REFERENCES[table];
    if (typeof reason === "string" && reason.length > 20) continue;
    uncovered.push(`${table}: ${[...columns].join(", ")}`);
  }
  assert.deepEqual(uncovered, [], "add erasure SQL or a documented ACCOUNT_ERASURE_RETAINED_REFERENCES entry");
  for (const table of Object.keys(ACCOUNT_ERASURE_RETAINED_REFERENCES)) {
    assert.ok(tables.has(table), `retained-reference entry ${table} must name a real user-reference table`);
  }
});

test("erasure scrubs share links, Hub home edits, moderation targets and legacy 0001 tables", async () => {
  const past = "2025-01-01T00:00:00.000Z";
  for (const [id, deleted] of [
    ["erase-me", true],
    ["hub-owner", false],
    ["staff", false],
  ]) {
    db.exec(
      `INSERT INTO decave_users(id,username,password_salt,password_hash,created_at,platform_role,deleted_at,delete_after)
       VALUES(?,?,?,?,?,'user',?,?)`,
      id,
      `user-${id}`,
      "salt",
      "hash",
      past,
      deleted ? past : null,
      deleted ? past : null,
    );
  }
  db.exec(
    "INSERT INTO decave_hubs(id,name,icon,owner_id,visibility,created_at,updated_at) VALUES(5,'Hub','H','hub-owner','private',?,?)",
    past,
    past,
  );
  db.exec(`CREATE TABLE IF NOT EXISTS decave_hub_share_links (
    hub_id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL, created_at TEXT NOT NULL)`);
  db.exec("INSERT INTO decave_hub_share_links(hub_id,code,created_by,created_at) VALUES(5,'code','erase-me',?)", past);
  db.exec("INSERT INTO decave_hub_home(hub_id,updated_by,updated_at) VALUES(5,'erase-me',?)", past);
  db.exec(
    `INSERT INTO decave_moderation_cases(id,case_number,category,urgency_recommended,urgency_effective,created_at,updated_at)
     VALUES('case-1','CASE-1','harassment','low','low',?,?)`,
    past,
    past,
  );
  db.exec(
    `INSERT INTO decave_moderation_actions(id,case_id,target_user_id,action_type,starts_at,created_by_user_id,created_at)
     VALUES('action-1','case-1','erase-me','warning',?,'staff',?)`,
    past,
    past,
  );
  db.exec(
    `INSERT INTO decave_moderation_audit_log(id,actor_user_id,case_id,event_type,created_at)
     VALUES('mod-audit-1','erase-me','case-1','note',?)`,
    past,
  );
  // Legacy 0001 tables: the erased account owns a legacy hub (ON DELETE
  // RESTRICT), has a session, and appears in another hub's audit log.
  db.exec(
    "INSERT INTO users(id,username,password_hash) VALUES('erase-me','legacy-erase','x'),('other','legacy-other','x')",
  );
  db.exec(
    "INSERT INTO hubs(id,owner_user_id,name) VALUES('legacy-own','erase-me','mine'),('legacy-other','other','theirs')",
  );
  db.exec("INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES('s1','erase-me','legacy-token','2099-01-01')");
  db.exec(
    "INSERT INTO audit_log(id,hub_id,actor_user_id,target_user_id,action,details_json) VALUES('a1','legacy-other','erase-me','other','kick','{\"why\":\"x\"}')",
  );

  assert.equal(await eraseDueAccounts(env), 1);
  assert.equal(db.scalar("SELECT created_by FROM decave_hub_share_links WHERE hub_id=5"), "hub-owner");
  assert.equal(db.scalar("SELECT updated_by FROM decave_hub_home WHERE hub_id=5"), null);
  assert.equal(db.scalar("SELECT target_user_id FROM decave_moderation_actions WHERE id='action-1'"), null);
  assert.equal(db.scalar("SELECT created_by_user_id FROM decave_moderation_actions WHERE id='action-1'"), "staff");
  // Append-only by trigger: the row survives and points at the anonymized tombstone.
  assert.equal(db.scalar("SELECT actor_user_id FROM decave_moderation_audit_log WHERE id='mod-audit-1'"), "erase-me");
  assert.match(db.scalar("SELECT username FROM decave_users WHERE id='erase-me'"), /^Deleted-/);
  assert.equal(db.scalar("SELECT COUNT(*) FROM users WHERE id='erase-me'"), 0);
  assert.equal(db.scalar("SELECT COUNT(*) FROM users WHERE id='other'"), 1);
  assert.equal(db.scalar("SELECT COUNT(*) FROM hubs WHERE id='legacy-own'"), 0);
  assert.equal(db.scalar("SELECT COUNT(*) FROM sessions WHERE user_id='erase-me'"), 0);
  assert.equal(db.scalar("SELECT actor_user_id FROM audit_log WHERE id='a1'"), null);
  assert.equal(db.scalar("SELECT target_user_id FROM audit_log WHERE id='a1'"), "other");
  assert.equal(db.scalar("SELECT details_json FROM audit_log WHERE id='a1'"), "{}");
  assert.ok(db.scalar("SELECT erased_at FROM decave_users WHERE id='erase-me'"));
});

test("legacy erasure skips 0001 tables that do not exist", async () => {
  // Reuse the database from the previous test: Worker lazy-schema promises are
  // cached per module instance, exactly like one long-lived Worker isolate.
  for (const { table } of LEGACY_ACCOUNT_ERASURE_SQL) db.sqlite.exec(`DROP TABLE IF EXISTS ${table}`);
  const past = "2025-01-01T00:00:00.000Z";
  db.exec(
    `INSERT INTO decave_users(id,username,password_salt,password_hash,created_at,platform_role,deleted_at,delete_after)
     VALUES('gone','user-gone','salt','hash',?,'user',?,?)`,
    past,
    past,
    past,
  );
  assert.equal(await eraseDueAccounts(env), 1);
});
