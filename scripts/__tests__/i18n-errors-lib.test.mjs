// Error codes from Worker helpers outside the API routes: machine codes kept
// beside catalog codes, plural messages, and realtime error frames.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { NAMESPACES } = await import("../../shared/i18n/namespaces.ts");
const { apiErrorLegacy, englishErrorText, errorFields } = await import("../../worker/lib/http.ts");
const { streamerError, streamerErrorBody } = await import("../../worker/streamer/errors.ts");
const { StreamerInputError, identifier, text } = await import("../../shared/streamer-mode.ts");
const { pugCreateInput } = await import("../../shared/streamer-pugs.ts");
const runtime = await import("../../src/i18n/index.ts");
const { apiErrorMessage, realtimeErrorMessage } = await import("../../src/i18n/apiError.ts");

const readLocale = (locale) =>
  Object.fromEntries(
    NAMESPACES.map((ns) => [
      ns,
      JSON.parse(fs.readFileSync(path.join(root, "shared/i18n/locales", locale, `${ns}.json`), "utf8")),
    ]),
  );
runtime.setCatalogSource({ english: readLocale("en"), load: async (locale) => readLocale(locale) });
await runtime.initI18n("en");

test("a machine code clients branch on stays in code; the catalog key goes in i18nKey", async () => {
  const response = apiErrorLegacy("SAFETY_POLICY_UNAVAILABLE", "session.safetyPolicyUnavailable", 503);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    code: "SAFETY_POLICY_UNAVAILABLE",
    i18nKey: "session.safetyPolicyUnavailable",
    error: "Account safety policy is temporarily unavailable.",
  });
  assert.equal(
    apiErrorMessage(
      { code: "SAFETY_POLICY_UNAVAILABLE", i18nKey: "session.safetyPolicyUnavailable", error: "x" },
      "common.unknown",
    ),
    "Account safety policy is temporarily unavailable.",
  );
});

test("errorFields fills params into the English text", () => {
  assert.deepEqual(errorFields("session.accountSuspendedUntil", { until: "2027-01-01" }), {
    code: "session.accountSuspendedUntil",
    params: { until: "2027-01-01" },
    error: "This account is suspended until 2027-01-01.",
  });
});

test("plural codes pick the English form from count on both sides", () => {
  assert.equal(
    englishErrorText("streamer.giveawayMemberDays", { count: 1 }),
    "This giveaway needs 1 day in the Hub before entering.",
  );
  assert.equal(
    englishErrorText("streamer.giveawayMemberDays", { count: 7 }),
    "This giveaway needs 7 days in the Hub before entering.",
  );
  assert.equal(
    apiErrorMessage({ code: "streamer.giveawayMemberDays", params: { count: 7 } }, "common.unknown"),
    "This giveaway needs 7 days in the Hub before entering.",
  );
});

test("streamer errors and shared streamer input validation carry a code", () => {
  const coded = streamerError("streamer.pug.full", 409);
  assert.equal(coded.status, 409);
  assert.equal(coded.message, "This PUG is full.");
  assert.deepEqual(streamerErrorBody(coded), { code: "streamer.pug.full", error: "This PUG is full." });

  const caught = (run) => {
    try {
      run();
    } catch (error) {
      assert.ok(error instanceof StreamerInputError);
      return streamerErrorBody(error);
    }
    assert.fail("expected a StreamerInputError");
  };
  // The English text is unchanged; the field's label also travels as a catalog key.
  assert.deepEqual(
    caught(() => text(5, "title", 120)),
    {
      code: "streamerInput.notText",
      params: { field: "Title", fieldKey: "streamerInput.fields.title" },
      error: "Title must be text.",
    },
  );
  assert.equal(caught(() => text("", "streamUrl", 500)).error, "Stream URL must be 1–500 characters.");
  assert.equal(
    caught(() => pugCreateInput({ teamSize: 2, maps: ["Mirage", ""], voiceA: 1, voiceB: 2 })).error,
    "Map 2 must be 1–30 characters.",
  );
  assert.equal(caught(() => identifier("../x")).error, "Invalid identifier.");
});

test("a `fieldKey` param is translated in place of the English `field` label", () => {
  assert.equal(
    apiErrorMessage(
      { code: "streamerInput.notText", params: { field: "Not this", fieldKey: "streamerInput.fields.title" } },
      "common.unknown",
    ),
    "Title must be text.",
  );
  assert.equal(
    apiErrorMessage(
      {
        code: "streamerInput.length",
        params: { n: 3, field: "x", fieldKey: "streamerInput.fields.map", min: "1", max: 30 },
      },
      "common.unknown",
    ),
    "Map 3 must be 1–30 characters.",
  );
});

test("realtime error frames translate from code or i18nKey, else keep message, else the fallback", () => {
  assert.equal(
    realtimeErrorMessage(
      { type: "ERROR", code: "realtime.authRequired", message: "You must authenticate first" },
      "fallback",
    ),
    "You must authenticate first",
  );
  assert.equal(
    realtimeErrorMessage(
      { type: "ERROR", code: "FORUM_POST_LOCKED", i18nKey: "realtime.forum.postLocked", message: "old" },
      "fallback",
    ),
    "This post is locked.",
  );
  assert.equal(
    realtimeErrorMessage({ type: "ERROR", code: "nope.missing", message: "English" }, "fallback"),
    "English",
  );
  assert.equal(realtimeErrorMessage({ type: "ERROR" }, "fallback"), "fallback");
  assert.equal(realtimeErrorMessage(null, "fallback"), "fallback");
});
