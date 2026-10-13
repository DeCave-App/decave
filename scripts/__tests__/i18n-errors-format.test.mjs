import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { NAMESPACES } = await import("../../shared/i18n/namespaces.ts");
const { apiError } = await import("../../worker/lib/http.ts");
const runtime = await import("../../src/i18n/index.ts");
const { apiErrorMessage } = await import("../../src/i18n/apiError.ts");
const { formatDate, formatList, formatNumber, formatRelative } = await import("../../src/i18n/format.ts");

const readLocale = (locale) =>
  Object.fromEntries(
    NAMESPACES.map((ns) => [
      ns,
      JSON.parse(fs.readFileSync(path.join(root, "shared/i18n/locales", locale, `${ns}.json`), "utf8")),
    ]),
  );
runtime.setCatalogSource({ english: readLocale("en"), load: async (locale) => readLocale(locale) });
await runtime.initI18n("en");
const englishErrors = readLocale("en").errors;

test("apiError returns the code, params and the English text", async () => {
  const response = apiError("account.localeInvalid", 400);
  assert.equal(response.status, 400);
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.deepEqual(await response.json(), {
    code: "account.localeInvalid",
    error: englishErrors.account.localeInvalid,
  });
  const withParams = await apiError("common.unknown", 500, { retry: 3 }).json();
  assert.deepEqual(withParams.params, { retry: 3 });
  assert.equal(withParams.error, "Something went wrong. Try again.");
});

test("apiErrorMessage translates codes, then falls back to the server text, then the fallback key", () => {
  assert.equal(
    apiErrorMessage({ code: "account.localeInvalid" }, "common.unknown"),
    englishErrors.account.localeInvalid,
  );
  assert.equal(apiErrorMessage({ code: "nope.unknownCode", error: "x" }, "common.unknown"), "x");
  assert.equal(apiErrorMessage({ error: "Server said no" }, "common.unknown"), "Server said no");
  assert.equal(apiErrorMessage(null, "common.unknown"), "Something went wrong. Try again.");
  assert.equal(apiErrorMessage(undefined, "common.unknown"), "Something went wrong. Try again.");
  assert.equal(apiErrorMessage({ code: "account", error: "y" }, "common.unknown"), "y", "a namespace is not a message");
});

test("formatNumber and formatList follow the UI language", async () => {
  assert.equal(formatNumber(1234.5), "1,234.5");
  assert.equal(formatList(["a", "b", "c"]), "a, b, and c");
  await runtime.initI18n("de");
  assert.equal(formatNumber(1234.5), "1.234,5");
  assert.equal(formatList(["a", "b", "c"]), "a, b und c");
  await runtime.initI18n("en");
});

test("formatRelative keeps today's short English labels", async () => {
  const now = Date.parse("2026-10-13T12:00:00Z");
  const ago = (ms) => new Date(now - ms).toISOString();
  assert.equal(formatRelative(ago(10_000), now), "now");
  assert.equal(formatRelative(ago(5 * 60_000), now), "5m");
  assert.equal(formatRelative(ago(3 * 3600_000), now), "3h");
  assert.equal(formatRelative(ago(2 * 86400_000), now), "2d");
  assert.equal(formatRelative(ago(14 * 86400_000), now), "2w");
  assert.equal(formatRelative("not a date", now), "");
  await runtime.initI18n("de");
  assert.notEqual(formatRelative(ago(5 * 60_000), now), "5m");
  assert.match(formatRelative(ago(5 * 60_000), now), /5/);
  await runtime.initI18n("en");
});

test("formatDate uses Intl with the date style override", () => {
  const value = Date.UTC(2026, 9, 13, 15, 4);
  assert.equal(formatDate(value, "medium"), new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(value));
  assert.equal(
    formatDate(new Date(value).toISOString(), "long"),
    new Intl.DateTimeFormat("en", { dateStyle: "long" }).format(value),
  );
  assert.equal(
    formatDate(value, "time"),
    new Date(value).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" }),
  );
  assert.equal(formatDate("garbage", "short"), "");
});
