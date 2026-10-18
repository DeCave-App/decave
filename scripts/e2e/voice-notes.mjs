// Two-user voice-note check against a running local Worker:
//   npm run build:web (with the Worker stopped), then
//   npx wrangler dev --local --port 8790 --ip 127.0.0.1 --local-upstream 127.0.0.1:8790
//   DECAVE_E2E_BASE=http://127.0.0.1:8790 npm run e2e:voice-notes
//
// Two fresh accounts per run: the sender uses 127.0.0.1 and the listener
// localhost, so each has its own cookie jar. The script makes them friends and
// creates a Hub they share (via the app's own APIs), then for a DM and a Hub
// room: record 3 s with the fake microphone, preview, send, check the listener
// sees an unplayed bubble, plays it past half, and the sender sees the receipt
// ("Played" in the DM, the listener's unplayed dot clearing in the Hub).
// Screenshots go to DECAVE_E2E_SHOTS when set. Not covered: group DMs (they
// have no attachment support).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE, createChecks, launchBrowser, sleep, waitFor } from "./browser.mjs";

// Two fresh accounts per run: existing ones have their DM key on other devices,
// so a clean browser profile would only see "locked".
const suffix = `${Date.now().toString(36)}${crypto.randomBytes(2).toString("hex")}`;
const password = `E2e-${crypto.randomBytes(12).toString("base64url")}`;
const [SENDER, LISTENER] = ["sender", "listener"].map((role) => ({
  username: `vn_${role}_${suffix}`,
  email: `vn-${role}-${suffix}@example.test`,
}));
const HUB_NAME = `Voice ${suffix}`;
const SHOTS = process.env.DECAVE_E2E_SHOTS;
// It signs up throwaway accounts: only ever against a local Worker.
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(BASE)) {
  console.error(
    `Refusing to run against ${BASE}: set DECAVE_E2E_BASE to http://127.0.0.1:<port> or http://localhost:<port>.`,
  );
  process.exit(2);
}
const senderBase = BASE.replace("localhost", "127.0.0.1");
const listenerBase = senderBase.replace("127.0.0.1", "localhost");
const { check, finish } = createChecks();

const HELPERS = `window.__e2e = {
  button: (text) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === text || b.getAttribute("aria-label") === text || b.title === text),
  setInput: (el, value) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  },
};`;
// Remember what the recorder actually produced.
const SPY_RECORDER = `(() => {
  const Native = window.MediaRecorder;
  window.__recorded = [];
  window.MediaRecorder = class extends Native {
    constructor(stream, options) { super(stream, options); window.__recorded.push({ requested: options?.mimeType ?? "", actual: this.mimeType }); }
  };
  window.MediaRecorder.isTypeSupported = Native.isTypeSupported.bind(Native);
})();`;

async function shot(browser, name) {
  if (!SHOTS) return;
  const { data } = await browser.send("Page.captureScreenshot", { format: "png" });
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(SHOTS, name), Buffer.from(data, "base64"));
}

const JSON_API = (browser, url, method = "GET", body) =>
  browser.evaluate(`(async () => {
    const r = await fetch(${JSON.stringify(url)}, {
      method: ${JSON.stringify(method)},
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: ${body === undefined ? "undefined" : JSON.stringify(JSON.stringify(body))},
    });
    const text = await r.text();
    let body = text;
    try { body = JSON.parse(text); } catch {}
    return { status: r.status, body };
  })()`);
const must = async (label, promise) => {
  const r = await promise;
  if (r.status < 200 || r.status > 299)
    throw new Error(`${label}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body;
};

async function load(browser, base) {
  await browser.send("Page.navigate", { url: base });
  await waitFor(
    browser,
    "app shell",
    `document.readyState === "complete" && !!document.querySelector(".vadrion-auth-card, button[title='Your profile']")`,
  );
  await browser.evaluate(HELPERS);
}

// The local Worker writes verification emails to .wrangler/tmp/email.
const emailRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.wrangler/tmp/email");
function verificationToken(user) {
  for (const dir of fs.existsSync(emailRoot) ? fs.readdirSync(emailRoot) : []) {
    const texts = path.join(emailRoot, dir, "email-text");
    for (const file of fs.existsSync(texts) ? fs.readdirSync(texts) : []) {
      const text = fs.readFileSync(path.join(texts, file), "utf8");
      const token = text.includes(`Hi ${user.username},`) && /[?#]token=([0-9a-f]+)/.exec(text);
      if (token) return token[1];
    }
  }
  return null;
}
async function waitForToken(user) {
  for (let i = 0; i < 30; i += 1) {
    const token = verificationToken(user);
    if (token) return token;
    await sleep(300);
  }
  throw new Error(`No verification email found for ${user.username}`);
}

// Registers on this browser's origin and signs in over the API.
async function createAccount(browser, user) {
  await must(
    `register ${user.username}`,
    JSON_API(browser, "/api/auth/register", "POST", {
      email: user.email,
      username: user.username,
      password,
      birthDate: "1990-01-01",
      acceptedTerms: true,
      turnstileToken: "e2e",
    }),
  );
  await must("verify email", JSON_API(browser, "/api/auth/verify-email", "POST", { token: await waitForToken(user) }));
  await must(
    `login ${user.username}`,
    JSON_API(browser, "/api/auth/login", "POST", { identifier: user.email, password, turnstileToken: "e2e" }),
  );
}

// A first sign-in asks to save the DM recovery code before anything else.
async function enter(browser, base) {
  await load(browser, base);
  await waitFor(browser, "recovery code dialog", `!!document.querySelector(".dc-e2ee-check input")`, 15_000).catch(
    () => {},
  );
  await browser.evaluate(`document.querySelector(".dc-e2ee-check input")?.click()`);
  await sleep(300);
  await browser.evaluate(`__e2e.button("Done")?.click()`);
  await waitFor(browser, "realtime connection", `!!document.querySelector(".dc-bottom-bar-status.is-online")`);
}

async function setup(a, b) {
  await load(a, senderBase);
  await load(b, listenerBase);
  await createAccount(a, SENDER);
  await createAccount(b, LISTENER);
  const bMe = await must("me", JSON_API(b, "/api/auth/me"));
  const aMe = await must("me", JSON_API(a, "/api/auth/me"));
  const idOf = (me) => me.user?.decaveId ?? me.user?.publicId ?? me.decaveId ?? me.publicId;
  if (!/^DC-/.test(String(idOf(aMe))) || !/^DC-/.test(String(idOf(bMe))))
    throw new Error(`could not read DeCave ids from /api/auth/me (keys: ${Object.keys(aMe.user ?? aMe)})`);
  await must("friend request", JSON_API(a, `/api/friends/${idOf(bMe)}/request`, "POST"));
  await must("friend accept", JSON_API(b, `/api/friends/${idOf(aMe)}/accept`, "POST"));
  const hub = await must("create hub", JSON_API(a, "/api/servers", "POST", { name: HUB_NAME }));
  const invite = await must("invite", JSON_API(a, `/api/servers/${hub.id}/invites`, "POST", {}));
  await must("join", JSON_API(b, `/api/invites/${invite.code}/join`, "POST", {}));
}

const clickText = (browser, selector, text) =>
  browser.evaluate(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.includes(${JSON.stringify(text)}));
    if (!el) return false;
    el.click();
    return true;
  })()`);

async function openDm(browser, withUser) {
  await browser.evaluate(`__e2e.button("DMs")?.click()`);
  await sleep(800);
  if (!(await clickText(browser, "button.ds-row", withUser))) {
    await browser.evaluate(`__e2e.button("Friends")?.click()`);
    await sleep(800);
    await clickText(browser, "button", "Message");
  }
  await waitFor(browser, "DM composer", `!!document.querySelector("textarea[placeholder*='${withUser}']")`);
}

const GENERAL = `/^#?\\s*general$/i.test(b.textContent.replace(/[^\\w ]/g, "").trim())`;
async function openHubRoom(browser) {
  await browser.evaluate(`__e2e.button("Open ${HUB_NAME}")?.click()`);
  await sleep(1000);
  await waitFor(browser, "general room", `[...document.querySelectorAll("button")].some((b) => ${GENERAL})`);
  await browser.evaluate(`[...document.querySelectorAll("button")].find((b) => ${GENERAL}).click()`);
  await waitFor(browser, "Hub composer", `!!document.querySelector("textarea[placeholder*='general']")`);
}

// The Hub page stays mounted behind the Messages overlay, so every query is
// scoped: the composer by its textarea placeholder, bubbles by conversation.
const DM_BUBBLES = `.vn-bubble[data-message-id][data-conversation^="dm:"]`;
const ROOM_BUBBLES = `.vn-bubble[data-message-id][data-conversation^="room:"]`;

// The bubble is still there, playable, and has no unplayed dot.
const CLEARED = (bubbles) =>
  `!!document.querySelector(${JSON.stringify(`${bubbles}:not(.is-error)`)}) && !document.querySelector(${JSON.stringify(`${bubbles} .vn-unplayed-dot`)})`;

async function tagComposer(browser, placeholder) {
  const ok = await browser.evaluate(`(() => {
    document.querySelectorAll("[data-e2e-root]").forEach((e) => e.removeAttribute("data-e2e-root"));
    let root = document.querySelector("textarea[placeholder*='${placeholder}']");
    while (root && !root.querySelector('button[aria-label="Record voice message"]')) root = root.parentElement;
    if (!root) return false;
    root.setAttribute("data-e2e-root", "1");
    return true;
  })()`);
  if (!ok) throw new Error(`${browser.name}: no mic button in the composer with placeholder ${placeholder}`);
}

async function record(browser, placeholder) {
  await tagComposer(browser, placeholder);
  await browser.evaluate(`document.querySelector('[data-e2e-root] button[aria-label="Record voice message"]').click()`);
  await waitFor(browser, "recording bar", `!!document.querySelector("[data-e2e-root] .vn-bar-root.is-recording")`);
  await sleep(3300);
  await browser.evaluate(`document.querySelector('[data-e2e-root] button[aria-label="Stop recording"]').click()`);
  await waitFor(browser, "preview", `!!document.querySelector("[data-e2e-root] .vn-bar-root.is-preview")`);
  return browser.evaluate(`document.querySelector("[data-e2e-root] .vn-bar-root.is-preview .vn-timer")?.textContent`);
}

async function sendAndAwaitBubble(sender, listener, label, placeholder, bubbles) {
  const timer = await record(sender, placeholder);
  check(`${label}: recorded a preview`, /^0:0[2-4]$/.test(timer ?? ""), timer);
  await sender.evaluate(`document.querySelector("[data-e2e-root] .vn-bar-root.is-preview .vn-send").click()`);
  await waitFor(sender, "sender bubble", `document.querySelectorAll(${JSON.stringify(bubbles)}).length > 0`);
  check(`${label}: sender sees their bubble`, true);
  await waitFor(
    listener,
    "listener bubble",
    `document.querySelectorAll(${JSON.stringify(bubbles)}).length > 0`,
    30_000,
  );
  const dot = await listener.evaluate(`!!document.querySelector(${JSON.stringify(`${bubbles} .vn-unplayed-dot`)})`);
  check(`${label}: listener sees an unplayed dot`, dot);
}

async function listenerPlays(listener, bubbles) {
  await listener.evaluate(`document.querySelector(${JSON.stringify(`${bubbles} .vn-play`)}).click()`);
  await sleep(2600); // past half of a ~3 s note
}

async function main() {
  const port = 9451 + Math.floor(Math.random() * 40) * 2;
  const a = await launchBrowser("sender", port);
  const b = await launchBrowser("listener", port + 1);
  try {
    await a.send("Page.addScriptToEvaluateOnNewDocument", { source: SPY_RECORDER });
    await setup(a, b);
    await enter(a, senderBase);
    await enter(b, listenerBase);
    console.log(`accounts ${SENDER.username} / ${LISTENER.username}, hub "${HUB_NAME}"`);

    // Direct message.
    await openDm(a, LISTENER.username);
    await openDm(b, SENDER.username);
    await sendAndAwaitBubble(a, b, "DM", "@" + LISTENER.username, DM_BUBBLES);
    await listenerPlays(b, DM_BUBBLES);
    await waitFor(
      a,
      "Played label",
      `!!document.querySelector(${JSON.stringify(`${DM_BUBBLES} .vn-played-label`)})`,
      25_000,
    ).then(
      () => check("DM: sender sees Played", true),
      () => check("DM: sender sees Played", false),
    );
    check("DM: listener's unplayed dot cleared", await b.evaluate(CLEARED(DM_BUBBLES)));
    await shot(a, "task-10-dm-sender.png");
    await shot(b, "task-10-dm-listener.png");

    // Hub room.
    await openHubRoom(a);
    await openHubRoom(b);
    await sendAndAwaitBubble(a, b, "Hub", "general", ROOM_BUBBLES);
    await listenerPlays(b, ROOM_BUBBLES);
    await waitFor(b, "dot cleared", CLEARED(ROOM_BUBBLES), 20_000).then(
      () => check("Hub: listener's unplayed dot cleared", true),
      () => check("Hub: listener's unplayed dot cleared", false),
    );
    await shot(b, "task-10-hub.png");

    const recorded = await a.evaluate("window.__recorded");
    console.log("MediaRecorder mime:", JSON.stringify(recorded));
    check("recorder produced a supported mime", recorded.length > 0 && !!recorded[0].actual, recorded[0]?.actual);
  } finally {
    a.close();
    b.close();
  }
}

main()
  .catch((error) => {
    check(`unexpected failure: ${error.message}`, false);
  })
  .finally(() => finish("voice-note checks"));
