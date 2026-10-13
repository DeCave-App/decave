// Shared modules return catalog keys for text the apps show; their English must
// stay exactly what users saw before translation.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { NAMESPACES } = await import("../../shared/i18n/namespaces.ts");
const { getHubTemplateDefinitions, hubTemplateTextKey } = await import("../../shared/hub-templates.ts");
const { validateRule } = await import("../../shared/bots/schema.ts");
const { DM_E2EE_ERROR_TEXT, DmE2eeUnavailableError } = await import("../../shared/dm-e2ee-session.ts");
const { createSessionKit, prepareSessionKitLaunch } = await import("../../shared/session-kit.ts");
const { PRIVATE_NOTICE_LABEL, PRIVATE_NOTICE_LABEL_KEY } = await import("../../shared/bots/card-view.ts");
const runtime = await import("../../src/i18n/index.ts");
const { e2eeErrorText, e2eeStateErrorText } = await import("../../src/e2ee/errorText.ts");

const readLocale = (locale) =>
  Object.fromEntries(
    NAMESPACES.map((ns) => [
      ns,
      JSON.parse(fs.readFileSync(path.join(root, "shared/i18n/locales", locale, `${ns}.json`), "utf8")),
    ]),
  );
const english = readLocale("en");
runtime.setCatalogSource({ english, load: async (locale) => readLocale(locale) });
await runtime.initI18n("en");
const t = (key, params) => runtime.i18next.t(key, params);

test("hub template text has catalog keys with the same English", () => {
  for (const template of getHubTemplateDefinitions(true)) {
    assert.equal(t(`hub.templates.names.${template.id}`), template.name);
    assert.equal(t(`hub.templates.descriptions.${template.id}`), template.description);
    for (const room of template.rooms) {
      assert.equal(t(`hub.templates.rooms.${hubTemplateTextKey(room.name)}`), room.name);
      assert.equal(t(`hub.templates.categories.${hubTemplateTextKey(room.category)}`), room.category);
    }
  }
});

test("bot rule errors carry a catalog code whose English is the message", () => {
  const result = validateRule(
    {
      v: 2,
      trigger: { type: "schedule", every: 1, timezone: "UTC" },
      scope: { channels: ["nope"], roles: [] },
      cooldown: { perUser: 999999, perChannel: 0 },
      then: [{ type: "sendMessage", channel: "trigger", text: "" }],
    },
    {
      channelIds: new Set(["c1"]),
      voiceRoomIds: new Set(),
      roleIds: new Set(),
      ruleIds: new Set(),
      builtInCommands: new Set(),
    },
  );
  assert.equal(result.ok, false);
  const byPath = Object.fromEntries(result.errors.map((error) => [error.path, error]));
  assert.equal(byPath.v.message, "Unsupported rule version.");
  assert.equal(byPath["trigger.every"].message, "Schedules must run at least every 5 minutes.");
  assert.equal(byPath["scope.channels[0]"].message, "Unknown channel in this hub.");
  assert.equal(byPath["cooldown.perUser"].message, "Must be a number from 0 to 86400.");
  for (const error of result.errors) {
    assert.match(error.code, /^bots\.validation\./, error.path);
    assert.equal(t(error.code, error.params), error.message, error.code);
  }
});

test("DM encryption errors match the dm.e2ee.errors catalog", () => {
  // dm.e2ee.errors.crypto holds the DmCryptoError messages (shared/dm-e2ee.ts).
  const { crypto: cryptoErrors, ...sessionErrors } = english.dm.e2ee.errors;
  assert.deepEqual(sessionErrors, DM_E2EE_ERROR_TEXT);
  assert.ok(cryptoErrors);
  const error = new DmE2eeUnavailableError(DM_E2EE_ERROR_TEXT.signInFirst, "dm.e2ee.errors.signInFirst");
  assert.equal(e2eeErrorText(error, "fallback"), "Sign in first.");
  assert.equal(e2eeErrorText(new Error("Plain"), "fallback"), "Plain");
  assert.equal(e2eeErrorText(new DmE2eeUnavailableError("Server text", "errors.nope.missing"), "x"), "Server text");
  assert.equal(e2eeErrorText("not an error", "fallback"), "fallback");
  assert.equal(e2eeStateErrorText({ error: "Old", errorKey: "dm.e2ee.errors.notReady" }), DM_E2EE_ERROR_TEXT.notReady);
  assert.equal(e2eeStateErrorText({ error: "Old", errorKey: null }), "Old");
});

test("audit labels and admin values read from the admin catalog with unchanged English", async () => {
  const { readableAuditLabel } = await import("../../src/app/format.ts");
  const { adminValueLabel } = await import("../../src/app/views/admin/adminValues.ts");
  assert.equal(readableAuditLabel("login.mfa_failed"), "Login MFA Failed");
  assert.equal(readableAuditLabel("platform.account_details_viewed"), "Platform Account Details Viewed");
  assert.equal(readableAuditLabel("something.new_event"), "Something New Event", "unknown codes keep the old label");
  assert.ok(english.admin.auditEvents.login_mfa_failed);
  assert.equal(adminValueLabel("platformRole", "owner"), "owner");
  assert.equal(adminValueLabel("ageAssuranceMethod", "self_attested"), "self_attested");
  assert.equal(adminValueLabel("visibility", "weird value"), "weird value");
  assert.equal(adminValueLabel("ageBand", null), "");
});

test("the private-notice label key holds the English label", () => {
  assert.equal(t(PRIVATE_NOTICE_LABEL_KEY), PRIVATE_NOTICE_LABEL);
});

test("Session Kit launch lines keep their English and render from keys", () => {
  const kit = createSessionKit({
    name: "Ranked night",
    intent: "play",
    scope: { hubId: "hub-1", channelId: "voice-1", eventId: "event-1" },
    inviteUserIds: ["u-1", "u-2"],
    game: { name: "A game", platform: "PC" },
    voice: { inputDeviceId: "mic-1", outputDeviceId: "headphones-1", processingMode: "high-quality" },
    privacy: { presenceStatus: "online", notificationPreset: "mentions", allowUrgentMentions: true },
  });
  const plan = prepareSessionKitLaunch(kit, {
    hubIds: ["hub-1"],
    channelIdsByHub: { "hub-1": [] },
    eventIds: [],
    inviteUserIds: ["u-1"],
    inputDeviceIds: ["mic-1"],
    outputDeviceIds: [],
  });
  assert.deepEqual(plan.summary, [
    "Hub: hub-1",
    "Room: unavailable (skipped)",
    "Game: A game · PC",
    "Event: unavailable (skipped)",
    "Invites: 1 available; unchanged until you choose Invite",
    "Microphone: unchanged until you choose Join and enable it",
    "Camera: unchanged until you choose Camera",
  ]);
  assert.deepEqual(
    plan.summaryText.map((line) => t(line.key, line.params)),
    plan.summary,
  );
  assert.deepEqual(
    plan.issues.map((issue) => issue.message),
    [
      "This room is no longer available and was skipped.",
      "This event is unavailable and was skipped.",
      "An unavailable invite was skipped.",
      "The saved output is unavailable; the system output will be kept.",
    ],
  );
  for (const issue of plan.issues) assert.equal(t(issue.key), issue.message);
  const none = prepareSessionKitLaunch(
    { ...kit, inviteUserIds: [], game: { name: "", platform: null } },
    {
      hubIds: [],
    },
  );
  assert.equal(none.summary[0], "Hub: unavailable (safe home state)");
  assert.equal(none.summary[2], "Game: not set");
  assert.equal(none.summary[4], "Invites: none");
  assert.equal(none.issues[0].message, "This Hub is no longer available; the kit will open at the safe home state.");
});
