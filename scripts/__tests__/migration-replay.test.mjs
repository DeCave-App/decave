import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { D1Mock } from "../test-support/worker-sqlite-test-fixture.mjs";

// Columns the Worker adds at runtime (ensureHubFeatureSchema in worker/index.ts)
// with no migration creating them. A migration that names one breaks every
// fresh database (local dev and tests), because migrations run before the
// Worker ever does. Production already has these columns.
const RUNTIME_ONLY_COLUMNS = { decave_rooms: ["icon"], decave_hubs: ["icon_ring"] };

const migrationsDir = new URL("../../migrations/", import.meta.url);

test("all migrations replay on a fresh database", () => {
  const db = new D1Mock();
  try {
    assert.ok(db.scalar("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='decave_rooms'"));
  } finally {
    db.sqlite.close();
  }
});

test("no migration writes to a runtime-only column", () => {
  const offenders = [];
  for (const file of fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const sql = fs.readFileSync(new URL(file, migrationsDir), "utf8").replace(/--[^\n]*/g, "");
    for (const statement of sql.split(";")) {
      for (const [table, columns] of Object.entries(RUNTIME_ONLY_COLUMNS)) {
        if (!new RegExp(`\\b(?:INSERT\\s+INTO|UPDATE|ALTER\\s+TABLE)\\s+${table}\\b`, "i").test(statement)) continue;
        for (const column of columns) {
          if (new RegExp(`\\b${column}\\b`).test(statement)) offenders.push(`${file}: ${table}.${column}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, []);
});
