import type { SafetyReportTarget } from "./types";
import type { DmReportProof } from "../../shared/dm-e2ee";

type ReportKey = {
  keyId: string;
  version: number;
  algorithm: string;
  publicKey: string;
};

type EvidencePackage = {
  evidenceType: string;
  target: Pick<SafetyReportTarget, "targetType" | "targetId" | "subjectUserId" | "contextType" | "contextId">;
  content: string;
  createdAt: string;
  /** Encrypted DM only: the signed envelope and its content key. */
  e2eeProof?: DmReportProof;
};

const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

export function buildTextEvidencePackage(target: SafetyReportTarget): Uint8Array | null {
  const content = target.evidenceText?.trim().slice(0, 12000) ?? "";
  if (!content) return null;
  const payload: EvidencePackage = {
    evidenceType: target.evidenceType ?? "context",
    target: {
      targetType: target.targetType,
      targetId: target.targetId,
      subjectUserId: target.subjectUserId,
      contextType: target.contextType,
      contextId: target.contextId,
    },
    content,
    createdAt: new Date().toISOString(),
    ...(target.e2eeProof ? { e2eeProof: target.e2eeProof } : {}),
  };
  return encoder.encode(canonicalJson(payload));
}

export async function encryptReportEvidence(plaintext: Uint8Array, key: ReportKey): Promise<ArrayBuffer> {
  if (key.algorithm !== "ECDH-P256-AESGCM") {
    throw new Error("This DeCave client does not support the configured evidence key algorithm.");
  }

  let publicJwk: JsonWebKey;
  try {
    publicJwk = JSON.parse(key.publicKey) as JsonWebKey;
  } catch {
    throw new Error("The Trust & Safety evidence key is invalid.");
  }

  const recipient = await crypto.subtle.importKey("jwk", publicJwk, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const sharedSecret = await crypto.subtle.deriveBits({ name: "ECDH", public: recipient }, ephemeral.privateKey, 256);
  const aesKey = await crypto.subtle.importKey("raw", sharedSecret, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const aad = encoder.encode(`decave-trust-safety-evidence-v1:${key.keyId}:${key.version}`);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: asArrayBuffer(iv), additionalData: asArrayBuffer(aad) },
      aesKey,
      asArrayBuffer(plaintext),
    ),
  );
  const ephemeralPublicKey = await crypto.subtle.exportKey("jwk", ephemeral.publicKey);
  const header = encoder.encode(
    canonicalJson({
      version: 1,
      algorithm: key.algorithm,
      keyId: key.keyId,
      keyVersion: key.version,
      iv: base64Url(iv),
      aad: base64Url(aad),
      ephemeralPublicKey,
    }),
  );
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, header.byteLength);
  return asArrayBuffer(concatBytes(length, header, ciphertext));
}

export async function decryptReportEvidence(
  encrypted: ArrayBuffer,
  privateKeyJwk: JsonWebKey,
): Promise<{ header: { keyId: string; keyVersion: number; algorithm: string }; plaintext: Uint8Array }> {
  if (encrypted.byteLength < 5) throw new Error("The evidence package is incomplete.");
  const view = new DataView(encrypted);
  const headerLength = view.getUint32(0);
  if (headerLength < 2 || headerLength > 128 * 1024 || 4 + headerLength >= encrypted.byteLength) {
    throw new Error("The evidence package header is invalid.");
  }

  const headerBytes = new Uint8Array(encrypted, 4, headerLength);
  const ciphertext = new Uint8Array(encrypted, 4 + headerLength);
  let parsed: {
    version?: number;
    algorithm?: string;
    keyId?: string;
    keyVersion?: number;
    iv?: string;
    aad?: string;
    ephemeralPublicKey?: JsonWebKey;
  };
  try {
    parsed = JSON.parse(new TextDecoder().decode(headerBytes)) as typeof parsed;
  } catch {
    throw new Error("The evidence package header is not readable.");
  }
  if (
    parsed.version !== 1 ||
    parsed.algorithm !== "ECDH-P256-AESGCM" ||
    typeof parsed.keyId !== "string" ||
    typeof parsed.keyVersion !== "number" ||
    !Number.isInteger(parsed.keyVersion) ||
    typeof parsed.iv !== "string" ||
    typeof parsed.aad !== "string" ||
    !parsed.ephemeralPublicKey
  ) {
    throw new Error("The evidence package uses an unsupported encryption format.");
  }

  const recipient = await crypto.subtle.importKey("jwk", privateKeyJwk, { name: "ECDH", namedCurve: "P-256" }, false, [
    "deriveBits",
  ]);
  const ephemeral = await crypto.subtle.importKey(
    "jwk",
    parsed.ephemeralPublicKey,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const sharedSecret = await crypto.subtle.deriveBits({ name: "ECDH", public: ephemeral }, recipient, 256);
  const aesKey = await crypto.subtle.importKey("raw", sharedSecret, { name: "AES-GCM" }, false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: asArrayBuffer(fromBase64Url(parsed.iv)),
      additionalData: asArrayBuffer(fromBase64Url(parsed.aad)),
    },
    aesKey,
    asArrayBuffer(ciphertext),
  );
  return {
    header: {
      keyId: parsed.keyId,
      keyVersion: parsed.keyVersion,
      algorithm: parsed.algorithm,
    },
    plaintext: new Uint8Array(plaintext),
  };
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function uploadReportEvidence(
  request: (path: string, init?: RequestInit) => Promise<Response>,
  reportId: string,
  target: SafetyReportTarget,
): Promise<boolean> {
  const plaintext = buildTextEvidencePackage(target);
  if (!plaintext) return false;
  const keyResponse = await request("/api/safety/report-key");
  if (!keyResponse.ok) return false;
  const key = (await keyResponse.json()) as ReportKey;
  const encrypted = await encryptReportEvidence(plaintext, key);
  const hash = await sha256Hex(encrypted);
  const response = await request(`/api/safety/reports/${encodeURIComponent(reportId)}/evidence`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-DeCave-Evidence-Sha256": hash,
      "X-DeCave-Evidence-Key-Id": key.keyId,
      "X-DeCave-Evidence-Type": target.evidenceType ?? "context",
      "X-DeCave-Evidence-Message-Id": target.targetType === "message" ? target.targetId : "",
      "X-DeCave-Evidence-Context-Type": target.contextType ?? "",
      "X-DeCave-Evidence-Context-Id": target.contextId ?? "",
      "X-DeCave-Evidence-Package-Version": "report-package-v1",
      "X-DeCave-Evidence-Encryption-Version": "report-envelope-v1",
    },
    body: encrypted,
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "Encrypted evidence could not be uploaded.");
  }
  return true;
}
