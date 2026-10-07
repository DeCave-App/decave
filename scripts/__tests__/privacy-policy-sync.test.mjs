import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { test } from "node:test";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const root = path.resolve(import.meta.dirname, "..", "..");
const { renderPrivacyPolicyMarkdown } = await import("../dev/render-privacy-policy.mjs");
const { RETENTION_DAYS } = await import("../../worker/retention.ts");
const { PRIVACY_POLICY } = await import("../../website/src/privacy-policy.ts");

test("docs/legal/PRIVACY-POLICY.md is generated from the website policy source", async () => {
  const markdown = fs.readFileSync(path.join(root, "docs", "legal", "PRIVACY-POLICY.md"), "utf8");
  assert.equal(markdown, await renderPrivacyPolicyMarkdown());
});

test("the published retention table matches the retention job", () => {
  const rows = PRIVACY_POLICY.sections
    .flatMap((section) => section.blocks)
    .flatMap((block) => ("table" in block ? block.table.rows : []));
  const keptFor = (label) => rows.find(([name]) => name.startsWith(label))?.[1];
  assert.equal(RETENTION_DAYS.securityEvents, 180);
  assert.equal(keptFor("Security log"), "180 days");
  assert.equal(RETENTION_DAYS.knownDevices, 365);
  assert.equal(keptFor("Devices remembered"), "1 year after last use");
  assert.equal(RETENTION_DAYS.closedCaseEvidence, 183);
  assert.equal(keptFor("Evidence attached"), "6 months after the case is closed");
  assert.equal(RETENTION_DAYS.closedCaseRecords, 365);
  assert.equal(keptFor("Reports, moderation cases"), "1 year after the case is closed");
  assert.equal(RETENTION_DAYS.auditLogs, 365);
  assert.equal(keptFor("Moderation and admin audit"), "1 year");
  assert.equal(RETENTION_DAYS.hubAuditLog, 183);
  assert.equal(keptFor("Hub moderation history"), "6 months");
  assert.equal(RETENTION_DAYS.feedback, 365);
  assert.equal(keptFor("Feedback"), "1 year");
});

test("the policy no longer names removed integrations", () => {
  const text = JSON.stringify(PRIVACY_POLICY);
  assert.doesNotMatch(text, /twitch|youtube/i);
});
