import assert from "node:assert/strict";
import test from "node:test";
import {
  hubMediaDimensionProblem,
  hubMediaHint,
  readImageDimensions,
  validateHubMediaDimensions,
} from "../../shared/hub-media-specs.ts";

const png = (w, h) => {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};
const gif = (w, h) => {
  const b = new Uint8Array(10);
  b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  new DataView(b.buffer).setUint16(6, w, true);
  new DataView(b.buffer).setUint16(8, h, true);
  return b;
};
const jpeg = (w, h) =>
  new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0,
    4,
    0,
    0,
    0xff,
    0xc0,
    0,
    17,
    8,
    h >> 8,
    h & 255,
    w >> 8,
    w & 255,
    3,
    0,
    0,
    0,
    0,
  ]);

test("reads PNG, GIF and JPEG header dimensions", () => {
  assert.deepEqual(readImageDimensions(png(600, 1800)), { width: 600, height: 1800 });
  assert.deepEqual(readImageDimensions(gif(1920, 1080)), { width: 1920, height: 1080 });
  assert.deepEqual(readImageDimensions(jpeg(1280, 720)), { width: 1280, height: 720 });
  assert.equal(readImageDimensions(new Uint8Array([1, 2, 3])), null);
});

test("banner must be 1:3 portrait within 5% and at least 400x1200", () => {
  assert.equal(validateHubMediaDimensions("banner", 600, 1800), null);
  assert.equal(validateHubMediaDimensions("banner", 620, 1800), null);
  assert.match(validateHubMediaDimensions("banner", 1200, 400), /600×1800/);
  assert.match(validateHubMediaDimensions("banner", 300, 900), /too small/);
});

test("chat background must be 16:9 landscape within 5% and at least 1280x720", () => {
  assert.equal(validateHubMediaDimensions("chat-background", 1920, 1080), null);
  assert.equal(validateHubMediaDimensions("chat-background", 2560, 1440), null);
  assert.match(validateHubMediaDimensions("chat-background", 1920, 1200), /1920×1080/);
  assert.match(validateHubMediaDimensions("chat-background", 800, 450), /too small/);
  assert.equal(validateHubMediaDimensions("icon", 1, 1), null);
});

test("header image accepts any wide image from 4:3 to 4:1, at least 900 px wide", () => {
  assert.equal(validateHubMediaDimensions("header", 1500, 500), null);
  assert.equal(validateHubMediaDimensions("header", 1194, 795), null, "3:2 welcome art fits as is");
  assert.equal(validateHubMediaDimensions("header", 1920, 1080), null);
  assert.match(validateHubMediaDimensions("header", 600, 1800), /between 4:3 and 4:1/);
  assert.match(validateHubMediaDimensions("header", 3000, 500), /between 4:3 and 4:1/);
  assert.match(validateHubMediaDimensions("header", 800, 400), /too small/);
});

test("messages are catalog keys whose English matches the text shown before translation", () => {
  assert.equal(hubMediaHint("banner"), "Recommended: 600×1800 px, portrait (minimum 400×1200)");
  assert.equal(
    hubMediaHint("header"),
    "Recommended: 1500×500 px; any wide image from 4:3 to 4:1 works (at least 900 px wide)",
  );
  assert.equal(hubMediaHint("chat-background"), "Recommended: 1920×1080 px, landscape (minimum 1280×720)");
  assert.equal(
    validateHubMediaDimensions("banner", 1200, 400),
    "Banner is 1200×400 px. It must be 600×1800 px portrait (aspect 1:3, ±5%).",
  );
  assert.equal(
    validateHubMediaDimensions("chat-background", 800, 450),
    "Chat background is 800×450 px, which is too small. Use 1920×1080 px landscape (at least 1280×720).",
  );
  assert.equal(
    validateHubMediaDimensions("header", NaN, NaN),
    "Header image image size could not be read. Use a PNG, JPG, WebP or GIF of 1500×500 px.",
  );
  assert.equal(
    validateHubMediaDimensions("header", 3000, 500),
    "Header image is 3000×500 px. Use a wide image between 4:3 and 4:1, such as 1500×500 px.",
  );
  assert.equal(
    validateHubMediaDimensions("header", 800, 400),
    "Header image is 800×400 px, which is too small. Use at least 900 px wide.",
  );
  assert.deepEqual(hubMediaDimensionProblem("banner", 300, 900), {
    code: "hubMedia.dimensions.banner.tooSmall",
    params: { width: 600, height: 1800, minWidth: 400, minHeight: 1200, actualWidth: 300, actualHeight: 900 },
    error: "Banner is 300×900 px, which is too small. Use 600×1800 px portrait (at least 400×1200).",
  });
});
