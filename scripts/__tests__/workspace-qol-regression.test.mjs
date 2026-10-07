import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { readAppSource } from "./app-source.mjs";
import { readWorkerSource } from "./worker-source.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (name) => fs.readFile(path.join(root, name), "utf8");

test("active voice sessions expose a persistent mini-player outside the voice channel", async () => {
  const [app, css] = await Promise.all([readAppSource(), read("src/styles/app-rework.css")]);
  assert.match(app, /voiceMiniPlayerVisible/);
  assert.match(app, /className="dc-voice-mini-player(?: [^"]*)?"/);
  assert.match(app, /data-voice-surface="persistent"/);
  assert.match(app, /onClick=\{toggleMute\}/);
  assert.match(app, /onClick=\{toggleDeafen\}/);
  assert.match(app, /onClick=\{returnToVoiceChannel\}/);
  assert.match(app, /className="dc-voice-mini-return"/);
  assert.match(css, /\.dc-voice-mini-player/);
});

test("channel reorder is a single permission-checked complete-section operation", async () => {
  const [app, worker] = await Promise.all([readAppSource(), readWorkerSource()]);
  assert.match(app, /\/api\/servers\/\$\{currentServer\.id\}\/channels\/reorder/);
  assert.doesNotMatch(app, /Promise\.all\(ordered\.map\(\(channel, position\).*?\/api\/channels\//s);
  assert.match(worker, /\/api\\\/servers\\\/\(\\d\+\)\\\/channels\\\/reorder/);
  assert.match(worker, /hasPermission\(env\.DB, hubId, user\.id, "manageRooms"\)/);
  assert.match(worker, /The order must include every room in that section/);
  assert.match(worker, /env\.DB\.batch\(\s*orderedIds\.map/);
});

test("Hub, voice, Discover, and DM requested cleanup remains present", async () => {
  const [app, css] = await Promise.all([readAppSource(), read("src/styles/app-rework.css")]);
  assert.doesNotMatch(app, /Right-click a person for volume, friend and moderation controls/);
  assert.doesNotMatch(app, />Active now<|>Any status</);
  // Theme selectors may retain this name; only rendered metadata is a regression.
  assert.doesNotMatch(app, /className\s*=\s*["'][^"']*\bdc-dm-reference-meta\b[^"']*["']/);
  const forumView = await read("src/features/forum/ForumView.tsx");
  assert.match(app, /ownerOnlyPosting=\{currentServer\.ownerOnlyPosting === true\}/);
  assert.match(forumView, /!props\.ownerOnlyPosting && <div className="dc-forum-card-votes"/);
  assert.match(forumView, /!props\.ownerOnlyPosting &&\s*\(?\s*<div className="dc-forum-root-votes"/);
  // The Hub composer only renders for members who can post.
  assert.match(app, /canPostInCurrentHub &&\s*\(?\s*(?:!legacyHistoryReadOnly &&\s*)?<HubComposer\b/);
  assert.match(app, /<div className="composer-shell">/);
  assert.match(app, /accessibleVoiceFriends/);
  assert.match(app, /for \(const server of servers\)/);
  // Friends now appear in cards grouped by Hub and voice room.
  assert.match(
    app,
    /onClick=\{\(\) => \{\s*if \(!inThisVoiceRoom\) openFriendVoiceRoom\(group\.server, group\.channel\);\s*\}\}/,
  );
  assert.match(app, /className="dc-friends-voice-panel" aria-label="Friends in voice rooms"/);
  assert.match(app, /friendVoiceGroups\.map\(\(group\) => \{\s*const inThisVoiceRoom/);
  assert.match(app, /setShowHubMembersPanel\(false\)/);
  assert.match(css, /\.voice-presence-person\s*\{\s*width:\s*auto\s*!important;\s*min-height:\s*190px/);
  assert.match(css, /\.app\[data-workspace="hub"\] \.v21-hub-header\s*\{\s*margin-top:\s*50px\s*!important;?\s*\}/);
  assert.doesNotMatch(app, /<span>Version<\/span><strong>\d+\.\d+\.\d+<\/strong>/);
  assert.match(app, /desktopUpdateState\?\.currentVersion/);
});

test("bottom bar does not render the encryption status label", async () => {
  const app = await readAppSource();
  assert.doesNotMatch(app, /className="dc-bottom-bar-center"/);
});

test("settings actions stay in document flow until the end of the page", async () => {
  const css = await read("src/styles/app-rework.css");
  const actionRules = [...css.matchAll(/\.dc-settings-shell > \.modal-buttons \{([\s\S]*?)\}/g)].map(
    (match) => match[1],
  );
  assert.ok(actionRules.length > 0);
  assert.ok(actionRules.every((rule) => /position: static !important/.test(rule)));
  assert.ok(actionRules.every((rule) => !/position: sticky/.test(rule)));
});

test("Hub sidebars use rounded scroll surfaces like the global rail", async () => {
  const css = await read("src/styles/app-rework.css");
  assert.match(
    css,
    /\.app\[data-skin\]\[data-workspace="hub"\] > \.channel-sidebar \{[\s\S]*border-radius: 0 12px 12px 0 !important/,
  );
  assert.match(
    css,
    /\.app\[data-skin\]\[data-workspace="hub"\] > \.dc-global-friends-sidebar \{[\s\S]*border-radius: 12px 0 0 12px !important/,
  );
  assert.match(css, /\.app\[data-skin\]\[data-workspace="hub"\] > \.channel-sidebar \{[\s\S]*margin: 0 !important/);
  assert.match(
    css,
    /\.app\[data-skin\]\[data-workspace="hub"\] > \.dc-global-friends-sidebar \{[\s\S]*margin: 0 !important/,
  );
});

test("global navigation exposes clear active and reset states", async () => {
  const [app, css] = await Promise.all([readAppSource(), read("src/styles/app-rework.css")]);
  assert.match(app, /aria-current=\{showHome \? "page" : undefined\}/);
  assert.doesNotMatch(app, /data-primary-nav="hubs"/);
  assert.doesNotMatch(app, /data-primary-nav="more"/);
  // Rail icons come from the shared design-system Icon set (no glyph icons).
  assert.match(app, /data-primary-nav="home"[\s\S]{0,500}<Icon name="home" size="xl" \/>/);
  assert.match(app, /data-primary-nav="dms"[\s\S]{0,500}<Icon name="message" size="xl" \/>/);
  assert.match(app, /data-primary-nav="friends"[\s\S]{0,500}<Icon name="users" size="xl" \/>/);
  assert.match(app, /data-primary-nav="squad-finder"[\s\S]{0,500}<Icon name="gamepad" size="xl" \/>/);
  assert.match(app, /data-primary-nav="discover"[\s\S]{0,500}<Icon name="compass" size="xl" \/>/);
  assert.match(css, /--dc-ui-support-size: 11px/);
  assert.match(css, /\.app\[data-skin\]\[data-workspace\].*dc-home-friends-list small/s);
});

test("legacy dock workspace files and session layout APIs are absent", async () => {
  const [app, sessionKit] = await Promise.all([readAppSource(), read("shared/session-kit.ts")]);
  assert.equal(existsSync(path.join(root, "src/docks")), false);
  assert.doesNotMatch(app, /<DockWorkspace|openDockWorkspace|dockWorkspaceRevision|decave-dock-layout/);
  assert.doesNotMatch(sessionKit, /dockLayout(?:Id|Snapshot|Ids|s)?/i);
});

test("Home and Hub surfaces retain their standalone layout styling", async () => {
  const css = await read("src/styles/app-rework.css");
  assert.match(
    css,
    /\.app\[data-skin\]\[data-workspace="discover"\] > \.dc-discover-page > \.dc-discover-shell[\s\S]*border-radius: 15px !important/,
  );
  assert.match(
    css,
    /\.app\[data-skin\]\[data-workspace="home"\] > \.dc-global-friends-sidebar,[\s\S]*border-radius: 12px !important/,
  );
});

test("DM empty state and management dialogs remain clean and reachable in short windows", async () => {
  const css = await read("src/styles/app-rework.css");
  assert.match(css, /\.dc-dm-start-panel::before\s*\{\s*content:\s*none\s*!important;?\s*\}/);
});

test("Voice RTT follows the selected ICE path instead of the slowest successful check", async () => {
  const app = await readAppSource();
  assert.match(app, /report\.type === "transport" && typeof report\.selectedCandidatePairId === "string"/);
  assert.match(app, /reports\.get\(selectedCandidatePairId\)/);
  assert.match(app, /report\.nominated === true && report\.state === "succeeded"/);
  assert.doesNotMatch(
    app,
    /report\.nominated === true \|\| report\.selected === true \|\| report\.state === "succeeded"/,
  );
});
