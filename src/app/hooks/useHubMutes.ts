// Muted Hubs: saves the list locally, applies timed mutes as they start and
// expire, and syncs mutes to the account so phones stay quiet too.

import { useEffect, type MutableRefObject } from "react";
import type { AccountUser } from "../types";
import type { PreferencesState } from "../state/preferences";
import { MUTED_HUBS_KEY } from "../settings-storage";
import { HTTP_URL } from "../env";
import { authorizedFetch } from "../http";
import { SETTINGS_SYNC_STAMP_KEY, mutedHubsForSync } from "../../features/settings/settingsSync";

export type HubMutesDeps = {
  currentUser: AccountUser | null;
  preferences: PreferencesState;
  mutedHubIdsRef: MutableRefObject<Set<number>>;
  /** The mutes last sent to or received from the account (shared with settings sync). */
  lastSyncedMutesRef: MutableRefObject<string | null>;
};

export function useHubMutes({ currentUser, preferences, mutedHubIdsRef, lastSyncedMutesRef }: HubMutesDeps): void {
  useEffect(() => {
    mutedHubIdsRef.current = new Set(preferences.mutedHubIds);
    try {
      localStorage.setItem(MUTED_HUBS_KEY, JSON.stringify(preferences.mutedHubIds));
    } catch {}
  }, [preferences.mutedHubIds]);

  useEffect(() => {
    const applyMuteSchedule = () => {
      const now = Date.now();
      const activeIds = Object.entries(preferences.hubMuteSchedule)
        .filter(([, until]) => until === -1 || until > now)
        .map(([id]) => Number(id))
        .filter(Number.isFinite);
      const expiredIds = Object.entries(preferences.hubMuteSchedule)
        .filter(([, until]) => until !== -1 && until <= now)
        .map(([id]) => Number(id));
      if (expiredIds.length)
        preferences.setHubMuteSchedule((current) =>
          Object.fromEntries(Object.entries(current).filter(([, until]) => until === -1 || until > Date.now())),
        );
      preferences.setMutedHubIds((current) =>
        Array.from(new Set([...current.filter((id) => !expiredIds.includes(id)), ...activeIds])),
      );
      try {
        localStorage.setItem(
          "decave-hub-mute-schedule-v1",
          JSON.stringify(
            Object.fromEntries(
              Object.entries(preferences.hubMuteSchedule).filter(([, until]) => until === -1 || until > now),
            ),
          ),
        );
      } catch {}
    };
    applyMuteSchedule();
    const timer = window.setInterval(applyMuteSchedule, 60000);
    return () => window.clearInterval(timer);
  }, [preferences.hubMuteSchedule]);

  // Muting a Hub (bell on Hub Home, right-click) happens outside Settings, so
  // send it to the account straight away; the server uses it to keep phones
  // quiet too. Debounced, and skipped when nothing changed.
  useEffect(() => {
    if (!currentUser) return;
    const mutedHubs = mutedHubsForSync(preferences.mutedHubIds, preferences.hubMuteSchedule);
    const serialized = JSON.stringify(mutedHubs);
    if (lastSyncedMutesRef.current === null) {
      lastSyncedMutesRef.current = serialized;
      return;
    }
    if (lastSyncedMutesRef.current === serialized) return;
    const timer = window.setTimeout(() => {
      lastSyncedMutesRef.current = serialized;
      void authorizedFetch(`${HTTP_URL}/api/account/preferences`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientSettingsPatch: { mutedHubs, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" },
        }),
      })
        .then((response) => response.json().catch(() => ({})))
        .then((data: { clientSettingsUpdatedAt?: string }) => {
          if (data.clientSettingsUpdatedAt) {
            try {
              localStorage.setItem(SETTINGS_SYNC_STAMP_KEY, data.clientSettingsUpdatedAt);
            } catch {}
          }
        })
        .catch(() => {
          lastSyncedMutesRef.current = null;
        });
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [preferences.mutedHubIds, preferences.hubMuteSchedule, currentUser?.id]);
}
