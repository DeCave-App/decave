// End-to-end encryption for direct messages, their reactions, and group chats.
//
// Each account has one current key, held only by the account's devices. It is a
// 32-byte seed from which an X25519 key (messages are encrypted to it) and an
// Ed25519 key (messages are signed with it) are derived. A message is encrypted
// once with a random content key; that key is wrapped for every account in the
// conversation (sender included), so every device of those accounts can read the
// history the server stores.
//
// The key rotates (monthly): the old key signs the new one and seals it for the
// account's other devices. Devices keep the old keys in a keyring so history
// stays readable, until the account's history setting says to drop them; from
// then on a stolen device or recovery code can't read those older messages.
// New devices get the keyring from the recovery-code backup or sealed by an
// existing device. See docs/security/DM-E2EE.md.
//
// Pure TypeScript on @noble, so the web app, Electron, React Native and Node tests
// run the same code. The mobile app keeps an identical copy in
// mobile/src/lib/e2ee/ (checked by scripts/__tests__/dm-e2ee.test.mjs).

import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "@noble/ciphers/utils.js";
import {
  DM_E2EE_VERSION,
  DM_KEYRING_MAX,
  DM_REACTIONS_MAX,
  backupKeyStatement,
  base64UrlToBytes,
  bytesToBase64Url,
  successionStatement,
  type DmEnvelope,
  type DmKeyBackup,
  type DmLinkSealed,
  type DmPublicKey,
  type DmSealedSuccessor,
} from "./dm-e2ee-format.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ZERO_NONCE = new Uint8Array(24);

export type DmAccountKeys = {
  seed: Uint8Array;
  keyId: string;
  xSecret: Uint8Array;
  xPublic: Uint8Array;
  edSecret: Uint8Array;
  edPublic: Uint8Array;
};

/**
 * The decrypted contents of a message: `t` is the text the app already
 * understands, `r` the id of the message it replies to (kept out of the server's
 * view; older messages carry the reply link in the clear instead).
 */
export type DmPlainPayload = { t: string; r?: string };

/**
 * What an envelope carries. The scope is part of everything signed and
 * encrypted, so an envelope sealed for one purpose can't be passed off as another
 * (a reaction as a message, a DM as a group message).
 */
export type DmEnvelopeScope = "message" | "reactions" | "group";

/** An account's keys, newest (current) first. */
export type DmKeyring = readonly DmAccountKeys[];

export type DmCryptoErrorCode =
  "bad-envelope" | "no-key" | "bad-signature" | "decrypt-failed" | "wrong-code" | "key-mismatch" | "bad-succession";

export class DmCryptoError extends Error {
  readonly code: DmCryptoErrorCode;
  constructor(message: string, code: DmCryptoErrorCode) {
    super(message);
    this.name = "DmCryptoError";
    this.code = code;
  }
}

function utf8(value: string): Uint8Array {
  return encoder.encode(value);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function derive(secret: Uint8Array, salt: Uint8Array, info: string): Uint8Array {
  return hkdf(sha256, secret, salt, utf8(`decave-dm-v1 ${info}`), 32);
}

function keyIdFor(xPublic: Uint8Array, edPublic: Uint8Array): string {
  return bytesToBase64Url(sha256(concat(utf8("decave-dm-v1 key-id"), xPublic, edPublic)).slice(0, 16));
}

// ---------------------------------------------------------------- account keys

export function generateAccountSeed(): Uint8Array {
  return randomBytes(32);
}

export function deriveAccountKeys(seed: Uint8Array): DmAccountKeys {
  if (seed.length !== 32) throw new DmCryptoError("An account key is 32 bytes.", "bad-envelope");
  const empty = new Uint8Array(0);
  const xSecret = derive(seed, empty, "x25519");
  const edSecret = derive(seed, empty, "ed25519");
  const xPublic = x25519.getPublicKey(xSecret);
  const edPublic = ed25519.getPublicKey(edSecret);
  return { seed, keyId: keyIdFor(xPublic, edPublic), xSecret, xPublic, edSecret, edPublic };
}

export function publicKeyOf(keys: DmAccountKeys): DmPublicKey {
  return { keyId: keys.keyId, x25519: bytesToBase64Url(keys.xPublic), ed25519: bytesToBase64Url(keys.edPublic) };
}

/** True when a published key's id really is derived from its key material. */
export function isConsistentPublicKey(key: DmPublicKey): boolean {
  try {
    return keyIdFor(base64UrlToBytes(key.x25519), base64UrlToBytes(key.ed25519)) === key.keyId;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- keyrings and rotation

function asKeyring(keys: DmAccountKeys | DmKeyring): DmKeyring {
  return Array.isArray(keys) ? keys : [keys as DmAccountKeys];
}

/** A keyring as bytes for storage and transfer: the seeds, newest first. */
export function keyringToBytes(keyring: DmKeyring): Uint8Array {
  if (keyring.length < 1 || keyring.length > DM_KEYRING_MAX) {
    throw new DmCryptoError("A keyring holds 1 to 120 keys.", "bad-envelope");
  }
  return concat(...keyring.map((keys) => keys.seed));
}

export function keyringFromBytes(bytes: Uint8Array): DmAccountKeys[] {
  if (bytes.length < 32 || bytes.length % 32 !== 0 || bytes.length / 32 > DM_KEYRING_MAX) {
    throw new DmCryptoError("That is not a keyring.", "bad-envelope");
  }
  const keyring: DmAccountKeys[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32) {
    keyring.push(deriveAccountKeys(bytes.slice(offset, offset + 32)));
  }
  return keyring;
}

function successorAad(userId: string, previousKeyId: string, nextKeyId: string): Uint8Array {
  return utf8(`decave-dm-v1 successor\n${userId}\n${previousKeyId}\n${nextKeyId}`);
}

/**
 * Replace the account key. The current key signs the new one (so other people's
 * apps accept the change without a warning) and seals its seed to itself (so
 * the account's other devices, which hold the current key, can pick it up).
 */
export function rotateAccountKey(
  current: DmAccountKeys,
  userId: string,
): { next: DmAccountKeys; certificate: string; sealedForPrevious: DmSealedSuccessor } {
  const next = deriveAccountKeys(generateAccountSeed());
  const statement = utf8(successionStatement(userId, publicKeyOf(current), publicKeyOf(next)));
  const certificate = bytesToBase64Url(ed25519.sign(statement, current.edSecret));
  const sealed = sealToX25519(current.xPublic, next.seed, successorAad(userId, current.keyId, next.keyId), "successor");
  return { next, certificate, sealedForPrevious: sealed };
}

/** On another device of the account: open the key that replaced `previous`. */
export function openSuccessor(
  sealed: DmSealedSuccessor,
  previous: DmAccountKeys,
  userId: string,
  next: DmPublicKey,
  certificate: string,
): DmAccountKeys {
  if (!verifySuccession(userId, publicKeyOf(previous), next, certificate)) {
    throw new DmCryptoError("The new key isn't signed by the old one.", "bad-succession");
  }
  const seed = openFromX25519(previous, sealed, successorAad(userId, previous.keyId, next.keyId), "successor");
  const keys = deriveAccountKeys(seed);
  if (keys.keyId !== next.keyId) throw new DmCryptoError("The new key doesn't match.", "key-mismatch");
  return keys;
}

/** True when `previous` signed `next` as its successor for this account. */
export function verifySuccession(
  userId: string,
  previous: DmPublicKey,
  next: DmPublicKey,
  certificate: string,
): boolean {
  if (!isConsistentPublicKey(previous) || !isConsistentPublicKey(next)) return false;
  try {
    return ed25519.verify(
      base64UrlToBytes(certificate),
      utf8(successionStatement(userId, previous, next)),
      base64UrlToBytes(previous.ed25519),
    );
  } catch {
    return false;
  }
}

/** A published key with the link to the key it replaced, as the server lists them. */
export type DmChainedKey = DmPublicKey & { previousKeyId?: string | null; certificate?: string | null };

/**
 * Walk back from `current` through keys each signed by its predecessor. Returns
 * the chain, newest first; the last entry is the root, the key the account
 * started with (or last reset to). Stops at a missing or invalid link.
 */
export function keyChain(
  userId: string,
  current: DmChainedKey,
  known: ReadonlyMap<string, DmChainedKey>,
): DmChainedKey[] {
  const chain: DmChainedKey[] = [current];
  const seen = new Set([current.keyId]);
  let key = current;
  while (key.previousKeyId && key.certificate && chain.length <= DM_KEYRING_MAX * 2) {
    const previous = known.get(key.previousKeyId);
    if (!previous || seen.has(previous.keyId)) break;
    if (!verifySuccession(userId, previous, key, key.certificate)) break;
    chain.push(previous);
    seen.add(previous.keyId);
    key = previous;
  }
  return chain;
}

// Sealed box: an ephemeral X25519 key agreement, HKDF and XChaCha20-Poly1305.
function sealToX25519(
  recipientX: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
  info: string,
): { e: string; n: string; c: string } {
  const ephemeralSecret = x25519.utils.randomSecretKey();
  const ephemeral = x25519.getPublicKey(ephemeralSecret);
  const key = derive(x25519.getSharedSecret(ephemeralSecret, recipientX), concat(ephemeral, recipientX), info);
  const nonce = randomBytes(24);
  return {
    e: bytesToBase64Url(ephemeral),
    n: bytesToBase64Url(nonce),
    c: bytesToBase64Url(xchacha20poly1305(key, nonce, aad).encrypt(plaintext)),
  };
}

function openFromX25519(
  recipient: { xSecret: Uint8Array; xPublic: Uint8Array },
  sealed: { e: string; n: string; c: string },
  aad: Uint8Array,
  info: string,
): Uint8Array {
  try {
    const ephemeral = base64UrlToBytes(sealed.e);
    const key = derive(
      x25519.getSharedSecret(recipient.xSecret, ephemeral),
      concat(ephemeral, recipient.xPublic),
      info,
    );
    return xchacha20poly1305(key, base64UrlToBytes(sealed.n), aad).decrypt(base64UrlToBytes(sealed.c));
  } catch {
    throw new DmCryptoError("This could not be decrypted.", "decrypt-failed");
  }
}

/**
 * Safety number for two accounts: 60 digits in 12 groups of five, the same on
 * both sides. If it matches when compared in person or over a call, neither key
 * was substituted.
 */
export function safetyNumber(a: { userId: string; key: DmPublicKey }, b: { userId: string; key: DmPublicKey }): string {
  const part = (side: { userId: string; key: DmPublicKey }) =>
    concat(
      utf8(side.userId),
      new Uint8Array([0]),
      base64UrlToBytes(side.key.x25519),
      base64UrlToBytes(side.key.ed25519),
    );
  const [first, second] = [a, b].sort((left, right) => (left.userId < right.userId ? -1 : 1));
  const input = concat(utf8("decave-dm-v1 safety-number"), part(first), part(second));
  return digitGroups(
    concat(sha256(concat(input, new Uint8Array([0]))), sha256(concat(input, new Uint8Array([1])))),
    12,
    5,
  );
}

/** Read `count` groups of `width` digits from 5-byte chunks of `bytes`, like Signal's safety numbers. */
function digitGroups(bytes: Uint8Array, count: number, width: number): string {
  const groups: string[] = [];
  for (let index = 0; index < count; index += 1) {
    let value = 0;
    for (let offset = 0; offset < 5; offset += 1) value = value * 256 + bytes[index * 5 + offset];
    groups.push(String(value % 10 ** width).padStart(width, "0"));
  }
  return groups.join(" ");
}

// ---------------------------------------------------------------- recovery code

// Crockford base32: no I, L, O or U, so the code survives being read aloud or retyped.
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A fresh recovery code: 160 random bits as eight groups of four characters. */
export function generateRecoveryCode(): string {
  const bytes = randomBytes(20);
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      output += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return output.match(/.{4}/g)!.join("-");
}

/** Decode a typed recovery code, forgiving case, spaces, dashes and look-alike letters. */
export function recoveryCodeBytes(code: string): Uint8Array | null {
  const cleaned = code.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (cleaned.length !== 32) return null;
  const bytes = new Uint8Array(20);
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const character of cleaned) {
    const digit = CROCKFORD.indexOf(character);
    if (digit < 0) return null;
    value = ((value << 5) | digit) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bytes[index] = (value >>> (bits - 8)) & 0xff;
      index += 1;
      bits -= 8;
    }
  }
  return bytes;
}

function backupKeyPair(codeBytes: Uint8Array, userId: string): { xSecret: Uint8Array; xPublic: Uint8Array } {
  const xSecret = derive(codeBytes, utf8(userId), "backup-x25519");
  return { xSecret, xPublic: x25519.getPublicKey(xSecret) };
}

function backupAad(userId: string, keyId: string): Uint8Array {
  return utf8(`decave-dm-v1 backup\n${userId}\n${keyId}`);
}

function sealBackupTo(keyring: DmKeyring, backupPublic: Uint8Array, userId: string): DmKeyBackup {
  const current = keyring[0];
  const bpk = bytesToBase64Url(backupPublic);
  const sealed = sealToX25519(backupPublic, keyringToBytes(keyring), backupAad(userId, current.keyId), "backup");
  return {
    v: 2,
    keyId: current.keyId,
    keys: keyring.map((keys) => keys.keyId),
    bpk,
    bs: bytesToBase64Url(ed25519.sign(utf8(backupKeyStatement(userId, bpk)), current.edSecret)),
    ...sealed,
  };
}

/**
 * Back up a keyring under a new recovery code. The code (160 bits, so no slow
 * KDF is needed) derives an X25519 key pair; the backup is sealed to its public
 * half, which the backup carries so devices can update it later.
 */
export function sealKeyBackup(keyring: DmAccountKeys | DmKeyring, recoveryCode: string, userId: string): DmKeyBackup {
  const codeBytes = recoveryCodeBytes(recoveryCode);
  if (!codeBytes) throw new DmCryptoError("Invalid recovery code.", "wrong-code");
  return sealBackupTo(asKeyring(keyring), backupKeyPair(codeBytes, userId).xPublic, userId);
}

/**
 * Update the backup with a changed keyring, for the same recovery code, without
 * knowing the code. The existing backup's public key must be signed by a key in
 * `keyring`, so a server can't substitute a backup key it can open.
 */
export function resealKeyBackup(previous: DmKeyBackup, keyring: DmKeyring, userId: string): DmKeyBackup {
  const signer = keyring.find((keys) => keys.keyId === previous.keyId);
  let trusted = false;
  try {
    trusted = Boolean(
      signer &&
      ed25519.verify(base64UrlToBytes(previous.bs), utf8(backupKeyStatement(userId, previous.bpk)), signer.edPublic),
    );
  } catch {
    trusted = false;
  }
  if (!trusted) throw new DmCryptoError("The recovery backup's key isn't signed by this account.", "bad-signature");
  return sealBackupTo(keyring, base64UrlToBytes(previous.bpk), userId);
}

export function openKeyBackup(backup: DmKeyBackup, recoveryCode: string, userId: string): DmAccountKeys[] {
  const codeBytes = recoveryCodeBytes(recoveryCode);
  if (!codeBytes) throw new DmCryptoError("That doesn't look like a recovery code.", "wrong-code");
  let keyring: DmAccountKeys[];
  try {
    const plaintext = openFromX25519(
      backupKeyPair(codeBytes, userId),
      backup,
      backupAad(userId, backup.keyId),
      "backup",
    );
    keyring = keyringFromBytes(plaintext);
  } catch {
    throw new DmCryptoError("That recovery code doesn't unlock this account.", "wrong-code");
  }
  if (keyring[0].keyId !== backup.keyId) throw new DmCryptoError("The backup doesn't match its key.", "key-mismatch");
  return keyring;
}

// ---------------------------------------------------------------- device linking

/**
 * Comparison code for a device-link request: 12 digits both devices show. If
 * the server swapped in its own key the codes would differ.
 */
export function linkComparisonCode(userId: string, requestId: string, linkPublicKey: string): string {
  const digest = sha256(
    concat(utf8(`decave-dm-v1 link-code\n${userId}\n${requestId}\n`), base64UrlToBytes(linkPublicKey)),
  );
  return digitGroups(digest, 3, 4);
}

export function generateLinkKeyPair(): { secret: Uint8Array; publicKey: string } {
  const secret = x25519.utils.randomSecretKey();
  return { secret, publicKey: bytesToBase64Url(x25519.getPublicKey(secret)) };
}

function linkAad(userId: string, requestId: string, keyId: string): Uint8Array {
  return utf8(`link\n${userId}\n${requestId}\n${keyId}`);
}

/** Seal this device's keyring for a new device that showed the same comparison code. */
export function sealForLinkedDevice(
  keyring: DmAccountKeys | DmKeyring,
  linkPublicKey: string,
  userId: string,
  requestId: string,
): DmLinkSealed {
  const ring = asKeyring(keyring);
  const sealed = sealToX25519(
    base64UrlToBytes(linkPublicKey),
    keyringToBytes(ring),
    linkAad(userId, requestId, ring[0].keyId),
    "link",
  );
  return { v: DM_E2EE_VERSION, keyId: ring[0].keyId, ...sealed };
}

export function openFromLinkingDevice(
  sealed: DmLinkSealed,
  linkSecret: Uint8Array,
  userId: string,
  requestId: string,
): DmAccountKeys[] {
  let keyring: DmAccountKeys[];
  try {
    const plaintext = openFromX25519(
      { xSecret: linkSecret, xPublic: x25519.getPublicKey(linkSecret) },
      sealed,
      linkAad(userId, requestId, sealed.keyId),
      "link",
    );
    keyring = keyringFromBytes(plaintext);
  } catch {
    throw new DmCryptoError("Could not open the key from your other device.", "decrypt-failed");
  }
  if (keyring[0].keyId !== sealed.keyId) throw new DmCryptoError("The linked key doesn't match.", "key-mismatch");
  return keyring;
}

// ---------------------------------------------------------------- envelopes

function envelopeHeader(env: Pick<DmEnvelope, "id" | "from" | "to" | "sk" | "e">, scope: DmEnvelopeScope): Uint8Array {
  return utf8(`decave-dm-v1 ${scope}\n${env.id}\n${env.from}\n${env.to}\n${env.sk}\n${env.e}`);
}

function signedBytes(env: Omit<DmEnvelope, "s">, scope: DmEnvelopeScope): Uint8Array {
  const wraps = [...env.w].sort((left, right) => (left.k < right.k ? -1 : 1)).map((wrap) => `${wrap.k}:${wrap.w}`);
  return concat(envelopeHeader(env, scope), utf8(`\n${env.n}\n${env.c}\n${wraps.join(",")}`));
}

function wrapKeyFor(shared: Uint8Array, ephemeral: Uint8Array, recipientX: Uint8Array): Uint8Array {
  return derive(shared, concat(ephemeral, recipientX), "wrap");
}

function sealEnvelope(
  scope: DmEnvelopeScope,
  input: { id: string; from: string; to: string; sender: DmAccountKeys; recipients: readonly DmPublicKey[] },
  plaintext: Uint8Array,
): DmEnvelope {
  const { sender } = input;
  const contentKey = randomBytes(32);
  const ephemeralSecret = x25519.utils.randomSecretKey();
  const ephemeral = x25519.getPublicKey(ephemeralSecret);
  const header = { id: input.id, from: input.from, to: input.to, sk: sender.keyId, e: bytesToBase64Url(ephemeral) };
  const aad = envelopeHeader(header, scope);
  const targets = new Map<string, Uint8Array>([[sender.keyId, sender.xPublic]]);
  for (const recipient of input.recipients) targets.set(recipient.keyId, base64UrlToBytes(recipient.x25519));
  const wraps = [...targets].map(([keyId, recipientX]) => {
    const kek = wrapKeyFor(x25519.getSharedSecret(ephemeralSecret, recipientX), ephemeral, recipientX);
    return { k: keyId, w: bytesToBase64Url(xchacha20poly1305(kek, ZERO_NONCE, aad).encrypt(contentKey)) };
  });
  const nonce = randomBytes(24);
  const ciphertext = xchacha20poly1305(contentKey, nonce, aad).encrypt(plaintext);
  const unsigned: Omit<DmEnvelope, "s"> = {
    v: DM_E2EE_VERSION,
    ...header,
    n: bytesToBase64Url(nonce),
    c: bytesToBase64Url(ciphertext),
    w: wraps,
  };
  const signature = ed25519.sign(signedBytes(unsigned, scope), sender.edSecret);
  return { ...unsigned, s: bytesToBase64Url(signature) };
}

function verifySignature(envelope: DmEnvelope, senderKey: DmPublicKey, scope: DmEnvelopeScope) {
  if (senderKey.keyId !== envelope.sk || !isConsistentPublicKey(senderKey)) {
    throw new DmCryptoError("The sender's key doesn't match.", "bad-signature");
  }
  const { s, ...unsigned } = envelope;
  let valid = false;
  try {
    valid = ed25519.verify(base64UrlToBytes(s), signedBytes(unsigned, scope), base64UrlToBytes(senderKey.ed25519));
  } catch {
    valid = false;
  }
  if (!valid) throw new DmCryptoError("This message's signature is not valid.", "bad-signature");
}

function unwrapContentKey(envelope: DmEnvelope, reader: DmAccountKeys | DmKeyring, scope: DmEnvelopeScope): Uint8Array {
  let keys: DmAccountKeys | undefined;
  let wrap: DmEnvelope["w"][number] | undefined;
  for (const candidate of asKeyring(reader)) {
    wrap = envelope.w.find((item) => item.k === candidate.keyId);
    if (wrap) {
      keys = candidate;
      break;
    }
  }
  if (!wrap || !keys) throw new DmCryptoError("This message wasn't encrypted for a key this device has.", "no-key");
  try {
    const ephemeral = base64UrlToBytes(envelope.e);
    const kek = wrapKeyFor(x25519.getSharedSecret(keys.xSecret, ephemeral), ephemeral, keys.xPublic);
    return xchacha20poly1305(kek, ZERO_NONCE, envelopeHeader(envelope, scope)).decrypt(base64UrlToBytes(wrap.w));
  } catch {
    throw new DmCryptoError("This message could not be decrypted.", "decrypt-failed");
  }
}

function decryptWithContentKey(envelope: DmEnvelope, contentKey: Uint8Array, scope: DmEnvelopeScope): unknown {
  try {
    const plaintext = xchacha20poly1305(
      contentKey,
      base64UrlToBytes(envelope.n),
      envelopeHeader(envelope, scope),
    ).decrypt(base64UrlToBytes(envelope.c));
    return JSON.parse(decoder.decode(plaintext));
  } catch {
    throw new DmCryptoError("This message could not be decrypted.", "decrypt-failed");
  }
}

function messagePayload(raw: unknown): DmPlainPayload {
  const payload = (raw ?? {}) as Partial<DmPlainPayload>;
  if (typeof payload.t !== "string") throw new DmCryptoError("This message could not be decrypted.", "decrypt-failed");
  return typeof payload.r === "string" ? { t: payload.t, r: payload.r } : { t: payload.t };
}

function openEnvelope(
  scope: DmEnvelopeScope,
  input: { envelope: DmEnvelope; reader: DmAccountKeys | DmKeyring; senderKey: DmPublicKey },
  expected: { id: string; from: string; to: string },
): unknown {
  const { envelope } = input;
  if (envelope.id !== expected.id || envelope.from !== expected.from || envelope.to !== expected.to) {
    throw new DmCryptoError("This message doesn't belong to this conversation.", "bad-envelope");
  }
  verifySignature(envelope, input.senderKey, scope);
  return decryptWithContentKey(envelope, unwrapContentKey(envelope, input.reader, scope), scope);
}

// ---------------------------------------------------------------- direct messages

export type SealDmInput = {
  /** Message id chosen by the sender (a UUID); edits reuse the original id. */
  id: string;
  /** Sender and recipient account ids as the server knows them. */
  from: string;
  to: string;
  payload: DmPlainPayload;
  sender: DmAccountKeys;
  recipientKey: DmPublicKey;
};

export function sealDirectMessage(input: SealDmInput): DmEnvelope {
  return sealEnvelope("message", { ...input, recipients: [input.recipientKey] }, utf8(JSON.stringify(input.payload)));
}

export type OpenDmInput = {
  envelope: DmEnvelope;
  /** The reader's account keys, or their whole keyring. */
  reader: DmAccountKeys | DmKeyring;
  /** The sender's public key with id `envelope.sk`, fetched for the `from` account. */
  senderKey: DmPublicKey;
  /** What the server says about the message; must match what the sender signed. */
  expected: { id: string; from: string; to: string };
};

export function openDirectMessage({ envelope, reader, senderKey, expected }: OpenDmInput): DmPlainPayload {
  return messagePayload(openEnvelope("message", { envelope, reader, senderKey }, expected));
}

// ---------------------------------------------------------------- reactions

function cleanReactions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const result: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !item || item.length > 24 || result.includes(item)) continue;
    result.push(item);
    if (result.length >= DM_REACTIONS_MAX) break;
  }
  return result;
}

/**
 * One account's reactions to one encrypted DM (poll votes are `poll_<index>`),
 * as a single envelope that replaces the previous one. Its id is the message's
 * id, so the server can't move it onto another message.
 */
export function sealReactions(input: {
  messageId: string;
  from: string;
  to: string;
  emojis: readonly string[];
  sender: DmAccountKeys;
  recipientKey: DmPublicKey;
}): DmEnvelope {
  return sealEnvelope(
    "reactions",
    { id: input.messageId, from: input.from, to: input.to, sender: input.sender, recipients: [input.recipientKey] },
    utf8(JSON.stringify({ e: cleanReactions(input.emojis) })),
  );
}

export function openReactions(input: {
  envelope: DmEnvelope;
  reader: DmAccountKeys | DmKeyring;
  senderKey: DmPublicKey;
  expected: { messageId: string; from: string; to: string };
}): string[] {
  const { messageId, from, to } = input.expected;
  const raw = openEnvelope("reactions", input, { id: messageId, from, to }) as { e?: unknown } | null;
  return cleanReactions(raw?.e);
}

// ---------------------------------------------------------------- group chats

/**
 * A group chat message, wrapped for every member's current key. `to` is the
 * group id, so the message can't be moved into another group.
 */
export function sealGroupMessage(input: {
  id: string;
  from: string;
  groupId: string;
  payload: DmPlainPayload;
  sender: DmAccountKeys;
  memberKeys: readonly DmPublicKey[];
}): DmEnvelope {
  return sealEnvelope(
    "group",
    { id: input.id, from: input.from, to: input.groupId, sender: input.sender, recipients: input.memberKeys },
    utf8(JSON.stringify(input.payload)),
  );
}

export function openGroupMessage(input: {
  envelope: DmEnvelope;
  reader: DmAccountKeys | DmKeyring;
  senderKey: DmPublicKey;
  expected: { id: string; from: string; groupId: string };
}): DmPlainPayload {
  const { id, from, groupId } = input.expected;
  return messagePayload(openEnvelope("group", input, { id, from, to: groupId }));
}

// ---------------------------------------------------------------- reports

/**
 * What a reporter hands the safety team about one encrypted message: its signed
 * envelope and that message's content key, which unlocks this message only. It
 * travels inside the report's evidence, which is itself encrypted to the safety
 * key. `scope` is "group" for a group chat message.
 */
export type DmReportProof = { envelope: DmEnvelope; contentKey: string; scope?: "group" };

export function reportProofFor(
  envelope: DmEnvelope,
  reader: DmAccountKeys | DmKeyring,
  scope: "message" | "group" = "message",
): DmReportProof {
  const proof: DmReportProof = { envelope, contentKey: bytesToBase64Url(unwrapContentKey(envelope, reader, scope)) };
  return scope === "group" ? { ...proof, scope } : proof;
}

/**
 * Check a reported message: the sender's key signed this envelope, and the
 * revealed content key decrypts it to the returned payload. Throws when the
 * report was forged or altered.
 */
export function verifyReportProof(proof: DmReportProof, senderKey: DmPublicKey): DmPlainPayload {
  const scope: DmEnvelopeScope = proof.scope === "group" ? "group" : "message";
  verifySignature(proof.envelope, senderKey, scope);
  let contentKey: Uint8Array;
  try {
    contentKey = base64UrlToBytes(proof.contentKey);
  } catch {
    throw new DmCryptoError("The revealed key is not valid.", "decrypt-failed");
  }
  if (contentKey.length !== 32) throw new DmCryptoError("The revealed key is not valid.", "decrypt-failed");
  return messagePayload(decryptWithContentKey(proof.envelope, contentKey, scope));
}

// ---------------------------------------------------------------- attachments

/** Key material for one encrypted file; it travels inside the encrypted message. */
export type DmFileKey = { k: string; n: string };

export function encryptAttachment(bytes: Uint8Array): { fileKey: DmFileKey; ciphertext: Uint8Array } {
  const key = randomBytes(32);
  const nonce = randomBytes(24);
  const ciphertext = xchacha20poly1305(key, nonce, utf8("decave-dm-v1 file")).encrypt(bytes);
  return { fileKey: { k: bytesToBase64Url(key), n: bytesToBase64Url(nonce) }, ciphertext };
}

export function decryptAttachment(ciphertext: Uint8Array, fileKey: DmFileKey): Uint8Array {
  try {
    return xchacha20poly1305(
      base64UrlToBytes(fileKey.k),
      base64UrlToBytes(fileKey.n),
      utf8("decave-dm-v1 file"),
    ).decrypt(ciphertext);
  } catch {
    throw new DmCryptoError("This file could not be decrypted.", "decrypt-failed");
  }
}

export function isDmFileKey(value: unknown): value is DmFileKey {
  if (!value || typeof value !== "object") return false;
  const { k, n } = value as Record<string, unknown>;
  return typeof k === "string" && k.length === 43 && typeof n === "string" && n.length === 32;
}

// ---------------------------------------------------------------- calls

// Voice rooms and calls are peer to peer over DTLS-SRTP, relayed by TURN. The
// media is already encrypted end to end; what the server could attack is the
// signaling, by swapping a DTLS certificate fingerprint for its own. Each side
// therefore signs the fingerprints in its session description with its account
// key, and the other side checks them against that account's key.

/** The DTLS certificate fingerprints in an SDP, normalized and sorted. */
export function sdpFingerprints(sdp: string): string[] {
  const found = new Set<string>();
  for (const match of sdp.matchAll(/^a=fingerprint:(\S+) ([0-9A-Fa-f:]+)\s*$/gm)) {
    found.add(`${match[1].toLowerCase()} ${match[2].toUpperCase()}`);
  }
  return [...found].sort();
}

function rtcStatement(from: string, to: string, fingerprints: readonly string[]): Uint8Array {
  return utf8(`decave-rtc-v1 description\n${from}\n${to}\n${fingerprints.join("\n")}`);
}

/** What travels next to a session description: the signing key and its signature. */
export type RtcDescriptionAuth = { k: string; s: string };

/** Sign an SDP's fingerprints from `from` to `to`. Null when it has none. */
export function signRtcDescription(
  keys: DmAccountKeys,
  from: string,
  to: string,
  sdp: string,
): RtcDescriptionAuth | null {
  const fingerprints = sdpFingerprints(sdp);
  if (!fingerprints.length) return null;
  return { k: keys.keyId, s: bytesToBase64Url(ed25519.sign(rtcStatement(from, to, fingerprints), keys.edSecret)) };
}

/** True when `senderKey` signed exactly this SDP's fingerprints for this pair of accounts. */
export function verifyRtcDescription(
  senderKey: DmPublicKey,
  from: string,
  to: string,
  sdp: string,
  auth: RtcDescriptionAuth,
): boolean {
  const fingerprints = sdpFingerprints(sdp);
  if (!fingerprints.length || auth.k !== senderKey.keyId || !isConsistentPublicKey(senderKey)) return false;
  try {
    return ed25519.verify(
      base64UrlToBytes(auth.s),
      rtcStatement(from, to, fingerprints),
      base64UrlToBytes(senderKey.ed25519),
    );
  } catch {
    return false;
  }
}
