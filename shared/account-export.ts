/** The v2 export streams a JSON object and writes this terminal status last. */
export function accountExportStatus(tail: string): { complete: boolean; error?: string } {
  const text = tail.trimEnd();
  if (/"complete"\s*:\s*true\s*}\s*$/.test(text)) return { complete: true };
  const failed = /"complete"\s*:\s*false\s*,\s*"error"\s*:\s*"((?:\\.|[^"\\])*)"\s*}\s*$/.exec(text);
  if (failed) {
    try {
      return { complete: false, error: JSON.parse(`"${failed[1]}"`) as string };
    } catch {
      return { complete: false, error: "The export could not be completed. Retry the download." };
    }
  }
  return { complete: false, error: "The export did not finish. Retry the download." };
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
