// Drives headless Chromium over the DevTools protocol for end-to-end checks
// against a running local Worker. Each browser gets its own profile (so its own
// session) and a fake microphone and camera.
//
// Accounts come from the git-ignored .dev-test-account.txt (smoketest1 and
// smoketest2 share its password). Override with DECAVE_E2E_BASE,
// DECAVE_E2E_PASSWORD, DECAVE_E2E_CHROME.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const BASE = process.env.DECAVE_E2E_BASE ?? "http://127.0.0.1:8787";
export const HUB_NAME = "Smoke Hub";
export const VOICE_ROOM = "General Voice";
export const USERS = ["smoketest1@example.test", "smoketest2@example.test"];

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function testPassword() {
  if (process.env.DECAVE_E2E_PASSWORD) return process.env.DECAVE_E2E_PASSWORD;
  const file = path.join(root, ".dev-test-account.txt");
  const match = fs.readFileSync(file, "utf8").match(/^password:\s*(.+)$/m);
  if (!match) throw new Error("No password in .dev-test-account.txt; set DECAVE_E2E_PASSWORD");
  return match[1].trim();
}

function chromePath() {
  if (process.env.DECAVE_E2E_CHROME) return process.env.DECAVE_E2E_CHROME;
  const cache = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), ".cache"), "ms-playwright");
  const dirs = fs.existsSync(cache)
    ? fs
        .readdirSync(cache)
        .filter((d) => /^chromium-\d+$/.test(d))
        .sort()
        .reverse()
    : [];
  for (const dir of dirs) {
    for (const exe of [
      "chrome-win64/chrome.exe",
      "chrome-linux/chrome",
      "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
    ]) {
      const candidate = path.join(cache, dir, exe);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw new Error("Chromium not found; set DECAVE_E2E_CHROME");
}

export async function assertServerUp() {
  const up = await fetch(BASE)
    .then((r) => r.ok)
    .catch(() => false);
  if (!up) throw new Error(`No app at ${BASE}; start the local Worker first`);
}

// Records every RTCPeerConnection the page creates so stats can be read.
const TRACK_PEERS = `(() => {
  const Native = window.RTCPeerConnection;
  const peers = [];
  window.__e2ePeers = peers;
  window.RTCPeerConnection = function (...args) { const pc = new Native(...args); peers.push(pc); return pc; };
  window.RTCPeerConnection.prototype = Native.prototype;
  Object.setPrototypeOf(window.RTCPeerConnection, Native);
})();`;

// Page-side helpers, defined once per page load.
const HELPERS = `window.__e2e = {
  button: (text) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === text || b.getAttribute("aria-label") === text || b.title === text),
  setInput: (el, value) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  },
  async audioBytes() {
    let received = 0, sent = 0;
    for (const pc of window.__e2ePeers) {
      if (pc.connectionState === "closed") continue;
      const stats = await pc.getStats();
      stats.forEach((s) => {
        if (s.type === "inbound-rtp" && s.kind === "audio") received += s.bytesReceived || 0;
        if (s.type === "outbound-rtp" && s.kind === "audio") sent += s.bytesSent || 0;
      });
    }
    return { received, sent };
  },
  connectedPeers: () => window.__e2ePeers.filter((pc) => pc.connectionState === "connected").length,
};`;

export async function launchBrowser(name, port) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `decave-e2e-${name}-`));
  const child = spawn(
    chromePath(),
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      "--no-first-run",
      "--window-size=1440,900",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let page = null;
  for (let i = 0; i < 100 && !page; i += 1) {
    await sleep(200);
    try {
      page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
    } catch {}
  }
  if (!page) throw new Error(`${name}: Chromium did not start`);
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let nextId = 1;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails)
      throw new Error(`${name}: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
    return result.result.value;
  };
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: TRACK_PEERS });
  const close = () => {
    try {
      socket.close();
    } catch {}
    // Chromium runs as a process tree; end exactly this one.
    if (process.platform === "win32") spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill();
    setTimeout(() => {
      try {
        fs.rmSync(profile, { recursive: true, force: true });
      } catch {}
    }, 1000);
  };
  return { name, send, evaluate, close };
}

export async function waitFor(browser, label, expression, timeoutMs = 20_000) {
  const start = Date.now();
  for (;;) {
    const value = await browser.evaluate(expression).catch(() => null);
    if (value) return value;
    if (Date.now() - start > timeoutMs) {
      const screen = await browser
        .evaluate(`document.body?.innerText.replace(/\\s+/g, " ").slice(0, 300)`)
        .catch(() => "");
      throw new Error(`${browser.name}: timed out waiting for ${label}; page shows: ${screen}`);
    }
    await sleep(300);
  }
}

export async function openApp(browser) {
  await browser.send("Page.navigate", { url: BASE });
  await waitFor(
    browser,
    "app shell",
    `document.readyState === "complete" && !!document.querySelector(".vadrion-auth-card, button[title='Your profile']")`,
  );
  await browser.evaluate(HELPERS);
}

export async function signIn(browser, email, password) {
  await openApp(browser);
  const signedIn = await browser.evaluate(`!!document.querySelector("button[title='Your profile']")`);
  if (!signedIn) {
    await browser.evaluate(`(() => {
      __e2e.setInput(document.querySelector('.vadrion-auth-card input[type="email"]'), ${JSON.stringify(email)});
      __e2e.setInput(document.querySelector('.vadrion-auth-card input[type="password"]'), ${JSON.stringify(password)});
      __e2e.button("Enter DeCave").click();
    })()`);
    await waitFor(browser, "sign-in", `!!document.querySelector("button[title='Your profile']")`);
  }
  await waitFor(browser, "realtime connection", `!!document.querySelector(".dc-bottom-bar-status.is-online")`);
}

export async function joinVoiceRoom(browser) {
  await browser.evaluate(`__e2e.button("Open ${HUB_NAME}").click()`);
  await sleep(800);
  await waitFor(browser, "voice room in sidebar", `!!__e2e.button("🔊${VOICE_ROOM}")`);
  await browser.evaluate(`__e2e.button("🔊${VOICE_ROOM}").click()`);
  await waitFor(browser, "lobby Join button", `!!__e2e.button("Join")`);
  await browser.evaluate(`__e2e.button("Join").click()`);
}

export async function audioFlowing(browser) {
  const before = await browser.evaluate("__e2e.audioBytes()");
  await sleep(2500);
  const after = await browser.evaluate("__e2e.audioBytes()");
  return {
    receivedPerSec: Math.round((after.received - before.received) / 2.5),
    sentPerSec: Math.round((after.sent - before.sent) / 2.5),
  };
}

export function createChecks() {
  const results = [];
  const check = (label, ok, detail = "") => {
    results.push({ label, ok });
    console.log(`${ok ? "✔" : "✖"} ${label}${detail ? ` (${detail})` : ""}`);
  };
  const finish = (what) => {
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} ${what} passed`);
    if (failed) process.exitCode = 1;
  };
  return { check, finish };
}
