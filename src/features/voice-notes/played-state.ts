// Per-device "I have played this voice note" memory (used for Hub rooms; DMs use receipts).
const MAX_IDS = 2000;
const key = (accountId: string) => `decave.voiceNote.played.${accountId}`;

function read(accountId: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key(accountId)) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function isLocallyPlayed(accountId: string, messageId: string): boolean {
  return read(accountId).includes(messageId);
}

export function markLocallyPlayed(accountId: string, messageId: string): void {
  try {
    const ids = read(accountId).filter((id) => id !== messageId);
    ids.push(messageId);
    localStorage.setItem(key(accountId), JSON.stringify(ids.slice(-MAX_IDS)));
  } catch {
    /* storage unavailable */
  }
}
