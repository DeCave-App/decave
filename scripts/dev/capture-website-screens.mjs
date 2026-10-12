// Captures the website's product screenshots from the real web app with a local
// synthetic API, WebSocket and desktop-bridge fixture. No network or account is used.
//
//   npm run build:web
//   node scripts/acceptance/static-server.mjs &
//   node scripts/dev/capture-website-screens.mjs
//
// Set PLAYWRIGHT_MODULE to a playwright entry if it is not resolvable from here.

import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { avatarSvg, hubBannerSvg, hubIconSvg } from "./demo-art.mjs";

const require = createRequire(import.meta.url);
const playwrightEntry =
  process.env.PLAYWRIGHT_MODULE ||
  (() => {
    try {
      return require.resolve("playwright");
    } catch {
      return "/opt/node-tools/node_modules/playwright/index.js";
    }
  })();
const playwright = await import(pathToFileURL(playwrightEntry).href);
const chromium = playwright.chromium ?? playwright.default.chromium;
const { default: sharp } = await import(
  pathToFileURL(createRequire(path.join(import.meta.dirname, "..", "..", "website", "package.json")).resolve("sharp"))
    .href
);

const root = path.resolve(import.meta.dirname, "..", "..");
const outDir = path.resolve(process.env.DECAVE_SCREENS_DIR || path.join(root, "website", "public", "screens"));
const appUrl = new URL(process.env.DECAVE_ACCEPTANCE_URL || "http://127.0.0.1:4175/");
if (!["127.0.0.1", "localhost", "[::1]"].includes(appUrl.hostname)) {
  throw new Error("DECAVE_ACCEPTANCE_URL must be a loopback URL.");
}

const now = Date.now();
const minutesAgo = (m) => new Date(now - m * 60_000).toISOString();

const me = {
  id: "demo-user-ash",
  username: "Ash",
  email: "ash@example.test",
  emailVerified: true,
  status: "online",
  statusText: "Queueing ranked tonight",
  activityText: "Playing Starfall Tactics",
  accent: "#7c5cff",
  avatarUrl: "/demo-media/avatar/demo-user-ash.svg",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const people = [
  ["demo-mira", "Mira", "online", "Playing Starfall Tactics", "#38c9ff"],
  ["demo-kestrel", "Kestrel", "online", "Playing Ember Rift", "#b6f36a"],
  ["demo-juno", "Juno", "idle", "Watching a stream", "#ff8a4c"],
  ["demo-talon", "Talon", "online", "Playing Starfall Tactics", "#f45bd0"],
  ["demo-vex", "Vex", "dnd", "In a ranked match", "#ffd84c"],
  ["demo-rook", "Rook", "offline", "", "#8f9bb3"],
].map(([id, username, status, activityText, accent]) => ({
  id,
  username,
  email: `${username.toLowerCase()}@example.test`,
  emailVerified: true,
  status,
  online: status !== "offline",
  statusText: "",
  activityText,
  accent,
  avatarUrl: `/demo-media/avatar/${id}.svg`,
}));
const [mira, kestrel, juno, talon, vex] = people;

const hubs = [
  {
    id: 1,
    name: "Night Raid Collective",
    icon: "N",
    accent: "#7c5cff",
    art: ["moon", "#7c5cff", "#2b1b6b"],
    description: "Weekly raids, ranked squads and patch-night watch parties.",
    category: "Gaming",
    tags: ["raids", "ranked", "eu"],
    channels: [
      { id: 101, name: "announcements", type: "text", category: "INFO", position: 0, icon: "#" },
      { id: 102, name: "general", type: "text", category: "TEXT", position: 1, icon: "#" },
      { id: 103, name: "raid-planning", type: "text", category: "TEXT", position: 2, icon: "#" },
      { id: 104, name: "clips", type: "text", category: "TEXT", position: 3, icon: "#" },
      { id: 105, name: "Raid voice", type: "voice", category: "VOICE", position: 4, icon: "◉" },
      { id: 106, name: "Chill lounge", type: "voice", category: "VOICE", position: 5, icon: "◉" },
    ],
  },
  {
    id: 2,
    name: "Indie Dev Lounge",
    icon: "I",
    accent: "#38c9ff",
    art: ["code", "#38c9ff", "#174a7a"],
    description: "Builders sharing devlogs, playtests and feedback.",
    category: "Creative",
    tags: ["gamedev"],
    channels: [
      { id: 201, name: "devlogs", type: "text", category: "TEXT", position: 0, icon: "#" },
      { id: 202, name: "Playtest voice", type: "voice", category: "VOICE", position: 1, icon: "◉" },
    ],
  },
  {
    id: 3,
    name: "Speedrun Lab",
    icon: "S",
    accent: "#b6f36a",
    art: ["bolt", "#7bd94a", "#1f5c3a"],
    description: "Routes, splits and practice races.",
    category: "Gaming",
    tags: ["speedrun"],
    channels: [
      { id: 301, name: "routes", type: "text", category: "TEXT", position: 0, icon: "#" },
      { id: 302, name: "Race voice", type: "voice", category: "VOICE", position: 1, icon: "◉" },
    ],
  },
].map(({ art, ...hub }) => ({
  ...hub,
  iconUrl: `/demo-media/hub-icon/${hub.id}.svg`,
  bannerUrl: `/demo-media/hub-banner/${hub.id}.svg`,
  art,
  ownerId: me.id,
  myRole: hub.id === 1 ? "owner" : "member",
  visibility: "private",
  memberCount: hub.id === 1 ? 128 : 46,
  onlineCount: hub.id === 1 ? 37 : 9,
  theme: "midnight",
}));

// The official DeCave Hub every account joins: streamer layout, private
// membership and staff-only posting, as in production.
const OFFICIAL_HUB_ID = 9;
const officialHub = {
  id: OFFICIAL_HUB_ID,
  name: "DeCave",
  icon: "D",
  accent: "#7c5cff",
  description: "Official news, guides and help from the DeCave team.",
  category: "Official",
  tags: ["official"],
  iconUrl: `/demo-media/hub-icon/${OFFICIAL_HUB_ID}.svg`,
  bannerUrl: `/demo-media/hub-banner/${OFFICIAL_HUB_ID}.svg`,
  art: ["cave", "#7c5cff", "#0e6a8f"],
  ownerId: "demo-decave-team",
  myRole: "member",
  visibility: "private",
  layout: "streamer",
  membershipPrivate: true,
  ownerOnlyPosting: true,
  memberCount: null,
  onlineCount: null,
  theme: "midnight",
  channels: [
    { id: 901, name: "welcome", type: "text", category: "START HERE", position: 0, icon: "👋" },
    { id: 902, name: "rules", type: "text", category: "START HERE", position: 1, icon: "📜", kind: "forum" },
    { id: 903, name: "faq", type: "text", category: "START HERE", position: 2, icon: "❓", kind: "forum" },
    { id: 904, name: "announcements", type: "text", category: "NEWS", position: 10, icon: "📣" },
    { id: 905, name: "patch-notes", type: "text", category: "NEWS", position: 11, icon: "#" },
    { id: 906, name: "roadmap", type: "text", category: "NEWS", position: 12, icon: "🗺️" },
  ],
};
hubs.unshift(officialHub);

const officialSnapshot = () => ({
  enabled: true,
  role: "member",
  config: {
    creatorName: "DeCave",
    tagline: "Welcome to DeCave — good games, better people.",
    streamUrl: "",
    streamTitle: "Your home base for news, guides and help",
    game: "",
    language: "English",
    liveUntil: null,
    queueRules: "",
    onboarding:
      "Welcome to DeCave! DeCave is in alpha and for adults 18+. Here is how to get started:\n\n1. Set up your profile.\n2. Add friends.\n3. Join or create Hubs.\n4. Read #announcements, #patch-notes and #roadmap.\n5. Install the desktop app.",
    version: 3,
  },
  session: null,
  queue: { waiting: 0, called: 0, ready: 0, playing: 0, mine: null },
  highlights: [],
  giveaways: [],
  features: { giveaways: false },
  serverTime: new Date(now).toISOString(),
});

const chat = (id, user, text, m, channelId = 102, role = "member") => ({
  id: `demo-msg-${id}`,
  userId: user.id,
  username: user.username,
  avatarUrl: user.avatarUrl,
  text,
  timestamp: minutesAgo(m),
  channelId,
  role,
  reactions: {},
});

const channelMessages = {
  102: [
    chat(1, mira, "Patch notes are out — the new raid opens Friday at 20:00 CET.", 58),
    chat(2, kestrel, "Finally. I've been saving consumables for two weeks 😅", 55),
    chat(3, talon, "Who's running tank? I can swap to support if we need it.", 49),
    chat(4, me, "I'll tank. Let's do a warm-up run Thursday so everyone knows the route.", 46, 102, "owner"),
    chat(5, vex, "Thursday works. I'll pin the route doc in #raid-planning.", 41),
    chat(6, juno, "Can someone share their screen during the first pull? I learn faster watching.", 30),
    chat(7, mira, "I'll stream it in Raid voice — 1440p60 should be fine.", 27),
    chat(8, kestrel, "Squad Finder already matched us a fifth for the Friday group 🎉", 12),
    chat(9, me, "Perfect. See everyone in voice at 19:45.", 6, 102, "owner"),
  ],
  101: [
    chat(20, me, "Raid night is every Friday at 20:00 CET. Ranked squads queue from Squad Finder.", 600, 101, "owner"),
  ],
  103: [chat(30, vex, "Route doc: boss 1 → left wing → skip the gate event → boss 2.", 90, 103)],
};

const dmThreads = {
  [mira.id]: [
    { from: mira, text: "Are you on tonight?", m: 44 },
    { from: me, text: "Yeah, after dinner. Ranked or chill?", m: 42 },
    { from: mira, text: "Ranked. Talon and Vex are in too.", m: 40 },
    { from: me, text: "Nice, I'll open Raid voice at 19:45.", m: 38 },
    { from: mira, text: "I'll bring snacks and bad callouts 😄", m: 35 },
  ],
  [kestrel.id]: [{ from: kestrel, text: "Sent you the clip from last night's wipe 😂", m: 120 }],
  [talon.id]: [{ from: talon, text: "GG, that last round was close.", m: 300 }],
};

const dmMessages = (friendId) =>
  (dmThreads[friendId] || []).map((entry, index) => ({
    id: `demo-dm-${friendId}-${index}`,
    fromUserId: entry.from.id,
    toUserId: entry.from.id === me.id ? friendId : me.id,
    text: entry.text,
    timestamp: minutesAgo(entry.m),
    reactions: {},
  }));

const members = [me, ...people].map((person, index) => ({
  userId: person.id,
  username: person.username,
  avatarUrl: person.avatarUrl,
  role: index === 0 ? "owner" : index === 1 ? "admin" : "member",
  status: person.status,
  online: person.status !== "offline",
  activityText: person.activityText,
  isFriend: index !== 0,
}));

const voiceParticipants = [me, mira, talon, kestrel].map((person, index) => ({
  connectionId: `demo-voice-${person.id}`,
  userId: person.id,
  username: person.username,
  avatarUrl: person.avatarUrl,
  channelId: 105,
  role: index === 0 ? "owner" : "member",
  muted: false,
  selfMuted: index === 3,
  selfDeafened: false,
  serverMuted: false,
  serverDeafened: false,
  screenSharing: false,
  cameraSharing: false,
  speaking: index === 1,
}));

const hourMs = 60 * 60_000;
const nextFriday = (() => {
  const date = new Date(now);
  date.setUTCHours(19, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + ((5 - date.getUTCDay() + 7) % 7 || 7));
  return date.getTime();
})();
const hubEvent = (id, title, description, startsAt, going, gameTag, voiceChannelId = 105) => ({
  id: `demo-event-${id}`,
  hubId: 1,
  channelId: 103,
  voiceChannelId,
  title,
  description,
  coverUrl: null,
  startsAt,
  endsAt: startsAt + 2 * hourMs,
  timezone: "Europe/Berlin",
  recurrence: "weekly",
  audience: "all",
  audienceIds: [],
  reminderMinutes: 30,
  capacity: 20,
  gameTag,
  createdBy: me.id,
  createdAt: now - 72 * hourMs,
  updatedAt: now - 72 * hourMs,
  cancelledAt: null,
  occurrenceStart: startsAt,
  occurrenceEnd: startsAt + 2 * hourMs,
  rsvpCounts: { going, maybe: 3, declined: 1 },
  myRsvp: "going",
  goingUserIds: [me.id, mira.id, talon.id, kestrel.id, vex.id],
  canManage: true,
});
const hubEvents = [
  hubEvent(
    1,
    "Friday raid night",
    "New raid, full clear attempt. Warm-up at 19:45.",
    nextFriday,
    14,
    "Starfall Tactics",
  ),
  hubEvent(
    2,
    "Ranked squad queue",
    "Duo and trio queue — sign up in Squad Finder.",
    nextFriday + 26 * hourMs,
    8,
    "Starfall Tactics",
  ),
];

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

const everyone = [me, ...people];
async function installMediaRoutes(page) {
  await page.route("**/demo-media/**", async (route) => {
    const [, kind, file] = new URL(route.request().url()).pathname.match(/^\/demo-media\/([^/]+)\/([^/]+)\.svg$/) || [];
    const id = decodeURIComponent(file || "");
    let body = null;
    if (kind === "avatar") {
      const person = everyone.find((entry) => entry.id === id);
      body = avatarSvg(id, person?.accent);
    } else if (kind === "hub-icon" || kind === "hub-banner") {
      const hub = hubs.find((entry) => String(entry.id) === id);
      if (hub) {
        const [emblem, from, to] = hub.art;
        body = kind === "hub-icon" ? hubIconSvg(emblem, from, to) : hubBannerSvg(hub.name, from, to);
      }
    }
    if (!body) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, contentType: "image/svg+xml", body });
  });
}

async function installRoutes(page) {
  await installMediaRoutes(page);
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname;
    const method = request.method();
    if (process.env.DECAVE_SCREENS_DEBUG && p.includes("messages")) console.log("api", method, p);
    if (p === "/api/auth/config") return json(route, { turnstileSiteKey: "demo-site-key", streamerHubsEnabled: true });
    if (p === `/api/servers/${OFFICIAL_HUB_ID}/streamer`) return json(route, officialSnapshot());
    if (p === "/api/auth/me") return json(route, { user: me, safety: { ageStatus: "eligible", blockedUserIds: [] } });
    if (p === "/api/auth/ws-token") return json(route, { wsToken: "demo-ws-token" });
    if (p === "/api/servers" && method === "GET") return json(route, hubs);
    if (p === "/api/servers/discover")
      return json(
        route,
        hubs.filter((hub) => hub.id !== OFFICIAL_HUB_ID).map((hub) => ({ ...hub, myRole: null })),
      );
    if (/^\/api\/servers\/\d+\/members$/.test(p)) return json(route, members);
    const channelMatch = p.match(/^\/api\/channels\/(\d+)\/messages$/);
    if (channelMatch) return json(route, channelMessages[Number(channelMatch[1])] || []);
    if (p === "/api/dms" && method === "GET")
      return json(route, {
        conversations: Object.keys(dmThreads).map((id) => {
          const messages = dmMessages(id);
          const last = messages[messages.length - 1];
          return {
            user: people.find((person) => person.id === id),
            latestMessage: last.text,
            latestTimestamp: last.timestamp,
          };
        }),
      });
    const dmMatch = p.match(/^\/api\/dms\/([^/]+)$/);
    if (dmMatch && method === "GET") return json(route, { messages: dmMessages(decodeURIComponent(dmMatch[1])) });
    if (/^\/api\/social\/dm-preferences\/[^/]+$/.test(p)) return json(route, {});
    if (p === "/api/social")
      return json(route, {
        friends: people,
        incoming: [{ ...people[5], id: "demo-request-nova", username: "Nova" }],
        outgoing: [],
      });
    if (p === "/api/account/preferences")
      return json(route, {
        friendRequestPolicy: "everyone",
        allowStreamPreviews: true,
        streamerMode: false,
        language: "en",
        timeFormat: "24h",
      });
    if (p === "/api/profile/activity")
      return json(route, {
        automaticText: me.activityText,
        source: "demo",
        appId: "starfall",
        startedAt: minutesAgo(52),
      });
    if (p === "/api/integrations/steam/status") return json(route, { linked: false, apiConfigured: false });
    if (p === "/api/squad-finder/games")
      return json(route, { games: ["Starfall Tactics", "Ember Rift", "Gridline Racing"] });
    if (p === "/api/squad-finder")
      return json(route, {
        current: null,
        matches: [mira, talon, vex].map((person, index) => ({
          id: `demo-squad-${index}`,
          game: "Starfall Tactics",
          platform: "PC",
          language: "English",
          region: "Europe",
          microphoneRequired: index !== 2,
          groupId: `demo-group-${index}`,
          memberCount: [3, 2, 1][index],
          expiresAt: new Date(now + (40 - index * 10) * 60_000).toISOString(),
          owner: { id: person.id, username: person.username, avatarUrl: person.avatarUrl },
        })),
      });
    if (p === "/api/rtc/ice-servers") return json(route, { iceServers: [{ urls: "stun:demo.invalid" }] });
    if (p === "/api/soundboard") return json(route, { sounds: [] });
    if (/^\/api\/servers\/\d+\/(features|access|custom-roles)$/.test(p))
      return json(route, p.endsWith("custom-roles") ? [] : {});
    const eventsMatch = p.match(/^\/api\/servers\/(\d+)\/events$/);
    if (eventsMatch && method === "GET")
      return json(route, { events: Number(eventsMatch[1]) === 1 ? hubEvents : [], truncated: false, canCreate: true });
    if (/^\/api\/servers\/\d+\/assets$/.test(p)) return json(route, []);
    if (p === "/api/safety/blocks") return json(route, { blocks: [] });
    if (p === "/api/social/dm-preferences") return json(route, {});
    if (p.startsWith("/api/admin/")) return json(route, { error: "forbidden" }, 403);
    if (process.env.DECAVE_SCREENS_DEBUG) console.log("unmocked", method, p);
    return json(route, {});
  });
}

function initScript({ meId, voice }) {
  // Runs in the page before the app boots: synthetic WebSocket, media, and desktop bridge.
  const socketState = { meId, voice };
  return `(() => {
    const state = ${JSON.stringify(socketState)};
    localStorage.setItem('decave_last_workspace_v1', JSON.stringify({ serverId: 1, channelId: 102 }));
    class DemoSocket {
      static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
      constructor() { this.readyState = 0; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(new Event('open')); }, 0); }
      emit(data, delay = 10) { setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify(data) }), delay); }
      send(raw) {
        let payload = {}; try { payload = JSON.parse(raw); } catch {}
        if (window.__demoDebug) console.log('ws-out ' + payload.type);
        if (payload.type === 'IDENTIFY') this.emit({ type: 'IDENTIFIED', id: 'demo-connection', serverId: 1, channelId: 102 }, 0);
        else if (payload.type === 'PING') this.emit({ type: 'PONG' }, 0);
        else if (payload.type === 'JOIN_SERVER') this.emit({ type: 'SERVER_JOINED', serverId: Number(payload.serverId), channelId: Number(payload.channelId) || 0 });
        else if (payload.type === 'JOIN_CHANNEL') this.emit({ type: 'CHANNEL_JOINED', channelId: Number(payload.channelId) });
        else if (payload.type === 'VOICE_STATE_REQUEST') this.emit({ type: 'VOICE_STATE', participants: state.joined ? state.voice : state.voice.filter((p) => p.userId !== state.meId) });
        else if (payload.type === 'VOICE_JOIN') {
          state.joined = true;
          const self = state.voice.find((p) => p.userId === state.meId);
          this.emit({ type: 'VOICE_JOINED', channelId: 105, participant: self, peers: [] });
          this.emit({ type: 'VOICE_STATE', participants: state.voice }, 30);
        } else if (payload.type === 'VOICE_LEAVE') this.emit({ type: 'VOICE_LEFT' });
      }
      close() { this.readyState = 3; this.onclose && this.onclose(new CloseEvent('close')); }
    }
    window.WebSocket = DemoSocket;
    window.turnstile = { render(_, o) { setTimeout(() => o.callback && o.callback('demo-token'), 0); return 'demo'; }, remove() {} };
    if (navigator.mediaDevices) {
      navigator.mediaDevices.enumerateDevices = async () => [
        { deviceId: 'demo-mic', groupId: 'g', kind: 'audioinput', label: 'Studio microphone' },
        { deviceId: 'demo-out', groupId: 'g', kind: 'audiooutput', label: 'Headphones' },
      ];
      navigator.mediaDevices.getUserMedia = async () => {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const dest = ctx.createMediaStreamDestination();
        const gain = ctx.createGain(); gain.gain.value = 0; const osc = ctx.createOscillator();
        osc.connect(gain); gain.connect(dest); osc.start();
        return dest.stream;
      };
    }
  })();`;
}

async function settle(page, ms = 900) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(ms);
}

async function clickIfVisible(locator) {
  const target = locator.first();
  if ((await target.count()) === 0 || !(await target.isVisible().catch(() => false))) return false;
  await target.click({ timeout: 5_000 }).catch(() => {});
  return true;
}

async function dumpButtons(page, label) {
  if (!process.env.DECAVE_SCREENS_DEBUG) return;
  const names = await page
    .locator("button:visible")
    .evaluateAll((nodes) =>
      nodes.map(
        (n) =>
          `${n.className.split(" ")[0]}|${(n.getAttribute("aria-label") || n.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40)}`,
      ),
    );
  console.log(`buttons@${label}:`, names.join(" ;; "));
}

async function shot(page, name) {
  await dumpButtons(page, name);
  await page.mouse.move(2, 2);
  await settle(page, 600);
  const file = path.join(outDir, `${name}.webp`);
  await sharp(await page.screenshot())
    .webp({ quality: 84 })
    .toFile(file);
  console.log("captured", path.relative(root, file));
}

await fs.mkdir(outDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const only = new Set((process.env.DECAVE_SCREENS || "").split(",").filter(Boolean));
const want = (name) => only.size === 0 || only.has(name);

try {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 960 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
    permissions: ["microphone", "camera"],
  });
  await context.addInitScript(initScript({ meId: me.id, voice: voiceParticipants }));
  const page = await context.newPage();
  if (process.env.DECAVE_SCREENS_DEBUG) {
    await context.addInitScript("window.__demoDebug = true;");
    page.on("console", (message) => message.text().startsWith("ws-out") && console.log(message.text()));
  }
  page.on("pageerror", (error) => console.warn("pageerror:", error.message));
  await installRoutes(page);
  await page.goto(appUrl.href, { waitUntil: "domcontentloaded" });
  await page.locator(".app[data-workspace]").waitFor({ timeout: 30_000 });
  await settle(page, 1500);

  const openHub = async () => {
    await clickIfVisible(page.getByRole("button", { name: "Open Night Raid Collective", exact: true }));
    await page
      .locator('.app[data-workspace="hub"]')
      .waitFor({ timeout: 10_000 })
      .catch(() => {});
  };
  const railPage = async (name) => {
    await clickIfVisible(page.locator("button.dc-rail-page-button").filter({ hasText: name }));
    await settle(page, 700);
  };

  if (want("app-home")) {
    await railPage("Home");
    await shot(page, "app-home");
  }

  if (want("app-hub-home")) {
    await openHub();
    await clickIfVisible(page.locator("button.hbx-home"));
    await clickIfVisible(page.locator("button.hh-btn").filter({ hasText: /^Hide$/ }));
    await shot(page, "app-hub-home");
  }

  if (want("app-hub")) {
    await openHub();
    await clickIfVisible(page.locator("button.hbx-tile").filter({ hasText: "general" }));
    await shot(page, "app-hub");
  }

  if (want("app-voice")) {
    await openHub();
    await clickIfVisible(page.locator("button.hbx-tile").filter({ hasText: "Raid voice" }));
    await settle(page, 800);
    await dumpButtons(page, "voice-lobby");
    if (!(await clickIfVisible(page.locator("button.vr-join-orb"))))
      await clickIfVisible(page.getByRole("button", { name: /^Join Raid voice$/ }));
    await settle(page, 1500);
    await shot(page, "app-voice");
  }

  if (want("app-dms")) {
    await railPage("DMs");
    await clickIfVisible(page.getByText("Mira", { exact: true }));
    await shot(page, "app-dms");
  }

  if (want("app-friends")) {
    await railPage("Friends");
    await shot(page, "app-friends");
  }

  if (want("app-squad")) {
    await railPage("Squad");
    await shot(page, "app-squad");
  }

  if (want("app-official")) {
    await clickIfVisible(page.getByRole("button", { name: "Open DeCave", exact: true }));
    await page.locator(".dc-official-section").first().waitFor({ timeout: 15_000 });
    await settle(page, 1200);
    await shot(page, "app-official");
    // Regression check: the overview must keep its scroll position while the
    // app re-renders every second.
    const scroller = page.locator(".dc-streamer-content");
    await scroller.evaluate((node) => node.scrollTo(0, node.scrollHeight));
    const before = await scroller.evaluate((node) => node.scrollTop);
    await page.waitForTimeout(3500);
    const after = await scroller.evaluate((node) => node.scrollTop);
    if (before < 50 || Math.abs(after - before) > 2)
      throw new Error(`Official Hub overview scroll jumped from ${before} to ${after}.`);
    console.log(`official overview scroll held at ${after}px`);
    await shot(page, "app-official-info");
  }

  if (want("app-discover")) {
    await railPage("Discover");
    await shot(page, "app-discover");
  }
} finally {
  await browser.close();
}
