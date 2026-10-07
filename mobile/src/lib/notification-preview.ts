export type NotificationPreview = "full" | "sender" | "hidden";

/**
 * Message contents stay off the lock screen unless the user explicitly opts
 * into a less private preview mode.
 */
export const DEFAULT_NOTIFICATION_PREVIEW: NotificationPreview = "hidden";

export function normalizeNotificationPreview(
  value: unknown,
): NotificationPreview {
  return value === "full" || value === "sender" || value === "hidden"
    ? value
    : DEFAULT_NOTIFICATION_PREVIEW;
}
