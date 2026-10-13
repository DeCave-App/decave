// Result pages for third-party account links (Steam, Twitch, FACEIT) that open in
// the browser after the provider's sign-in. They render in the language of the
// account that started linking, else the browser's Accept-Language.

import { DEFAULT_LOCALE, resolveLocale, type Locale } from "../../shared/i18n/languages.ts";
import { storedLocale, tWith, workerT } from "./i18n";

export type LinkProvider = "steam" | "twitch" | "faceit";

/** Catalog entries under settings.linkPage.<provider>: each has a matching `<outcome>Title`. */
export type LinkOutcome = "expired" | "cancelled" | "signIn" | "failed" | "taken" | "linked";

const BRAND: Record<LinkProvider, string> = { steam: "Steam", twitch: "Twitch", faceit: "FACEIT" };

/** Accept-Language tags, highest quality first ("de-DE,de;q=0.9,en;q=0.5" -> ["de-DE", "de", "en"]). */
export function acceptLanguages(header: string | null): string[] {
  if (!header) return [];
  return header
    .split(",")
    .slice(0, 20)
    .map((part, index) => {
      const [tag, ...rest] = part.trim().split(";");
      const q = rest.map((item) => item.trim()).find((item) => item.startsWith("q="));
      const quality = q ? Number(q.slice(2)) : 1;
      return { tag: tag.trim(), quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter((item) => item.tag && item.tag !== "*" && item.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index)
    .map((item) => item.tag);
}

/** The account's saved language when it has one, else the browser's. */
export async function linkPageLocale(db: D1Database, request: Request, userId: string | null): Promise<Locale> {
  if (userId) {
    const saved = await db
      .prepare("SELECT locale FROM decave_users WHERE id=? LIMIT 1")
      .bind(userId)
      .first<{ locale: string | null }>()
      .catch(() => null);
    const locale = storedLocale(saved?.locale);
    if (locale) return locale;
  }
  return resolveLocale(acceptLanguages(request.headers.get("accept-language")));
}

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char] ?? char,
  );

/**
 * The page for one link outcome. `account` is the provider account name shown on
 * success; it is user content and is inserted verbatim (then HTML-escaped).
 */
export function linkResultPage(
  locale: Locale,
  provider: LinkProvider,
  outcome: LinkOutcome,
  options: { account?: string; showOpenDeCaveLink?: boolean } = {},
): Response {
  const t = workerT(locale) as unknown as (key: string) => string;
  const base = `settings.linkPage.${provider}.${outcome}`;
  const title = t(`${base}Title`);
  const message = options.account === undefined ? t(base) : tWith(workerT(locale), base, { account: options.account });
  const ok = outcome === "linked";
  const accent = ok ? "#64e6a6" : "#ff6b7a";
  const openDeCaveLink = options.showOpenDeCaveLink
    ? `<p style="margin:20px 0 0"><a href="${escapeHtml("/")}" style="color:#9bbcff">${escapeHtml(t("settings.linkPage.openDeCave"))}</a></p>`
    : "";
  const lang = locale === DEFAULT_LOCALE ? "" : ` lang="${escapeHtml(locale)}"`;
  return new Response(
    `<!doctype html><html${lang}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="margin:0;background:#050712;color:#eaf3ff;font-family:system-ui,-apple-system,Segoe UI,sans-serif;display:grid;place-items:center;min-height:100vh"><main style="max-width:520px;margin:24px;padding:30px;border:1px solid rgba(120,160,255,.2);border-radius:18px;background:#0b1220;box-shadow:0 24px 80px rgba(0,0,0,.38)"><div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:${accent};font-weight:800">DeCave · ${escapeHtml(BRAND[provider])}</div><h1 style="font-size:26px;margin:10px 0 10px">${escapeHtml(title)}</h1><p style="color:#aebbd0;line-height:1.6;margin:0">${escapeHtml(message)}</p>${openDeCaveLink}<p style="color:#77849a;font-size:13px;margin:20px 0 0">${escapeHtml(t("settings.linkPage.closeTab"))}</p></main></body></html>`,
    { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}
