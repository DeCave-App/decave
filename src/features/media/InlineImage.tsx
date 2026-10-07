import { useEffect, useRef, useState } from "react";
import { validateLegacyAttachmentUrl, readBoundedLegacyAttachmentBody } from "./attachment-download";
import { Icon } from "../../components/Icon";
import "./inlineImage.css";

/** Image types shown inline. SVG is left out on purpose (it can carry script). */
export const INLINE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);
const INLINE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export function canShowInline(attachment: { mimeType?: string; size?: number }): boolean {
  return (
    INLINE_IMAGE_TYPES.has(String(attachment.mimeType || "").toLowerCase()) &&
    (attachment.size ?? 0) <= INLINE_IMAGE_MAX_BYTES
  );
}

// Object URLs for images already fetched this session, so scrolling back up or
// re-rendering doesn't download them again. Oldest are released past 80.
const cache = new Map<string, string>();
function remember(key: string, objectUrl: string) {
  cache.set(key, objectUrl);
  while (cache.size > 80) {
    const [oldestKey, oldestUrl] = cache.entries().next().value as [string, string];
    cache.delete(oldestKey);
    URL.revokeObjectURL(oldestUrl);
  }
}

type Props = {
  attachment: { id?: string; name: string; mimeType: string; size?: number; url: string };
  baseUrl: string;
  authorizedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  onDownload: () => void;
  /** Decrypts an end-to-end encrypted image after download. */
  decrypt?: ((bytes: Uint8Array) => Uint8Array) | null;
};

/** A photo inside a message: loads when scrolled into view, opens full size on click. */
export function InlineImage({ attachment, baseUrl, authorizedFetch, onDownload, decrypt }: Props) {
  const key = attachment.url;
  const [src, setSrc] = useState<string | null>(() => cache.get(key) ?? null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const holder = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (src || failed) return;
    const element = holder.current;
    if (!element) return;
    let cancelled = false;
    const load = async () => {
      try {
        const url = validateLegacyAttachmentUrl(attachment.url, baseUrl);
        const response = await authorizedFetch(url.href, {
          method: "GET",
          cache: "force-cache",
          redirect: "error",
          headers: { Accept: decrypt ? "application/octet-stream" : attachment.mimeType },
        });
        if (!response.ok) throw new Error(String(response.status));
        // An encrypted file is 16 bytes longer than the image (the authentication tag).
        const downloaded = await readBoundedLegacyAttachmentBody(response, INLINE_IMAGE_MAX_BYTES + (decrypt ? 16 : 0));
        const body = decrypt ? decrypt(downloaded) : downloaded;
        const objectUrl = URL.createObjectURL(
          new Blob([body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer], {
            type: attachment.mimeType,
          }),
        );
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        remember(key, objectUrl);
        setSrc(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    };
    if (typeof IntersectionObserver === "undefined") {
      void load();
      return () => {
        cancelled = true;
      };
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          void load();
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
    // authorizedFetch is a new function on every App render; the URL is what matters.
  }, [key, src, failed, attachment.url, attachment.mimeType, baseUrl]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  if (failed) {
    return (
      <button type="button" className="chat-media-preview" onClick={onDownload}>
        <span>Image · {attachment.name}</span>
        <small>Couldn't show the preview. Download instead.</small>
      </button>
    );
  }

  return (
    <>
      <button
        ref={holder}
        type="button"
        className={`dc-inline-image${src ? " is-loaded" : ""}`}
        onClick={() => src && setOpen(true)}
        aria-label={`Open image ${attachment.name}`}
        title={attachment.name}
      >
        {src ? (
          <img src={src} alt={attachment.name} />
        ) : (
          <span className="dc-inline-image-placeholder">
            <Icon name="image" />
            Loading image…
          </span>
        )}
      </button>
      {open && src && (
        <div
          className="dc-image-viewer"
          role="dialog"
          aria-modal="true"
          aria-label={attachment.name}
          onClick={() => setOpen(false)}
        >
          <img src={src} alt={attachment.name} onClick={(event) => event.stopPropagation()} />
          <div className="dc-image-viewer-bar" onClick={(event) => event.stopPropagation()}>
            <span>{attachment.name}</span>
            <button type="button" className="ds-btn ds-btn-sm" onClick={onDownload}>
              <Icon name="download" size="sm" />
              Download
            </button>
            <button
              type="button"
              className="ds-btn ds-btn-sm ds-btn-ghost"
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              <Icon name="close" size="sm" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
