// Wire formats for end-to-end encrypted direct messages. No crypto here: the
// Worker imports this file to check shapes and sizes without being able to read
// anything. The crypto lives in dm-e2ee.ts. The mobile app keeps an identical
// copy of both files (scripts/__tests__/dm-e2ee.test.mjs checks they match).

export const DM_E2EE_VERSION = 1;

/** Upper bound for one stored envelope (a 4000-character message is ~11 KB). */
export const DM_ENVELOPE_MAX_BYTES = 32 * 1024;
/** Most keys an account's keyring holds (monthly rotation for ten years). */
export const DM_KEYRING_MAX = 120;
export const DM_BACKUP_MAX_BYTES = 16 * 1024;
export const DM_LINK_SEALED_MAX_BYTES = 8 * 1024;
/** Wraps in a group message: one per member (groups have at most 20). */
export const DM_GROUP_MAX_WRAPS = 20;
export const DM_REACTIONS_MAX = 20;

const B64URL = /^[A-Za-z0-9_-]+$/;
const KEY_ID = /^[A-Za-z0-9_-]{22}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** An account's public keys, as the server publishes them. */
export type DmPublicKey = {
  keyId: string;
  /** X25519 public key (base64url) that messages are encrypted to. */
  x25519: string;
  /** Ed25519 public key (base64url) that the account signs messages with. */
  ed25519: string;
};

/** The content key wrapped for one account key. */
export type DmKeyWrap = { k: string; w: string };

/**
 * One encrypted direct message. `id`, `from` and `to` are also stored in the
 * clear by the server; the signature binds them so the server cannot move a
 * message to another conversation or give it another id.
 */
export type DmEnvelope = {
  v: 1;
  id: string;
  from: string;
  to: string;
  /** Sender's key id. */
  sk: string;
  /** Ephemeral X25519 public key for the key wraps. */
  e: string;
  n: string;
  c: string;
  w: DmKeyWrap[];
  s: string;
};

/**
 * Encrypted backup of an account's keyring, unlocked with the recovery code.
 * It is sealed to `bpk`, a public key derived from the code, so any device
 * holding the keyring can update the backup (after a key rotation) without
 * knowing the code. `bs` is the account key `keyId`'s signature over `bpk`, so
 * the server can't swap in a backup key of its own. `keys` lists the key ids
 * inside, so devices know when it needs updating.
 */
export type DmKeyBackup = {
  v: 2;
  keyId: string;
  keys: string[];
  bpk: string;
  bs: string;
  e: string;
  n: string;
  c: string;
};

/** An account's keyring sealed by an existing device for a new device. */
export type DmLinkSealed = { v: 1; keyId: string; e: string; n: string; c: string };

/** A new account key, sealed to the key it replaces (see rotation in dm-e2ee.ts). */
export type DmSealedSuccessor = { e: string; n: string; c: string };

/**
 * What the previous account key signs when an account rotates its key: the
 * account and both keys. Lives here, without crypto, because the Worker checks
 * the signature too.
 */
export function successionStatement(userId: string, previous: DmPublicKey, next: DmPublicKey): string {
  return `decave-dm-v1 succession\n${userId}\n${previous.keyId}\n${next.keyId}\n${next.x25519}\n${next.ed25519}`;
}

/** What the account key signs about the recovery backup's public key. */
export function backupKeyStatement(userId: string, backupPublicKey: string): string {
  return `decave-dm-v1 backup-key\n${userId}\n${backupPublicKey}`;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlToBytes(value: string): Uint8Array {
  if (!B64URL.test(value)) throw new Error("Invalid base64url value.");
  const normalized = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** True when `value` is base64url for exactly `length` bytes (or at most `max` bytes). */
function isB64(value: unknown, length?: number, max?: number): value is string {
  if (typeof value !== "string" || !value || !B64URL.test(value)) return false;
  const bytes = Math.floor((value.length * 3) / 4);
  if (length !== undefined) return bytes === length;
  return max === undefined || bytes <= max;
}

export function isDmKeyId(value: unknown): value is string {
  return typeof value === "string" && KEY_ID.test(value);
}

export function isDmMessageId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function parseDmPublicKey(raw: unknown): DmPublicKey | null {
  if (!isRecord(raw)) return null;
  if (!isDmKeyId(raw.keyId) || !isB64(raw.x25519, 32) || !isB64(raw.ed25519, 32)) return null;
  return { keyId: raw.keyId, x25519: raw.x25519, ed25519: raw.ed25519 };
}

/**
 * Check an envelope's shape. Accepts a JSON string or an already parsed value.
 * `maxWraps` is 4 for direct messages and reactions (two accounts, room for a
 * key change), DM_GROUP_MAX_WRAPS for group messages.
 */
export function parseDmEnvelope(raw: unknown, maxWraps = 4): DmEnvelope | null {
  let value = raw;
  if (typeof raw === "string") {
    if (raw.length > DM_ENVELOPE_MAX_BYTES) return null;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isRecord(value) || value.v !== DM_E2EE_VERSION) return null;
  const { id, from, to, sk, e, n, c, w, s } = value;
  if (!isDmMessageId(id) || typeof from !== "string" || typeof to !== "string") return null;
  if (!from || !to || from.length > 80 || to.length > 80 || from === to) return null;
  if (!isDmKeyId(sk) || !isB64(e, 32) || !isB64(n, 24) || !isB64(c, undefined, DM_ENVELOPE_MAX_BYTES)) return null;
  if (!isB64(s, 64) || !Array.isArray(w) || w.length < 1 || w.length > maxWraps) return null;
  const wraps: DmKeyWrap[] = [];
  for (const wrap of w) {
    if (!isRecord(wrap) || !isDmKeyId(wrap.k) || !isB64(wrap.w, 48)) return null;
    if (wraps.some((existing) => existing.k === wrap.k)) return null;
    wraps.push({ k: wrap.k, w: wrap.w });
  }
  return { v: 1, id, from, to, sk, e, n, c, w: wraps, s };
}

export function parseDmKeyBackup(raw: unknown): DmKeyBackup | null {
  let value = raw;
  if (typeof raw === "string") {
    if (raw.length > DM_BACKUP_MAX_BYTES) return null;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isRecord(value) || value.v !== 2) return null;
  const { keyId, keys, bpk, bs, e, n, c } = value;
  if (!isDmKeyId(keyId) || !isB64(bpk, 32) || !isB64(bs, 64) || !isB64(e, 32) || !isB64(n, 24)) return null;
  if (!isB64(c, undefined, DM_KEYRING_MAX * 32 + 16)) return null;
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > DM_KEYRING_MAX || keys[0] !== keyId) return null;
  if (!keys.every(isDmKeyId) || new Set(keys).size !== keys.length) return null;
  return { v: 2, keyId, keys: [...keys], bpk, bs, e, n, c };
}

export function parseDmLinkSealed(raw: unknown): DmLinkSealed | null {
  let value = raw;
  if (typeof raw === "string") {
    if (raw.length > DM_LINK_SEALED_MAX_BYTES) return null;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isRecord(value) || value.v !== DM_E2EE_VERSION) return null;
  if (!isDmKeyId(value.keyId) || !isB64(value.e, 32) || !isB64(value.n, 24)) return null;
  if (!isB64(value.c, undefined, DM_KEYRING_MAX * 32 + 16)) return null;
  return { v: 1, keyId: value.keyId, e: value.e, n: value.n, c: value.c };
}

export function parseDmSealedSuccessor(raw: unknown): DmSealedSuccessor | null {
  let value = raw;
  if (typeof raw === "string") {
    if (raw.length > 1024) return null;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isRecord(value) || !isB64(value.e, 32) || !isB64(value.n, 24) || !isB64(value.c, 48)) return null;
  return { e: value.e, n: value.n, c: value.c };
}

export function isDmSignature(value: unknown): value is string {
  return isB64(value, 64);
}
