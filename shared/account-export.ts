// Account export helpers for the worker, web, desktop and mobile. The mobile
// app keeps an identical copy at mobile/src/lib/account-export.ts (checked by
// scripts/__tests__/account-export.test.mjs).

const EXPORT_FAILED = "The export could not be completed. Retry the download.";
const EXPORT_UNFINISHED = "The export did not finish. Retry the download.";

/** `error` in English, with `errorKey` (its catalog key) for apps that translate when it is one of these. */
function exportError(error: string): { complete: false; error: string; errorKey?: string } {
  if (error === EXPORT_FAILED) return { complete: false, error, errorKey: "settings.accountExport.failed" };
  if (error === EXPORT_UNFINISHED) return { complete: false, error, errorKey: "settings.accountExport.unfinished" };
  return { complete: false, error };
}

/** The v2 export streams a JSON object and writes this terminal status last. */
export function accountExportStatus(tail: string): { complete: boolean; error?: string; errorKey?: string } {
  const text = tail.trimEnd();
  if (/"complete"\s*:\s*true\s*}\s*$/.test(text)) return { complete: true };
  const failed = /"complete"\s*:\s*false\s*,\s*"error"\s*:\s*"((?:\\.|[^"\\])*)"\s*}\s*$/.exec(text);
  if (failed) {
    try {
      return exportError(JSON.parse(`"${failed[1]}"`) as string);
    } catch {
      return exportError(EXPORT_FAILED);
    }
  }
  return exportError(EXPORT_UNFINISHED);
}

/**
 * Account exports show which push registrations exist without reproducing a
 * usable push credential: only the token family and its last four characters.
 */
export function maskPushToken(token: unknown): string {
  const value = typeof token === "string" ? token : "";
  const wrapped = /^(Expo(?:nent)?PushToken\[)(.*)\]$/.exec(value);
  const prefix = wrapped ? wrapped[1]! : "";
  const inner = wrapped ? wrapped[2]! : value;
  const visible = inner.length > 8 ? inner.slice(-4) : "";
  const masked = `${"*".repeat(Math.max(4, Math.min(inner.length - visible.length, 16)))}${visible}`;
  return wrapped ? `${prefix}${masked}]` : masked;
}
