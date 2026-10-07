// The mobile app's DM encryption session (dm-e2ee-session.ts, shared with the
// web app) with SecureStore for the key and a small file for the rest.

import "./polyfills";
import { useSyncExternalStore } from "react";
import * as SecureStore from "expo-secure-store";
import { File, Paths } from "expo-file-system";
import { DmE2eeSession, type DmDeviceState } from "./dm-e2ee-session";
import { createDmE2eeSending } from "./dm-e2ee-sending";
import { decryptAttachment, encryptAttachment, isDmFileKey, type DmFileKey } from "./dm-e2ee";
import { base64UrlToBytes } from "./dm-e2ee-format";
import { API_BASE } from "@/src/lib/api";

let sessionToken: string | null = null;

/** The session token requests are made with; the session provider keeps it current. */
export function setDmE2eeToken(token: string | null) {
  sessionToken = token;
}

// SecureStore keys may only contain letters, digits, ".", "-" and "_".
const seedKey = (accountId: string) => `decave.e2ee.seed.${accountId.replace(/[^A-Za-z0-9._-]/g, "_")}`;
const stateFile = (accountId: string) =>
  new File(Paths.document, `decave-e2ee-${accountId.replace(/[^A-Za-z0-9._-]/g, "_")}.json`);

const KEYRING_FILE = /^decave-e2ee-keys-[0-9a-f]{32}\.bin$/;

function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function keyringFileName(accountId: string): Promise<string | null> {
  try {
    const stored = await SecureStore.getItemAsync(seedKey(accountId));
    const name = stored?.startsWith("{") ? (JSON.parse(stored) as { f?: unknown }).f : null;
    return typeof name === "string" && KEYRING_FILE.test(name) ? name : null;
  } catch {
    return null;
  }
}

function deleteFile(name: string) {
  try {
    const file = new File(Paths.document, name);
    if (file.exists) file.delete();
  } catch {}
}

export const dmE2ee = new DmE2eeSession({
  client: "mobile",
  request: async (path, init = {}) => {
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;
      if (init.body !== undefined) headers["Content-Type"] = "application/json";
      const response = await fetch(`${API_BASE}${path}`, {
        method: init.method ?? "GET",
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      return { ok: response.ok, status: response.status, data };
    } catch {
      return { ok: false, status: 0, data: { error: "Could not reach DeCave." } };
    }
  },
  // The keyring never leaves this phone. It can outgrow SecureStore's ~2 KB limit,
  // so it is stored encrypted in a file, and SecureStore (Keychain / Keystore,
  // this device only, only while unlocked) holds that file's name and key.
  loadKeyring: async (accountId) => {
    const stored = await SecureStore.getItemAsync(seedKey(accountId));
    if (!stored) return null;
    try {
      if (!stored.startsWith("{")) {
        // Written by an earlier build: the one key itself.
        const seed = base64UrlToBytes(stored);
        return seed.length === 32 ? seed : null;
      }
      const pointer = JSON.parse(stored) as { f?: unknown; k?: unknown; n?: unknown };
      const fileKey = { k: pointer.k, n: pointer.n };
      if (typeof pointer.f !== "string" || !KEYRING_FILE.test(pointer.f) || !isDmFileKey(fileKey)) return null;
      const file = new File(Paths.document, pointer.f);
      if (!file.exists) return null;
      const keyring = decryptAttachment(await file.bytes(), fileKey);
      return keyring.length >= 32 && keyring.length % 32 === 0 ? keyring : null;
    } catch {
      return null;
    }
  },
  saveKeyring: async (accountId, keyring) => {
    // A new file and key each time; the old file goes only once the pointer moved.
    const previous = await keyringFileName(accountId);
    const { fileKey, ciphertext } = encryptAttachment(keyring);
    const name = `decave-e2ee-keys-${randomId()}.bin`;
    const file = new File(Paths.document, name);
    file.create();
    file.write(ciphertext);
    await SecureStore.setItemAsync(seedKey(accountId), JSON.stringify({ f: name, ...fileKey }), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    if (previous && previous !== name) deleteFile(previous);
  },
  forgetKeyring: async (accountId) => {
    const previous = await keyringFileName(accountId);
    await SecureStore.deleteItemAsync(seedKey(accountId)).catch(() => undefined);
    if (previous) deleteFile(previous);
    try {
      const file = stateFile(accountId);
      if (file.exists) file.delete();
    } catch {}
  },
  loadDeviceState: async (accountId) => {
    try {
      const file = stateFile(accountId);
      if (!file.exists) return { pins: {} };
      const raw = JSON.parse(file.textSync()) as Partial<DmDeviceState>;
      return {
        pins: raw.pins && typeof raw.pins === "object" ? raw.pins : {},
        recoveryCodeUnconfirmed: raw.recoveryCodeUnconfirmed === true,
      };
    } catch {
      return { pins: {} };
    }
  },
  saveDeviceState: async (accountId, state) => {
    try {
      const file = stateFile(accountId);
      if (!file.exists) file.create();
      file.write(JSON.stringify(state));
    } catch {}
  },
});

export function useDmE2ee() {
  return useSyncExternalStore(dmE2ee.subscribe, dmE2ee.getState, dmE2ee.getState);
}

// ---------------------------------------------------------------- attachments

/** Read and encrypt a picked file. The key goes inside the encrypted message. */
export async function encryptFileForDm(uri: string): Promise<{ body: Uint8Array; fileKey: DmFileKey }> {
  const { fileKey, ciphertext } = encryptAttachment(await new File(uri).bytes());
  return { body: ciphertext, fileKey };
}

/** The decryption step for a downloaded attachment, or null for an unencrypted one. */
export function attachmentDecrypter(attachment: { fileKey?: unknown }): ((bytes: Uint8Array) => Uint8Array) | null {
  const fileKey = attachment.fileKey;
  return isDmFileKey(fileKey) ? (bytes) => decryptAttachment(bytes, fileKey) : null;
}

// ---------------------------------------------------------------- sending

export const {
  dmSealedBody,
  dmSocketFrame,
  settleDmSend,
  retryFrameAfterDmError,
  dmReactionBody,
  groupSocketFrame,
  settleGroupSend,
  retryGroupFrameAfterError,
  groupPreview,
  decryptConversationPreviews,
} = createDmE2eeSending(dmE2ee);

// Groups the app has open or listed, so a GROUP_ERROR resend uses the latest members.
const knownGroups = new Map<string, { id: string; e2ee?: boolean; members: ReadonlyArray<{ id: string }> }>();

export function rememberGroup(group: { id: string; e2ee?: boolean; members: ReadonlyArray<{ id: string }> }) {
  knownGroups.set(group.id, group);
}

export function knownGroup(groupId: string) {
  return knownGroups.get(groupId) ?? null;
}
