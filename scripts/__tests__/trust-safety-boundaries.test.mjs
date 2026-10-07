import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readAppSource } from "./app-source.mjs";
import { readWorkerSource } from "./worker-source.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");

test("Trust & Safety migrations keep private evidence ciphertext-only", () => {
  const safety = read("migrations/0032_account_safety.sql");
  const core = read("migrations/0033_trust_safety_core.sql");
  const evidence = read("migrations/0034_trust_safety_evidence.sql");

  assert.match(safety, /age_status TEXT NOT NULL DEFAULT 'unconfirmed'/);
  assert.match(safety, /age_band TEXT NOT NULL DEFAULT 'unknown'/);
  assert.match(safety, /teen_safety_mode INTEGER NOT NULL DEFAULT 1/);
  assert.match(core, /CREATE TABLE IF NOT EXISTS decave_reports/);
  assert.match(core, /CREATE TABLE IF NOT EXISTS decave_moderation_cases/);
  assert.match(core, /CREATE TABLE IF NOT EXISTS decave_moderation_audit_log/);
  assert.match(core, /CREATE TRIGGER IF NOT EXISTS decave_moderation_audit_no_update/);
  assert.match(core, /CREATE TRIGGER IF NOT EXISTS decave_moderation_audit_no_delete/);
  assert.match(evidence, /object_key TEXT NOT NULL UNIQUE/);
  assert.match(evidence, /ciphertext_sha256 TEXT NOT NULL/);
  assert.match(evidence, /ciphertext_size INTEGER NOT NULL/);
  assert.match(evidence, /key_id TEXT NOT NULL/);
  const evidenceSchema = evidence.replace(/--[^\r\n]*/g, "");
  assert.doesNotMatch(evidenceSchema, /\bcontent\s+TEXT\b/i);
  assert.doesNotMatch(evidenceSchema, /plaintext/i);
});

test("Trust & Safety API is dispatched and owner-gated", () => {
  const worker = readWorkerSource();
  const trustSafetyDispatch = worker.indexOf("const trustSafetyResponse = await handleTrustSafetyApi");

  assert.ok(trustSafetyDispatch >= 0, "Trust & Safety dispatch should exist");
  assert.match(
    worker,
    /const adminPrefix = "\/api\/admin\/trust-safety";[\s\S]*?const owner = await requirePlatformOwner\(request, env\);/,
  );
  assert.match(worker, /const evidenceGetRoute = idFromPath\([\s\S]*?ownerRequireReauth\(request, env, owner\.id\)/);
  assert.match(worker, /const key = await activeTrustSafetyKey\(env\.DB\);/);
  assert.match(worker, /const objectKey = `safety-evidence\/v1\/\$\{reportId\}\/\$\{evidenceId\}\.bin`;/);
  assert.doesNotMatch(worker, /decave_report_evidence[\s\S]{0,120}\bcontent\b/);
  const actionInsert = worker.slice(worker.indexOf("INSERT INTO decave_moderation_actions"));
  const actionValues = actionInsert.match(/VALUES\(([^)]*)\)/)?.[1] || "";
  assert.equal(actionValues.split("?").length - 1, 11, "moderation action insert must match its 11 bound values");
  assert.match(worker, /actionType === "no_action_taken"/);
  assert.match(worker, /storedReasonCode = noActionTaken \? "no_action_taken"/);
});

test("Age, report, and block paths are wired across the product", () => {
  const worker = readWorkerSource();
  const hub = read("worker/HubRoom.ts");
  const web = readAppSource();
  const mobileDm = read("mobile/app/dm/[id].tsx");
  const mobileGroup = read("mobile/app/group/[id].tsx");
  const mobileChannel = read("mobile/app/channel/[id].tsx");
  const mobileVoice = read("mobile/app/voice/[id].tsx");

  assert.match(worker, /deriveAgeProfile\(body\.birthDate\)/);
  assert.match(worker, /code: "AGE_RESTRICTED"/);
  assert.match(worker, /const reportCreate = pathname === "\/api\/safety\/reports" && method === "POST"/);
  assert.match(worker, /const blockDetail = idFromPath\(pathname, \/\^\\\/api\\\/safety\\\/blocks/);
  assert.match(worker, /isBlockedEitherDirection\(env\.DB, user\.id, targetId\)/);
  assert.match(hub, /isBlockedEitherDirection\(this\.env\.DB, state\.userId, targetId\)/);
  assert.match(hub, /isBlockedEitherDirection\(this\.env\.DB, state\.userId, targetUserId\)/);
  assert.match(web, /Report User/);
  assert.match(web, /openSafetyReport\(/);
  assert.match(web, /TrustSafetyDashboard/);
  assert.match(mobileDm, /Report message/);
  assert.match(mobileGroup, /Report message/);
  assert.match(mobileChannel, /Report message/);
  assert.match(mobileVoice, /Report user/);
});
