import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readAppSource } from "./app-source.mjs";

const main = await readFile(new URL("../../electron/main.cjs", import.meta.url), "utf8");
const preload = await readFile(new URL("../../electron/preload.cjs", import.meta.url), "utf8");
const app = readAppSource();
const { isSafeExternalUrl, shouldBlockPrivilegedResource } = await import("../../electron/security-boundary.cjs");

test("desktop browser uses an isolated WebContentsView session", () => {
  assert.match(main, /new WebContentsView\(/);
  assert.match(main, /persist:decave-browser-v1/);
  assert.match(main, /partition: BROWSER_SESSION_PARTITION/);
  assert.match(main, /rawInput\.tabKey/);
  assert.match(main, /browserViews\.size >= 8/);
  assert.match(main, /decave:browser:deactivate/);
  assert.match(main, /decave:browser:zoom/);
  assert.match(main, /decave:browser:find/);
  assert.match(main, /stopFindInPage/);
  assert.match(main, /found-in-page/);
  assert.match(main, /setZoomFactor/);
  assert.match(main, /enter-html-full-screen/);
  assert.match(main, /leave-html-full-screen/);
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /sandbox: true/);
  assert.match(main, /webSecurity: true/);
  const browserBlock = main.slice(
    main.indexOf('ipcMain.handle("decave:browser:create"'),
    main.indexOf('ipcMain.handle("decave:activity:scan"'),
  );
  assert.doesNotMatch(browserBlock, /preload:/);
});

test("desktop browser navigation and permissions fail closed", () => {
  assert.match(main, /url\.protocol !== "https:"/);
  assert.match(main, /url\.username \|\| url\.password/);
  assert.match(main, /contents\.setWindowOpenHandler\(\(\) => \(\{ action: "deny" \}\)\)/);
  assert.match(main, /contents\.on\("will-attach-webview", \(event\) => event\.preventDefault\(\)\)/);
  assert.match(main, /browserSession\.setPermissionCheckHandler/);
  assert.match(main, /browserPermissionRequests/);
  assert.match(main, /browserPermissionGrants/);
  assert.match(main, /browserPermissionKey\(origin, permission, mediaType\)/);
  assert.match(main, /request\.mediaType/);
  assert.match(main, /decave:browser:respond-permission/);
  assert.match(main, /callback\(false\)/);
  assert.match(main, /item\.cancel\(\)/);
  assert.match(main, /trustedBrowserRequest/);
});

test("preload exposes only the narrow browser operations", () => {
  assert.match(preload, /browser: \{/);
  for (const operation of [
    "create",
    "setBounds",
    "navigate",
    "back",
    "forward",
    "reload",
    "zoom",
    "find",
    "stopFind",
    "getState",
    "destroy",
  ]) {
    assert.match(preload, new RegExp(`${operation}:`));
  }
  assert.match(preload, /deactivate:/);
  assert.match(preload, /onPermissionRequest:/);
  assert.match(preload, /respondPermission:/);
  assert.doesNotMatch(preload, /executeJavaScript/);
  assert.doesNotMatch(preload, /webContents/);
});

test("desktop external links cover the shared social destinations", () => {
  for (const url of [
    "https://store.steampowered.com/",
    "https://discord.com/",
    "https://x.com/",
    "https://www.instagram.com/",
    "https://www.tiktok.com/",
    "https://github.com/",
  ]) {
    assert.equal(isSafeExternalUrl(url), true, `${url} should be allowed`);
  }
  assert.equal(isSafeExternalUrl("http://example.com/"), false);
  assert.equal(isSafeExternalUrl("https://example.com/"), false);
});

test("dashboard quick links use the same external-link path on web and desktop", () => {
  const quickLinksBlock = app.slice(
    app.indexOf('className="hdx-links-grid"'),
    app.indexOf('if (widget.id === "jumpBack")'),
  );
  assert.match(quickLinksBlock, /target="_blank"/);
  assert.doesNotMatch(quickLinksBlock, /window\.decaveDesktop/);
});

test("forum composer is portaled outside clipped message surfaces", () => {
  assert.match(app, /forumPostComposerOpen &&\s*createPortal\(/);
  assert.match(app, /createPortal\([\s\S]*?forum-compose[\s\S]*?document\.body/);
});

test("desktop renderer blocks embedded frames and remote code", () => {
  assert.equal(
    shouldBlockPrivilegedResource("https://example.com/", "subFrame", "GET", "https://app.de-cave.com/"),
    true,
  );
  assert.equal(
    shouldBlockPrivilegedResource("https://cdn.example.net/frame/", "object", "GET", "https://app.de-cave.com/"),
    true,
  );
  assert.equal(
    shouldBlockPrivilegedResource("https://example.com/player.js", "script", "GET", "https://app.de-cave.com/"),
    true,
  );
  assert.equal(shouldBlockPrivilegedResource("https://app.de-cave.com/api/profile", "fetch", "GET"), false);
});
