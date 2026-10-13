// DM encryption errors (shared/dm-e2ee-session.ts) in the UI language: errors
// carry a catalog key next to their English message.

import { i18next } from "../i18n/index.ts";

const keyed = (key: unknown): string | null =>
  typeof key === "string" && (key.startsWith("dm.e2ee.errors.") || key.startsWith("errors.")) && i18next.exists(key)
    ? (i18next.t as unknown as (key: string) => string)(key)
    : null;

/** A caught error's text: its translated key, else its message, else the fallback. */
export function e2eeErrorText(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return keyed((error as Error & { key?: unknown }).key) ?? (error.message || fallback);
}

/** The encryption state's start-up error in the UI language. */
export function e2eeStateErrorText(state: { error: string; errorKey?: string | null }): string {
  return keyed(state.errorKey) ?? state.error;
}
