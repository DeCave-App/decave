export type NotificationPreview = "full" | "sender" | "hidden";

/**
 * Message contents stay off the lock screen unless the user explicitly opts
 * into a less private preview mode.
 */
export const DEFAULT_NOTIFICATION_PREVIEW: NotificationPreview = "hidden";

export function normalizeNotificationPreview(value: unknown): NotificationPreview {
  return value === "full" || value === "sender" || value === "hidden" ? value : DEFAULT_NOTIFICATION_PREVIEW;
}

/**
 * A non-hidden preview is only eligible while the local endpoint is unlocked.
 * Callers must derive that state from the approved native custody boundary;
 * this helper deliberately fails closed when it is not available.
 */
export function resolveNotificationPreview(value: unknown, localDeviceUnlocked: boolean): NotificationPreview {
  const mode = normalizeNotificationPreview(value);
  return localDeviceUnlocked ? mode : DEFAULT_NOTIFICATION_PREVIEW;
}
