// A web tab or Home Screen web app left open picks up a new release when the
// person returns to it, never in the middle of a call or while they use it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { entryScriptFromHtml, runningEntryScript, shouldReloadForRelease, RETURN_AFTER_MS } =
  await import("../../src/app/web-release.ts");

test("reads the fingerprinted entry script from the served page", () => {
  const html = '<script type="module" crossorigin src="/assets/index-RRT9ot55.js"></script>';
  assert.equal(entryScriptFromHtml(html), "/assets/index-RRT9ot55.js");
  assert.equal(entryScriptFromHtml("<html>maintenance</html>"), null);
  const doc = {
    querySelectorAll: () => [
      { getAttribute: () => "https://challenges.cloudflare.com/turnstile/v0/api.js" },
      { getAttribute: () => "/assets/index-D4iXoNFy.js" },
    ],
  };
  assert.equal(runningEntryScript(doc), "/assets/index-D4iXoNFy.js");
  assert.equal(runningEntryScript({ querySelectorAll: () => [{ getAttribute: () => "/src/main.tsx" }] }), null);
});

test("reloads only for a new release, after being away, outside calls", () => {
  const base = {
    running: "/assets/index-old.js",
    latest: "/assets/index-new.js",
    hiddenForMs: RETURN_AFTER_MS,
    busy: false,
  };
  assert.equal(shouldReloadForRelease(base), true);
  assert.equal(shouldReloadForRelease({ ...base, latest: base.running }), false);
  assert.equal(shouldReloadForRelease({ ...base, latest: null }), false);
  assert.equal(shouldReloadForRelease({ ...base, busy: true }), false);
  assert.equal(shouldReloadForRelease({ ...base, hiddenForMs: 5_000 }), false);
});

test("the built index.html still names its entry script the way the check expects", () => {
  const built = new URL("../../dist/index.html", import.meta.url);
  if (!fs.existsSync(built)) return; // only after a web build
  assert.ok(entryScriptFromHtml(fs.readFileSync(built, "utf8")), "dist/index.html has no /assets/index-*.js");
});
