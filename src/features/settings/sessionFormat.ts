// Wording for Settings → Account → Where you're signed in.

/** "Active now", "Active 3 hours ago", "Not used since 2 Oct". */
export function describeLastActive(
  lastActiveAt: string | null | undefined,
  now = Date.now(),
  formatDate?: (iso: string) => string,
): string {
  if (!lastActiveAt) return "";
  const at = Date.parse(lastActiveAt);
  if (!Number.isFinite(at)) return "";
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 10) return "Active now";
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (minutes < 60) return `Active ${rtf.format(-minutes, "minute")}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Active ${rtf.format(-hours, "hour")}`;
  const days = Math.round(hours / 24);
  if (days < 7) return `Active ${rtf.format(-days, "day")}`;
  return `Not used since ${formatDate ? formatDate(lastActiveAt) : new Date(at).toDateString()}`;
}
