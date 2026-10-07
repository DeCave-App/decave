// Server side of end-to-end encrypted direct messages. The Worker only checks
// that an envelope is well formed and addressed to the right keys; it cannot
// read it. See docs/security/DM-E2EE.md.

import {
  DM_GROUP_MAX_WRAPS,
  base64UrlToBytes,
  parseDmEnvelope,
  successionStatement,
  type DmEnvelope,
  type DmPublicKey,
} from "../../shared/dm-e2ee-format";
import { publicIdOf, type UserRow } from "../db";
import type { Env } from "./env";

/**
 * Whether end-to-end encrypted DMs are on. Off, nobody gets a key, DMs stay
 * plaintext, and the apps show nothing about encryption: the state before this
 * feature, kept until every client in the stores can read encrypted DMs.
 */
export function dmE2eeEnabled(env: Pick<Env, "DM_E2EE_ENABLED">): boolean {
  return env.DM_E2EE_ENABLED?.trim().toLowerCase() === "true";
}

export type DmKeyRow = {
  key_id: string;
  user_id: string;
  x25519_public: string;
  ed25519_public: string;
  created_at: string;
  retired_at: string | null;
  previous_key_id?: string | null;
  certificate?: string | null;
  sealed_for_previous?: string | null;
};

export type ClientDmKey = DmPublicKey & {
  createdAt: string;
  retiredAt: string | null;
  /** For a rotated key: the key it replaced, and that key's signature over this one. */
  previousKeyId: string | null;
  certificate: string | null;
};

export function dmKeyForClient(row: DmKeyRow): ClientDmKey {
  return {
    keyId: row.key_id,
    x25519: row.x25519_public,
    ed25519: row.ed25519_public,
    createdAt: row.created_at,
    retiredAt: row.retired_at,
    previousKeyId: row.previous_key_id ?? null,
    certificate: row.certificate ?? null,
  };
}

/** Check that `previous` signed `next` as its successor for this account (as the apps do). */
export async function verifyDmSuccession(
  userPublicId: string,
  previous: DmKeyRow,
  next: DmPublicKey,
  certificate: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      base64UrlToBytes(previous.ed25519_public) as BufferSource,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const statement = successionStatement(
      userPublicId,
      { keyId: previous.key_id, x25519: previous.x25519_public, ed25519: previous.ed25519_public },
      next,
    );
    return await crypto.subtle.verify(
      "Ed25519",
      key,
      base64UrlToBytes(certificate) as BufferSource,
      new TextEncoder().encode(statement),
    );
  } catch {
    return false;
  }
}

/** Current keys of several accounts, by internal user id. */
export async function currentDmKeys(db: D1Database, userIds: readonly string[]): Promise<Map<string, DmKeyRow>> {
  const keys = new Map<string, DmKeyRow>();
  if (!userIds.length) return keys;
  const rows = await db
    .prepare(
      `SELECT * FROM decave_dm_keys WHERE retired_at IS NULL AND user_id IN (${userIds.map(() => "?").join(",")})`,
    )
    .bind(...userIds)
    .all<DmKeyRow>();
  for (const row of rows.results) keys.set(row.user_id, row);
  return keys;
}

const PRIVATE_UPLOAD = /^attachments\/private\/[0-9a-f-]{36}$/;

/**
 * The uploads an encrypted DM says it uses. Each must be the sender's own upload
 * for this conversation. Returns the space-separated list to store, or null when
 * one isn't theirs.
 */
async function attachmentRefsFor(
  db: D1Database,
  raw: unknown,
  sender: UserRow,
  target: UserRow,
): Promise<string | null> {
  if (raw === undefined || raw === null) return "";
  if (!Array.isArray(raw) || raw.length > 10) return null;
  const keys = [...new Set(raw)];
  if (!keys.every((key) => typeof key === "string" && PRIVATE_UPLOAD.test(key))) return null;
  for (const key of keys as string[]) {
    const owned = await db
      .prepare(
        "SELECT 1 FROM decave_attachment_access WHERE r2_key=? AND kind='dm' AND owner_user_id=? AND peer_user_id=?",
      )
      .bind(key, sender.id, target.id)
      .first();
    if (!owned) return null;
  }
  return keys.join(" ");
}

export async function currentDmKey(db: D1Database, userId: string): Promise<DmKeyRow | null> {
  return db
    .prepare("SELECT * FROM decave_dm_keys WHERE user_id=? AND retired_at IS NULL LIMIT 1")
    .bind(userId)
    .first<DmKeyRow>();
}

export type OutgoingDm =
  | { ok: true; text: string; envelope: string | null; id: string | null; attachmentRefs: string | null }
  | { ok: false; status: number; error: string; code: string };

/**
 * Decide how a DM may be stored. With an envelope it must come from the
 * sender's current key and be readable by both accounts' current keys. Without
 * one it is plaintext, which is only allowed while either side has no key yet.
 * `editing` is the existing message id when replacing a message's content.
 */
export async function checkOutgoingDm(
  db: D1Database,
  input: {
    sender: UserRow;
    target: UserRow;
    text: unknown;
    envelope: unknown;
    /** Uploads an encrypted message uses (R2 keys); plaintext messages name them in their text. */
    attachmentKeys?: unknown;
    editing?: string;
    enabled: boolean;
  },
): Promise<OutgoingDm> {
  if (!input.enabled) {
    if (input.envelope !== undefined && input.envelope !== null) {
      return { ok: false, status: 409, error: "Encrypted messages aren't available yet.", code: "DM_E2EE_DISABLED" };
    }
    const text = typeof input.text === "string" ? input.text.trim().slice(0, 4000) : "";
    if (!text) return { ok: false, status: 400, error: "Message cannot be empty.", code: "DM_EMPTY" };
    return { ok: true, text, envelope: null, id: null, attachmentRefs: null };
  }
  const [senderKey, targetKey] = await Promise.all([
    currentDmKey(db, input.sender.id),
    currentDmKey(db, input.target.id),
  ]);

  if (input.envelope === undefined || input.envelope === null) {
    if (senderKey && targetKey) {
      return {
        ok: false,
        status: 409,
        error: "This conversation is end-to-end encrypted. Update DeCave to send messages here.",
        code: "DM_E2EE_REQUIRED",
      };
    }
    const text = typeof input.text === "string" ? input.text.trim().slice(0, 4000) : "";
    if (!text) return { ok: false, status: 400, error: "Message cannot be empty.", code: "DM_EMPTY" };
    return { ok: true, text, envelope: null, id: null, attachmentRefs: null };
  }

  const envelope = parseDmEnvelope(input.envelope);
  if (!envelope)
    return { ok: false, status: 400, error: "That encrypted message is malformed.", code: "DM_E2EE_INVALID" };
  if (envelope.from !== publicIdOf(input.sender) || envelope.to !== publicIdOf(input.target)) {
    return {
      ok: false,
      status: 400,
      error: "That encrypted message is for another conversation.",
      code: "DM_E2EE_INVALID",
    };
  }
  if (input.editing !== undefined && envelope.id !== input.editing) {
    return { ok: false, status: 400, error: "That encrypted edit is for another message.", code: "DM_E2EE_INVALID" };
  }
  // A stale key on either side means the client should refetch keys and seal again.
  if (!senderKey || envelope.sk !== senderKey.key_id || !envelope.w.some((wrap) => wrap.k === senderKey.key_id)) {
    return { ok: false, status: 409, error: "Your encryption key changed. Try again.", code: "DM_E2EE_STALE_KEY" };
  }
  if (!targetKey || !envelope.w.some((wrap) => wrap.k === targetKey.key_id)) {
    return {
      ok: false,
      status: 409,
      error: "Their encryption key changed. Try again.",
      code: "DM_E2EE_STALE_KEY",
    };
  }
  const attachmentRefs = await attachmentRefsFor(db, input.attachmentKeys, input.sender, input.target);
  if (attachmentRefs === null) {
    return { ok: false, status: 400, error: "That attachment isn't available.", code: "DM_E2EE_INVALID" };
  }
  return { ok: true, text: "", envelope: JSON.stringify(envelope), id: envelope.id, attachmentRefs };
}

/**
 * Check one account's encrypted reactions to an encrypted DM: addressed from the
 * reactor to the other person, with the message's id, sealed with both current keys.
 */
export async function checkReactionEnvelope(
  db: D1Database,
  input: { reactor: UserRow; other: UserRow; messageId: string; envelope: unknown },
): Promise<{ ok: true; envelope: string } | { ok: false; status: number; error: string; code: string }> {
  const envelope = parseDmEnvelope(input.envelope);
  if (!envelope || envelope.id !== input.messageId) {
    return { ok: false, status: 400, error: "Those encrypted reactions are malformed.", code: "DM_E2EE_INVALID" };
  }
  if (envelope.from !== publicIdOf(input.reactor) || envelope.to !== publicIdOf(input.other)) {
    return { ok: false, status: 400, error: "Those reactions are for another conversation.", code: "DM_E2EE_INVALID" };
  }
  const keys = await currentDmKeys(db, [input.reactor.id, input.other.id]);
  const mine = keys.get(input.reactor.id);
  const theirs = keys.get(input.other.id);
  if (
    !mine ||
    envelope.sk !== mine.key_id ||
    !hasWrap(envelope, mine.key_id) ||
    !theirs ||
    !hasWrap(envelope, theirs.key_id)
  ) {
    return { ok: false, status: 409, error: "An encryption key changed. Try again.", code: "DM_E2EE_STALE_KEY" };
  }
  return { ok: true, envelope: JSON.stringify(envelope) };
}

function hasWrap(envelope: DmEnvelope, keyId: string): boolean {
  return envelope.w.some((wrap) => wrap.k === keyId);
}

export type OutgoingGroupMessage =
  | { ok: true; text: string; envelope: string | null; id: string | null; encrypted: boolean }
  | { ok: false; error: string; code: string };

/**
 * Decide how a group chat message may be stored. A group is encrypted once it
 * has been marked so (`encryptedSince`) or every member has a key; then only
 * envelopes from the sender's current key, wrapped for exactly the members'
 * current keys, are accepted. `members` includes the sender.
 */
export async function checkOutgoingGroupMessage(
  db: D1Database,
  input: {
    sender: UserRow;
    groupId: string;
    members: readonly UserRow[];
    encryptedSince: string | null;
    text: unknown;
    envelope: unknown;
    enabled: boolean;
  },
): Promise<OutgoingGroupMessage> {
  const plaintext = (): OutgoingGroupMessage => {
    const text = typeof input.text === "string" ? input.text.trim().slice(0, 4000) : "";
    if (!text) return { ok: false, error: "Message cannot be empty.", code: "GROUP_EMPTY" };
    return { ok: true, text, envelope: null, id: null, encrypted: false };
  };
  const hasEnvelope = input.envelope !== undefined && input.envelope !== null;
  if (!input.enabled) {
    if (hasEnvelope) return { ok: false, error: "Encrypted messages aren't available yet.", code: "DM_E2EE_DISABLED" };
    return plaintext();
  }
  const keys = await currentDmKeys(
    db,
    input.members.map((member) => member.id),
  );
  const everyoneHasKey = input.members.every((member) => keys.has(member.id));
  if (!hasEnvelope) {
    if (input.encryptedSince || everyoneHasKey) {
      return {
        ok: false,
        error: "This group is end-to-end encrypted. Update DeCave to send messages here.",
        code: "DM_E2EE_REQUIRED",
      };
    }
    return plaintext();
  }
  const envelope = parseDmEnvelope(input.envelope, DM_GROUP_MAX_WRAPS);
  if (!envelope) return { ok: false, error: "That encrypted message is malformed.", code: "DM_E2EE_INVALID" };
  if (envelope.from !== publicIdOf(input.sender) || envelope.to !== input.groupId) {
    return { ok: false, error: "That encrypted message is for another group.", code: "DM_E2EE_INVALID" };
  }
  if (!everyoneHasKey) {
    return {
      ok: false,
      error: "Someone in this group can't receive encrypted messages yet.",
      code: "DM_E2EE_MEMBER_NO_KEY",
    };
  }
  // Exactly the members' current keys: nobody left out, nobody who has left.
  const expected = new Set(input.members.map((member) => keys.get(member.id)!.key_id));
  const senderKey = keys.get(input.sender.id)!;
  const wrapped = new Set(envelope.w.map((wrap) => wrap.k));
  const exact = wrapped.size === expected.size && [...expected].every((keyId) => wrapped.has(keyId));
  if (envelope.sk !== senderKey.key_id || !exact) {
    return { ok: false, error: "The group's members or keys changed. Try again.", code: "DM_E2EE_STALE_KEY" };
  }
  return { ok: true, text: "", envelope: JSON.stringify(envelope), id: envelope.id, encrypted: true };
}

/** Push text for a DM: the server can only describe an encrypted message, not quote it. */
export function dmPushText(stored: { text: string; envelope: string | null }): string {
  return stored.envelope ? "Sent you an encrypted message" : stored.text;
}
