// Muted Hubs and rooms, synced with web and desktop through the account's
// client settings: `mutedHubs` maps a Hub id to when its mute ends (-1 = until
// turned off; see src/features/settings/settingsSync.ts), and a room is muted
// when its notification level is "nothing".

import type { NotifyLevel, SyncedClientSettings } from "./account-preferences";

export function liveMutedHubs(settings: SyncedClientSettings | null | undefined, now = Date.now()): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, until] of Object.entries(settings?.mutedHubs ?? {})) {
    if (until === -1 || until > now) out[id] = until;
  }
  return out;
}

export function isHubMuted(settings: SyncedClientSettings | null | undefined, hubId: number, now = Date.now()): boolean {
  return String(hubId) in liveMutedHubs(settings, now);
}

export function mutedRoomIds(settings: SyncedClientSettings | null | undefined): number[] {
  return Object.entries(settings?.notifyLevels?.rooms ?? {})
    .filter(([, level]) => level === "nothing")
    .map(([id]) => Number(id))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
}

export function withHubMuted(settings: SyncedClientSettings | null | undefined, hubId: number, muted: boolean, now = Date.now()) {
  const mutedHubs = liveMutedHubs(settings, now);
  if (muted) mutedHubs[String(hubId)] = -1;
  else delete mutedHubs[String(hubId)];
  return { mutedHubs };
}

/** `null` returns the room to its Hub's level. */
export function withRoomLevel(settings: SyncedClientSettings | null | undefined, roomId: number, level: NotifyLevel | null) {
  const rooms: Record<string, NotifyLevel> = { ...(settings?.notifyLevels?.rooms ?? {}) };
  if (level === null) delete rooms[String(roomId)];
  else rooms[String(roomId)] = level;
  return { notifyLevels: { hubs: { ...(settings?.notifyLevels?.hubs ?? {}) }, rooms } };
}
