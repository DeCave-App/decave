import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { readAppSource } from "./app-source.mjs";
import { readWorkerSource } from "./worker-source.mjs";

const worker = readWorkerSource();
const app = readAppSource();
const baseCss = fs.readFileSync(new URL("../../src/styles/app.css", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../../src/styles/app-rework.css", import.meta.url), "utf8");
const mobileLogin = fs.readFileSync(new URL("../../mobile/app/(auth)/login.tsx", import.meta.url), "utf8");

test("login accepts email only across server, web and mobile", () => {
  const loginRoute = worker.slice(
    worker.indexOf('if (method === "POST" && p === "/api/auth/login")'),
    worker.indexOf('if (method === "POST" && p === "/api/auth/logout")'),
  );
  assert.match(loginRoute, /WHERE email_normalized = \?/);
  assert.doesNotMatch(loginRoute, /WHERE username\s*=/);
  assert.doesNotMatch(loginRoute, /body\.username/);
  assert.match(loginRoute, /Invalid email or password/);
  assert.match(app, /placeholder=\{authMode === "login" \? "Email" : "Username"\}/);
  assert.match(app, /authMode === "login" && !\/\^\\S\+@\\S\+\\\.\\S\+\$\//);
  assert.match(mobileLogin, /placeholder="Email"/);
  assert.match(mobileLogin, /keyboardType="email-address"/);
});

test("web Turnstile stays out of the auth form unless recovery is needed", () => {
  assert.match(app, /appearance: recoveryVisible \? "always" : "interaction-only"/);
  assert.match(app, /className=\{`decave-turnstile-shell\$\{recoveryVisible \? " recovery" : " background"\}`\}/);
  assert.match(app, /setRecoveryVisible\(true\)/);
  assert.match(baseCss, /\.decave-turnstile-shell\.background \{[\s\S]*left: -10000px;[\s\S]*pointer-events: none;/);
  assert.match(baseCss, /\.decave-turnstile-shell\.recovery \{[\s\S]*border: 1px solid rgba\(255, 112, 137, 0?\.28\)/);
});

test("desktop Turnstile starts in the background without a manual verify button", () => {
  const widget = app.slice(app.indexOf("function TurnstileWidget"), app.indexOf("function presenceLabel"));
  const turnstileModule = fs.readFileSync(new URL("../../electron/turnstile.cjs", import.meta.url), "utf8");
  const nativeFlow = turnstileModule.slice(
    turnstileModule.indexOf("async function showTurnstileChallenge"),
    turnstileModule.indexOf("module.exports"),
  );

  assert.match(widget, /void verifyDesktopHuman\(action\)/);
  assert.match(widget, /if \(desktopRuntime\) \{[\s\S]*if \(!recoveryVisible\) return null;/);
  assert.doesNotMatch(widget, /Verify securely/);
  assert.match(nativeFlow, /show: false/);
  assert.match(nativeFlow, /TURNSTILE_BACKGROUND_GRACE_MS/);
  assert.match(nativeFlow, /revealTurnstileChallenge\(\)/);
});

test("collapsed rail controls remain reachable and official room headings stay hidden", () => {
  assert.match(css, /\.dc-hub-rail-fold\s*\{\s*position:\s*absolute;\s*right:\s*7px/);
  assert.match(
    css,
    /data-hub-rail-collapsed="true"\][^}]*>\s*\.channel-sidebar\s*\{\s*overflow:\s*visible\s*!important;?\s*\}/,
  );
  assert.match(css, /\.dc-friends-rail-fold\s*\{\s*position:\s*absolute;\s*left:\s*7px/);
  // The Hub room list is the boxed sidebar (src/features/hub-sidebar, 2026-10 round 3).
  // Official (owner-only posting) Hubs still hide voice rooms; there is no generic
  // "TEXT ROOMS" heading any more, rooms sit under their own category titles.
  const roomBoxes = fs.readFileSync(
    new URL("../../src/features/hub-sidebar/HubRoomBoxes.tsx", import.meta.url),
    "utf8",
  );
  const roomModel = fs.readFileSync(
    new URL("../../src/features/hub-sidebar/roomBoxesModel.ts", import.meta.url),
    "utf8",
  );
  assert.match(app, /ownerOnlyPosting=\{currentServer\.ownerOnlyPosting === true\}/);
  assert.match(roomBoxes, /buildRoomBoxes\(props\.rooms, \{ ownerOnlyPosting: props\.ownerOnlyPosting \}\)/);
  assert.match(roomModel, /if \(voice\.length && !options\.ownerOnlyPosting\)/);
});

test("accessibility size scales the complete interface", () => {
  assert.match(app, /zoom: var\(--dc-a11y\)/);
  assert.match(app, /width: calc\(100% \/ var\(--dc-a11y\)\)/);
  assert.match(app, /height: calc\(100% \/ var\(--dc-a11y\)\)/);
  assert.doesNotMatch(app, /Scale typography and UI glyphs only/);
});

test("interface scale starts at default and is isolated per signed-in account", () => {
  assert.match(app, /useState<number>\(100\)/);
  assert.match(app, /if \(!userId\) return 100/);
  assert.match(app, /if \(raw === null\) return 100/);
  assert.match(app, /`\$\{ACCESSIBILITY_TEXT_SCALE_KEY\}:\$\{userId\}`/);
  assert.doesNotMatch(app, /localStorage\.setItem\(ACCESSIBILITY_TEXT_SCALE_KEY,/);
});

test("top account control owns the final explicit header column", () => {
  assert.match(app, /className="vadrion-top-account"/);
  assert.match(app, /\.vadrion-top-account \{\s*grid-column: 4 !important/s);
  assert.match(css, /\.vadrion-top-account \{\s*grid-column: 4;/s);
  assert.match(css, /@media \(max-width: 1400px\)[\s\S]*grid-template-columns: 76px 250px minmax\(0,\s*1fr\) 44px/);
});
