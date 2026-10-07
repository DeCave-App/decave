import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// The mobile file imports from mobile/node_modules and extensionless siblings.
register("../test-support/mobile-extensionless-loader.mjs", import.meta.url);
const mobile = await import("../../mobile/src/lib/report-evidence.ts");
const web = await import("../../src/safety/report-evidence.ts");
const crypto = await import("../../shared/dm-e2ee.ts");

test("evidence from the phone opens with the reviewers' tooling and carries the DM proof", async () => {
  const pair = await globalThis.crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const publicJwk = await globalThis.crypto.subtle.exportKey("jwk", pair.publicKey);
  const privateJwk = await globalThis.crypto.subtle.exportKey("jwk", pair.privateKey);
  const key = { keyId: "safety-1", version: 3, algorithm: "ECDH-P256-AESGCM", publicKey: JSON.stringify(publicJwk) };

  const alice = crypto.deriveAccountKeys(crypto.generateAccountSeed());
  const bob = crypto.deriveAccountKeys(crypto.generateAccountSeed());
  const envelope = crypto.sealDirectMessage({
    id: "0f8fad5b-d9cb-469f-a165-70867728950e",
    from: "alice",
    to: "bob",
    payload: { t: "a threat" },
    sender: alice,
    recipientKey: crypto.publicKeyOf(bob),
  });
  const proof = crypto.reportProofFor(envelope, bob);
  const plaintext = mobile.buildEvidencePackage({
    targetType: "message",
    targetId: envelope.id,
    subjectUserId: "alice",
    contextType: "dm",
    contextId: "alice",
    evidenceType: "message",
    evidenceText: "a threat",
    e2eeProof: proof,
  });
  const encrypted = mobile.encryptEvidence(plaintext, key);
  const opened = await web.decryptReportEvidence(
    encrypted.buffer.slice(encrypted.byteOffset, encrypted.byteOffset + encrypted.byteLength),
    privateJwk,
  );
  assert.equal(opened.header.keyId, "safety-1");
  const evidence = JSON.parse(new TextDecoder().decode(opened.plaintext));
  assert.equal(evidence.content, "a threat");
  assert.equal(crypto.verifyReportProof(evidence.e2eeProof, crypto.publicKeyOf(alice)).t, "a threat");
  assert.equal(mobile.sha256Hex(encrypted), await web.sha256Hex(encrypted.buffer.slice(encrypted.byteOffset)));
  assert.equal(mobile.buildEvidencePackage({ targetType: "user", targetId: "x" }), null);
  assert.throws(() => mobile.encryptEvidence(plaintext, { ...key, algorithm: "RSA" }), /does not support/);
});
