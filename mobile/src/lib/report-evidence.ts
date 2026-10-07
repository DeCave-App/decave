// Report evidence from the phone, in the same format as the web app
// (src/safety/report-evidence.ts): a JSON package encrypted to the Trust &
// Safety team's P-256 key with ECDH and AES-GCM, so only reviewers can read it.
// Hermes has no WebCrypto, so this uses @noble, which the DM encryption already
// ships. scripts/__tests__/mobile-report-evidence.test.mjs checks the web app's
// decryption opens what this produces.

import { p256 } from "@noble/curves/nist.js";
import { gcm } from "@noble/ciphers/aes.js";
import { randomBytes } from "@noble/ciphers/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base64UrlToBytes, bytesToBase64Url } from "./e2ee/dm-e2ee-format";
import type { DmReportProof } from "./e2ee/dm-e2ee";

export type ReportKey = { keyId: string; version: number; algorithm: string; publicKey: string };

export type EvidenceTarget = {
  targetType: string;
  targetId: string;
  subjectUserId?: string;
  contextType?: string;
  contextId?: string;
  evidenceType?: string;
  evidenceText?: string;
  /** Encrypted message only: its signed envelope and content key, so reviewers can check it. */
  e2eeProof?: DmReportProof;
};

const encoder = new TextEncoder();

export function buildEvidencePackage(target: EvidenceTarget, now = new Date()): Uint8Array | null {
  const content = target.evidenceText?.trim().slice(0, 12000) ?? "";
  if (!content) return null;
  return encoder.encode(
    JSON.stringify({
      evidenceType: target.evidenceType ?? "context",
      target: {
        targetType: target.targetType,
        targetId: target.targetId,
        subjectUserId: target.subjectUserId,
        contextType: target.contextType,
        contextId: target.contextId,
      },
      content,
      createdAt: now.toISOString(),
      ...(target.e2eeProof ? { e2eeProof: target.e2eeProof } : {}),
    }),
  );
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

export function encryptEvidence(plaintext: Uint8Array, key: ReportKey): Uint8Array {
  if (key.algorithm !== "ECDH-P256-AESGCM") {
    throw new Error("This DeCave app does not support the configured evidence key algorithm.");
  }
  let recipient: Uint8Array;
  try {
    const jwk = JSON.parse(key.publicKey) as { kty?: string; crv?: string; x?: string; y?: string };
    if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y) throw new Error("bad key");
    recipient = concat(new Uint8Array([4]), base64UrlToBytes(jwk.x), base64UrlToBytes(jwk.y));
    p256.Point.fromBytes(recipient);
  } catch {
    throw new Error("The Trust & Safety evidence key is invalid.");
  }
  const ephemeralSecret = p256.utils.randomSecretKey();
  const ephemeralPublic = p256.getPublicKey(ephemeralSecret, false);
  // WebCrypto's ECDH deriveBits(256) is the shared point's x coordinate, used as the AES key.
  const aesKey = p256.getSharedSecret(ephemeralSecret, recipient, true).slice(1);
  const iv = randomBytes(12);
  const aad = encoder.encode(`decave-trust-safety-evidence-v1:${key.keyId}:${key.version}`);
  const ciphertext = gcm(aesKey, iv, aad).encrypt(plaintext);
  const header = encoder.encode(
    JSON.stringify({
      version: 1,
      algorithm: key.algorithm,
      keyId: key.keyId,
      keyVersion: key.version,
      iv: bytesToBase64Url(iv),
      aad: bytesToBase64Url(aad),
      ephemeralPublicKey: {
        kty: "EC",
        crv: "P-256",
        x: bytesToBase64Url(ephemeralPublic.slice(1, 33)),
        y: bytesToBase64Url(ephemeralPublic.slice(33, 65)),
        ext: true,
      },
    }),
  );
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, header.length);
  return concat(length, header, ciphertext);
}

export function sha256Hex(bytes: Uint8Array): string {
  return Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Encrypt and upload a report's evidence. False when there is nothing to send. */
export async function uploadEvidence(
  request: (path: string, init?: RequestInit) => Promise<Response>,
  reportId: string,
  target: EvidenceTarget,
): Promise<boolean> {
  const plaintext = buildEvidencePackage(target);
  if (!plaintext) return false;
  const keyResponse = await request("/api/safety/report-key");
  if (!keyResponse.ok) return false;
  const key = (await keyResponse.json()) as ReportKey;
  const encrypted = encryptEvidence(plaintext, key);
  const response = await request(`/api/safety/reports/${encodeURIComponent(reportId)}/evidence`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-DeCave-Evidence-Sha256": sha256Hex(encrypted),
      "X-DeCave-Evidence-Key-Id": key.keyId,
      "X-DeCave-Evidence-Type": target.evidenceType ?? "context",
      "X-DeCave-Evidence-Message-Id": target.targetType === "message" ? target.targetId : "",
      "X-DeCave-Evidence-Context-Type": target.contextType ?? "",
      "X-DeCave-Evidence-Context-Id": target.contextId ?? "",
      "X-DeCave-Evidence-Package-Version": "report-package-v1",
      "X-DeCave-Evidence-Encryption-Version": "report-envelope-v1",
    },
    body: encrypted as unknown as BodyInit,
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "Encrypted evidence could not be uploaded.");
  }
  return true;
}
