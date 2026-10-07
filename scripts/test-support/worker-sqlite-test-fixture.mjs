import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function settle(work) {
  try {
    return Promise.resolve(work());
  } catch (error) {
    return Promise.reject(error);
  }
}

class D1Mock {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    // Account preferences are intentionally Worker-lazy in production. The
    // voice-position migration extends this runtime table, so seed its base
    // shape before replaying repository migrations in the test database.
    this.sqlite.exec(`
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
    const migrationDir = path.join(repositoryRoot, "migrations");
    for (const file of fs
      .readdirSync(migrationDir)
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      this.sqlite.exec(fs.readFileSync(path.join(migrationDir, file), "utf8"));
    }
  }

  prepare(sql) {
    const database = this.sqlite;
    let params = [];
    const statement = {
      bind(...values) {
        params = values;
        return statement;
      },
      // Like Cloudflare D1, every query returns a Promise and SQL errors reject
      // it (they never throw synchronously), so Worker code chaining
      // .then()/.catch() behaves the same in tests as in production.
      run() {
        return settle(() => statement._execute());
      },
      _execute() {
        const result = database.prepare(sql).run(...params);
        return {
          success: true,
          meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid ?? 0) },
        };
      },
      first() {
        return settle(() => database.prepare(sql).get(...params) ?? null);
      },
      all() {
        return settle(() => ({ results: database.prepare(sql).all(...params) }));
      },
    };
    return statement;
  }

  async batch(statements) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(statement._execute());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {}
      throw error;
    }
  }

  exec(sql, ...params) {
    return this.sqlite.prepare(sql).run(...params);
  }
  scalar(sql, ...params) {
    const row = this.sqlite.prepare(sql).get(...params);
    return row ? Object.values(row)[0] : undefined;
  }
}

class MediaMock {
  constructor() {
    this.objects = new Map();
    this.metadata = new Map();
  }
  async put(key, value, options = {}) {
    this.objects.set(key, value instanceof ArrayBuffer ? new Uint8Array(value) : value);
    this.metadata.set(key, options.httpMetadata ?? {});
  }
  async delete(key) {
    this.objects.delete(key);
    this.metadata.delete(key);
  }
  async get(key) {
    const value = this.objects.get(key);
    if (value === undefined) return null;
    const httpMetadata = this.metadata.get(key) ?? {};
    return {
      body: value instanceof Uint8Array ? value : new Uint8Array(value),
      httpMetadata,
      // Like R2: copy stored HTTP metadata onto response headers.
      writeHttpMetadata(headers) {
        if (httpMetadata.contentType) headers.set("content-type", httpMetadata.contentType);
      },
    };
  }
}

export { D1Mock, MediaMock };
