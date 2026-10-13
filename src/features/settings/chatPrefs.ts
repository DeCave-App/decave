// Settings → Chat: how the composer sends, whether GIFs and emotes animate,
// large emoji, spoilers and spellcheck. Kept on this device and synced with
// the account (SyncedSettings.chat); components read the live value through
// useChatPrefs() and event handlers through getChatPrefs().

import { useSyncExternalStore } from "react";

export type ChatPrefs = {
  sendWith: "enter" | "ctrlEnter";
  animate: "always" | "hover";
  largeEmoji: boolean;
  spoilers: "click" | "always";
  spellcheck: boolean;
};

/** Today's behaviour, so nothing changes until someone picks otherwise. */
export const DEFAULT_CHAT_PREFS: ChatPrefs = {
  sendWith: "enter",
  animate: "always",
  largeEmoji: true,
  spoilers: "click",
  spellcheck: true,
};

export const CHAT_PREFS_KEY = "decave_chat_prefs_v1";

export function normalizeChatPrefs(value: unknown): ChatPrefs {
  const raw = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Partial<
    Record<keyof ChatPrefs, unknown>
  >;
  return {
    sendWith: raw.sendWith === "ctrlEnter" ? "ctrlEnter" : "enter",
    animate: raw.animate === "hover" ? "hover" : "always",
    largeEmoji: raw.largeEmoji !== false,
    spoilers: raw.spoilers === "always" ? "always" : "click",
    spellcheck: raw.spellcheck !== false,
  };
}

/**
 * Whether this key press sends the message. Shift+Enter never sends (it is a
 * new line); Ctrl/Cmd+Enter always sends; plain Enter sends only in Enter mode.
 */
export function shouldSend(
  event: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
  prefs: Pick<ChatPrefs, "sendWith">,
): boolean {
  if (event.key !== "Enter" || event.shiftKey) return false;
  if (event.ctrlKey || event.metaKey) return true;
  return prefs.sendWith === "enter";
}

const EMOTE = /:[\p{L}\p{N}_-]+:/gu;
const PICTOGRAPH = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;
const NOT_EMOJI = /[\p{L}\p{N}\p{P}]/u;

type GraphemeSegmenter = new (
  locale: undefined,
  options: { granularity: "grapheme" },
) => { segment(text: string): Iterable<{ segment: string }> };

function graphemes(text: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: GraphemeSegmenter }).Segmenter;
  if (Segmenter)
    return Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(text), (item) => item.segment);
  return Array.from(text);
}

/** One to three emoji and nothing else (whitespace ignored); custom :emote: tokens count as emoji. */
export function isEmojiOnly(text: string): boolean {
  const emotes = text.match(EMOTE)?.length ?? 0;
  const rest = text.replace(EMOTE, "").replace(/\s+/gu, "");
  const symbols = rest ? graphemes(rest) : [];
  for (const symbol of symbols) {
    if (!PICTOGRAPH.test(symbol)) return false;
    // Keycaps start with a digit or # and end with U+20E3; anything else with letters, digits or punctuation is text.
    if (!symbol.includes("⃣") && NOT_EMOJI.test(symbol)) return false;
  }
  const count = emotes + symbols.length;
  return count >= 1 && count <= 3;
}

// ---------------------------------------------------------------- store

function load(): ChatPrefs {
  try {
    return normalizeChatPrefs(JSON.parse(localStorage.getItem(CHAT_PREFS_KEY) || "{}"));
  } catch {
    return DEFAULT_CHAT_PREFS;
  }
}

let current: ChatPrefs | null = null;
const listeners = new Set<() => void>();

export function getChatPrefs(): ChatPrefs {
  if (!current) current = load();
  return current;
}

/** Changes the preferences on this device; the account copy is saved with the other synced settings. */
export function setChatPrefs(next: ChatPrefs): void {
  current = normalizeChatPrefs(next);
  try {
    localStorage.setItem(CHAT_PREFS_KEY, JSON.stringify(current));
  } catch {}
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useChatPrefs(): ChatPrefs {
  return useSyncExternalStore(subscribe, getChatPrefs, getChatPrefs);
}
