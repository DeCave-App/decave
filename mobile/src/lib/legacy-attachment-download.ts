export const LEGACY_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
const LEGACY_ATTACHMENT_PATH = "/uploads/attachments/";

export type LegacyAttachmentErrorCode =
  | "invalid-url"
  | "invalid-response"
  | "http-error"
  | "network-failure"
  | "too-large"
  | "export-unavailable";

export class LegacyAttachmentError extends Error {
  readonly code: LegacyAttachmentErrorCode;

  constructor(code: LegacyAttachmentErrorCode, message: string) {
    super(message);
    this.name = "LegacyAttachmentError";
    this.code = code;
  }
}

function invalid(message: string): LegacyAttachmentError {
  return new LegacyAttachmentError("invalid-url", message);
}

function originFor(value: string | URL): URL {
  let parsed: URL;
  try {
    parsed = value instanceof URL ? new URL(value.href) : new URL(value);
  } catch {
    throw invalid("The attachment origin is invalid.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw invalid("The attachment origin must use HTTP(S).");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw invalid("The attachment origin must not contain credentials or URL state.");
  }
  return parsed;
}

export function validateLegacyAttachmentUrl(value: string, baseUrl: string | URL): URL {
  if (typeof value !== "string" || !value.trim()) throw invalid("The attachment URL is empty.");
  if (/[\\]/.test(value) || /%(?:2f|5c)/i.test(value)) {
    throw invalid("The attachment URL contains an encoded or literal path separator.");
  }
  const rawPath = value.split(/[?#]/, 1)[0] ?? value;
  if (/(?:^|\/)\.{1,2}(?:\/|$)/.test(rawPath) || /%(?:2e)/i.test(rawPath)) {
    throw invalid("The attachment URL contains traversal.");
  }

  const base = originFor(baseUrl);
  let parsed: URL;
  try {
    parsed = new URL(value, base.href);
  } catch {
    throw invalid("The attachment URL is invalid.");
  }
  if (parsed.origin !== base.origin) throw invalid("The attachment URL is not same-origin.");
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw invalid("The attachment URL must not contain credentials, a query, or a fragment.");
  }
  if (/%(?:2e)/i.test(parsed.pathname)) {
    throw invalid("The attachment URL contains encoded traversal.");
  }
  if (!parsed.pathname.startsWith(LEGACY_ATTACHMENT_PATH)) {
    throw invalid("The attachment URL is outside the legacy attachment route.");
  }

  const segments = parsed.pathname.split("/");
  if (segments.length <= 3 || segments.some((segment, index) =>
    index >= 3 && (segment === "" || segment === "." || segment === ".."))) {
    throw invalid("The attachment URL contains an unsafe path segment.");
  }
  return parsed;
}

export function sanitizeLegacyAttachmentFilename(value: string | null | undefined): string {
  const source = typeof value === "string" ? value.normalize("NFKC") : "";
  const cleaned = source
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return "attachment.bin";
  return cleaned.slice(0, 120) || "attachment.bin";
}

function byteLimit(value: number | undefined): number {
  if (value === undefined) return LEGACY_ATTACHMENT_MAX_BYTES;
  if (!Number.isSafeInteger(value) || value <= 0 || value > LEGACY_ATTACHMENT_MAX_BYTES) {
    throw new LegacyAttachmentError("too-large", "The attachment size limit is invalid.");
  }
  return value;
}

function responseHeader(response: Response, name: string): string | null {
  return response.headers?.get(name) ?? null;
}

type BoundedAttachmentReader = {
  read: () => Promise<{ done: boolean; value?: Uint8Array }>;
  cancel: () => Promise<unknown> | unknown;
  releaseLock: () => void;
};

export async function readBoundedLegacyAttachmentBody(
  response: Response,
  requestedLimit?: number,
): Promise<Uint8Array> {
  const limit = byteLimit(requestedLimit);
  const decodedSize = responseHeader(response, "x-decave-attachment-size");
  const contentLength = responseHeader(response, "content-length");
  const contentEncoding = responseHeader(response, "content-encoding");
  let expectedLength: number | null = null;
  const declaredSize = decodedSize ??
    (!contentEncoding || contentEncoding.trim().toLowerCase() === "identity" ? contentLength : null);
  if (declaredSize !== null) {
    if (!/^\d+$/.test(declaredSize.trim())) {
      throw new LegacyAttachmentError("invalid-response", "The attachment size is invalid.");
    }
    const announced = Number(declaredSize);
    if (!Number.isSafeInteger(announced) || announced > limit) {
      throw new LegacyAttachmentError("too-large", "The attachment exceeds the 25 MiB limit.");
    }
    expectedLength = announced;
  }

  const bodyStream = response.body;
  if (!bodyStream || typeof bodyStream.getReader !== "function") {
    if (expectedLength === null) {
      throw new LegacyAttachmentError("invalid-response", "The attachment response has no bounded body.");
    }
    try {
      const body = new Uint8Array(await response.arrayBuffer());
      if (body.byteLength > limit) {
        throw new LegacyAttachmentError("too-large", "The attachment exceeds the 25 MiB limit.");
      }
      if (body.byteLength !== expectedLength) {
        throw new LegacyAttachmentError("invalid-response", "The attachment response size was incomplete.");
      }
      return body;
    } catch (error) {
      if (error instanceof LegacyAttachmentError) throw error;
      throw new LegacyAttachmentError("network-failure", "The attachment download failed.");
    }
  }

  let reader: BoundedAttachmentReader;
  try {
    reader = bodyStream.getReader() as unknown as BoundedAttachmentReader;
  } catch {
    throw new LegacyAttachmentError("network-failure", "The attachment download failed.");
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value as Uint8Array;
      total += chunk.byteLength;
      if (total > limit) {
        try { await reader.cancel(); } catch { /* preserve the size failure */ }
        throw new LegacyAttachmentError("too-large", "The attachment exceeds the 25 MiB limit.");
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof LegacyAttachmentError) throw error;
    throw new LegacyAttachmentError("network-failure", "The attachment download failed.");
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (expectedLength !== null && body.byteLength !== expectedLength) {
    throw new LegacyAttachmentError("invalid-response", "The attachment response size was incomplete.");
  }
  return body;
}

function assertResponseForAttachment(response: Response, baseUrl: string | URL): void {
  if (response.redirected) {
    throw new LegacyAttachmentError("invalid-response", "The attachment response was redirected.");
  }
  if (!response.url) {
    throw new LegacyAttachmentError("invalid-response", "The attachment response has no verified URL.");
  }
  try {
    validateLegacyAttachmentUrl(response.url, baseUrl);
  } catch {
    throw new LegacyAttachmentError("invalid-response", "The attachment response URL is not approved.");
  }
  if (!response.ok) {
    throw new LegacyAttachmentError("http-error", `The attachment request failed (${response.status}).`);
  }
}

function contentTypeFor(response: Response): string {
  const contentType = responseHeader(response, "content-type")?.split(";", 1)[0]?.trim();
  return contentType || "application/octet-stream";
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof globalThis.btoa === "function") {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      const chunk = bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length));
      let part = "";
      for (const byte of chunk) part += String.fromCharCode(byte);
      binary += part;
    }
    return globalThis.btoa(binary);
  }

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    output += alphabet[first >> 2];
    output += alphabet[((first & 3) << 4) | ((second ?? 0) >> 4)];
    output += second === undefined ? "=" : alphabet[((second & 15) << 2) | ((third ?? 0) >> 6)];
    output += third === undefined ? "=" : alphabet[third & 63];
  }
  return output;
}

/** Fetches an authenticated image attachment without ever forwarding credentials across redirects. */
export async function loadAuthenticatedAttachmentImage(
  options: {
    url: string;
    baseUrl: string | URL;
    token: string;
    apiFetch: (path: string, init?: RequestInit, token?: string | null) => Promise<Response>;
    signal?: AbortSignal;
  },
): Promise<string> {
  const attachmentUrl = validateLegacyAttachmentUrl(options.url, options.baseUrl);
  let response: Response;
  try {
    response = await options.apiFetch(attachmentUrl.pathname, {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      signal: options.signal,
      headers: { Accept: "image/png, image/jpeg, image/gif, image/webp" },
    }, options.token);
  } catch {
    throw new LegacyAttachmentError("network-failure", "The attachment image request failed.");
  }
  assertResponseForAttachment(response, options.baseUrl);
  const mime = contentTypeFor(response).toLowerCase();
  if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mime)) {
    throw new LegacyAttachmentError("invalid-response", "The attachment response is not a supported image.");
  }
  const bytes = await readBoundedLegacyAttachmentBody(response);
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

export interface MobileLegacyAttachmentFileSystem {
  EncodingType?: { Base64?: string };
  /** iOS: app-private documents directory used before handing the file to the share sheet. */
  documentDirectory?: string | null;
  writeAsStringAsync?: (fileUri: string, contents: string, options?: { encoding?: string }) => Promise<void>;
  StorageAccessFramework: {
    requestDirectoryPermissionsAsync: () => Promise<{ granted: boolean; directoryUri?: string }>;
    createFileAsync: (parentUri: string, fileName: string, mimeType: string) => Promise<string>;
    writeAsStringAsync: (fileUri: string, contents: string, options?: { encoding?: string }) => Promise<void>;
  };
}

export interface MobileLegacyAttachmentDownloadOptions {
  url: string;
  baseUrl: string | URL;
  token?: string | null;
  filename?: string | null;
  platform: "android" | "ios" | "web" | "windows" | "macos";
  /** iOS share sheet; defaults to React Native's Share API. */
  share?: (content: { url: string; title?: string }) => Promise<unknown>;
  apiFetch: (path: string, init?: RequestInit, token?: string | null) => Promise<Response>;
  fileSystem?: MobileLegacyAttachmentFileSystem;
  maxBytes?: number;
}

export async function downloadLegacyAttachmentMobile(
  options: MobileLegacyAttachmentDownloadOptions,
): Promise<LegacyAttachmentDownloadResult> {
  if (options.platform !== "android" && options.platform !== "ios") {
    throw new LegacyAttachmentError(
      "export-unavailable",
      "Saving attachments is supported on Android and iOS.",
    );
  }
  const attachmentUrl = validateLegacyAttachmentUrl(options.url, options.baseUrl);
  const filename = sanitizeLegacyAttachmentFilename(options.filename);
  let response: Response;
  try {
    response = await options.apiFetch(attachmentUrl.pathname, {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      headers: { Accept: "application/octet-stream" },
    }, options.token);
  } catch {
    throw new LegacyAttachmentError("network-failure", "The attachment request failed.");
  }
  assertResponseForAttachment(response, options.baseUrl);
  const body = await readBoundedLegacyAttachmentBody(response, options.maxBytes);
  const fileSystem = options.fileSystem ??
    (await import("expo-file-system/legacy") as unknown as MobileLegacyAttachmentFileSystem);
  const encoding = fileSystem.EncodingType?.Base64 ?? "base64";
  if (options.platform === "ios") {
    // iOS has no folder picker: keep a copy in the app's documents folder and
    // let the user choose where it goes ("Save to Files", another app, ...).
    if (!fileSystem.documentDirectory || !fileSystem.writeAsStringAsync) {
      throw new LegacyAttachmentError("export-unavailable", "This device cannot save attachments.");
    }
    const fileUri = `${fileSystem.documentDirectory}${encodeURIComponent(filename)}`;
    await fileSystem.writeAsStringAsync(fileUri, bytesToBase64(body), { encoding });
    const share = options.share ??
      (async (content: { url: string; title?: string }) => (await import("react-native")).Share.share(content));
    await share({ url: fileUri, title: filename });
    return { filename, bytes: body.byteLength, uri: fileUri };
  }
  const permissions = await fileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permissions.granted || !permissions.directoryUri) {
    throw new LegacyAttachmentError("export-unavailable", "Choose a folder to save the attachment.");
  }
  const mimeType = contentTypeFor(response);
  const fileUri = await fileSystem.StorageAccessFramework.createFileAsync(
    permissions.directoryUri,
    filename,
    mimeType,
  );
  await fileSystem.StorageAccessFramework.writeAsStringAsync(fileUri, bytesToBase64(body), { encoding });
  return { filename, bytes: body.byteLength, uri: fileUri };
}

export interface LegacyAttachmentDownloadResult {
  filename: string;
  bytes: number;
  uri?: string;
}
