// Official DeCave Hubs: schema, automatic membership and who may post.

import type { Env } from "./env";
import { nowIso, officialHubPostingDecision } from "../db";
import { json } from "./http";

export let officialHubSchemaReady: Promise<void> | null = null;

export function ensureOfficialHubSchema(env: Env): Promise<void> {
  if (officialHubSchemaReady) return officialHubSchemaReady;
  officialHubSchemaReady = (async () => {
    await env.DB.batch([
      env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS decave_official_hubs (
          key TEXT PRIMARY KEY,
          hub_id INTEGER NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          FOREIGN KEY(hub_id) REFERENCES decave_hubs(id) ON DELETE CASCADE
        )`,
      ),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_decave_official_hubs_hub ON decave_official_hubs(hub_id)"),
    ]);
    const columns = await env.DB.prepare("PRAGMA table_info(decave_official_hubs)").all<{ name: string }>();
    if (columns.results.some((column) => column.name === "owner_only_posts")) {
      await env.DB.prepare("UPDATE decave_official_hubs SET owner_only_posts=1 WHERE key='decave-community-v1'").run();
    }
  })().catch((error) => {
    officialHubSchemaReady = null;
    throw error;
  });
  return officialHubSchemaReady;
}

export async function joinOfficialHubs(env: Env, userId: string, joinedAt = nowIso()): Promise<void> {
  await ensureOfficialHubSchema(env);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO decave_hub_members(hub_id,user_id,role,joined_at)
     SELECT hub_id,?,'member',? FROM decave_official_hubs`,
  )
    .bind(userId, joinedAt)
    .run();
}

export async function officialHubMembershipPrivate(db: D1Database, hubId: number): Promise<boolean> {
  try {
    const row = await db
      .prepare("SELECT membership_private FROM decave_official_hubs WHERE hub_id=? LIMIT 1")
      .bind(hubId)
      .first<{ membership_private: number }>();
    return Number(row?.membership_private ?? 0) === 1;
  } catch {
    return false;
  }
}

export async function requireHubPostingPermission(
  db: D1Database,
  hubId: number,
  userId: string,
): Promise<Response | null> {
  const decision = await officialHubPostingDecision(db, hubId, userId);
  if (decision === "unavailable") {
    return json(
      {
        error: "Official Hub posting policy is temporarily unavailable.",
        code: "HUB_POLICY_UNAVAILABLE",
      },
      503,
    );
  }
  if (decision === "deny") {
    return json({ error: "Only the Hub owner can post in this Hub" }, 403);
  }
  return null;
}
