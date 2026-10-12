import test from "node:test";
import assert from "node:assert/strict";

const { safeUploadedContentType, sniffedImageMime, UploadTypeError } =
  await import("../../worker/lib/upload-content-type.ts");

const bytes = (...values) => new Uint8Array(values);
const ascii = (text) => new TextEncoder().encode(text);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0);
const MP4 = ascii("\0\0\0\x18ftypisom\0\0\0\0");
const WEBM = bytes(0x1a, 0x45, 0xdf, 0xa3, 0, 0);

test("recognised media keeps its real type whatever the client declares", () => {
  assert.equal(safeUploadedContentType("text/html", PNG), "image/png");
  assert.equal(safeUploadedContentType("image/png", JPEG), "image/jpeg");
  assert.equal(safeUploadedContentType("video/mp4", MP4), "video/mp4");
  assert.equal(safeUploadedContentType("video/webm; codecs=vp9", WEBM), "video/webm");
  assert.equal(safeUploadedContentType("audio/mpeg", ascii("ID3\x04")), "audio/mpeg");
});

test("unrecognised bytes are stored as an opaque download", () => {
  assert.equal(safeUploadedContentType("text/html", ascii("<html><script></script>")), "application/octet-stream");
  assert.equal(safeUploadedContentType("image/svg+xml", PNG), "image/png");
  assert.equal(safeUploadedContentType("application/pdf", ascii("%PDF-1.7")), "application/octet-stream");
  assert.equal(safeUploadedContentType("video/mp4", ascii("not a video")), "application/octet-stream");
});

test("a declared image that is not image data is refused", () => {
  assert.throws(() => safeUploadedContentType("image/png", ascii("<svg onload=alert(1)>")), UploadTypeError);
  assert.throws(() => safeUploadedContentType("IMAGE/GIF", ascii("GIF")), UploadTypeError);
});

test("opaque uploads such as encrypted attachments are never sniffed", () => {
  // Ciphertext is random; it can start like a media header by chance.
  assert.equal(
    safeUploadedContentType("application/octet-stream", bytes(0xff, 0xfb, 1, 2)),
    "application/octet-stream",
  );
  assert.equal(safeUploadedContentType("application/octet-stream", PNG), "application/octet-stream");
  assert.equal(safeUploadedContentType("", JPEG), "application/octet-stream");
});

test("image-only uploads accept only allowed sniffed formats", () => {
  const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  assert.equal(sniffedImageMime(PNG, allowed), "image/png");
  assert.equal(sniffedImageMime(ascii("<svg/>"), allowed), null);
  assert.equal(sniffedImageMime(ascii("\0\0\0\x18ftypavif\0\0\0\0"), allowed), null);
});
