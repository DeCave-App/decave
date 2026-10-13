// Wording for Settings → Account & devices → Where you're signed in.

/** The words used, so the panel can pass translated ones; English by default. */
export type LastActiveWords = {
  locale: string;
  activeNow: string;
  /** "Active {{when}}", where when is e.g. "3 hours ago". */
  active: (when: string) => string;
  notUsedSince: (date: string) => string;
};

const ENGLISH: LastActiveWords = {
  locale: "en",
  activeNow: "Active now",
  active: (when) => `Active ${when}`,
  notUsedSince: (date) => `Not used since ${date}`,
};

/** "Active now", "Active 3 hours ago", "Not used since 2 Oct". */
export function describeLastActive(
  lastActiveAt: string | null | undefined,
  now = Date.now(),
  formatDate?: (iso: string) => string,
  words: LastActiveWords = ENGLISH,
): string {
  if (!lastActiveAt) return "";
  const at = Date.parse(lastActiveAt);
  if (!Number.isFinite(at)) return "";
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 10) return words.activeNow;
  const rtf = new Intl.RelativeTimeFormat(words.locale, { numeric: "auto" });
  if (minutes < 60) return words.active(rtf.format(-minutes, "minute"));
  const hours = Math.round(minutes / 60);
  if (hours < 24) return words.active(rtf.format(-hours, "hour"));
  const days = Math.round(hours / 24);
  if (days < 7) return words.active(rtf.format(-days, "day"));
  return words.notUsedSince(formatDate ? formatDate(lastActiveAt) : new Date(at).toDateString());
}
