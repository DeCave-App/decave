// The web and desktop app's DM encryption session (shared/dm-e2ee-session.ts)
// with browser storage, plus a React hook for its state.

import { useSyncExternalStore } from "react";
import { DmE2eeSession, type DmDeviceState } from "../../shared/dm-e2ee-session";
import { createDmE2eeSending } from "../../shared/dm-e2ee-sending";
import { decryptAttachment, isDmFileKey, encryptAttachment, type DmFileKey } from "../../shared/dm-e2ee";
import { authorizedFetch } from "../app/http";
import { HTTP_URL } from "../app/env";
import { hasDesktopActivityBridge } from "../app/desktop";
import { forgetAccountKeyring, loadAccountKeyring, saveAccountKeyring } from "./key-store";

const STATE_PREFIX = "decave.e2ee.device.";

export const dmE2ee = new DmE2eeSession({
  client: hasDesktopActivityBridge() ? "desktop" : "web",
  request: async (path, init = {}) => {
    try {
      const response = await authorizedFetch(`${HTTP_URL}${path}`, {
        method: init.method ?? "GET",
        headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      return { ok: response.ok, status: response.status, data };
    } catch {
      return { ok: false, status: 0, data: { error: "Could not reach DeCave." } };
    }
  },
  loadKeyring: loadAccountKeyring,
  saveKeyring: saveAccountKeyring,
  forgetKeyring: async (accountId) => {
    await forgetAccountKeyring(accountId);
    try {
      localStorage.removeItem(STATE_PREFIX + accountId);
    } catch {}
  },
  loadDeviceState: async (accountId) => {
    try {
      const raw = JSON.parse(localStorage.getItem(STATE_PREFIX + accountId) ?? "{}") as Partial<DmDeviceState>;
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
      localStorage.setItem(STATE_PREFIX + accountId, JSON.stringify(state));
    } catch {}
  },
});

export function useDmE2ee() {
  return useSyncExternalStore(dmE2ee.subscribe, dmE2ee.getState, dmE2ee.getState);
}

// ---------------------------------------------------------------- attachments

/** Encrypt a file before upload. The key goes inside the encrypted message. */
export async function encryptFileForDm(file: File): Promise<{ body: Blob; fileKey: DmFileKey }> {
  const { fileKey, ciphertext } = encryptAttachment(new Uint8Array(await file.arrayBuffer()));
  return { body: new Blob([ciphertext as BufferSource]), fileKey };
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
