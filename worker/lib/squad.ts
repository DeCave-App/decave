// Squad Finder: schema, supported games and filters, and searches as sent to
// the client.

import type { Env } from "./env";

export let squadFinderSchemaReady: Promise<void> | null = null;

export let squadGameSuggestionsSchemaReady: Promise<void> | null = null;

export function ensureSquadFinderSchema(env: Env): Promise<void> {
  if (squadFinderSchemaReady) return squadFinderSchemaReady;
  const ready = env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS decave_squad_searches (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE,
        game TEXT NOT NULL,
        platform TEXT NOT NULL,
        language TEXT NOT NULL,
        region TEXT NOT NULL,
        microphone_required INTEGER NOT NULL DEFAULT 0,
        group_id TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE,
        FOREIGN KEY(group_id) REFERENCES decave_group_chats(id) ON DELETE SET NULL
      )`,
    ),
    env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_decave_squad_match
       ON decave_squad_searches(status,game,platform,language,region,microphone_required,expires_at)`,
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS decave_squad_rooms (
        group_id TEXT PRIMARY KEY,
        hub_id INTEGER NOT NULL UNIQUE,
        room_id INTEGER NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        FOREIGN KEY(group_id) REFERENCES decave_group_chats(id) ON DELETE CASCADE,
        FOREIGN KEY(hub_id) REFERENCES decave_hubs(id) ON DELETE CASCADE,
        FOREIGN KEY(room_id) REFERENCES decave_rooms(id) ON DELETE CASCADE
      )`,
    ),
  ])
    .then(() => undefined)
    .catch((error) => {
      squadFinderSchemaReady = null;
      throw error;
    });
  squadFinderSchemaReady = ready;
  return ready;
}

export async function ensureSquadGameSuggestionsSchema(env: Env): Promise<void> {
  if (squadGameSuggestionsSchemaReady) return squadGameSuggestionsSchemaReady;
  const ready = env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS decave_squad_game_suggestions (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, game_name TEXT NOT NULL,
        game_name_normalized TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
        reviewed_by TEXT, created_at TEXT NOT NULL, reviewed_at TEXT,
        FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE,
        FOREIGN KEY(reviewed_by) REFERENCES decave_users(id) ON DELETE SET NULL,
        UNIQUE(user_id, game_name_normalized)
      )`,
    ),
    env.DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_decave_squad_game_suggestions_status ON decave_squad_game_suggestions(status,created_at)",
    ),
  ])
    .then(() => undefined)
    .catch((error) => {
      squadGameSuggestionsSchemaReady = null;
      throw error;
    });
  squadGameSuggestionsSchemaReady = ready;
  return ready;
}

export const SQUAD_GAMES = [
  "Escape from Tarkov",
  "PUBG",
  "Counter-Strike 2",
  "Dota 2",
  "League of Legends",
  "Valorant",
  "Fortnite",
  "Apex Legends",
  "Call of Duty: Warzone",
  "Call of Duty",
  "Minecraft",
  "Roblox",
  "Rocket League",
  "Overwatch 2",
  "Rainbow Six Siege",
  "Destiny 2",
  "Marvel Rivals",
  "Grand Theft Auto Online",
  "FiveM",
  "Palworld",
  "Helldivers 2",
  "Dead by Daylight",
  "Warframe",
  "World of Warcraft",
  "Final Fantasy XIV",
  "Path of Exile 2",
  "Rust",
  "ARK: Survival Ascended",
  "Sea of Thieves",
  "THE FINALS",
  "Battlefield",
  "Delta Force",
  "War Thunder",
  "World of Tanks",
  "Mobile Legends: Bang Bang",
  "Free Fire",
  "Brawl Stars",
  "Clash Royale",
  "Pokémon GO",
] as const;

export const SQUAD_PLATFORMS = ["PC", "PlayStation", "Xbox", "Mobile"] as const;

export const SQUAD_LANGUAGES = [
  "English",
  "Polish",
  "German",
  "French",
  "Spanish",
  "Italian",
  "Portuguese",
  "Dutch",
  "Swedish",
  "Norwegian",
  "Danish",
  "Finnish",
  "Czech",
  "Slovak",
  "Hungarian",
  "Romanian",
  "Greek",
  "Bulgarian",
  "Serbian",
  "Croatian",
  "Slovenian",
  "Lithuanian",
  "Latvian",
  "Estonian",
  "Turkish",
  "Arabic",
  "Hebrew",
  "Persian",
  "Russian",
  "Ukrainian",
  "Hindi",
  "Bengali",
  "Urdu",
  "Chinese",
  "Japanese",
  "Korean",
  "Thai",
  "Vietnamese",
  "Indonesian",
  "Malay",
  "Filipino",
] as const;

export const SQUAD_REGIONS = [
  "Europe",
  "North America",
  "South America",
  "Asia",
  "Oceania",
  "Middle East",
  "Africa",
] as const;

export type SquadSearchRow = {
  id: string;
  user_id: string;
  game: string;
  platform: string;
  language: string;
  region: string;
  microphone_required: number;
  group_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
  username?: string;
  public_id?: string | null;
  avatar_key?: string | null;
  avatar_updated_at?: string | null;
  member_count?: number;
};

export function squadChoice(value: unknown, allowed: readonly string[]): string | null {
  if (typeof value !== "string") return null;
  const found = allowed.find((item) => item.toLowerCase() === value.trim().toLowerCase());
  return found ?? null;
}

export function normalizedSquadGame(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export async function resolveSquadGame(env: Env, value: unknown): Promise<string | null> {
  if (typeof value !== "string") return null;
  const builtIn = squadChoice(value, SQUAD_GAMES);
  if (builtIn) return builtIn;
  await ensureSquadGameSuggestionsSchema(env);
  const row = await env.DB.prepare(
    "SELECT game_name FROM decave_squad_game_suggestions WHERE game_name_normalized=? AND status='approved' ORDER BY reviewed_at DESC LIMIT 1",
  )
    .bind(normalizedSquadGame(value))
    .first<{ game_name: string }>();
  return row?.game_name ?? null;
}

export function squadSearchForClient(row: SquadSearchRow) {
  return {
    id: row.id,
    game: row.game,
    platform: row.platform,
    language: row.language,
    region: row.region,
    microphoneRequired: row.microphone_required === 1,
    groupId: row.group_id,
    memberCount: Math.max(1, Number(row.member_count ?? 1)),
    expiresAt: row.expires_at,
    owner: row.username
      ? {
          id: row.public_id,
          username: row.username,
          avatarUrl: row.avatar_key
            ? `/api/media/${encodeURIComponent(row.avatar_key)}${row.avatar_updated_at ? `?v=${encodeURIComponent(row.avatar_updated_at)}` : ""}`
            : null,
        }
      : undefined,
  };
}
