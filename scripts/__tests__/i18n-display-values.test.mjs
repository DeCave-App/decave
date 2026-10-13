// Stored English values shown in the UI language: Hub categories and signed-in device names.
import assert from "node:assert/strict";
import { test } from "node:test";

const { builtInHubCategory, hubCategoryLabel, hubCategoryFieldText, hubCategoryValue } =
  await import("../../shared/hub-categories.ts");
const {
  englishSessionDeviceLabel,
  parseSessionDeviceLabel,
  sessionDeviceFromJson,
  sessionDeviceFromUserAgent,
  sessionDeviceText,
} = await import("../../shared/session-device.ts");

const greek = {
  "hub.hubCategories.gaming": "Gaming",
  "hub.hubCategories.community": "Κοινότητα",
  "hub.hubCategories.racing": "Αγώνες ταχύτητας",
  "hub.hubCategories.creative": "Δημιουργικότητα",
  "hub.hubCategories.music": "Μουσική",
  "settings.sessionDevice.apps.browser": "Πρόγραμμα περιήγησης",
  "settings.sessionDevice.appOnOs": "{{app}} σε {{os}}",
  "settings.sessionDevice.withPlace": "{{name}} · {{place}}",
};
const tGreek = (key, options = {}) => (greek[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name) => options[name] ?? "");

test("built-in Hub categories are translated, custom ones are shown as typed", () => {
  assert.equal(builtInHubCategory(" community "), "community");
  assert.equal(hubCategoryLabel("Community", tGreek), "Κοινότητα");
  assert.equal(hubCategoryLabel("Racing", tGreek), "Αγώνες ταχύτητας");
  assert.equal(hubCategoryLabel("Speedrunning", tGreek), "Speedrunning");
  assert.equal(hubCategoryFieldText("Music", tGreek), "Μουσική");
  assert.equal(hubCategoryFieldText("music", tGreek), "music");
  assert.equal(hubCategoryValue("Μουσική", tGreek), "Music");
  assert.equal(hubCategoryValue("Μουσ", tGreek), "Μουσ");
  assert.equal(hubCategoryValue("Gaming", tGreek), "Gaming");
});

test("device labels round-trip through their parts", () => {
  const chromeWin =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
  const device = sessionDeviceFromUserAgent(chromeWin, "web", "GR");
  assert.deepEqual(device, { app: "chrome", os: "Windows", country: "GR" });
  const label = englishSessionDeviceLabel(device);
  assert.equal(label, "Chrome on Windows · Greece");
  assert.deepEqual(parseSessionDeviceLabel(label), device);
  for (const sample of ["DeCave Mobile", "Mobile app", "Legacy session", "Web browser on Linux", "Firefox on macOS"])
    assert.equal(englishSessionDeviceLabel(parseSessionDeviceLabel(sample)), sample);
  assert.equal(parseSessionDeviceLabel("Unknown device"), null);
  assert.equal(parseSessionDeviceLabel("Chrome on Windows · Atlantis"), null);
  assert.equal(sessionDeviceFromJson({ app: "nope", os: "", country: "" }), null);
  assert.deepEqual(sessionDeviceFromJson({ app: "browser", os: "Linux", country: "ZZZ" }), {
    app: "browser",
    os: "Linux",
    country: "",
  });
});

test("device names are shown in the UI language", () => {
  assert.equal(
    sessionDeviceText({ app: "browser", os: "Linux", country: "GR" }, tGreek, "el"),
    "Πρόγραμμα περιήγησης σε Linux · Ελλάδα",
  );
  assert.equal(sessionDeviceText({ app: "chrome", os: "", country: "" }, tGreek, "el"), "Chrome");
});

test("secure-account pages render in the requested language", async () => {
  const { secureAccountPromptPage, secureAccountResultPage } = await import("../../worker/lib/secure-account-pages.ts");
  const english = await secureAccountPromptPage("en", "tok", {
    kind: "device",
    deviceLabel: "Chrome on Windows · Greece",
  }).text();
  assert.match(english, /<html><head>/);
  assert.match(english, /<title>Secure your DeCave account<\/title>/);
  assert.match(english, /<p>Someone signed in on <strong>Chrome on Windows · Greece<\/strong>\.<\/p>/);
  const greek = await secureAccountPromptPage("el", "tok", {
    kind: "device",
    deviceLabel: "Chrome on Windows · Greece",
  }).text();
  assert.match(greek, /<html lang="el">/);
  assert.match(greek, /Προστάτεψε τον λογαριασμό σου/);
  assert.match(greek, /<strong>Chrome σε Windows · Ελλάδα<\/strong>/);
  const done = await secureAccountResultPage("en", { mailed: true }).text();
  assert.match(done, /Account secured<\/h1><p>Every device has been signed out\.<\/p>/);
  assert.match(done, /so a password alone can't get into your account\./);
  assert.match(done, /Settings &gt; Account &amp; security/);
});
