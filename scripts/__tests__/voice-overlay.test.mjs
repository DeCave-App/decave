import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const { clampOverlayScale, overlayBounds, overlayHtml, OVERLAY_SCALE_DEFAULT } = createRequire(import.meta.url)(
  "../../electron/voice-overlay.cjs",
);
const work = { x: 1920, y: 0, width: 1920, height: 1040 };

test("overlay size is clamped to 60–150% and defaults to 100%", () => {
  assert.equal(clampOverlayScale(undefined), OVERLAY_SCALE_DEFAULT);
  assert.equal(clampOverlayScale("abc"), OVERLAY_SCALE_DEFAULT);
  assert.equal(clampOverlayScale(10), 60);
  assert.equal(clampOverlayScale(999), 150);
  assert.equal(clampOverlayScale(87.4), 87);
});

test("overlay sits top-left of the game's display and grows with size and people", () => {
  const small = overlayBounds(work, 4, 60);
  const normal = overlayBounds(work, 4, 100);
  const large = overlayBounds(work, 4, 150);
  assert.equal(normal.x, work.x + 16, "on the display the game is on, not the primary one");
  assert.equal(normal.y, 16);
  assert.ok(small.width < normal.width && normal.width < large.width);
  assert.ok(small.height < normal.height && normal.height < large.height);
  assert.ok(normal.width <= 240 && normal.height <= 200, "compact at the default size");
  assert.ok(overlayBounds(work, 8, 100).height > normal.height);
  assert.equal(overlayBounds(work, 40, 100).height, overlayBounds(work, 12, 100).height, "at most 12 rows");
  assert.ok(
    overlayBounds({ x: 0, y: 0, width: 200, height: 100 }, 12, 150).height <= 100,
    "never larger than the screen",
  );
});

test("overlay page is static and writes names as text, never HTML", () => {
  const html = overlayHtml();
  assert.match(html, /Content-Security-Policy" content="default-src 'none'/);
  assert.match(html, /name\.textContent=p\.username/);
  assert.match(html, /label\.textContent=/);
  assert.ok(!/innerHTML\s*=\s*p\./.test(html), "participant data never reaches innerHTML");
  assert.match(html, /--s/);
});
