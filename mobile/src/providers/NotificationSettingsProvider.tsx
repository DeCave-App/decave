import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import * as SecureStore from "expo-secure-store";
import { loadAccountPreferences, type SyncedClientSettings } from "@/src/lib/account-preferences";
import {
  NotificationSettingsStore,
  normalizeNotificationSettings,
  notificationSettingsStorageKey,
  type NotificationSettings,
} from "@/src/lib/notification-settings-store";
import { useSession } from "@/src/providers/SessionProvider";

export type { NotificationPreview } from "@/src/lib/notification-preview";
export { DEFAULT_NOTIFICATION_SETTINGS } from "@/src/lib/notification-settings-store";
export type { NotificationSettings } from "@/src/lib/notification-settings-store";

type NotificationSettingsContextValue = {
  settings: NotificationSettings;
  loaded: boolean;
  updateSettings: (patch: Partial<NotificationSettings>) => void;
  resetSettings: () => void;
};

const NotificationSettingsContext = createContext<NotificationSettingsContextValue | null>(null);
const LEGACY_STORAGE_KEY = "decave_mobile_notification_privacy_v1";

void SecureStore.deleteItemAsync(LEGACY_STORAGE_KEY).catch(() => undefined);

function notificationSettingsFromServer(
  clientSettings: SyncedClientSettings | null | undefined,
): Partial<NotificationSettings> {
  const notifications = clientSettings?.notifications;
  return normalizeNotificationSettings({
    enabled: notifications?.enabled,
    sound: notifications?.sounds,
    dms: notifications?.dms,
    groups: notifications?.groups,
    hubMessages: notifications?.hubMessages,
    mentions: notifications?.mentions,
    notificationPreview: clientSettings?.privacy?.notificationPreview,
  });
}

export function NotificationSettingsProvider({ children }: PropsWithChildren) {
  const { user, token } = useSession();
  const [store] = useState(() => new NotificationSettingsStore());
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const accountId = user?.id ?? null;
  const scopeKey = store.sessionKey(accountId, token);
  const settings = store.settingsFor(scopeKey);
  const loaded = store.loadedFor(scopeKey);

  useEffect(() => {
    const session = store.activate(accountId, token);
    if (!session || !accountId || !token) return;
    const storageKey = notificationSettingsStorageKey(accountId);

    void SecureStore.getItemAsync(storageKey)
      .then((raw) => {
        if (!raw) return;
        try {
          store.hydrateLocal(session, normalizeNotificationSettings(JSON.parse(raw) as Partial<NotificationSettings>));
        } catch {}
      })
      .catch(() => undefined);

    void loadAccountPreferences(token)
      .then((preferences) => store.hydrateServer(session, notificationSettingsFromServer(preferences.clientSettings)))
      .catch(() => undefined)
      .finally(() => store.finishHydration(session));
  }, [accountId, token, store]);

  const value = useMemo<NotificationSettingsContextValue>(
    () => ({
      settings,
      loaded,
      updateSettings: (patch) => {
        const next = store.update(scopeKey, patch);
        if (next && accountId) {
          void SecureStore.setItemAsync(notificationSettingsStorageKey(accountId), JSON.stringify(next)).catch(
            () => undefined,
          );
        }
      },
      resetSettings: () => {
        const next = store.reset(scopeKey);
        if (next && accountId) {
          void SecureStore.setItemAsync(notificationSettingsStorageKey(accountId), JSON.stringify(next)).catch(
            () => undefined,
          );
        }
      },
    }),
    [accountId, loaded, scopeKey, settings, store],
  );

  return <NotificationSettingsContext.Provider value={value}>{children}</NotificationSettingsContext.Provider>;
}

export function useNotificationSettings(): NotificationSettingsContextValue {
  const value = useContext(NotificationSettingsContext);
  if (!value) throw new Error("useNotificationSettings must be used inside NotificationSettingsProvider");
  return value;
}
