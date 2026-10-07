import assert from "node:assert/strict";
import test from "node:test";
import { compareSchema, ProductionD1AuditError, verifyExactDatabase } from "../ops/audit-production-d1-readonly.mjs";

test("production D1 audit requires the exact immutable database identity", () => {
  assert.deepEqual(
    verifyExactDatabase([{ name: "decave-review-example", uuid: "00000000-0000-0000-0000-000000000000" }]),
    {
      databaseName: "decave-review-example",
      databaseId: "00000000-0000-0000-0000-000000000000",
      matchCount: 1,
    },
  );
  assert.throws(
    () => verifyExactDatabase([{ name: "decave-review-example", uuid: "00000000-0000-4000-8000-000000000000" }]),
    ProductionD1AuditError,
  );
});

test("schema comparison separates known Worker-lazy tables from migration drift", () => {
  const result = compareSchema(
    {
      tables: ["decave_hubs", "decave_users"],
      columns: [
        { table_name: "decave_hubs", column_name: "id", column_type: "INTEGER", primary_key: 1 },
        { table_name: "decave_users", column_name: "id", column_type: "TEXT", primary_key: 1 },
      ],
    },
    {
      tables: ["decave_account_preferences", "decave_hubs", "decave_users"],
      columns: [
        { table_name: "decave_account_preferences", column_name: "user_id", column_type: "TEXT", primary_key: 1 },
        { table_name: "decave_hubs", column_name: "id", column_type: "INTEGER", primary_key: 1 },
        { table_name: "decave_hubs", column_name: "icon_ring", column_type: "INTEGER", primary_key: 0 },
        { table_name: "decave_users", column_name: "id", column_type: "TEXT", primary_key: 1 },
      ],
    },
  );
  assert.deepEqual(result.missingTables, []);
  assert.deepEqual(result.unexpectedExtraTables, []);
  assert.deepEqual(result.runtimeOnlyTables, ["decave_account_preferences"]);
  assert.deepEqual(result.unexpectedExtraColumns, []);
  assert.equal(result.compatible, true);
});

test("schema comparison reports an unexpected production table", () => {
  const result = compareSchema(
    {
      tables: ["decave_users"],
      columns: [{ table_name: "decave_users", column_name: "id", column_type: "TEXT", primary_key: 1 }],
    },
    {
      tables: ["decave_users", "unexpected_table"],
      columns: [
        { table_name: "decave_users", column_name: "id", column_type: "TEXT", primary_key: 1 },
        { table_name: "unexpected_table", column_name: "id", column_type: "TEXT", primary_key: 1 },
      ],
    },
  );
  assert.deepEqual(result.unexpectedExtraTables, ["unexpected_table"]);
  assert.equal(result.compatible, false);
});
