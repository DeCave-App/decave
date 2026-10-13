// English text of a catalog key without an i18next instance, for shared modules
// that return keys to clients but still hand English to the Worker and to
// callers without translations. Plain {{name}} placeholders only (no plurals).

export type TextParams = Record<string, string | number>;

/** Fills {{name}} placeholders; unknown names stay as written. */
export function interpolate(template: string, params?: TextParams): string {
  return template.replace(/\{\{\s*([^,}\s]+)\s*\}\}/g, (match, name: string) =>
    params && name in params ? String(params[name]) : match,
  );
}

/** The catalog's text at a dotted path ("media.banner.hint"), filled in; the path itself when missing. */
export function englishText(catalog: unknown, path: string, params?: TextParams): string {
  let node: unknown = catalog;
  for (const part of path.split(".")) node = (node as Record<string, unknown> | undefined)?.[part];
  return interpolate(typeof node === "string" ? node : path, params);
}
