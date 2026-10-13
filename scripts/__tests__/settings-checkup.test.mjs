import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { checkupItems, CHECKUP_ORDER } = await import("../../src/features/settings/checkup/checks.ts");

/** Everything fine: no items. */
const healthy = {
  twoFactorOn: true,
  e2eeAvailable: true,
  recoveryBackupSaved: true,
  pttMode: false,
  pttKey: null,
  notificationsOn: true,
  notificationPermission: "granted",
  micTestedOnDevice: true,
  desktopUpdateReady: false,
  hasAvatar: true,
  isDesktop: false,
};
const ids = (state, dismissed = []) => checkupItems({ ...healthy, ...state }, dismissed).map((item) => item.id);

test("a healthy setup has nothing to fix", () => {
  assert.deepEqual(ids({}), []);
});

test("each item appears exactly when its condition holds", () => {
  assert.deepEqual(ids({ twoFactorOn: false }), ["twoFactor"]);
  assert.deepEqual(ids({ recoveryBackupSaved: false }), ["recoveryCode"]);
  assert.deepEqual(ids({ pttMode: true, pttKey: null }), ["pttKey"]);
  assert.deepEqual(ids({ pttMode: true, pttKey: "" }), ["pttKey"]);
  assert.deepEqual(ids({ pttMode: false, pttKey: null }), []);
  assert.deepEqual(ids({ notificationPermission: "denied" }), ["notificationsBlocked"]);
  assert.deepEqual(ids({ notificationPermission: "default" }), ["notificationsBlocked"]);
  assert.deepEqual(ids({ notificationPermission: "denied", notificationsOn: false }), []);
  assert.deepEqual(ids({ notificationPermission: "unsupported" }), []);
  assert.deepEqual(ids({ micTestedOnDevice: false }), ["micTest"]);
  assert.deepEqual(ids({ hasAvatar: false }), ["avatar"]);
});

test("a waiting update shows only in the desktop app", () => {
  assert.deepEqual(ids({ desktopUpdateReady: true, isDesktop: false }), []);
  assert.deepEqual(ids({ desktopUpdateReady: true, isDesktop: true }), ["updateReady"]);
});

test("the recovery code item needs encrypted messages to be available", () => {
  assert.deepEqual(ids({ recoveryBackupSaved: false, e2eeAvailable: false }), []);
});

test("dismissed items stay hidden", () => {
  assert.deepEqual(ids({ hasAvatar: false, micTestedOnDevice: false }, ["avatar"]), ["micTest"]);
});

test("items come in the spec's priority order with fixes", () => {
  const all = checkupItems(
    {
      twoFactorOn: false,
      e2eeAvailable: true,
      recoveryBackupSaved: false,
      pttMode: true,
      pttKey: null,
      notificationsOn: true,
      notificationPermission: "denied",
      micTestedOnDevice: false,
      desktopUpdateReady: true,
      hasAvatar: false,
      isDesktop: true,
    },
    [],
  );
  assert.deepEqual(
    all.map((item) => item.id),
    ["twoFactor", "recoveryCode", "pttKey", "notificationsBlocked", "micTest", "updateReady", "avatar"],
  );
  assert.deepEqual(
    CHECKUP_ORDER,
    all.map((item) => item.id),
  );
  assert.deepEqual(all[0].fix, { tab: "account", anchor: "two-factor" });
  assert.deepEqual(all[2].fix, { tab: "gaming", anchor: "push-to-talk" });
  assert.deepEqual(all[5].fix, { action: "restartToUpdate" });
  assert.equal(all[0].severity, "high");
  assert.equal(all[6].severity, "low");
  assert.deepEqual(checkupItems({ ...healthy, notificationPermission: "default" }, [])[0].fix, {
    action: "requestNotifications",
  });
});

test("the push to talk item goes away once a key is set", () => {
  const before = ids({ pttMode: true, pttKey: null });
  const after = ids({ pttMode: true, pttKey: "KeyV" });
  assert.deepEqual(before, ["pttKey"]);
  assert.deepEqual(after, []);
});

test("every item has English text", () => {
  const settings = JSON.parse(fs.readFileSync(path.join(root, "shared/i18n/locales/en/settings.json"), "utf8"));
  for (const id of CHECKUP_ORDER) {
    const item = settings.checkup.items[id];
    assert.ok(item?.title && item?.description && item?.fix, id);
  }
});
