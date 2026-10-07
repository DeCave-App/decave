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
  assert.match(
    main,
    /ipcMain\.handle\("decave:browser:clear-session", async \(event\) => \{[\s\S]*?trustedMainRenderer\(event\)[\s\S]*?clearStorageData\(\)[\s\S]*?clearCache\(\)/,
  );
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
  assert.match(preload, /clearSession:\s*\(\) => ipcRenderer\.invoke\("decave:browser:clear-session"\)/);
  assert.match(preload, /onPermissionRequest:/);
  assert.match(preload, /respondPermission:/);
  assert.doesNotMatch(preload, /executeJavaScript/);
  assert.doesNotMatch(preload, /webContents/);
});

test("desktop external links allowlisted social and developer destinations only", () => {
  for (const url of [
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
  for (const url of [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com/",
    "https://youtu.be/example",
    "https://www.twitch.tv/example",
  ]) {
    assert.equal(isSafeExternalUrl(url), false, `${url} should not be allowlisted`);
  }
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

test("desktop renderer blocks third-party frames and remote code", () => {
  for (const frame of [
    "https://player.twitch.tv/",
    "https://www.youtube-nocookie.com/embed/test",
    "https://www.youtube.com/embed/test",
    "https://example.com/",
  ]) {
    assert.equal(shouldBlockPrivilegedResource(frame, "subFrame", "GET", "https://app.de-cave.com/"), true, frame);
  }
  assert.equal(
    shouldBlockPrivilegedResource(
      "https://www.youtube.com/s/player/base.js",
      "script",
      "GET",
      "https://www.youtube-nocookie.com/",
    ),
    true,
  );
  assert.equal(
    shouldBlockPrivilegedResource("https://example.com/player.js", "script", "GET", "https://app.de-cave.com/"),
    true,
  );
  assert.equal(
    shouldBlockPrivilegedResource(
      "https://app.de-cave.com/assets/index.js",
      "script",
      "GET",
      "https://app.de-cave.com/",
    ),
    false,
  );
});

test("DM encryption keys are wrapped by the OS keychain only for the trusted app window", () => {
  for (const channel of ["decave:e2ee:protect-key", "decave:e2ee:unprotect-key"]) {
    const start = main.indexOf(`ipcMain.handle("${channel}"`);
    assert.ok(start > 0, `${channel} is handled`);
    const handler = main.slice(start, main.indexOf("\n});", start));
    assert.match(handler, /if \(!trustedMainRenderer\(event\)\)/, `${channel} checks the sender`);
    assert.match(handler, /osKeychainAvailable\(\)/, `${channel} refuses without a real keychain`);
    assert.match(preload, new RegExp(`ipcRenderer\\.invoke\\("${channel}"`));
  }
  // Linux without a secret service falls back to a hard-coded key: not a keychain.
  assert.match(main, /getSelectedStorageBackend\(\) !== "basic_text"/);
});
