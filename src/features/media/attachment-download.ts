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

/**
 * Accept only a same-origin legacy upload path. The worker's upload route is
 * authenticated, so accepting arbitrary URLs here would turn the helper into
 * a credentialed cross-origin fetch primitive.
 */
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
  if (
    segments.length <= 3 ||
    segments.some((segment, index) => index >= 3 && (segment === "" || segment === "." || segment === ".."))
  ) {
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
  const declaredSize =
    decodedSize ?? (!contentEncoding || contentEncoding.trim().toLowerCase() === "identity" ? contentLength : null);
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
        try {
          await reader.cancel();
        } catch {
          /* preserve the size failure */
        }
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

export interface DesktopLegacyAttachmentDownloadOptions {
  url: string;
  baseUrl: string | URL;
  filename?: string | null;
  authorizedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  documentRef?: Pick<Document, "createElement" | "body">;
  urlRef?: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
  maxBytes?: number;
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
    throw new LegacyAttachmentError("network-failure", "The attachment request failed.");
  }
  assertResponseForAttachment(response, options.baseUrl);
  const body = await readBoundedLegacyAttachmentBody(response, options.maxBytes);
  const documentRef =
    options.documentRef ?? (typeof globalThis.document !== "undefined" ? globalThis.document : undefined);
  const urlRef = options.urlRef ?? (typeof globalThis.URL !== "undefined" ? globalThis.URL : undefined);
  if (!documentRef || !urlRef) {
    throw new LegacyAttachmentError("export-unavailable", "Desktop file export is unavailable in this environment.");
  }

  const objectUrl = urlRef.createObjectURL(new Blob([body.buffer as ArrayBuffer], { type: contentTypeFor(response) }));
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
