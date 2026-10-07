// Account preferences stored on the server, and synced client settings.

import type { Env } from "./env";
import { nowIso } from "../db";

export let accountPreferencesSchemaReady: Promise<void> | null = null;

export type AccountPreferencesRow = {
  user_id: string;
  phone_number: string;
  username_changed_at: string | null;
  friend_request_policy: string;
  allow_stream_previews: number;
  streamer_mode: number;
  language: string;
  time_format: string;
  voice_mini_player_x: number | null;
  voice_mini_player_y: number | null;
  updated_at: string;
  /** Migration 0061. */
  login_alerts?: number;
  client_settings_json?: string;
  client_settings_updated_at?: string | null;
};

/** Settings that follow the account: a JSON object of at most 32 KB. */
export const CLIENT_SETTINGS_MAX_BYTES = 32 * 1024;

export function parseClientSettings(value: string | undefined | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function ensureAccountPreferencesSchema(env: Env): Promise<void> {
  if (accountPreferencesSchemaReady) return accountPreferencesSchemaReady;
  accountPreferencesSchemaReady = (async () => {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS decave_account_preferences (
        user_id TEXT PRIMARY KEY,
        phone_number TEXT NOT NULL DEFAULT '',
        username_changed_at TEXT,
        friend_request_policy TEXT NOT NULL DEFAULT 'everyone',
        allow_stream_previews INTEGER NOT NULL DEFAULT 1,
        streamer_mode INTEGER NOT NULL DEFAULT 0,
        language TEXT NOT NULL DEFAULT 'en',
        time_format TEXT NOT NULL DEFAULT 'system',
        voice_mini_player_x REAL,
        voice_mini_player_y REAL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
      )`,
    ).run();
    const columns = await env.DB.prepare("PRAGMA table_info(decave_account_preferences)").all<{ name: string }>();
    const upgrades = [] as D1PreparedStatement[];
    if (!columns.results.some((column) => column.name === "voice_mini_player_x")) {
      upgrades.push(env.DB.prepare("ALTER TABLE decave_account_preferences ADD COLUMN voice_mini_player_x REAL"));
    }
    if (!columns.results.some((column) => column.name === "voice_mini_player_y")) {
      upgrades.push(env.DB.prepare("ALTER TABLE decave_account_preferences ADD COLUMN voice_mini_player_y REAL"));
    }
    if (upgrades.length) await env.DB.batch(upgrades);
  })().catch((error) => {
    accountPreferencesSchemaReady = null;
    throw error;
  });
  return accountPreferencesSchemaReady;
}

export async function accountPreferencesRow(env: Env, userId: string): Promise<AccountPreferencesRow> {
  await ensureAccountPreferencesSchema(env);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO decave_account_preferences
     (user_id, phone_number, username_changed_at, friend_request_policy, allow_stream_previews, streamer_mode, language, time_format, voice_mini_player_x, voice_mini_player_y, updated_at)
     VALUES(?, '', NULL, 'everyone', 1, 0, 'en', 'system', NULL, NULL, ?)`,
  )
    .bind(userId, nowIso())
    .run();
  const row = await env.DB.prepare("SELECT * FROM decave_account_preferences WHERE user_id=?")
    .bind(userId)
    .first<AccountPreferencesRow>();
  if (!row) throw new Error("Could not initialize account preferences");
  return row;
}

export function accountPreferencesForClient(row: AccountPreferencesRow) {
  const changedAt = row.username_changed_at || null;
  const next = changedAt ? new Date(Date.parse(changedAt) + 30 * 24 * 60 * 60 * 1000).toISOString() : null;
  return {
    usernameChangedAt: changedAt,
    usernameChangeAvailableAt: next,
    friendRequestPolicy:
      row.friend_request_policy === "friends_of_friends" || row.friend_request_policy === "none"
        ? row.friend_request_policy
        : "everyone",
    allowStreamPreviews: row.allow_stream_previews !== 0,
    streamerMode: row.streamer_mode === 1,
    language:
      row.language === "pl" ||
      row.language === "el" ||
      row.language === "de" ||
      row.language === "fr" ||
      row.language === "es" ||
      row.language === "it" ||
      row.language === "pt"
        ? row.language
        : "en",
    timeFormat: row.time_format === "12h" || row.time_format === "24h" ? row.time_format : "system",
    voiceMiniPlayerPosition:
      Number.isFinite(Number(row.voice_mini_player_x)) && Number.isFinite(Number(row.voice_mini_player_y))
        ? { x: Number(row.voice_mini_player_x), y: Number(row.voice_mini_player_y) }
        : null,
    loginAlerts: row.login_alerts !== 0,
    clientSettings: parseClientSettings(row.client_settings_json),
    clientSettingsUpdatedAt: row.client_settings_updated_at ?? null,
  };
}
