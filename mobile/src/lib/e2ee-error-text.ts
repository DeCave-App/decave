// DM encryption errors (lib/e2ee/dm-e2ee-session.ts and dm-e2ee.ts) in the app
// language: errors carry a catalog key next to their English message. Mirrors
// the web app's src/e2ee/errorText.ts (the mobile bundle cannot import web src).

import i18next from "i18next";

const keyed = (key: unknown): string | null =>
  typeof key === "string" && (key.startsWith("dm.e2ee.errors.") || key.startsWith("errors.")) && i18next.exists(key)
    ? (i18next.t as unknown as (key: string) => string)(key)
    : null;

/** A caught error's text: its translated key, else its message, else the fallback. */
export function e2eeErrorText(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return keyed((error as Error & { key?: unknown }).key) ?? (error.message || fallback);
}

/** The encryption state's start-up error in the app language. */
export function e2eeStateErrorText(state: { error: string; errorKey?: string | null }): string {
  return keyed(state.errorKey) ?? state.error;
}
