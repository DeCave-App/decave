// Lazily created tables and columns for Hub collaboration and Hub features.

import type { Env } from "./env";

export let collaborationSchemaReady: Promise<void> | null = null;

export function ensureCollaborationSchema(env: Env): Promise<void> {
  if (collaborationSchemaReady) return collaborationSchemaReady;
  const ready = env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS decave_presence_activity (
        user_id TEXT PRIMARY KEY,
        last_seen_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
      )`,
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS decave_hub_share_links (
        hub_id INTEGER PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(hub_id) REFERENCES decave_hubs(id) ON DELETE CASCADE
      )`,
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS decave_dm_preferences (
        user_id TEXT NOT NULL,
        peer_user_id TEXT NOT NULL,
        favorite INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(user_id, peer_user_id),
        FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE,
        FOREIGN KEY(peer_user_id) REFERENCES decave_users(id) ON DELETE CASCADE
      )`,
    ),
    // Keep this self-healing for databases that were initialized before the
    // migration shipped. The migration remains the deploy-time contract.
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS decave_hub_imports (
        id TEXT PRIMARY KEY,
        hub_id INTEGER NOT NULL,
        created_by TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        created_at TEXT NOT NULL,
        rolled_back_at TEXT,
        FOREIGN KEY(hub_id) REFERENCES decave_hubs(id) ON DELETE CASCADE,
        FOREIGN KEY(created_by) REFERENCES decave_users(id) ON DELETE CASCADE
      )`,
    ),
    env.DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_decave_hub_imports_hub_created ON decave_hub_imports(hub_id, created_at DESC)",
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS decave_hub_import_rooms (
        import_id TEXT NOT NULL,
        room_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('text','voice')),
        kind TEXT NOT NULL CHECK(kind IN ('chat','forum')),
        category TEXT NOT NULL,
        position INTEGER NOT NULL,
        private INTEGER NOT NULL CHECK(private IN (0,1)),
        icon TEXT NOT NULL,
        forum_guidelines TEXT NOT NULL,
        forum_post_policy TEXT NOT NULL,
        forum_post_role_ids_json TEXT NOT NULL,
        forum_post_member_ids_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(import_id, room_id),
        FOREIGN KEY(import_id) REFERENCES decave_hub_imports(id) ON DELETE CASCADE
      )`,
    ),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_decave_hub_import_rooms_room ON decave_hub_import_rooms(room_id)"),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS decave_hub_import_roles (
        import_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        icon TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(import_id, role_id),
        FOREIGN KEY(import_id) REFERENCES decave_hub_imports(id) ON DELETE CASCADE
      )`,
    ),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_decave_hub_import_roles_role ON decave_hub_import_roles(role_id)"),
  ])
    .then(() => undefined)
    .catch((error) => {
      collaborationSchemaReady = null;
      throw error;
    });
  collaborationSchemaReady = ready;
  return ready;
}

export let hubFeatureSchemaReady: Promise<void> | null = null;

export function ensureHubFeatureSchema(env: Env): Promise<void> {
  if (hubFeatureSchemaReady) return hubFeatureSchemaReady;
  hubFeatureSchemaReady = (async () => {
    await env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS decave_hub_assets (
        id TEXT PRIMARY KEY, hub_id INTEGER NOT NULL, kind TEXT NOT NULL,
        name TEXT NOT NULL, r2_key TEXT NOT NULL, mime_type TEXT NOT NULL,
        created_by TEXT NOT NULL, created_at TEXT NOT NULL,
        FOREIGN KEY(hub_id) REFERENCES decave_hubs(id) ON DELETE CASCADE,
        FOREIGN KEY(created_by) REFERENCES decave_users(id) ON DELETE CASCADE
      )`),
      env.DB.prepare(
        "CREATE INDEX IF NOT EXISTS idx_decave_hub_assets_hub ON decave_hub_assets(hub_id, kind, created_at)",
      ),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS decave_hub_bots (
        id TEXT PRIMARY KEY, hub_id INTEGER NOT NULL, name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        token_hash TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL,
        capabilities TEXT NOT NULL DEFAULT '["send_messages"]',
        allowed_room_ids TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
        FOREIGN KEY(hub_id) REFERENCES decave_hubs(id) ON DELETE CASCADE,
        FOREIGN KEY(created_by) REFERENCES decave_users(id) ON DELETE CASCADE
      )`),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_decave_hub_bots_hub ON decave_hub_bots(hub_id, created_at)"),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS decave_room_members (
        room_id INTEGER NOT NULL, user_id TEXT NOT NULL, granted_by TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY(room_id, user_id),
        FOREIGN KEY(room_id) REFERENCES decave_rooms(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE,
        FOREIGN KEY(granted_by) REFERENCES decave_users(id) ON DELETE CASCADE
      )`),
      env.DB.prepare(
        "CREATE INDEX IF NOT EXISTS idx_decave_room_members_user ON decave_room_members(user_id, room_id)",
      ),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS decave_hub_home (
        hub_id INTEGER PRIMARY KEY,
        sections_json TEXT NOT NULL DEFAULT '[]',
        welcome TEXT NOT NULL DEFAULT '',
        rules TEXT NOT NULL DEFAULT '',
        updated_by TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(hub_id) REFERENCES decave_hubs(id) ON DELETE CASCADE
      )`),
    ]);
    const columns = await env.DB.prepare("PRAGMA table_info(decave_rooms)").all<{ name: string }>();
    if (!columns.results.some((column) => column.name === "icon")) {
      await env.DB.prepare("ALTER TABLE decave_rooms ADD COLUMN icon TEXT NOT NULL DEFAULT ''").run();
    }
    // Migration 0058 adds the official START HERE rooms without naming the
    // runtime-only icon column; give them their icons once the column exists.
    try {
      await env.DB.prepare(
        `UPDATE decave_rooms SET icon=CASE name WHEN 'rules' THEN '📜' ELSE '❓' END
         WHERE icon='' AND name IN ('rules','faq')
           AND hub_id IN (SELECT hub_id FROM decave_official_hubs WHERE key='decave-community-v1')`,
      ).run();
    } catch (error) {
      console.warn("Official room icons not set", error);
    }
    const hubColumns = await env.DB.prepare("PRAGMA table_info(decave_hubs)").all<{ name: string }>();
    if (!hubColumns.results.some((column) => column.name === "icon_ring")) {
      await env.DB.prepare("ALTER TABLE decave_hubs ADD COLUMN icon_ring INTEGER NOT NULL DEFAULT 0").run();
    }
    if (!hubColumns.results.some((column) => column.name === "chat_background_key")) {
      await env.DB.prepare("ALTER TABLE decave_hubs ADD COLUMN chat_background_key TEXT").run();
    }
    if (!hubColumns.results.some((column) => column.name === "use_chat_background")) {
      await env.DB.prepare("ALTER TABLE decave_hubs ADD COLUMN use_chat_background INTEGER NOT NULL DEFAULT 0").run();
    }
    const botColumns = await env.DB.prepare("PRAGMA table_info(decave_hub_bots)").all<{ name: string }>();
    if (!botColumns.results.some((column) => column.name === "description")) {
      await env.DB.prepare("ALTER TABLE decave_hub_bots ADD COLUMN description TEXT NOT NULL DEFAULT ''").run();
    }
    if (!botColumns.results.some((column) => column.name === "capabilities")) {
      await env.DB.prepare(
        "ALTER TABLE decave_hub_bots ADD COLUMN capabilities TEXT NOT NULL DEFAULT '[\"send_messages\"]'",
      ).run();
    }
    if (!botColumns.results.some((column) => column.name === "allowed_room_ids")) {
      await env.DB.prepare("ALTER TABLE decave_hub_bots ADD COLUMN allowed_room_ids TEXT NOT NULL DEFAULT '[]'").run();
    }
  })().catch((error) => {
    hubFeatureSchemaReady = null;
    throw error;
  });
  return hubFeatureSchemaReady;
}
