// Web builds are fingerprinted: each release serves a new /assets/index-<hash>.js.
// A tab or Home Screen web app left open keeps running the old bundle, so the
// app compares its own entry script with the one the server lists now.

const ENTRY_SCRIPT = /\/assets\/index-[\w-]+\.js/;

/** The entry script path in an HTML page, or null (dev server, error page). */
export function entryScriptFromHtml(html: string): string | null {
  return html.match(ENTRY_SCRIPT)?.[0] ?? null;
}

/** The entry script this page was loaded with, or null outside a production build. */
export function runningEntryScript(doc: Pick<Document, "querySelectorAll">): string | null {
  for (const script of Array.from(doc.querySelectorAll("script[src]"))) {
    const match = (script.getAttribute("src") ?? "").match(ENTRY_SCRIPT);
    if (match) return match[0];
  }
  return null;
}

/** Coming back to the app after at least this long counts as "returning". */
export const RETURN_AFTER_MS = 60_000;

/**
 * Reload into the new release only when the person is coming back to the app
 * (so nothing they are doing is interrupted) and is not in a call.
 */
export function shouldReloadForRelease(input: {
  running: string | null;
  latest: string | null;
  hiddenForMs: number;
  busy: boolean;
}): boolean {
  if (!input.running || !input.latest || input.running === input.latest) return false;
  return !input.busy && input.hiddenForMs >= RETURN_AFTER_MS;
}
