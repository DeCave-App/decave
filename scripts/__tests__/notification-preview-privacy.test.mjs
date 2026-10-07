import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_NOTIFICATION_PREVIEW as desktopDefault,
  normalizeNotificationPreview as normalizeDesktop,
  resolveNotificationPreview as resolveDesktop,
} from "../../src/privacy/notification-preview.ts";
import {
  DEFAULT_NOTIFICATION_PREVIEW as mobileDefault,
  normalizeNotificationPreview as normalizeMobile,
} from "../../mobile/src/lib/notification-preview.ts";

for (const [platform, defaultValue, normalize] of [
  ["desktop", desktopDefault, normalizeDesktop],
  ["mobile", mobileDefault, normalizeMobile],
]) {
  test(`${platform} notification previews default closed`, () => {
    assert.equal(defaultValue, "hidden");
    for (const malformed of [undefined, null, "", "FULL", 1, {}, []]) {
      assert.equal(normalize(malformed), "hidden");
    }
  });

  test(`${platform} preserves every explicit supported preview choice`, () => {
    for (const choice of ["hidden", "sender", "full"]) {
      assert.equal(normalize(choice), choice);
    }
  });

  test(`${platform} fails closed while the local endpoint is locked`, () => {
    const resolve =
      platform === "desktop" ? resolveDesktop : (value, unlocked) => (unlocked ? normalize(value) : "hidden");
    for (const choice of ["full", "sender", "hidden"]) {
      assert.equal(resolve(choice, false), "hidden");
    }
    assert.equal(resolve("full", true), "full");
  });
}
