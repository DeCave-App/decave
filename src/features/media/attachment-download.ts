import { i18next } from "../../i18n/index.ts";

// Error messages are in the UI language: callers show error.message.
export const LEGACY_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
const LEGACY_ATTACHMENT_PATH = "/uploads/attachments/";

export type LegacyAttachmentErrorCode =
  "invalid-url" | "invalid-response" | "http-error" | "network-failure" | "too-large" | "export-unavailable";

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
    throw invalid(i18next.t("chat.media.download.originInvalid"));
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw invalid(i18next.t("chat.media.download.originProtocol"));
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw invalid(i18next.t("chat.media.download.originState"));
  }
  return parsed;
}

/**
 * Accept only a same-origin legacy upload path. The worker's upload route is
 * authenticated, so accepting arbitrary URLs here would turn the helper into
 * a credentialed cross-origin fetch primitive.
 */
export function validateLegacyAttachmentUrl(value: string, baseUrl: string | URL): URL {
  if (typeof value !== "string" || !value.trim()) throw invalid(i18next.t("chat.media.download.urlEmpty"));
  if (/[\\]/.test(value) || /%(?:2f|5c)/i.test(value)) {
    throw invalid(i18next.t("chat.media.download.urlSeparator"));
  }
  const rawPath = value.split(/[?#]/, 1)[0] ?? value;
  if (/(?:^|\/)\.{1,2}(?:\/|$)/.test(rawPath) || /%(?:2e)/i.test(rawPath)) {
    throw invalid(i18next.t("chat.media.download.urlTraversal"));
  }

  const base = originFor(baseUrl);
  let parsed: URL;
  try {
    parsed = new URL(value, base.href);
  } catch {
    throw invalid(i18next.t("chat.media.download.urlInvalid"));
  }
  if (parsed.origin !== base.origin) throw invalid(i18next.t("chat.media.download.urlCrossOrigin"));
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw invalid(i18next.t("chat.media.download.urlState"));
  }
  if (/%(?:2e)/i.test(parsed.pathname)) {
    throw invalid(i18next.t("chat.media.download.urlEncodedTraversal"));
  }
  if (!parsed.pathname.startsWith(LEGACY_ATTACHMENT_PATH)) {
    throw invalid(i18next.t("chat.media.download.urlOutsideRoute"));
  }

  const segments = parsed.pathname.split("/");
  if (
    segments.length <= 3 ||
    segments.some((segment, index) => index >= 3 && (segment === "" || segment === "." || segment === ".."))
  ) {
    throw invalid(i18next.t("chat.media.download.urlUnsafeSegment"));
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
    throw new LegacyAttachmentError("too-large", i18next.t("chat.media.download.limitInvalid"));
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
  const declaredSize =
    decodedSize ?? (!contentEncoding || contentEncoding.trim().toLowerCase() === "identity" ? contentLength : null);
  if (declaredSize !== null) {
    if (!/^\d+$/.test(declaredSize.trim())) {
      throw new LegacyAttachmentError("invalid-response", i18next.t("chat.media.download.sizeInvalid"));
    }
    const announced = Number(declaredSize);
    if (!Number.isSafeInteger(announced) || announced > limit) {
      throw new LegacyAttachmentError("too-large", i18next.t("chat.media.download.tooLarge"));
    }
    expectedLength = announced;
  }

  const bodyStream = response.body;
  if (!bodyStream || typeof bodyStream.getReader !== "function") {
    if (expectedLength === null) {
      throw new LegacyAttachmentError("invalid-response", i18next.t("chat.media.download.noBoundedBody"));
    }
    try {
      const body = new Uint8Array(await response.arrayBuffer());
      if (body.byteLength > limit) {
        throw new LegacyAttachmentError("too-large", i18next.t("chat.media.download.tooLarge"));
      }
      if (body.byteLength !== expectedLength) {
        throw new LegacyAttachmentError("invalid-response", i18next.t("chat.media.download.incomplete"));
      }
      return body;
    } catch (error) {
      if (error instanceof LegacyAttachmentError) throw error;
      throw new LegacyAttachmentError("network-failure", i18next.t("chat.media.download.downloadFailed"));
    }
  }

  let reader: BoundedAttachmentReader;
  try {
    reader = bodyStream.getReader() as unknown as BoundedAttachmentReader;
  } catch {
    throw new LegacyAttachmentError("network-failure", i18next.t("chat.media.download.downloadFailed"));
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
        try {
          await reader.cancel();
        } catch {
          /* preserve the size failure */
        }
        throw new LegacyAttachmentError("too-large", i18next.t("chat.media.download.tooLarge"));
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof LegacyAttachmentError) throw error;
    throw new LegacyAttachmentError("network-failure", i18next.t("chat.media.download.downloadFailed"));
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
    throw new LegacyAttachmentError("invalid-response", i18next.t("chat.media.download.incomplete"));
  }
  return body;
}

function assertResponseForAttachment(response: Response, baseUrl: string | URL): void {
  if (response.redirected) {
    throw new LegacyAttachmentError("invalid-response", i18next.t("chat.media.download.redirected"));
  }
  if (!response.url) {
    throw new LegacyAttachmentError("invalid-response", i18next.t("chat.media.download.noVerifiedUrl"));
  }
  try {
    validateLegacyAttachmentUrl(response.url, baseUrl);
  } catch {
    throw new LegacyAttachmentError("invalid-response", i18next.t("chat.media.download.urlNotApproved"));
  }
  if (!response.ok) {
    throw new LegacyAttachmentError(
      "http-error",
      i18next.t("chat.media.download.requestFailedStatus", { status: response.status }),
    );
  }
}

function contentTypeFor(response: Response): string {
  const contentType = responseHeader(response, "content-type")?.split(";", 1)[0]?.trim();
  return contentType || "application/octet-stream";
}

export interface DesktopLegacyAttachmentDownloadOptions {
  url: string;
  baseUrl: string | URL;
  filename?: string | null;
  authorizedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  documentRef?: Pick<Document, "createElement" | "body">;
  urlRef?: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
  maxBytes?: number;
  /** Decrypts an end-to-end encrypted file after download. */
  decrypt?: ((bytes: Uint8Array) => Uint8Array) | null;
  /** The real type of a decrypted file (the server only knows it as a blob). */
  contentType?: string;
}

export interface LegacyAttachmentDownloadResult {
  filename: string;
  bytes: number;
  uri?: string;
}

export async function downloadLegacyAttachmentDesktop(
  options: DesktopLegacyAttachmentDownloadOptions,
): Promise<LegacyAttachmentDownloadResult> {
  const attachmentUrl = validateLegacyAttachmentUrl(options.url, options.baseUrl);
  const filename = sanitizeLegacyAttachmentFilename(options.filename);
  let response: Response;
  try {
    response = await options.authorizedFetch(attachmentUrl.href, {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      headers: { Accept: "application/octet-stream" },
    });
  } catch {
    throw new LegacyAttachmentError("network-failure", i18next.t("chat.media.download.requestFailed"));
  }
  assertResponseForAttachment(response, options.baseUrl);
  const downloaded = await readBoundedLegacyAttachmentBody(response, options.maxBytes);
  const body = options.decrypt ? options.decrypt(downloaded) : downloaded;
  const documentRef =
    options.documentRef ?? (typeof globalThis.document !== "undefined" ? globalThis.document : undefined);
  const urlRef = options.urlRef ?? (typeof globalThis.URL !== "undefined" ? globalThis.URL : undefined);
  if (!documentRef || !urlRef) {
    throw new LegacyAttachmentError("export-unavailable", i18next.t("chat.media.download.exportUnavailable"));
  }

  const type = options.decrypt ? options.contentType || "application/octet-stream" : contentTypeFor(response);
  const objectUrl = urlRef.createObjectURL(
    new Blob([body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer], { type }),
  );
  let anchor: HTMLAnchorElement | null = null;
  try {
    anchor = documentRef.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    documentRef.body?.appendChild(anchor);
    anchor.click();
  } finally {
    try {
      anchor?.remove();
    } finally {
      setTimeout(() => urlRef.revokeObjectURL(objectUrl), 0);
    }
  }
  return { filename, bytes: body.byteLength };
}
