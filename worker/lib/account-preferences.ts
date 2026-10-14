// Account preferences stored on the server, and synced client settings.

import type { Env } from "./env";
import { nowIso } from "../db";
import { ensureActivitySchema } from "./activity";
import { twitchConfigured } from "../twitch/client";
import { faceitLoginConfigured } from "../faceit/client";
import { isDateStyleLanguage } from "../../shared/date-style";

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
  /** Migration 0089: provider → shown on the profile. */
  connection_visibility_json?: string;
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
    language: isDateStyleLanguage(row.language) ? row.language : "en",
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

/**
 * Whether a screen share may show previews. Clients that send no
 * `allowStreamPreview` (the mobile app before 0.1.95) follow the account
 * setting instead of defaulting to allowed.
 */
export async function screenPreviewAllowed(requested: unknown, stored: () => Promise<boolean>): Promise<boolean> {
  return typeof requested === "boolean" ? requested : stored();
}

/** The account's Stream privacy setting; allowed when never set. */
export async function storedAllowStreamPreviews(env: Env, userId: string): Promise<boolean> {
  await ensureAccountPreferencesSchema(env);
  const row = await env.DB.prepare("SELECT allow_stream_previews FROM decave_account_preferences WHERE user_id=?")
    .bind(userId)
    .first<{ allow_stream_previews: number }>();
  return row ? row.allow_stream_previews !== 0 : true;
}

/** Linked accounts shown in Settings → Connections, in display order. */
export const CONNECTION_PROVIDERS = ["steam", "twitch", "faceit"] as const;
export type ConnectionProvider = (typeof CONNECTION_PROVIDERS)[number];

export function isConnectionProvider(value: string): value is ConnectionProvider {
  return (CONNECTION_PROVIDERS as readonly string[]).includes(value);
}

export type AccountConnection = {
  provider: ConnectionProvider;
  linked: boolean;
  displayName?: string;
  showOnProfile: boolean;
  /** False when the server has no credentials for that provider; the app hides it. */
  available: boolean;
};

function parseVisibility(value: string | undefined | null): Partial<Record<ConnectionProvider, boolean>> {
  const parsed = parseClientSettings(value);
  return Object.fromEntries(CONNECTION_PROVIDERS.map((provider) => [provider, parsed[provider] === true]));
}

async function linkedNames(env: Env, userId: string): Promise<Partial<Record<ConnectionProvider, string>>> {
  await ensureActivitySchema(env);
  const optional = <T>(query: Promise<T | null>) => query.catch(() => null);
  const [steam, twitch, faceit] = await Promise.all([
    optional(
      env.DB.prepare("SELECT persona_name AS name, steam_id AS id FROM decave_steam_links WHERE user_id=?")
        .bind(userId)
        .first<{ name: string; id: string }>(),
    ),
    optional(
      env.DB.prepare("SELECT login AS name FROM decave_twitch_member_links WHERE user_id=?")
        .bind(userId)
        .first<{ name: string }>(),
    ),
    optional(
      env.DB.prepare("SELECT nickname AS name FROM decave_faceit_links WHERE user_id=?")
        .bind(userId)
        .first<{ name: string }>(),
    ),
  ]);
  const names: Partial<Record<ConnectionProvider, string>> = {};
  if (steam) names.steam = steam.name || steam.id;
  if (twitch) names.twitch = twitch.name;
  if (faceit) names.faceit = faceit.name;
  return names;
}

function providerAvailable(env: Env, provider: ConnectionProvider): boolean {
  if (provider === "twitch") return twitchConfigured(env);
  if (provider === "faceit") return faceitLoginConfigured(env);
  return true;
}

/** The account's own view: every provider, linked or not. */
export async function accountConnections(env: Env, userId: string): Promise<AccountConnection[]> {
  const [row, names] = await Promise.all([accountPreferencesRow(env, userId), linkedNames(env, userId)]);
  const visibility = parseVisibility(row.connection_visibility_json);
  return CONNECTION_PROVIDERS.map((provider) => ({
    provider,
    linked: names[provider] !== undefined,
    ...(names[provider] !== undefined ? { displayName: names[provider] } : {}),
    showOnProfile: visibility[provider] === true,
    available: providerAvailable(env, provider),
  }));
}

export async function setConnectionVisibility(
  env: Env,
  userId: string,
  provider: ConnectionProvider,
  showOnProfile: boolean,
): Promise<void> {
  const row = await accountPreferencesRow(env, userId);
  const visibility = { ...parseVisibility(row.connection_visibility_json), [provider]: showOnProfile };
  await env.DB.prepare(
    "UPDATE decave_account_preferences SET connection_visibility_json=?, updated_at=? WHERE user_id=?",
  )
    .bind(JSON.stringify(visibility), nowIso(), userId)
    .run();
}

/** What other people see on the profile: linked accounts the owner chose to show. */
export async function profileConnections(
  env: Env,
  userId: string,
): Promise<{ provider: ConnectionProvider; displayName: string }[]> {
  const connections = await accountConnections(env, userId);
  return connections
    .filter((item) => item.available && item.linked && item.showOnProfile)
    .map((item) => ({ provider: item.provider, displayName: item.displayName ?? "" }));
}
