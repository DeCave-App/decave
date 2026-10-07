#!/usr/bin/env node

/**
 * Read-only production D1 inventory and repository compatibility audit.
 *
 * The target is intentionally fixed to the production name/UUID from the
 * checked-in Worker config. This script has no migration/apply/write path and
 * only prints migration metadata, schema metadata, and aggregate row counts.
 */

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const databaseName = "decave-review-example";
const databaseId = "00000000-0000-0000-0000-000000000000";
const wranglerConfig = path.join(root, "wrangler.jsonc");
const wranglerScript = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const migrationDir = path.join(root, "migrations");
const systemTables = new Set(["_cf_KV", "d1_migrations"]);
// These tables are deliberately created lazily by the deployed Worker rather
// than by repository migrations. Keep them visible in the report while
// excluding them from migration-schema compatibility mismatches.
const expectedRuntimeTables = new Set([
  "decave_account_preferences",
  "decave_activity_state",
  "decave_dm_preferences",
  "decave_group_chat_members",
  "decave_group_chat_messages",
  "decave_group_chats",
  "decave_hub_assets",
  "decave_hub_bots",
  "decave_hub_share_links",
  "decave_presence_activity",
  "decave_qr_login_challenges",
  "decave_squad_rooms",
  "decave_steam_link_states",
  "decave_steam_links",
]);
const expectedRuntimeColumns = new Set([
  "decave_hubs\u0000icon_ring",
  "decave_rooms\u0000icon",
  "decave_hub_bots\u0000description",
  "decave_hub_bots\u0000capabilities",
  "decave_hub_bots\u0000allowed_room_ids",
]);

export class ProductionD1AuditError extends Error {}

function fail(message) {
  throw new ProductionD1AuditError(message);
}

function parseJson(stdout, label) {
  try {
    return JSON.parse(String(stdout).trim());
  } catch {
    fail(`${label} did not return JSON.`);
  }
}

let readOnlyQueryNumber = 0;

function runWrangler(args) {
  const result = spawnSync(process.execPath, [wranglerScript, ...args], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const operation = args.includes("--command") ? "the production read-only query" : "production D1 discovery";
    fail(`Wrangler failed while running ${operation}${args.includes("--command") ? ` #${readOnlyQueryNumber}` : ""}.`);
  }
  return String(result.stdout ?? "");
}

function loadProductionConfig() {
  let config;
  try {
    config = JSON.parse(fs.readFileSync(wranglerConfig, "utf8"));
  } catch {
    fail("The production Wrangler config is missing or invalid JSONC for this audit.");
  }
  const binding = config?.d1_databases?.find((entry) => entry?.binding === "DB");
  if (config?.name !== "decave" || binding?.database_name !== databaseName || binding?.database_id !== databaseId) {
    fail("The checked-in production D1 binding does not match the fixed audit target.");
  }
  return { workerName: config.name, databaseName: binding.database_name, databaseId: binding.database_id };
}

export function parseD1List(stdout) {
  const payload = parseJson(stdout, "Wrangler D1 discovery");
  const rows = Array.isArray(payload) ? payload : payload && Array.isArray(payload.result) ? payload.result : null;
  if (!rows) fail("Wrangler D1 discovery returned an unexpected shape.");
  return rows;
}

export function verifyExactDatabase(rows) {
  const matches = rows.filter((row) => row?.name === databaseName && row?.uuid === databaseId);
  if (matches.length !== 1) fail("The exact production D1 name/UUID was not uniquely verified.");
  if (rows.some((row) => row?.name === databaseName && row?.uuid !== databaseId))
    fail("The production D1 name resolved to an unexpected UUID.");
  return { databaseName, databaseId, matchCount: matches.length };
}

function executeReadOnly(sql) {
  readOnlyQueryNumber += 1;
  const stdout = runWrangler([
    "d1",
    "execute",
    databaseName,
    "--remote",
    "--config",
    wranglerConfig,
    "--json",
    "--command",
    sql,
  ]);
  const payload = parseJson(stdout, "Production D1 query");
  const result = payload?.[0];
  if (!result?.success || !Array.isArray(result.results))
    fail("The production D1 read-only query returned an unexpected result.");
  return result.results;
}

function localMigrationNames() {
  return fs
    .readdirSync(migrationDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

function localSchema() {
  const database = new DatabaseSync(":memory:");
  for (const migration of localMigrationNames())
    database.exec(fs.readFileSync(path.join(migrationDir, migration), "utf8"));
  const rows = database
    .prepare("SELECT name,type FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all();
  const columns = [];
  for (const table of rows.map((row) => String(row.name)).filter((name) => !systemTables.has(name))) {
    for (const column of database.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all()) {
      columns.push({
        table_name: table,
        column_name: String(column.name),
        column_type: String(column.type ?? ""),
        not_null: Number(column.notnull ?? 0),
        default_value: column.dflt_value == null ? null : String(column.dflt_value),
        primary_key: Number(column.pk ?? 0),
      });
    }
  }
  const foreignKeys = [];
  for (const table of rows.map((row) => String(row.name)).filter((name) => !systemTables.has(name))) {
    for (const foreignKey of database.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(table)})`).all()) {
      foreignKeys.push({
        table_name: table,
        foreign_table: String(foreignKey.table),
        from_column: String(foreignKey.from),
        to_column: String(foreignKey.to ?? ""),
        on_update: String(foreignKey.on_update ?? ""),
        on_delete: String(foreignKey.on_delete ?? ""),
      });
    }
  }
  const objects = database
    .prepare(
      "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('index','trigger','view') AND name NOT LIKE 'sqlite_%' ORDER BY type,name",
    )
    .all()
    .map((row) => ({
      type: String(row.type),
      name: String(row.name),
      table_name: String(row.tbl_name ?? ""),
      sql: String(row.sql ?? "")
        .replace(/\\s+/g, " ")
        .trim()
        .toLowerCase(),
    }));
  return {
    tables: rows
      .map((row) => String(row.name))
      .filter((name) => !systemTables.has(name))
      .sort(),
    columns,
    foreignKeys,
    objects,
  };
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function remoteSchema() {
  const tableRows = executeReadOnly(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;",
  );
  const tables = tableRows
    .map((row) => String(row.name))
    .filter((name) => !systemTables.has(name))
    .sort();
  if (!tables.length) fail("Production D1 returned no application tables.");
  const selects = tables.map((table) => {
    const literal = table.replaceAll("'", "''");
    return `SELECT '${literal}' AS table_name,name AS column_name,type AS column_type,"notnull" AS not_null,dflt_value AS default_value,pk AS primary_key FROM pragma_table_info('${literal}')`;
  });
  const columns = [];
  for (let index = 0; index < selects.length; index += 4) {
    const rows = executeReadOnly(
      `${selects.slice(index, index + 4).join(" UNION ALL ")} ORDER BY table_name,column_name;`,
    );
    columns.push(
      ...rows.map((row) => ({
        table_name: String(row.table_name),
        column_name: String(row.column_name),
        column_type: String(row.column_type ?? ""),
        not_null: Number(row.not_null ?? 0),
        default_value: row.default_value == null ? null : String(row.default_value),
        primary_key: Number(row.primary_key ?? 0),
      })),
    );
  }
  const foreignKeySelects = tables.map((table) => {
    const literal = table.replaceAll("'", "''");
    return `SELECT '${literal}' AS table_name,"table" AS foreign_table,"from" AS from_column,"to" AS to_column,on_update,on_delete FROM pragma_foreign_key_list('${literal}')`;
  });
  const foreignKeys = [];
  for (let index = 0; index < foreignKeySelects.length; index += 4) {
    const rows = executeReadOnly(
      `${foreignKeySelects.slice(index, index + 4).join(" UNION ALL ")} ORDER BY table_name,foreign_table,from_column;`,
    );
    foreignKeys.push(
      ...rows.map((row) => ({
        table_name: String(row.table_name),
        foreign_table: String(row.foreign_table),
        from_column: String(row.from_column),
        to_column: String(row.to_column ?? ""),
        on_update: String(row.on_update ?? ""),
        on_delete: String(row.on_delete ?? ""),
      })),
    );
  }
  const objects = executeReadOnly(
    "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('index','trigger','view') AND name NOT LIKE 'sqlite_%' ORDER BY type,name;",
  ).map((row) => ({
    type: String(row.type),
    name: String(row.name),
    table_name: String(row.tbl_name ?? ""),
    sql: String(row.sql ?? "")
      .replace(/\\s+/g, " ")
      .trim()
      .toLowerCase(),
  }));
  return { tables, columns, foreignKeys, objects };
}

export function compareSchema(expected, actual) {
  const key = (row) => `${row.table_name}\u0000${row.column_name}`;
  const expectedMap = new Map(expected.columns.map((row) => [key(row), row]));
  const actualMap = new Map(actual.columns.map((row) => [key(row), row]));
  const missingTables = expected.tables.filter((name) => !actual.tables.includes(name));
  const extraTables = actual.tables.filter((name) => !expected.tables.includes(name));
  const missingColumns = [...expectedMap.keys()].filter((name) => !actualMap.has(name)).sort();
  const extraColumns = [...actualMap.keys()].filter((name) => !expectedMap.has(name)).sort();
  const mismatchedColumns = [];
  for (const name of [...expectedMap.keys()].filter((keyName) => actualMap.has(keyName)).sort()) {
    const expectedColumn = expectedMap.get(name);
    const actualColumn = actualMap.get(name);
    if (
      expectedColumn.column_type !== actualColumn.column_type ||
      expectedColumn.not_null !== actualColumn.not_null ||
      expectedColumn.default_value !== actualColumn.default_value ||
      expectedColumn.primary_key !== actualColumn.primary_key
    ) {
      mismatchedColumns.push({ expected: expectedColumn, actual: actualColumn });
    }
  }
  const runtimeOnlyTables = extraTables.filter((name) => expectedRuntimeTables.has(name));
  const unexpectedExtraTables = extraTables.filter((name) => !expectedRuntimeTables.has(name));
  const unexpectedExtraColumns = extraColumns.filter((name) => {
    const table = name.split("\u0000", 1)[0];
    return !expectedRuntimeTables.has(table) && !expectedRuntimeColumns.has(name);
  });
  const relationKey = (row) =>
    [row.table_name, row.foreign_table, row.from_column, row.to_column, row.on_update, row.on_delete].join("\u0000");
  const expectedRelations = new Map((expected.foreignKeys ?? []).map((row) => [relationKey(row), row]));
  const actualRelations = new Map((actual.foreignKeys ?? []).map((row) => [relationKey(row), row]));
  const missingForeignKeys = [...expectedRelations.keys()].filter((name) => !actualRelations.has(name)).sort();
  const extraForeignKeys = [...actualRelations.keys()]
    .filter((name) => !expectedRelations.has(name))
    .filter((name) => !expectedRuntimeTables.has(name.split("\u0000", 1)[0]))
    .sort();
  const objectKey = (row) => `${row.type}\u0000${row.name}`;
  const expectedObjects = new Map((expected.objects ?? []).map((row) => [objectKey(row), row]));
  const actualObjects = new Map((actual.objects ?? []).map((row) => [objectKey(row), row]));
  const missingObjects = [...expectedObjects.keys()].filter((name) => !actualObjects.has(name)).sort();
  const extraObjects = [...actualObjects.keys()].filter((name) => !expectedObjects.has(name));
  const unexpectedExtraObjects = extraObjects
    .filter((name) => {
      const object = actualObjects.get(name);
      return !expectedRuntimeTables.has(object.table_name);
    })
    .sort();
  const mismatchedObjects = [...expectedObjects.keys()]
    .filter((name) => actualObjects.has(name))
    .sort()
    .filter((name) => expectedObjects.get(name).sql !== actualObjects.get(name).sql)
    .map((name) => ({ expected: expectedObjects.get(name), actual: actualObjects.get(name) }));
  const compatible =
    missingTables.length === 0 &&
    unexpectedExtraTables.length === 0 &&
    missingColumns.length === 0 &&
    unexpectedExtraColumns.length === 0 &&
    mismatchedColumns.length === 0 &&
    missingForeignKeys.length === 0 &&
    extraForeignKeys.length === 0 &&
    missingObjects.length === 0 &&
    unexpectedExtraObjects.length === 0 &&
    mismatchedObjects.length === 0;
  return {
    expectedTableCount: expected.tables.length,
    actualTableCount: actual.tables.length,
    missingTables,
    extraTables,
    runtimeOnlyTables,
    unexpectedExtraTables,
    missingColumns,
    extraColumns,
    unexpectedExtraColumns,
    mismatchedColumns,
    missingForeignKeys,
    extraForeignKeys,
    missingObjects,
    unexpectedExtraObjects,
    mismatchedObjects,
    compatible,
  };
}

function aggregateCounts() {
  const tables = [
    "decave_users",
    "decave_sessions",
    "decave_direct_messages",
    "decave_messages",
    "messages",
    "dm_messages",
    "decave_group_chat_messages",
  ];
  const counts = [];
  for (let index = 0; index < tables.length; index += 4) {
    const sql = tables
      .slice(index, index + 4)
      .map((table) => `SELECT '${table}' AS table_name,COUNT(*) AS row_count FROM ${quoteIdentifier(table)}`)
      .join(" UNION ALL ");
    counts.push(...executeReadOnly(`${sql} ORDER BY table_name;`));
  }
  return counts.map((row) => ({ table: String(row.table_name), rows: Number(row.row_count) }));
}

export async function runAudit() {
  const config = loadProductionConfig();
  const discovered = verifyExactDatabase(parseD1List(runWrangler(["d1", "list", "--json"])));
  const migrationRows = executeReadOnly("SELECT id,name,applied_at FROM d1_migrations ORDER BY id;");
  const appliedMigrations = migrationRows.map((row) => String(row.name));
  const expectedMigrations = localMigrationNames();
  const migrationComparison = {
    localCount: expectedMigrations.length,
    remoteCount: appliedMigrations.length,
    missing: expectedMigrations.filter((name) => !appliedMigrations.includes(name)),
    extra: appliedMigrations.filter((name) => !expectedMigrations.includes(name)),
    orderMatches:
      expectedMigrations.length === appliedMigrations.length &&
      expectedMigrations.every((name, index) => name === appliedMigrations[index]),
  };
  const firstOrderDifference = migrationComparison.orderMatches
    ? null
    : expectedMigrations.findIndex((name, index) => name !== appliedMigrations[index]);
  migrationComparison.orderDifference =
    firstOrderDifference < 0
      ? null
      : {
          index: firstOrderDifference,
          repository: expectedMigrations[firstOrderDifference],
          remote: appliedMigrations[firstOrderDifference],
        };
  const schemaComparison = compareSchema(localSchema(), remoteSchema());
  const counts = aggregateCounts();
  const migrationReady = migrationComparison.missing.length === 0 && migrationComparison.extra.length === 0;
  const schemaCompatible =
    schemaComparison.missingTables.length === 0 &&
    schemaComparison.unexpectedExtraTables.length === 0 &&
    schemaComparison.missingColumns.length === 0 &&
    schemaComparison.unexpectedExtraColumns.length === 0 &&
    schemaComparison.mismatchedColumns.length === 0;
  return {
    readOnly: true,
    targetVerified: discovered,
    config,
    migrationComparison: { ...migrationComparison, ready: migrationReady },
    schemaComparison: { ...schemaComparison, compatible: schemaCompatible },
    aggregateCounts: counts,
    remediation:
      migrationReady && schemaCompatible
        ? "No migration remediation is indicated. Investigate runtime retention/deletion policy and production Worker configuration separately; do not apply migrations based on this audit."
        : "Do not apply migrations automatically. Review the listed migration/schema differences, stage a compatibility migration, and obtain an explicit production change approval before any write.",
  };
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  if (process.argv.length !== 2) {
    console.error("PRODUCTION D1 AUDIT BLOCKED: this fixed-target audit accepts no CLI arguments.");
    process.exitCode = 1;
  } else {
    try {
      console.log(JSON.stringify(await runAudit(), null, 2));
    } catch (error) {
      console.error(
        `PRODUCTION D1 AUDIT BLOCKED: ${error instanceof ProductionD1AuditError ? error.message : "read-only audit failed"}`,
      );
      process.exitCode = 1;
    }
  }
}
