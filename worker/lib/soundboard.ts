// Hub soundboard: schema and sounds as sent to the client.

import type { Env } from "./env";

export let soundboardSchemaReady: Promise<void> | null = null;

export type SoundboardRow = {
  id: string;
  user_id: string;
  hub_id: number | null;
  name: string;
  mime_type: string;
  size_bytes: number;
  r2_key: string;
  created_at: string;
};

export function ensureSoundboardSchema(env: Env): Promise<void> {
  if (soundboardSchemaReady) return soundboardSchemaReady;
  soundboardSchemaReady = env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS decave_soundboard_sounds (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        hub_id INTEGER,
        name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        r2_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE,
        FOREIGN KEY(hub_id) REFERENCES decave_hubs(id) ON DELETE CASCADE
      )`,
    ),
    env.DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_decave_soundboard_user ON decave_soundboard_sounds(user_id, created_at)",
    ),
    env.DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_decave_soundboard_hub ON decave_soundboard_sounds(hub_id, created_at)",
    ),
  ])
    .then(() => undefined)
    .catch((error) => {
      soundboardSchemaReady = null;
      throw error;
    });
  return soundboardSchemaReady;
}

export function soundboardSoundForClient(row: SoundboardRow) {
  return {
    id: row.id,
    uploaderUserId: row.user_id,
    name: row.name,
    mimeType: row.mime_type,
    size: Number(row.size_bytes),
    createdAt: row.created_at,
    url: `/api/soundboard/${encodeURIComponent(row.id)}/media`,
  };
}
