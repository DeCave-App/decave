import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { spawnSync } from "node:child_process";
import {
  DmCryptoError,
  decryptAttachment,
  deriveAccountKeys,
  encryptAttachment,
  generateAccountSeed,
  generateLinkKeyPair,
  generateRecoveryCode,
  isConsistentPublicKey,
  linkComparisonCode,
  openDirectMessage,
  openFromLinkingDevice,
  openKeyBackup,
  publicKeyOf,
  recoveryCodeBytes,
  reportProofFor,
  verifyReportProof,
  safetyNumber,
  sealDirectMessage,
  sealForLinkedDevice,
  sealKeyBackup,
  keyChain,
  openGroupMessage,
  openReactions,
  openSuccessor,
  resealKeyBackup,
  rotateAccountKey,
  sealGroupMessage,
  sealReactions,
  verifySuccession,
} from "../../shared/dm-e2ee.ts";
import {
  DM_ENVELOPE_MAX_BYTES,
  parseDmEnvelope,
  parseDmKeyBackup,
  parseDmLinkSealed,
  parseDmPublicKey,
  parseDmSealedSuccessor,
  DM_GROUP_MAX_WRAPS,
} from "../../shared/dm-e2ee-format.ts";
import { toggledReactions } from "../../shared/dm-e2ee-session.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const alice = deriveAccountKeys(generateAccountSeed());
const bob = deriveAccountKeys(generateAccountSeed());
const mallory = deriveAccountKeys(generateAccountSeed());
const messageId = "0f8fad5b-d9cb-469f-a165-70867728950e";

function seal(text = "hello bob", overrides = {}) {
  return sealDirectMessage({
    id: messageId,
    from: "alice-public",
    to: "bob-public",
    payload: { t: text },
    sender: alice,
    recipientKey: publicKeyOf(bob),
    ...overrides,
  });
}

function open(envelope, reader = bob, senderKey = publicKeyOf(alice), expected = {}) {
  return openDirectMessage({
    envelope,
    reader,
    senderKey,
    expected: { id: messageId, from: "alice-public", to: "bob-public", ...expected },
  });
}

function codeOf(fn) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof DmCryptoError, `expected DmCryptoError, got ${error}`);
    return error.code;
  }
  assert.fail("expected the call to throw");
}

test("account keys derive deterministically from the seed", () => {
  const again = deriveAccountKeys(alice.seed);
  assert.equal(again.keyId, alice.keyId);
  assert.deepEqual(publicKeyOf(again), publicKeyOf(alice));
  assert.notEqual(alice.keyId, bob.keyId);
  assert.equal(alice.keyId.length, 22);
  assert.ok(isConsistentPublicKey(publicKeyOf(alice)));
  assert.ok(!isConsistentPublicKey({ ...publicKeyOf(alice), x25519: publicKeyOf(bob).x25519 }));
  assert.deepEqual(parseDmPublicKey(publicKeyOf(alice)), publicKeyOf(alice));
});

test("both the recipient and the sender's other devices can read a message", () => {
  const envelope = seal("gg, rematch?");
  assert.deepEqual(open(envelope), { t: "gg, rematch?" });
  assert.deepEqual(open(envelope, alice), { t: "gg, rematch?" });
  assert.equal(
    codeOf(() => open(envelope, mallory)),
    "no-key",
  );
  // The stored form survives a JSON round trip and passes the Worker's shape check.
  const stored = JSON.stringify(envelope);
  assert.ok(stored.length < DM_ENVELOPE_MAX_BYTES);
  assert.deepEqual(open(parseDmEnvelope(stored)), { t: "gg, rematch?" });
  assert.ok(!stored.includes("rematch"));
});

test("a 4000-character message fits the envelope limit", () => {
  const text = "\u{1F3AE}".repeat(2000);
  const stored = JSON.stringify(seal(text));
  assert.ok(stored.length < DM_ENVELOPE_MAX_BYTES, `${stored.length} bytes`);
  assert.equal(open(parseDmEnvelope(stored)).t, text);
});

test("the server cannot move, rename or alter a message", () => {
  const envelope = seal();
  assert.equal(
    codeOf(() => open(envelope, bob, publicKeyOf(alice), { id: crypto.randomUUID() })),
    "bad-envelope",
  );
  assert.equal(
    codeOf(() => open(envelope, bob, publicKeyOf(alice), { from: "carol-public" })),
    "bad-envelope",
  );
  assert.equal(
    codeOf(() => open({ ...envelope, to: "carol-public" }, bob, publicKeyOf(alice), { to: "carol-public" })),
    "bad-signature",
  );
  const flipped = envelope.c.startsWith("A") ? `B${envelope.c.slice(1)}` : `A${envelope.c.slice(1)}`;
  assert.equal(
    codeOf(() => open({ ...envelope, c: flipped })),
    "bad-signature",
  );
  // Dropping the sender's own wrap is also caught: wraps are signed.
  assert.equal(
    codeOf(() => open({ ...envelope, w: envelope.w.filter((wrap) => wrap.k === bob.keyId) })),
    "bad-signature",
  );
});

test("a message signed by another key is rejected", () => {
  const forged = sealDirectMessage({
    id: messageId,
    from: "alice-public",
    to: "bob-public",
    payload: { t: "send me your password" },
    sender: mallory,
    recipientKey: publicKeyOf(bob),
  });
  // Claiming Alice's key id with Mallory's signature fails...
  assert.equal(
    codeOf(() => open({ ...forged, sk: alice.keyId })),
    "bad-signature",
  );
  // ...and a key whose id doesn't match its material is refused outright.
  assert.equal(
    codeOf(() => open(forged, bob, { ...publicKeyOf(mallory), keyId: alice.keyId })),
    "bad-signature",
  );
});

test("the envelope shape check rejects junk", () => {
  const envelope = seal();
  assert.equal(parseDmEnvelope("{"), null);
  assert.equal(parseDmEnvelope({ ...envelope, v: 2 }), null);
  assert.equal(parseDmEnvelope({ ...envelope, id: "not-a-uuid" }), null);
  assert.equal(parseDmEnvelope({ ...envelope, from: envelope.to }), null);
  assert.equal(parseDmEnvelope({ ...envelope, w: [] }), null);
  assert.equal(parseDmEnvelope({ ...envelope, w: [envelope.w[0], envelope.w[0]] }), null);
  assert.equal(parseDmEnvelope({ ...envelope, s: "short" }), null);
  assert.equal(parseDmEnvelope("x".repeat(DM_ENVELOPE_MAX_BYTES + 1)), null);
});

test("recovery codes unlock the backup and nothing else", () => {
  const code = generateRecoveryCode();
  assert.match(code, /^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.equal(recoveryCodeBytes(code).length, 20);
  const backup = parseDmKeyBackup(JSON.stringify(sealKeyBackup(alice, code, "user-a")));
  assert.ok(backup);
  assert.equal(openKeyBackup(backup, code, "user-a")[0].keyId, alice.keyId);
  // Typing it in lower case without dashes, or with O for 0, still works.
  const sloppy = code.toLowerCase().replace(/-/g, " ").replace(/0/g, "o");
  assert.equal(openKeyBackup(backup, sloppy, "user-a")[0].keyId, alice.keyId);
  assert.equal(
    codeOf(() => openKeyBackup(backup, generateRecoveryCode(), "user-a")),
    "wrong-code",
  );
  assert.equal(
    codeOf(() => openKeyBackup(backup, code, "user-b")),
    "wrong-code",
  );
  assert.equal(
    codeOf(() => openKeyBackup(backup, "1234", "user-a")),
    "wrong-code",
  );
  assert.equal(
    codeOf(() => openKeyBackup({ ...backup, keyId: bob.keyId }, code, "user-a")),
    "wrong-code",
  );
});

test("recovery code encoding round-trips every bit", () => {
  for (let index = 0; index < 50; index += 1) {
    const code = generateRecoveryCode();
    const bytes = recoveryCodeBytes(code);
    // Re-encode by hand and compare.
    let bits = "";
    for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
    const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    const reencoded = bits
      .match(/.{5}/g)
      .map((chunk) => alphabet[parseInt(chunk, 2)])
      .join("");
    assert.equal(reencoded, code.replace(/-/g, ""));
  }
  assert.equal(recoveryCodeBytes("U".repeat(32)), null);
});

test("an existing device can hand the key to a new device", () => {
  const link = generateLinkKeyPair();
  const sealed = parseDmLinkSealed(JSON.stringify(sealForLinkedDevice(alice, link.publicKey, "user-a", "req-1")));
  assert.ok(sealed);
  assert.equal(openFromLinkingDevice(sealed, link.secret, "user-a", "req-1")[0].keyId, alice.keyId);
  assert.equal(
    codeOf(() => openFromLinkingDevice(sealed, generateLinkKeyPair().secret, "user-a", "req-1")),
    "decrypt-failed",
  );
  assert.equal(
    codeOf(() => openFromLinkingDevice(sealed, link.secret, "user-a", "req-2")),
    "decrypt-failed",
  );
  const code = linkComparisonCode("user-a", "req-1", link.publicKey);
  assert.match(code, /^\d{4} \d{4} \d{4}$/);
  assert.notEqual(code, linkComparisonCode("user-a", "req-1", generateLinkKeyPair().publicKey));
});

test("safety numbers match on both sides and change with the key", () => {
  const a = { userId: "alice-public", key: publicKeyOf(alice) };
  const b = { userId: "bob-public", key: publicKeyOf(bob) };
  const number = safetyNumber(a, b);
  assert.match(number, /^(\d{5} ){11}\d{5}$/);
  assert.equal(safetyNumber(b, a), number);
  assert.notEqual(safetyNumber(a, { userId: "bob-public", key: publicKeyOf(mallory) }), number);
});

test("attachments are encrypted with their own key", () => {
  const file = new Uint8Array(100_000).map((_, index) => index % 251);
  const { fileKey, ciphertext } = encryptAttachment(file);
  assert.equal(ciphertext.length, file.length + 16);
  assert.deepEqual(decryptAttachment(ciphertext, fileKey), file);
  const tampered = ciphertext.slice();
  tampered[10] ^= 1;
  assert.equal(
    codeOf(() => decryptAttachment(tampered, fileKey)),
    "decrypt-failed",
  );
  assert.equal(
    codeOf(() => decryptAttachment(ciphertext, encryptAttachment(file).fileKey)),
    "decrypt-failed",
  );
});

test("a reply link travels inside the ciphertext", () => {
  const envelope = sealDirectMessage({
    id: messageId,
    from: "alice-public",
    to: "bob-public",
    payload: { t: "agreed", r: "11111111-2222-4333-8444-555555555555" },
    sender: alice,
    recipientKey: publicKeyOf(bob),
  });
  assert.ok(!JSON.stringify(envelope).includes("11111111"));
  assert.deepEqual(open(envelope), { t: "agreed", r: "11111111-2222-4333-8444-555555555555" });
  assert.deepEqual(open(seal("no reply")), { t: "no reply" });
});

test("a reported message can be verified, and a forged or altered report can't", () => {
  const envelope = seal("you'll regret this");
  const proof = JSON.parse(JSON.stringify(reportProofFor(envelope, bob)));
  // The safety team needs only the proof and the sender's public key.
  assert.equal(verifyReportProof(proof, publicKeyOf(alice)).t, "you'll regret this");
  // The reporter (or anyone) can't pin it on someone else...
  assert.equal(
    codeOf(() => verifyReportProof(proof, publicKeyOf(mallory))),
    "bad-signature",
  );
  // ...or change what it says...
  const otherKey = reportProofFor(seal("something else"), bob).contentKey;
  assert.equal(
    codeOf(() => verifyReportProof({ ...proof, contentKey: otherKey }, publicKeyOf(alice))),
    "decrypt-failed",
  );
  // ...or invent a message: Bob can encrypt but can't sign as Alice.
  const forged = sealDirectMessage({
    id: messageId,
    from: "alice-public",
    to: "bob-public",
    payload: { t: "fake" },
    sender: bob,
    recipientKey: publicKeyOf(bob),
  });
  assert.equal(
    codeOf(() =>
      verifyReportProof(
        { ...reportProofFor(forged, bob), envelope: { ...forged, sk: alice.keyId } },
        publicKeyOf(alice),
      ),
    ),
    "bad-signature",
  );
  // The revealed key opens only this message.
  assert.equal(
    codeOf(() => verifyReportProof({ envelope: seal("another"), contentKey: proof.contentKey }, publicKeyOf(alice))),
    "decrypt-failed",
  );
});

test("the safety team's verification script accepts real reports and rejects altered ones", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dm-report-"));
  const envelope = seal("report me");
  const key = { ...publicKeyOf(alice), user_id: "u-alice" };
  const evidence = (content) => ({
    evidenceType: "message",
    target: { targetType: "message", targetId: envelope.id },
    content,
    createdAt: "2026-10-05T00:00:00.000Z",
    e2eeProof: reportProofFor(envelope, bob),
  });
  const run = (content, senderKey = key) => {
    fs.writeFileSync(path.join(dir, "evidence.json"), JSON.stringify(evidence(content)));
    fs.writeFileSync(path.join(dir, "key.json"), JSON.stringify(senderKey));
    return spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        path.join(root, "scripts/ops/verify-dm-report.mjs"),
        path.join(dir, "evidence.json"),
        path.join(dir, "key.json"),
      ],
      { encoding: "utf8" },
    );
  };
  const good = run("report me");
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /VERIFIED/);
  const altered = run("report me, and something worse");
  assert.equal(altered.status, 1);
  assert.match(altered.stderr, /differs/);
  const wrongKey = run("report me", { ...publicKeyOf(mallory), keyId: alice.keyId });
  assert.equal(wrongKey.status, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the mobile app carries identical copies of the shared E2EE files", () => {
  for (const name of [
    "dm-e2ee.ts",
    "dm-e2ee-format.ts",
    "dm-e2ee-session.ts",
    "dm-e2ee-sending.ts",
    "dm-message-preview.ts",
  ]) {
    const shared = fs.readFileSync(path.join(root, "shared", name), "utf8");
    const mobile = fs.readFileSync(path.join(root, "mobile/src/lib/e2ee", name), "utf8");
    assert.equal(mobile, shared, `mobile/src/lib/e2ee/${name} is out of date; run node scripts/dev/sync-dm-e2ee.mjs`);
  }
});

test("report evidence for an encrypted DM carries the proof", async () => {
  const { buildTextEvidencePackage } = await import("../../src/safety/report-evidence.ts");
  const envelope = seal("evidence please");
  const proof = reportProofFor(envelope, bob);
  const bytes = buildTextEvidencePackage({
    targetType: "message",
    targetId: envelope.id,
    evidenceType: "message",
    evidenceText: "evidence please",
    e2eeProof: proof,
  });
  const evidence = JSON.parse(new TextDecoder().decode(bytes));
  assert.equal(verifyReportProof(evidence.e2eeProof, publicKeyOf(alice)).t, evidence.content);
});

// ---------------------------------------------------------------- part 2

test("a backup holds the whole keyring and devices can update it without the code", () => {
  const code = generateRecoveryCode();
  const backup = parseDmKeyBackup(JSON.stringify(sealKeyBackup([alice], code, "user-a")));
  assert.deepEqual(backup.keys, [alice.keyId]);
  const { next } = rotateAccountKey(alice, "user-a");
  const updated = parseDmKeyBackup(JSON.stringify(resealKeyBackup(backup, [next, alice], "user-a")));
  assert.deepEqual(updated.keys, [next.keyId, alice.keyId]);
  assert.equal(updated.bpk, backup.bpk);
  const restored = openKeyBackup(updated, code, "user-a");
  assert.deepEqual(
    restored.map((keys) => keys.keyId),
    [next.keyId, alice.keyId],
  );
  // A server can't make devices seal the keyring to a backup key of its own.
  const forged = { ...backup, bpk: parseDmPublicKey(publicKeyOf(mallory)).x25519 };
  assert.equal(
    codeOf(() => resealKeyBackup(forged, [next, alice], "user-a")),
    "bad-signature",
  );
  // Nor to one signed by a key this device doesn't hold.
  const otherBackup = sealKeyBackup([mallory], generateRecoveryCode(), "user-a");
  assert.equal(
    codeOf(() => resealKeyBackup(otherBackup, [next, alice], "user-a")),
    "bad-signature",
  );
});

test("the link hands over the whole keyring", () => {
  const link = generateLinkKeyPair();
  const { next } = rotateAccountKey(alice, "user-a");
  const sealed = parseDmLinkSealed(JSON.stringify(sealForLinkedDevice([next, alice], link.publicKey, "user-a", "r")));
  assert.deepEqual(
    openFromLinkingDevice(sealed, link.secret, "user-a", "r").map((keys) => keys.keyId),
    [next.keyId, alice.keyId],
  );
});

test("a rotated key is signed by the old one and sealed to it", () => {
  const { next, certificate, sealedForPrevious } = rotateAccountKey(alice, "user-a");
  const nextPublic = publicKeyOf(next);
  assert.ok(verifySuccession("user-a", publicKeyOf(alice), nextPublic, certificate));
  assert.ok(!verifySuccession("user-b", publicKeyOf(alice), nextPublic, certificate));
  assert.ok(!verifySuccession("user-a", publicKeyOf(mallory), nextPublic, certificate));
  assert.ok(!verifySuccession("user-a", publicKeyOf(alice), publicKeyOf(mallory), certificate));
  const sealed = parseDmSealedSuccessor(JSON.stringify(sealedForPrevious));
  assert.equal(openSuccessor(sealed, alice, "user-a", nextPublic, certificate).keyId, next.keyId);
  // Only the old key opens it, and only for the signed successor.
  assert.equal(
    codeOf(() => openSuccessor(sealed, mallory, "user-a", nextPublic, certificate)),
    "bad-succession",
  );
  const other = rotateAccountKey(alice, "user-a");
  assert.equal(
    codeOf(() => openSuccessor(sealed, alice, "user-a", publicKeyOf(other.next), other.certificate)),
    "decrypt-failed",
  );
});

test("key chains walk back to the root through valid signatures only", () => {
  const first = rotateAccountKey(alice, "user-a");
  const second = rotateAccountKey(first.next, "user-a");
  const chained = (keys, previous, certificate) => ({
    ...publicKeyOf(keys),
    previousKeyId: previous?.keyId ?? null,
    certificate: certificate ?? null,
  });
  const k0 = chained(alice);
  const k1 = chained(first.next, alice, first.certificate);
  const k2 = chained(second.next, first.next, second.certificate);
  const known = new Map([k0, k1, k2].map((key) => [key.keyId, key]));
  assert.deepEqual(
    keyChain("user-a", k2, known).map((key) => key.keyId),
    [k2.keyId, k1.keyId, k0.keyId],
  );
  // A forged link stops the walk: the forged key is its own root, so pins notice.
  const forged = chained(mallory, second.next, first.certificate);
  known.set(forged.keyId, forged);
  assert.deepEqual(
    keyChain("user-a", forged, known).map((key) => key.keyId),
    [forged.keyId],
  );
  // Another account's chain doesn't verify for this one.
  assert.deepEqual(
    keyChain("user-b", k2, known).map((key) => key.keyId),
    [k2.keyId],
  );
});

test("old messages open with an older key in the keyring", () => {
  const envelope = seal("before the rotation");
  const { next } = rotateAccountKey(bob, "bob-public");
  assert.equal(open(envelope, [next, bob]).t, "before the rotation");
  assert.equal(
    codeOf(() => open(envelope, [next])),
    "no-key",
  );
});

test("reactions are sealed per message and can't pass for a message", () => {
  const reaction = sealReactions({
    messageId,
    from: "bob-public",
    to: "alice-public",
    emojis: ["👍", "poll_1", "👍", 7],
    sender: bob,
    recipientKey: publicKeyOf(alice),
  });
  const expected = { messageId, from: "bob-public", to: "alice-public" };
  assert.deepEqual(openReactions({ envelope: reaction, reader: alice, senderKey: publicKeyOf(bob), expected }), [
    "👍",
    "poll_1",
  ]);
  assert.equal(
    codeOf(() =>
      openReactions({
        envelope: reaction,
        reader: alice,
        senderKey: publicKeyOf(bob),
        expected: { ...expected, messageId: "1f8fad5b-d9cb-469f-a165-70867728950e" },
      }),
    ),
    "bad-envelope",
  );
  // The scope is signed: a reaction envelope is not a valid message, nor the reverse.
  assert.equal(
    codeOf(() =>
      openDirectMessage({
        envelope: reaction,
        reader: alice,
        senderKey: publicKeyOf(bob),
        expected: { id: messageId, from: "bob-public", to: "alice-public" },
      }),
    ),
    "bad-signature",
  );
  const message = seal();
  assert.equal(
    codeOf(() =>
      openReactions({
        envelope: message,
        reader: bob,
        senderKey: publicKeyOf(alice),
        expected: { messageId, from: "alice-public", to: "bob-public" },
      }),
    ),
    "bad-signature",
  );
});

test("toggling reactions keeps poll votes single choice", () => {
  const reactions = { "👍": ["me", "them"], poll_0: ["me"], poll_1: ["them"] };
  assert.deepEqual(toggledReactions(reactions, "me", "👍"), ["poll_0"]);
  assert.deepEqual(toggledReactions(reactions, "me", "🔥"), ["👍", "poll_0", "🔥"]);
  assert.deepEqual(toggledReactions(reactions, "me", "poll_1"), ["👍", "poll_1"]);
  assert.deepEqual(toggledReactions(reactions, "me", "poll_0"), ["👍"]);
  assert.deepEqual(toggledReactions(undefined, "me", "👍"), ["👍"]);
});

test("group messages open for every member and only in their group", () => {
  const groupId = "6f1c1f1e-1b1a-4c3d-9e8f-123456789abc";
  const carol = deriveAccountKeys(generateAccountSeed());
  const envelope = sealGroupMessage({
    id: messageId,
    from: "alice-public",
    groupId,
    payload: { t: "hi all", r: "reply-id" },
    sender: alice,
    memberKeys: [publicKeyOf(bob), publicKeyOf(carol)],
  });
  assert.equal(envelope.w.length, 3);
  const expected = { id: messageId, from: "alice-public", groupId };
  for (const reader of [alice, bob, carol]) {
    assert.deepEqual(openGroupMessage({ envelope, reader, senderKey: publicKeyOf(alice), expected }), {
      t: "hi all",
      r: "reply-id",
    });
  }
  assert.equal(
    codeOf(() => openGroupMessage({ envelope, reader: mallory, senderKey: publicKeyOf(alice), expected })),
    "no-key",
  );
  assert.equal(
    codeOf(() =>
      openGroupMessage({
        envelope,
        reader: bob,
        senderKey: publicKeyOf(alice),
        expected: { ...expected, groupId: "7f1c1f1e-1b1a-4c3d-9e8f-123456789abc" },
      }),
    ),
    "bad-envelope",
  );
  // A group message can't be replayed as a DM between two members.
  assert.equal(
    codeOf(() =>
      openDirectMessage({
        envelope: { ...envelope, to: "bob-public" },
        reader: bob,
        senderKey: publicKeyOf(alice),
        expected: { id: messageId, from: "alice-public", to: "bob-public" },
      }),
    ),
    "bad-signature",
  );
  // Group envelopes may carry up to 20 wraps; DM envelopes only 4.
  assert.ok(parseDmEnvelope(JSON.stringify(envelope), DM_GROUP_MAX_WRAPS));
  const big = {
    ...envelope,
    w: Array.from({ length: 6 }, (_, index) => ({ ...envelope.w[0], k: `${"k".repeat(21)}${index}` })),
  };
  assert.equal(parseDmEnvelope(big), null);
  assert.ok(parseDmEnvelope(big, DM_GROUP_MAX_WRAPS));
  // Reported group messages verify too.
  const proof = reportProofFor(envelope, carol, "group");
  assert.equal(proof.scope, "group");
  assert.equal(verifyReportProof(proof, publicKeyOf(alice)).t, "hi all");
  assert.equal(
    codeOf(() => verifyReportProof({ ...proof, scope: undefined }, publicKeyOf(alice))),
    "bad-signature",
  );
});

test("the verification script accepts a reported group message", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dm-report-"));
  const members = Array.from({ length: 6 }, () => publicKeyOf(deriveAccountKeys(generateAccountSeed())));
  const envelope = sealGroupMessage({
    id: messageId,
    from: "alice-public",
    groupId: "6f1c1f1e-1b1a-4c3d-9e8f-123456789abc",
    payload: { t: "group threat" },
    sender: alice,
    memberKeys: [publicKeyOf(bob), ...members],
  });
  fs.writeFileSync(
    path.join(dir, "evidence.json"),
    JSON.stringify({
      evidenceType: "message",
      target: { targetType: "message", targetId: envelope.id },
      content: "group threat",
      e2eeProof: reportProofFor(envelope, bob, "group"),
    }),
  );
  fs.writeFileSync(path.join(dir, "key.json"), JSON.stringify(publicKeyOf(alice)));
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      path.join(root, "scripts/ops/verify-dm-report.mjs"),
      path.join(dir, "evidence.json"),
      path.join(dir, "key.json"),
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /group:/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("call descriptions: fingerprints are signed per pair of accounts", async () => {
  const { sdpFingerprints, signRtcDescription, verifyRtcDescription } = await import("../../shared/dm-e2ee.ts");
  const sdp = [
    "v=0",
    "a=fingerprint:sha-256 ab:cd:EF:01",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111",
    "a=fingerprint:SHA-256 AB:CD:EF:01",
    "a=ice-ufrag:x",
    "",
  ].join("\r\n");
  assert.deepEqual(sdpFingerprints(sdp), ["sha-256 AB:CD:EF:01"]);
  const auth = signRtcDescription(alice, "alice", "bob", sdp);
  assert.ok(verifyRtcDescription(publicKeyOf(alice), "alice", "bob", sdp, auth));
  // The server swapping in its own certificate breaks the signature.
  const swapped = sdp.replace(/AB:CD:EF:01/gi, "99:99:99:99");
  assert.ok(!verifyRtcDescription(publicKeyOf(alice), "alice", "bob", swapped, auth));
  // Nor can it be replayed to someone else, or claimed by another account.
  assert.ok(!verifyRtcDescription(publicKeyOf(alice), "alice", "carol", sdp, auth));
  assert.ok(!verifyRtcDescription(publicKeyOf(mallory), "alice", "bob", sdp, { ...auth, k: mallory.keyId }));
  assert.equal(signRtcDescription(alice, "alice", "bob", "v=0\r\n"), null);
});
