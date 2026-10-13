import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("../test-support/mobile-extensionless-loader.mjs", import.meta.url);
await import("../test-support/mobile-i18n-english.mjs");
const { summarizeBot, timeAgo } = await import("../../mobile/src/lib/bots.ts");

const now = Date.parse("2026-10-09T12:00:00Z");
const rules = (n) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, enabled: true }));

test("summarizeBot shows rule count and last run", () => {
  assert.equal(
    summarizeBot({ pausedReason: null, rules: rules(3), lastRunAt: "2026-10-09 11:58:00" }, now),
    "3 rules · last run 2 min ago",
  );
  assert.equal(summarizeBot({ pausedReason: null, rules: rules(1), lastRunAt: null }, now), "1 rule · No runs yet");
});

test("summarizeBot flags bots paused after errors", () => {
  assert.equal(summarizeBot({ pausedReason: "errors", rules: rules(2), lastRunAt: null }, now), "Paused after errors");
});

test("timeAgo handles ISO and day-scale times", () => {
  assert.equal(timeAgo("2026-10-09T11:59:50Z", now), "just now");
  assert.equal(timeAgo("2026-10-07 12:00:00", now), "2 d ago");
});
