// Check a report about an end-to-end encrypted DM (docs/security/DM-E2EE.md).
//
//   node --experimental-strip-types scripts/ops/verify-dm-report.mjs <evidence.json> <sender-key.json>
//
// evidence.json is the decrypted evidence package from the report (it has an
// `e2eeProof`). sender-key.json is the reported account's key, from
//   SELECT key_id AS keyId, x25519_public AS x25519, ed25519_public AS ed25519, user_id
//     FROM decave_dm_keys WHERE key_id = '<e2eeProof.envelope.sk>';
// Prints the verified message and exits 0, or explains why the report doesn't
// check out and exits 1.
import fs from "node:fs";
import { verifyReportProof } from "../../shared/dm-e2ee.ts";
import { DM_GROUP_MAX_WRAPS, parseDmEnvelope, parseDmPublicKey } from "../../shared/dm-e2ee-format.ts";

const [evidencePath, keyPath] = process.argv.slice(2);
if (!evidencePath || !keyPath) {
  console.error("usage: verify-dm-report.mjs <evidence.json> <sender-key.json>");
  process.exit(2);
}

function fail(reason) {
  console.error(`NOT VERIFIED: ${reason}`);
  process.exit(1);
}

const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
const keyRow = JSON.parse(fs.readFileSync(keyPath, "utf8"));
const proof = evidence?.e2eeProof;
// A group chat message carries up to 20 key wraps, a DM at most 4.
const group = proof?.scope === "group";
const envelope = parseDmEnvelope(proof?.envelope, group ? DM_GROUP_MAX_WRAPS : undefined);
if (!envelope || typeof proof?.contentKey !== "string") fail("the evidence has no encrypted-message proof.");
const senderKey = parseDmPublicKey(keyRow);
if (!senderKey) fail("the sender key file is not a DM key.");
if (senderKey.keyId !== envelope.sk) fail(`the message was signed by key ${envelope.sk}, not ${senderKey.keyId}.`);
if (evidence.target?.targetId && evidence.target.targetId !== envelope.id) {
  fail(`the proof is for message ${envelope.id}, but the report is about ${evidence.target.targetId}.`);
}

let payload;
try {
  payload = verifyReportProof(
    group ? { envelope, contentKey: proof.contentKey, scope: "group" } : { envelope, contentKey: proof.contentKey },
    senderKey,
  );
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
const reported = typeof evidence.content === "string" ? evidence.content.trim() : "";
if (reported && reported !== payload.t.trim().slice(0, 12000)) {
  fail("the text in the report differs from the message that was actually sent.");
}

console.log("VERIFIED: this message was sent and signed by the reported account's key.");
console.log(`  message id: ${envelope.id}`);
console.log(`  from:       ${envelope.from}${keyRow.user_id ? ` (account ${keyRow.user_id})` : ""}`);
console.log(`  ${group ? "group:" : "to:   "}      ${envelope.to}`);
console.log(`  text:       ${JSON.stringify(payload.t)}`);
