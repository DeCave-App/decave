import {
  DEFAULT_NOTIFICATION_PREVIEW,
  normalizeNotificationPreview,
  type NotificationPreview,
} from "./notification-preview";

export type NotificationSettings = {
  enabled: boolean;
  sound: boolean;
  dms: boolean;
  groups: boolean;
  hubMessages: boolean;
  mentions: boolean;
  notificationPreview: NotificationPreview;
};

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  sound: true,
  dms: true,
  groups: true,
  hubMessages: true,
  mentions: true,
  notificationPreview: DEFAULT_NOTIFICATION_PREVIEW,
};

const SETTINGS_KEYS = Object.keys(DEFAULT_NOTIFICATION_SETTINGS) as (keyof NotificationSettings)[];

export type NotificationSettingsSession = { key: string; generation: number };

type Snapshot = {
  scopeKey: string | null;
  generation: number;
  settings: NotificationSettings;
  loaded: boolean;
  serverLoaded: boolean;
};

export function notificationSettingsStorageKey(accountId: string): string {
  const encodedId = Array.from(accountId, (character) => character.codePointAt(0)!.toString(16)).join(".");
  return `decave.notificationPrivacy.v2.${encodedId}`;
}

export function normalizeNotificationSettings(
  value: Partial<NotificationSettings> | null | undefined,
): NotificationSettings {
  return {
    enabled: typeof value?.enabled === "boolean" ? value.enabled : DEFAULT_NOTIFICATION_SETTINGS.enabled,
    sound: typeof value?.sound === "boolean" ? value.sound : DEFAULT_NOTIFICATION_SETTINGS.sound,
    dms: typeof value?.dms === "boolean" ? value.dms : DEFAULT_NOTIFICATION_SETTINGS.dms,
    groups: typeof value?.groups === "boolean" ? value.groups : DEFAULT_NOTIFICATION_SETTINGS.groups,
    hubMessages: typeof value?.hubMessages === "boolean" ? value.hubMessages : DEFAULT_NOTIFICATION_SETTINGS.hubMessages,
    mentions: typeof value?.mentions === "boolean" ? value.mentions : DEFAULT_NOTIFICATION_SETTINGS.mentions,
    notificationPreview: normalizeNotificationPreview(value?.notificationPreview),
  };
}

/**
 * Owns notification choices for one authenticated session at a time. Callers
 * may render defaults for a new session before activating or loading it.
 */
export class NotificationSettingsStore {
  private snapshot: Snapshot = {
    scopeKey: null,
    generation: 0,
    settings: DEFAULT_NOTIFICATION_SETTINGS,
    loaded: true,
    serverLoaded: false,
  };
  private touched = new Set<keyof NotificationSettings>();
  private listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = () => this.snapshot;

  sessionKey(accountId: string | null, token: string | null): string | null {
    return accountId && token ? JSON.stringify([accountId, token]) : null;
  }

  settingsFor(scopeKey: string | null): NotificationSettings {
    return this.snapshot.scopeKey === scopeKey ? this.snapshot.settings : DEFAULT_NOTIFICATION_SETTINGS;
  }

  loadedFor(scopeKey: string | null): boolean {
    return this.snapshot.scopeKey === scopeKey ? this.snapshot.loaded : scopeKey === null;
  }

  activate(accountId: string | null, token: string | null): NotificationSettingsSession | null {
    const key = this.sessionKey(accountId, token);
    if (this.snapshot.scopeKey !== key) {
      const generation = this.snapshot.generation + 1;
      this.touched = new Set();
      this.replace({
        scopeKey: key,
        generation,
        settings: DEFAULT_NOTIFICATION_SETTINGS,
        loaded: key === null,
        serverLoaded: false,
      });
    }
    return key ? { key, generation: this.snapshot.generation } : null;
  }

  update(scopeKey: string | null, patch: Partial<NotificationSettings>): NotificationSettings | null {
    if (!scopeKey || this.snapshot.scopeKey !== scopeKey) return null;
    for (const key of Object.keys(patch) as (keyof NotificationSettings)[]) this.touched.add(key);
    const settings = normalizeNotificationSettings({ ...this.snapshot.settings, ...patch });
    this.replace({ ...this.snapshot, settings });
    return settings;
  }

  reset(scopeKey: string | null): NotificationSettings | null {
    return this.update(scopeKey, DEFAULT_NOTIFICATION_SETTINGS);
  }

  hydrateLocal(session: NotificationSettingsSession, value: Partial<NotificationSettings>): boolean {
    if (!this.isCurrent(session) || this.snapshot.serverLoaded) return false;
    const settings = this.mergeUntouched(value, true);
    this.replace({ ...this.snapshot, settings });
    return true;
  }

  hydrateServer(session: NotificationSettingsSession, value: Partial<NotificationSettings>): boolean {
    if (!this.isCurrent(session)) return false;
    const settings = this.mergeUntouched(value, false);
    this.replace({ ...this.snapshot, settings, loaded: true, serverLoaded: true });
    return true;
  }

  finishHydration(session: NotificationSettingsSession): void {
    if (!this.isCurrent(session)) return;
    if (!this.snapshot.loaded) this.replace({ ...this.snapshot, loaded: true });
  }

  private isCurrent(session: NotificationSettingsSession): boolean {
    return this.snapshot.scopeKey === session.key && this.snapshot.generation === session.generation;
  }

  private mergeUntouched(
    value: Partial<NotificationSettings>,
    keepPrivatePreview: boolean,
  ): NotificationSettings {
    const patch = { ...value };
    for (const key of SETTINGS_KEYS) if (this.touched.has(key)) delete patch[key];
    if (keepPrivatePreview) delete patch.notificationPreview;
    return normalizeNotificationSettings({ ...this.snapshot.settings, ...patch });
  }

  private replace(snapshot: Snapshot): void {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }
}
