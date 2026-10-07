import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const playwrightModulePath = process.env.PLAYWRIGHT_MODULE_PATH;
if (!playwrightModulePath) {
  throw new Error("Set PLAYWRIGHT_MODULE_PATH to a local Playwright ESM entry point.");
}
const { chromium } = await import(pathToFileURL(playwrightModulePath).href);

const root = path.resolve(import.meta.dirname, "..", "..");
const evidenceDir = path.join(root, "evidence", "home-navigation-acceptance-2026-09-12");
const appUrl = new URL(process.env.DECAVE_ACCEPTANCE_URL || "http://127.0.0.1:4175/");
const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
const userId = "fixture-user-home-navigation-001";
const friendId = "fixture-friend-home-navigation-002";
const fixtureHubName = "Navigation Acceptance Hub";
const fixtureTextChannelName = "general";
const fixtureSecondTextChannelName = "watch-party";
const fixtureVoiceChannelName = "Raid voice";

function assertLoopbackUrl(url) {
  if (!loopbackHosts.has(url.hostname) || !["http:", "https:"].includes(url.protocol)) {
    throw new Error("DECAVE_ACCEPTANCE_URL must be an HTTP(S) loopback URL; received " + url.href);
  }
}

assertLoopbackUrl(appUrl);

const fixtureUser = {
  id: userId,
  username: "Home Acceptance User",
  email: "home-navigation@example.test",
  emailVerified: true,
  status: "online",
  statusText: "Ready for a session",
  activityText: "Playing Acceptance Quest",
  accent: "#7c5cff",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const fixtureFriend = {
  id: friendId,
  username: "Navigation Teammate",
  email: "teammate@example.test",
  emailVerified: true,
  status: "online",
  online: true,
  statusText: "Ready to play",
  activityText: "Playing Acceptance Quest",
  accent: "#38c9ff",
};

const fixtureChannels = [
  { id: 101, name: fixtureTextChannelName, type: "text", category: "TEXT", position: 0, icon: "#" },
  { id: 102, name: fixtureSecondTextChannelName, type: "text", category: "TEXT", position: 1, icon: "▶" },
  { id: 103, name: fixtureVoiceChannelName, type: "voice", category: "VOICE", position: 2, icon: "◉" },
];

const fixtureServer = {
  id: 1,
  name: fixtureHubName,
  icon: "N",
  ownerId: userId,
  myRole: "owner",
  visibility: "private",
  memberCount: 2,
  onlineCount: 2,
  description: "A local fixture Hub for home, channel, DM, and voice acceptance.",
  category: "Gaming",
  tags: ["acceptance", "navigation"],
  accent: "#7c5cff",
  theme: "midnight",
  channels: fixtureChannels,
};

const now = Date.now();
const fixtureMessages = [
  {
    id: "fixture-home-navigation-message",
    userId: friendId,
    username: fixtureFriend.username,
    text: "Welcome to the navigation acceptance room.",
    timestamp: new Date(now - 30 * 60 * 1000).toISOString(),
    channelId: 101,
    role: "member",
    reactions: {},
  },
];
const fixtureDmMessages = [
  {
    id: "fixture-home-navigation-dm",
    fromUserId: friendId,
    toUserId: userId,
    text: "Private navigation fixture message",
    timestamp: new Date(now - 20 * 60 * 1000).toISOString(),
    reactions: {},
  },
];

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

function fixtureInitScript() {
  const updateState = {
    status: "downloaded",
    currentVersion: "0.1.20",
    availableVersion: "0.1.21",
    percent: 100,
    transferred: 12 * 1024 * 1024,
    total: 12 * 1024 * 1024,
    bytesPerSecond: null,
    checkedAt: "2026-09-12T00:00:00.000Z",
    error: null,
  };
  return (
    "(function() {\n" +
    "  localStorage.setItem('decave_last_workspace_v1', JSON.stringify({ serverId: 1, channelId: 101 }));\n" +
    "  var outbound = [];\n" +
    "  var updateState = " +
    JSON.stringify(updateState) +
    ";\n" +
    "  window.__DECAVE_ACCEPTANCE_FIXTURE__ = { kind: 'local synthetic API, WebSocket, media, and desktop bridge fixture', outbound: outbound, updateRestarted: false };\n" +
    "  class FixtureSocket {\n" +
    "    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;\n" +
    "    constructor() { this.readyState = FixtureSocket.CONNECTING; this.onopen = null; this.onmessage = null; this.onerror = null; this.onclose = null; setTimeout(() => { this.readyState = FixtureSocket.OPEN; if (this.onopen) this.onopen(new Event('open')); }, 0); }\n" +
    "    send(raw) {\n" +
    "      var payload = {}; try { payload = JSON.parse(raw); } catch (_) {}\n" +
    "      outbound.push(payload);\n" +
    "      if (payload.type === 'IDENTIFY') setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify({ type: 'IDENTIFIED', id: 'fixture-home-navigation-connection', serverId: 1, channelId: 101 }) }), 0);\n" +
    "      else if (payload.type === 'PING') setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify({ type: 'PONG' }) }), 0);\n" +
    "      else if (payload.type === 'CHAT_MESSAGE') setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify({ type: 'CHAT_MESSAGE', id: 'fixture-chat-posted-' + Date.now(), channelId: Number(payload.channelId || 101), userId: " +
    JSON.stringify(userId) +
    ", username: " +
    JSON.stringify(fixtureUser.username) +
    ", text: typeof payload.text === 'string' ? payload.text : '', timestamp: new Date().toISOString(), role: 'owner' }) }), 10);\n" +
    "      else if (payload.type === 'DM_MESSAGE') setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify({ type: 'DM_MESSAGE', message: { id: 'fixture-dm-posted-' + Date.now(), fromUserId: " +
    JSON.stringify(userId) +
    ", toUserId: typeof payload.targetUserId === 'string' ? payload.targetUserId : " +
    JSON.stringify(friendId) +
    ", text: typeof payload.text === 'string' ? payload.text : '', timestamp: new Date().toISOString(), reactions: {} } }) }), 10);\n" +
    "      else if (payload.type === 'VOICE_JOIN') {\n" +
    "        var participant = { connectionId: 'fixture-voice-self', userId: " +
    JSON.stringify(userId) +
    ", username: " +
    JSON.stringify(fixtureUser.username) +
    ", channelId: Number(payload.channelId || 103), role: 'owner', muted: false, selfMuted: false, selfDeafened: false, serverMuted: false, serverDeafened: false, screenSharing: false, cameraSharing: false };\n" +
    "        setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify({ type: 'VOICE_JOINED', channelId: participant.channelId, participant: participant, peers: [] }) }), 10);\n" +
    "        setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify({ type: 'VOICE_STATE', participants: [participant] }) }), 20);\n" +
    "      } else if (payload.type === 'VOICE_LEAVE') setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify({ type: 'VOICE_LEFT' }) }), 10);\n" +
    "    }\n" +
    "    close() { if (this.readyState === FixtureSocket.CLOSED) return; this.readyState = FixtureSocket.CLOSED; if (this.onclose) this.onclose(new CloseEvent('close')); }\n" +
    "  }\n" +
    "  window.WebSocket = FixtureSocket;\n" +
    "  window.turnstile = { render: function(_, options) { setTimeout(function() { if (options.callback) options.callback('fixture-turnstile-token'); }, 0); return 'fixture-widget'; }, remove: function() {} };\n" +
    "  window.decaveDesktop = {\n" +
    "    isDesktop: true,\n" +
    "    getUpdateStatus: async function() { return Object.assign({}, updateState); },\n" +
    "    checkForUpdates: async function() { return Object.assign({}, updateState); },\n" +
    "    restartToUpdate: async function() { window.__DECAVE_ACCEPTANCE_FIXTURE__.updateRestarted = true; return true; },\n" +
    "    onUpdateStatus: function(callback) { setTimeout(function() { callback(Object.assign({}, updateState)); }, 0); return function() {}; },\n" +
    "    getSystemSettings: async function() { return { openAtLogin: false, closeToTray: false, voiceOverlayEnabled: true }; },\n" +
    "    setSystemSettings: async function(settings) { return settings; },\n" +
    "    getKeybinds: async function() { return { toggleMute: 'Ctrl+Shift+M', toggleDeafen: 'Ctrl+Shift+D' }; },\n" +
    "    setKeybinds: async function(settings) { return settings; },\n" +
    "    setStreamerMode: async function() { return true; }, setVoiceOverlayState: async function() { return true; },\n" +
    "    verifyHuman: async function() { return 'fixture-human-token'; }, openExternal: async function() { return true; }\n" +
    "  };\n" +
    "  if (navigator.mediaDevices) {\n" +
    "    navigator.mediaDevices.enumerateDevices = async function() { return [{ deviceId: 'fixture-mic', groupId: 'fixture-group', kind: 'audioinput', label: 'Fixture microphone' }, { deviceId: 'fixture-output', groupId: 'fixture-group', kind: 'audiooutput', label: 'Fixture headphones' }]; };\n" +
    "    navigator.mediaDevices.getUserMedia = async function() { var AudioContextCtor = window.AudioContext || window.webkitAudioContext; if (!AudioContextCtor) return new MediaStream(); var audio = new AudioContextCtor(); var oscillator = audio.createOscillator(); var destination = audio.createMediaStreamDestination(); oscillator.frequency.value = 220; oscillator.connect(destination); oscillator.start(); return destination.stream; };\n" +
    "  }\n" +
    "})();"
  );
}

async function installRoutes(page, fixture) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const p = url.pathname;
    fixture.apiRequests.push({ method: request.method(), path: p });
    if (p === "/api/auth/config") return json(route, { turnstileSiteKey: "fixture-site-key" });
    if (p === "/api/auth/me")
      return json(route, { user: fixtureUser, safety: { ageStatus: "eligible", blockedUserIds: [] } });
    if (p === "/api/auth/ws-token") return json(route, { wsToken: "fixture-ws-token" });
    if (p === "/api/servers" && request.method() === "GET") return json(route, [fixtureServer]);
    if (p === "/api/servers/discover") return json(route, []);
    if (p.match(/^\/api\/servers\/\d+\/members$/))
      return json(route, [
        {
          userId: userId,
          username: fixtureUser.username,
          role: "owner",
          status: "online",
          online: true,
          isFriend: false,
        },
        {
          userId: friendId,
          username: fixtureFriend.username,
          role: "member",
          status: "online",
          online: true,
          isFriend: true,
        },
      ]);
    if (p.match(/^\/api\/channels\/\d+\/messages$/))
      return json(route, Number(p.split("/")[3]) === 101 ? fixtureMessages : []);
    if (p === "/api/dms" && request.method() === "GET")
      return json(route, {
        conversations: [
          {
            user: fixtureFriend,
            latestMessage: fixtureDmMessages[0].text,
            latestTimestamp: fixtureDmMessages[0].timestamp,
          },
        ],
      });
    if (p.match(/^\/api\/dms\/[^/]+$/) && request.method() === "GET")
      return json(route, { messages: fixtureDmMessages });
    if (p.match(/^\/api\/social\/dm-preferences\/[^/]+$/)) return json(route, {});
    if (p === "/api/social") return json(route, { friends: [fixtureFriend], incoming: [], outgoing: [] });
    if (p === "/api/account/preferences")
      return json(route, {
        friendRequestPolicy: "everyone",
        allowStreamPreviews: false,
        streamerMode: false,
        language: "en",
        timeFormat: "system",
      });
    if (p === "/api/profile/activity")
      return json(route, {
        automaticText: fixtureUser.activityText,
        source: "fixture",
        appId: "acceptance",
        startedAt: new Date(now - 45 * 60 * 1000).toISOString(),
      });
    if (p === "/api/integrations/steam/status") return json(route, { linked: false, apiConfigured: false });
    if (p === "/api/squad-finder/games") return json(route, { games: ["Acceptance Quest"] });
    if (p === "/api/squad-finder") return json(route, { current: null, matches: [] });
    if (p === "/api/rtc/ice-servers") return json(route, { iceServers: [{ urls: "stun:fixture.invalid" }] });
    if (p === "/api/soundboard") return json(route, { sounds: [] });
    if (p.match(/^\/api\/servers\/\d+\/(features|access|custom-roles)$/))
      return json(route, p.endsWith("custom-roles") ? [] : {});
    if (p === "/api/profile/settings") return json(route, {});
    return json(route, {});
  });
}

function bodyText(page) {
  return page
    .locator("body")
    .innerText()
    .catch(() => "");
}

async function visible(locator) {
  return (
    (await locator.count()) > 0 &&
    (await locator
      .first()
      .isVisible()
      .catch(() => false))
  );
}

async function centerHit(locator) {
  return locator
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return { hit: false, reason: "empty-bounds" };
      const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        hit: target === element || Boolean(target && element.contains(target)),
        target: target?.tagName || null,
      };
    })
    .catch((error) => ({ hit: false, reason: error instanceof Error ? error.message : String(error) }));
}

async function clickVisible(locator, timeout = 5_000) {
  if (!(await visible(locator))) return false;
  return locator
    .click({ timeout })
    .then(() => true)
    .catch(() => false);
}

async function clickTitle(page, title) {
  const locator = page.getByTitle(title, { exact: true }).first();
  return clickVisible(locator);
}

async function clickTextButton(page, name) {
  const locator = page.getByRole("button", { name: name, exact: true }).first();
  return clickVisible(locator);
}

async function expectWorkspace(page, workspace) {
  await page.locator('.app[data-workspace="' + workspace + '"]').waitFor({ state: "attached", timeout: 15_000 });
}

function channelButton(page, name) {
  return page.locator("aside.channel-sidebar button.channel").filter({ hasText: name }).first();
}

async function checkHubViewport(page, result, width, screenshot) {
  await page.setViewportSize({ width: width, height: 860 });
  await expectWorkspace(page, "hub");
  const sidebar = page.locator("aside.channel-sidebar");
  const restoreSidebar = page.getByRole("button", { name: "Show Hub sidebar" }).first();
  if (await visible(restoreSidebar)) await restoreSidebar.click();
  const compactPicker = page.locator('select[data-compact-channel-picker="true"]').first();
  const sidebarReachable =
    (await visible(sidebar)) &&
    (await sidebar.locator("button.channel").filter({ hasText: fixtureTextChannelName }).count()) > 0;
  const compactReachable = await visible(compactPicker);
  const channelNames = await sidebar
    .locator("button.channel")
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => {
          const element = node;
          return !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
        })
        .map((node) => (node.textContent || "").replace(/\s+/g, " ").trim()),
    )
    .catch(() => []);
  const compactOptions = compactReachable
    ? await compactPicker
        .locator("option")
        .evaluateAll((nodes) =>
          nodes.map((node) => ({ label: (node.textContent || "").replace(/\s+/g, " ").trim(), value: node.value })),
        )
        .catch(() => [])
    : [];
  const selectedText = (
    await sidebar
      .locator("button.channel.selected")
      .first()
      .innerText()
      .catch(() => "")
  )
    .replace(/\s+/g, " ")
    .trim();
  const selectedCompactValue = compactReachable ? await compactPicker.inputValue().catch(() => "") : "";
  result.checks.push({
    name: width + "px Hub exposes reachable channels and selected location",
    pass:
      (sidebarReachable &&
        channelNames.some((text) => text.includes(fixtureTextChannelName)) &&
        channelNames.some((text) => text.includes(fixtureSecondTextChannelName)) &&
        channelNames.some((text) => text.includes(fixtureVoiceChannelName)) &&
        selectedText.includes(fixtureTextChannelName)) ||
      (compactReachable &&
        compactOptions.some((option) => option.label.includes(fixtureTextChannelName)) &&
        compactOptions.some((option) => option.label.includes(fixtureSecondTextChannelName)) &&
        compactOptions.some((option) => option.label.includes(fixtureVoiceChannelName)) &&
        selectedCompactValue === "101"),
    detail: JSON.stringify({
      control: sidebarReachable ? "sidebar" : compactReachable ? "compact-select" : "none",
      channelNames: channelNames,
      compactOptions: compactOptions,
      selectedText: selectedText,
      selectedCompactValue: selectedCompactValue,
    }),
  });
  const shellGeometry = await page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      return {
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        bottom: bounds.bottom,
        width: bounds.width,
        height: bounds.height,
      };
    };
    const rail = rect(".server-bar");
    const topbar = rect(".vadrion-topbar");
    const main = rect("main.dc-primary-workspace");
    return {
      rail: rail,
      topbar: topbar,
      main: main,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });
  result.checks.push({
    name: width + "px responsive shell keeps rail, topbar, and workspace in bounds",
    pass: Boolean(
      shellGeometry.rail &&
      shellGeometry.topbar &&
      shellGeometry.main &&
      shellGeometry.documentWidth <= shellGeometry.viewportWidth &&
      shellGeometry.rail.left >= -1 &&
      shellGeometry.topbar.left >= -1 &&
      shellGeometry.topbar.right <= shellGeometry.viewportWidth + 1 &&
      shellGeometry.main.left >= shellGeometry.rail.right - 1 &&
      shellGeometry.main.right <= shellGeometry.viewportWidth + 1,
    ),
    detail: JSON.stringify(shellGeometry),
  });
  const secondChannel = channelButton(page, fixtureSecondTextChannelName);
  const secondReachable = sidebarReachable
    ? await visible(secondChannel)
    : compactReachable && compactOptions.some((option) => option.value === "102");
  if (sidebarReachable && secondReachable) await secondChannel.click();
  if (!sidebarReachable && compactReachable && secondReachable) await compactPicker.selectOption("102");
  await page.waitForTimeout(120);
  const composer = page.locator(".composer-shell textarea").first();
  const composerBox = await composer.boundingBox().catch(() => null);
  result.measurements["composer-" + width + "-" + (await page.locator(".app").getAttribute("data-text-scale"))] =
    await composer.evaluate((el) => {
      const rows = [];
      for (let p = el; p; p = p.parentElement) {
        const r = p.getBoundingClientRect(),
          s = getComputedStyle(p);
        rows.push({
          name: p.className,
          top: r.top,
          height: r.height,
          display: s.display,
          minHeight: s.minHeight,
          flex: s.flex,
          grid: s.gridTemplateRows,
        });
      }
      return rows;
    });
  const sendButton = page.locator(".composer-shell .dc-hub-composer .dc-dm-send").first();
  const composerCenterHit = (await visible(composer))
    ? await centerHit(composer)
    : { hit: false, reason: "composer-not-visible" };
  const sendCenterHit = (await visible(sendButton))
    ? await centerHit(sendButton)
    : { hit: false, reason: "send-not-visible" };
  result.checks.push({
    name: width + "px text channel opens with reachable composer",
    pass:
      secondReachable &&
      (await visible(composer)) &&
      !(await composer.isDisabled().catch(() => true)) &&
      !!composerBox &&
      composerBox.width > 0 &&
      composerCenterHit.hit &&
      sendCenterHit.hit &&
      ((sidebarReachable &&
        (await visible(page.locator("button.channel.selected").filter({ hasText: fixtureSecondTextChannelName })))) ||
        (!sidebarReachable && compactReachable && (await compactPicker.inputValue().catch(() => "")) === "102")) &&
      (await page.locator('[data-channel-id="102"][aria-current="page"]').count()) >= 1,
    detail: JSON.stringify({
      placeholder: await composer.getAttribute("placeholder").catch(() => null),
      composerWidth: composerBox ? composerBox.width : 0,
      composerCenterHit: composerCenterHit,
      sendCenterHit: sendCenterHit,
      selectedCompactValue: compactReachable ? await compactPicker.inputValue().catch(() => "") : "",
    }),
  });
  const generalChannel = channelButton(page, fixtureTextChannelName);
  if (sidebarReachable && (await visible(generalChannel))) await generalChannel.click();
  if (!sidebarReachable && compactReachable) await compactPicker.selectOption("101");
  await page.waitForTimeout(120);
  await screenshot("hub-" + width + ".png");
}

async function main() {
  await fs.mkdir(evidenceDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.DECAVE_ACCEPTANCE_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe",
    args: ["--disable-gpu", "--no-sandbox"],
  });
  const fixture = { apiRequests: [], unexpectedRequests: [], requestFailures: [] };
  const context = await browser.newContext({
    viewport: { width: 1366, height: 860 },
    colorScheme: "dark",
    permissions: ["microphone"],
  });
  await context.addInitScript({ content: fixtureInitScript() });
  await context.route("**/*", async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    if (["http:", "https:"].includes(requestUrl.protocol) && requestUrl.origin !== appUrl.origin) {
      fixture.unexpectedRequests.push({
        method: request.method(),
        url: request.url(),
        resourceType: request.resourceType(),
      });
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  await installRoutes(page, fixture);
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
  page.on("requestfailed", (request) =>
    fixture.requestFailures.push({
      url: request.url(),
      error: request.failure() ? request.failure().errorText : "unknown",
    }),
  );

  const result = {
    appUrl: appUrl.href,
    fixture:
      "loopback-only Playwright route fixture; API, WebSocket, media, and desktop update bridge are synthetic and never send real calls/messages",
    checks: [],
    screens: [],
    measurements: {},
    consoleErrors: consoleErrors,
    pageErrors: pageErrors,
    unexpectedRequests: fixture.unexpectedRequests,
    requestFailures: fixture.requestFailures,
    apiRequests: fixture.apiRequests,
  };
  const check = (name, pass, detail = "") => result.checks.push({ name: name, pass: Boolean(pass), detail: detail });
  const screenshot = async (name) => {
    const target = path.join(evidenceDir, name);
    await page.screenshot({ path: target, fullPage: true });
    result.screens.push(target);
    return target;
  };

  try {
    await page.goto(appUrl.href, { waitUntil: "commit", timeout: 60_000 });
    await page.locator(".app[data-workspace]").waitFor({ state: "attached", timeout: 60_000 });
    await page.getByText(fixtureHubName, { exact: true }).first().waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(800);
    await expectWorkspace(page, "hub");
    check(
      "loopback app loaded in Hub workspace",
      (await page.locator('.app[data-workspace="hub"]').count()) === 1 &&
        (await bodyText(page)).includes(fixtureHubName),
    );
    const railButtons = await page.locator("aside.server-bar .dc-rail-page-button").evaluateAll((nodes) =>
      nodes.map((node) => ({
        nav: node.getAttribute("data-primary-nav"),
        label: (node.textContent || "").replace(/\s+/g, " ").trim(),
      })),
    );
    const railNavIds = railButtons.map((button) => button.nav).filter(Boolean);
    check(
      "left rail has no Hubs or More tab and keeps direct destinations",
      !railNavIds.includes("hubs") &&
        !railNavIds.includes("more") &&
        ["home", "dms", "friends", "squad-finder", "discover", "settings"].every((id) => railNavIds.includes(id)),
      JSON.stringify(railButtons),
    );
    check(
      "selected Hub is exposed by accessible state",
      (await page
        .getByRole("button", { name: "Open " + fixtureHubName })
        .first()
        .getAttribute("aria-pressed")) === "true" &&
        (await page.locator('[data-primary-nav="hubs"], [data-primary-nav="more"]').count()) === 0,
    );
    check(
      "initial location markers identify the selected Hub and channel",
      (await page
        .locator(
          'main.dc-primary-workspace[data-primary-workspace="hubs"][data-current-hub-id="1"][data-current-channel-id="101"]',
        )
        .count()) === 1 &&
        (await page.locator('.dc-hub-context-header[data-hub-id="1"][data-channel-id="101"]').count()) === 1 &&
        (await page.locator('[data-channel-id="101"][aria-current="page"]').count()) >= 1,
    );
    check(
      "initial channel is selected and fixture content is visible",
      (
        await page
          .locator("button.channel.selected")
          .first()
          .innerText()
          .catch(() => "")
      ).includes(fixtureTextChannelName) &&
        (await bodyText(page)).includes("Welcome to the navigation acceptance room."),
    );
    await screenshot("hub-1366-initial.png");

    const homeClicked = await clickTitle(page, "Home");
    await expectWorkspace(page, "home");
    check(
      "Home opens the personal dashboard",
      homeClicked &&
        (await page.locator('.app[data-workspace="home"] .dc-home-page').count()) === 1 &&
        (await bodyText(page)).includes("Welcome back"),
    );
    await screenshot("home.png");

    const hubClickedFromHome = await clickTextButton(page, "Open " + fixtureHubName);
    await expectWorkspace(page, "hub");
    check(
      "Home returns to the selected Hub",
      hubClickedFromHome &&
        (await page.locator('.app[data-workspace="hub"] .channel-header').count()) === 1 &&
        (await page
          .getByRole("button", { name: "Open " + fixtureHubName })
          .first()
          .getAttribute("aria-pressed")) === "true",
    );
    for (const width of [1366, 1200, 1101, 1024, 800]) await checkHubViewport(page, result, width, screenshot);

    const dmClicked = await clickTitle(page, "Direct Messages");
    await expectWorkspace(page, "dm");
    check(
      "DM destination opens from the primary navigation",
      dmClicked &&
        (await page.locator('.app[data-workspace="dm"] [aria-label="Direct messages"]').count()) === 1 &&
        (await page.locator('[data-primary-nav="dms"][aria-current="page"]').count()) === 1 &&
        (await page.locator('main.dc-primary-workspace[data-primary-workspace="dms"]').count()) === 1,
    );
    const dmRow = page.locator(".dc-dm-row").filter({ hasText: fixtureFriend.username }).first();
    const dmRowReachable = await visible(dmRow);
    if (dmRowReachable) await dmRow.click();
    const dmComposer = page.locator(".dc-dm-chat-pane .dc-dm-reference-composer textarea").first();
    await dmComposer.waitFor({ state: "visible", timeout: 15_000 });
    check(
      "fixture DM opens with a reachable composer",
      dmRowReachable &&
        (await visible(dmComposer)) &&
        (await bodyText(page)).includes("Private navigation fixture message"),
    );
    await dmComposer.fill("Synthetic DM acceptance message");
    const dmSend = page.locator('.dc-dm-chat-pane .dc-dm-send[aria-label="Send"]').first();
    const dmSendReachable = await visible(dmSend);
    const dmComposerCenterHit = await centerHit(dmComposer);
    const dmSendCenterHit = dmSendReachable ? await centerHit(dmSend) : { hit: false, reason: "send-not-visible" };
    if (dmSendReachable) await dmSend.click();
    await page
      .getByText("Synthetic DM acceptance message", { exact: true })
      .waitFor({ state: "visible", timeout: 10_000 });
    check(
      "DM composer sends only through the fixture WebSocket",
      dmSendReachable && (await bodyText(page)).includes("Synthetic DM acceptance message"),
    );
    check(
      "DM composer and Send center points are hit-test reachable",
      dmComposerCenterHit.hit && dmSendCenterHit.hit,
      JSON.stringify({ composer: dmComposerCenterHit, send: dmSendCenterHit }),
    );
    await screenshot("dm.png");

    const homeAfterDm = await clickTitle(page, "Home");
    await expectWorkspace(page, "home");
    check(
      "DM returns to Home without losing the session",
      homeAfterDm && (await bodyText(page)).includes(fixtureUser.username),
    );

    const hubForVoice = await clickTextButton(page, "Open " + fixtureHubName);
    await expectWorkspace(page, "hub");
    const voiceChannel = channelButton(page, fixtureVoiceChannelName);
    const compactVoicePicker = page.locator('select[data-compact-channel-picker="true"]').first();
    const sidebarVoiceReachable = await visible(voiceChannel);
    const compactVoiceReachable =
      (await visible(compactVoicePicker)) && (await compactVoicePicker.locator('option[value="103"]').count()) > 0;
    const voiceChannelReachable = sidebarVoiceReachable || compactVoiceReachable;
    if (sidebarVoiceReachable) await voiceChannel.click();
    if (!sidebarVoiceReachable && compactVoiceReachable) await compactVoicePicker.selectOption("103");
    const voicePanel = page.locator('.voice-panel[data-voice-surface="room-controls"]');
    const voicePanelVisible = await voicePanel
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    const joinVoice = voicePanel.getByRole("button", { name: "Join Voice", exact: true }).first();
    const joinReachable = await visible(joinVoice);
    if (joinReachable) await joinVoice.click();
    const voiceConnected =
      joinReachable &&
      (await voicePanel
        .locator(".voice-status")
        .filter({ hasText: "Voice Connected" })
        .waitFor({ state: "visible", timeout: 10_000 })
        .then(() => true)
        .catch(() => false));
    check(
      "voice channel opens with local controls",
      hubForVoice && voiceChannelReachable && voicePanelVisible && joinReachable,
    );
    const muteButton = voicePanel.locator('button[aria-label="Mute"]').first();
    const deafenButton = voicePanel.locator('button[aria-label="Deafen"]').first();
    check(
      "mock voice join reaches persistent controls",
      voiceConnected && (await visible(muteButton)) && (await visible(deafenButton)),
    );
    if (await visible(muteButton)) await muteButton.click();
    if (await visible(deafenButton)) await deafenButton.click();
    check(
      "voice mute and deafen state toggles locally",
      voiceConnected &&
        (await visible(voicePanel.locator('button[aria-label="Unmute"]'))) &&
        (await visible(voicePanel.locator('button[aria-label="Undeafen"]'))),
    );
    const homeWhileVoice = await clickTitle(page, "Home");
    await expectWorkspace(page, "home");
    const miniVoice = page.locator(
      'aside[data-voice-surface="persistent"][aria-label^="Active voice channel"] .dc-studio-voice-strip',
    );
    const homeVoicePersistent =
      voiceConnected &&
      homeWhileVoice &&
      (await visible(miniVoice)) &&
      (await miniVoice.innerText()).includes(fixtureVoiceChannelName) &&
      (await visible(miniVoice.getByRole("button", { name: "Unmute" }))) &&
      (await visible(miniVoice.getByRole("button", { name: "Undeafen" })));
    check(
      "voice controls persist while browsing Home",
      homeVoicePersistent,
      JSON.stringify({ connected: voiceConnected, homeClicked: homeWhileVoice, miniVisible: await visible(miniVoice) }),
    );
    const dmWhileVoice = await clickTitle(page, "Direct Messages");
    await expectWorkspace(page, "dm");
    check(
      "voice controls persist while browsing DM",
      dmWhileVoice &&
        voiceConnected &&
        (await visible(page.locator('aside[data-voice-surface="persistent"][aria-label^="Active voice channel"]'))),
    );
    const hubWhileVoice = await clickTextButton(page, "Open " + fixtureHubName);
    await expectWorkspace(page, "hub");
    check(
      "voice controls persist after returning to Hub",
      hubWhileVoice &&
        voiceConnected &&
        (await visible(page.locator('aside[data-voice-surface="persistent"][aria-label^="Active voice channel"]'))),
    );
    const homeAfterVoice = await clickTitle(page, "Home");
    await expectWorkspace(page, "home");
    check(
      "voice persistence completes Home to DM to Hub journey",
      homeAfterVoice &&
        voiceConnected &&
        (await visible(page.locator('aside[data-voice-surface="persistent"][aria-label^="Active voice channel"]'))),
    );
    await screenshot("home-voice-mini-player.png");

    await page.setViewportSize({ width: 1366, height: 860 });
    const settingsClicked = await clickTitle(page, "Settings");
    await page.locator('[aria-label="Settings sections"]').waitFor({ state: "visible", timeout: 15_000 });
    check(
      "Settings opens from Home",
      settingsClicked && (await page.locator('.app[data-workspace="settings"]').count()) === 1,
    );
    const appearance = page.locator(".dc-studio-settings-index button").filter({ hasText: "Appearance" }).first();
    const appearanceReachable = await visible(appearance);
    if (appearanceReachable) await appearance.click();
    const textScale = page.getByRole("slider", { name: "DeCave text and interface size" }).first();
    const larger = page.getByRole("button", { name: "Larger", exact: true }).first();
    const largerReachable = await visible(larger);
    const largerClicked = largerReachable && (await clickVisible(larger));
    check(
      "text scaling control changes the rendered app scale",
      appearanceReachable &&
        largerClicked &&
        (await visible(textScale)) &&
        (await page.locator('.app[data-text-scale="120"]').count()) === 1 &&
        (await page.getByText("120%", { exact: true }).count()) > 0,
      JSON.stringify({
        appearanceReachable: appearanceReachable,
        largerReachable: largerReachable,
        largerClicked: largerClicked,
        textScaleVisible: await visible(textScale),
        appScale: await page
          .locator(".app")
          .getAttribute("data-text-scale")
          .catch(() => null),
      }),
    );
    const system = page.locator(".dc-studio-settings-index button").filter({ hasText: "System" }).first();
    const systemClicked = await clickVisible(system);
    const restartBefore = await page.evaluate(() => window.__DECAVE_ACCEPTANCE_FIXTURE__?.updateRestarted === false);
    const restartButton = page
      .locator('.dc-desktop-update-card[data-update-surface="settings"] button')
      .filter({ hasText: "Restart to update" })
      .first();
    const restartReachable = await visible(restartButton);
    const restartClicked = restartReachable && (await clickVisible(restartButton));
    await page.waitForTimeout(100);
    check(
      "desktop updater mock exposes ready state and records explicit restart",
      systemClicked &&
        (await visible(page.locator('.dc-desktop-update-card[data-update-surface="settings"]'))) &&
        (await visible(page.locator('[data-installed-version="0.1.20"]'))) &&
        (await bodyText(page)).includes("Desktop app updates") &&
        (await bodyText(page)).includes("Update 0.1.21 downloaded and ready") &&
        restartBefore &&
        restartClicked &&
        (await page.evaluate(() => window.__DECAVE_ACCEPTANCE_FIXTURE__?.updateRestarted === true)),
      JSON.stringify({
        systemClicked: systemClicked,
        restartBefore: restartBefore,
        restartReachable: restartReachable,
        restartClicked: restartClicked,
      }),
    );
    await screenshot("settings-1366-final.png");

    await page.setViewportSize({ width: 800, height: 860 });
    const narrowAppearanceClicked = await clickVisible(appearance);
    await textScale.scrollIntoViewIfNeeded();
    check(
      "800px at larger text scale keeps Settings usable",
      narrowAppearanceClicked &&
        (await visible(textScale)) &&
        (await centerHit(textScale)).hit &&
        (await clickVisible(larger)) &&
        (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)),
    );
    await screenshot("settings-800-final.png");
    const hubAfterSettings = await clickTextButton(page, "Open " + fixtureHubName);
    await expectWorkspace(page, "hub");
    const finalCompactPicker = page.locator('select[data-compact-channel-picker="true"]').first();
    const finalSidebarVoice = channelButton(page, fixtureVoiceChannelName);
    const finalCompactVoice =
      (await visible(finalCompactPicker)) && (await finalCompactPicker.locator('option[value="103"]').count()) > 0;
    const scaledPickerReachable = await visible(finalCompactPicker);
    let scaledPickerSwitched = false;
    if (scaledPickerReachable) {
      await finalCompactPicker.selectOption("102");
      await page.waitForTimeout(120);
      scaledPickerSwitched =
        (await finalCompactPicker.inputValue().catch(() => "")) === "102" &&
        (await page.locator('main.dc-primary-workspace[data-current-channel-id="102"]').count()) >= 1;
      await finalCompactPicker.selectOption("101");
    }
    check(
      "larger text scale still returns to a Hub with selected channels",
      hubAfterSettings && (await visible(finalCompactPicker)) && (await finalCompactPicker.inputValue()) === "101",
    );
    check(
      "800px larger text scale switches channels through the compact picker",
      scaledPickerReachable && scaledPickerSwitched,
      JSON.stringify({
        pickerVisible: scaledPickerReachable,
        switched: scaledPickerSwitched,
        finalValue: await finalCompactPicker.inputValue().catch(() => ""),
      }),
    );
    await screenshot("hub-800-text-scale-final.png");
    const scaledGeometry = await page.evaluate(() => {
      const main = document.querySelector("main.dc-primary-workspace").getBoundingClientRect();
      const topbar = document.querySelector(".vadrion-topbar").getBoundingClientRect();
      return {
        mainRight: main.right,
        mainWidth: main.width,
        topLeft: topbar.left,
        topRight: topbar.right,
        width: innerWidth,
      };
    });
    check(
      "scaled narrow workspace uses the available width",
      Math.abs(scaledGeometry.mainRight - scaledGeometry.width) <= 2 &&
        scaledGeometry.mainWidth > scaledGeometry.width * 0.7 &&
        Math.abs(scaledGeometry.topLeft) <= 2 &&
        Math.abs(scaledGeometry.topRight - scaledGeometry.width) <= 2,
      JSON.stringify(scaledGeometry),
    );
    const persistentUnmute = page
      .locator('aside[data-voice-surface="persistent"]')
      .getByRole("button", { name: "Unmute", exact: true });
    check(
      "update banner does not cover persistent voice controls",
      (await visible(persistentUnmute)) && (await centerHit(persistentUnmute)).hit,
    );
    await checkHubViewport(page, result, 800, screenshot);
    check(
      "800px at larger text scale keeps voice channel reachable",
      (await visible(finalSidebarVoice)) || finalCompactVoice,
      JSON.stringify({ sidebar: await visible(finalSidebarVoice), compact: finalCompactVoice }),
    );

    await clickTitle(page, "Home");
    await expectWorkspace(page, "home");
    await screenshot("final-home.png");
    result.measurements.finalViewport = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      textScale: document.querySelector(".app") && document.querySelector(".app").getAttribute("data-text-scale"),
    }));
    check(
      "loopback request policy blocked all unexpected external requests",
      fixture.unexpectedRequests.length === 0,
      JSON.stringify(fixture.unexpectedRequests),
    );
    check("page reports no runtime errors", pageErrors.length === 0, pageErrors.join(" | "));
    check("console reports no errors", consoleErrors.length === 0, consoleErrors.join(" | "));
    check(
      "fixture WebSocket handled synthetic navigation traffic",
      await page.evaluate(
        () =>
          Array.isArray(window.__DECAVE_ACCEPTANCE_FIXTURE__ && window.__DECAVE_ACCEPTANCE_FIXTURE__.outbound) &&
          window.__DECAVE_ACCEPTANCE_FIXTURE__.outbound.some((item) => item.type === "DM_MESSAGE") &&
          window.__DECAVE_ACCEPTANCE_FIXTURE__.outbound.some((item) => item.type === "VOICE_JOIN"),
      ),
    );
  } catch (error) {
    result.failure = error instanceof Error ? error.stack || error.message : String(error);
    await page.screenshot({ path: path.join(evidenceDir, "failure.png"), fullPage: true }).catch(() => undefined);
  } finally {
    if (!result.measurements.finalViewport)
      result.measurements.finalViewport = await page
        .evaluate(() => ({
          width: window.innerWidth,
          height: window.innerHeight,
          documentWidth: document.documentElement.scrollWidth,
          textScale: document.querySelector(".app")?.getAttribute("data-text-scale") || null,
        }))
        .catch(() => null);
    result.unexpectedRequests = fixture.unexpectedRequests;
    result.requestFailures = fixture.requestFailures;
    result.apiRequests = fixture.apiRequests;
    await fs.writeFile(path.join(evidenceDir, "result.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
    await browser.close();
  }

  console.log(JSON.stringify(result, null, 2));
  if (result.failure || result.checks.some((item) => !item.pass)) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
