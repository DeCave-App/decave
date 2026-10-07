import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readWorkerSource } from "./worker-source.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");

test("Official Hub posting policy fails closed across all write boundaries", () => {
  const db = read("worker/db.ts");
  const worker = readWorkerSource();
  const hub = read("worker/HubRoom.ts");

  assert.match(db, /export async function getOfficialHubPostingPolicy\([\s\S]*?return \{ status: "unavailable" \};/);
  assert.match(db, /typeof row\.owner_only_posts !== "number"/);
  assert.match(
    db,
    /export async function officialHubPostingDecision\([\s\S]*?if \(policy\.status === "unavailable"\) return "unavailable"/,
  );
  assert.match(worker, /async function requireHubPostingPermission\([\s\S]*?code: "HUB_POLICY_UNAVAILABLE"/);
  assert.match(worker, /const postingError = await requireHubPostingPermission\(/);
  assert.equal((worker.match(/requireHubPostingPermission\(env\.DB/g) ?? []).length, 4);
  assert.match(worker, /await ensureOfficialHubSchema\(env\)/);
  assert.match(hub, /const postingDecision = await officialHubPostingDecision\(/);
  assert.match(hub, /code: "HUB_POLICY_UNAVAILABLE"/);
  assert.doesNotMatch(worker, /async function officialHubOwnerOnlyPosting\(/);
  assert.doesNotMatch(hub, /async function canPostToHub\(/);
  assert.match(worker, /UPDATE decave_official_hubs SET owner_only_posts=1 WHERE key='decave-community-v1'/);
  assert.match(worker, /Official Hub posting policy is temporarily unavailable\.[\s\S]*?HUB_POLICY_UNAVAILABLE/);
});

test("WebSocket admission and message processing are bounded", () => {
  const hub = read("worker/HubRoom.ts");

  assert.match(hub, /const REALTIME_MESSAGE_TYPES = new Set\(/);
  assert.match(hub, /if \(current\.count >= limit\) return false/);
  assert.match(hub, /const MAX_REALTIME_TYPE_LENGTH = 64/);
  assert.match(
    hub,
    /const knownType = type\.length <= MAX_REALTIME_TYPE_LENGTH && REALTIME_MESSAGE_TYPES\.has\(type\)/,
  );
  assert.match(hub, /const rateType = knownType \? type : "__unknown__"/);
  assert.match(hub, /allowRealtime\(state\.connectionId, "__frame__"\)/);
  assert.match(hub, /JSON\.parse/);
  assert.ok(
    hub.indexOf('allowRealtime(state.connectionId, "__frame__")') < hub.indexOf("data = JSON.parse"),
    "raw frame admission must happen before JSON parsing",
  );
  assert.match(hub, /if \(!this\.allowRealtime\(state\.connectionId, rateType, false\)\)/);
  assert.match(hub, /Unknown realtime message type/);
  assert.match(hub, /const MAX_IDENTIFY_FAILURES = 5/);
  assert.match(hub, /const WS_IDENTIFY_FAILURE_LIMIT_PER_ADDRESS = 60/);
  assert.match(hub, /identifyFailures: state\.identifyFailures \+ 1/);
  assert.match(hub, /identifyFailuresForAddress\(state\.peerAddress\)/);
  assert.match(hub, /recordIdentifyFailure\(state\.peerAddress\)/);
  assert.match(hub, /data\.token\.length <= 256/);
  assert.match(hub, /Authentication is temporarily unavailable/);
  assert.match(hub, /state\.identifyFailures >= MAX_IDENTIFY_FAILURES/);
  assert.match(hub, /const MAX_REALTIME_RATE_VIOLATIONS = 3/);
  assert.match(hub, /rateLimitViolations: state\.rateLimitViolations \+ 1/);
  assert.match(hub, /next\.rateLimitViolations >= MAX_REALTIME_RATE_VIOLATIONS/);
  assert.match(hub, /const WS_AUTH_DEADLINE_MS = 30_000/);
  assert.match(hub, /async alarm\(\): Promise<void>/);
  assert.match(hub, /Authentication timed out/);
  assert.match(hub, /storage\.setAlarm\(Math\.min\(\.\.\.deadlines\)\)/);
  assert.match(hub, /storage\.deleteAlarm\(\)/);
  assert.match(hub, /private realtimeRate = new Map<string, Map<string, RealtimeRateBucket>>\(\)/);
  assert.match(hub, /this\.realtimeRate\.delete\(state\.connectionId\)/);
  assert.match(hub, /CF-Connecting-IP/);
  assert.match(hub, /const WS_CONNECTION_LIMIT_PER_ADDRESS = 32/);
  assert.match(hub, /const WS_CONNECTION_LIMIT_GLOBAL = 2_048/);
  assert.match(hub, /const WS_HANDSHAKE_LIMIT_PER_ADDRESS = 60/);
  assert.match(hub, /if \(!this\.allowWebSocketAdmission\(peerAddress\)\)/);
});
