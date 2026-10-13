// Screen share through Cloudflare Realtime (SFU) with per-frame E2EE, against a running local Worker:
//   .dev.vars needs SCREEN_SFU_ENABLED=true, CLOUDFLARE_REALTIME_APP_ID/APP_TOKEN and
//   CLOUDFLARE_TURN_KEY_ID/CLOUDFLARE_TURN_API_TOKEN (calls are relay-only, so TURN is required).
//   npm run build:web && npx wrangler dev --local --port 8787
//   node scripts/e2e/screen-sfu.mjs
//
// Checks the SFU sender (simulcast rids f,p), the preview gate, full quality while watching,
// and the low-quality preview after Stop Watching. The mesh fallback (SCREEN_SFU_ENABLED=false)
// is covered by running screen-watch.mjs against a Worker started with the flag off.
// No key-drop test hook exists in the app, so "viewer without keys decodes nothing" is covered by
// the frame-crypto unit tests instead.
import {
  BASE,
  HUB_NAME,
  USERS,
  assertServerUp,
  createChecks,
  joinVoiceRoom,
  launchBrowser,
  openApp,
  signIn,
  testPassword,
  waitFor,
} from "./browser.mjs";

const { check, finish } = createChecks();

const FAKE_DISPLAY = `(() => {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext("2d");
    setInterval(() => {
      const image = ctx.createImageData(canvas.width, canvas.height);
      for (let i = 0; i < image.data.length; i += 4) {
        const v = Math.random() * 255;
        image.data[i] = v; image.data[i + 1] = v; image.data[i + 2] = v; image.data[i + 3] = 255;
      }
      ctx.putImageData(image, 0, 0);
    }, 33);
    return canvas.captureStream(30);
  };
})();`;

// The SFU sender is the video sender whose encodings carry simulcast rids.
const SFU_RIDS = `(() => {
  for (const pc of window.__e2ePeers) {
    if (pc.connectionState === "closed") continue;
    const sender = pc.getSenders().find((s) => s.track?.kind === "video");
    const rids = sender?.getParameters().encodings.map((e) => e.rid).filter(Boolean);
    if (rids && rids.length) return rids.join(",");
  }
  return null;
})()`;

const INBOUND_WIDTH = `(async () => {
  let width = 0;
  for (const pc of window.__e2ePeers) {
    if (pc.connectionState === "closed") continue;
    (await pc.getStats()).forEach((s) => {
      if (s.type === "inbound-rtp" && s.kind === "video" && s.frameWidth) width = Math.max(width, s.frameWidth);
    });
  }
  return width;
})()`;

async function main() {
  await assertServerUp();
  const ice = await fetch(`${BASE}/api/rtc/ice-servers`)
    .then((r) => r.json())
    .catch(() => null);
  if (!ice?.turnEnabled) {
    throw new Error(
      "TURN is not configured (/api/rtc/ice-servers turnEnabled is false). Set CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_API_TOKEN in .dev.vars and restart the Worker; calls are relay-only.",
    );
  }
  const password = testPassword();
  const a = await launchBrowser("A", 9341);
  const b = await launchBrowser("B", 9342);
  try {
    await a.send("Page.addScriptToEvaluateOnNewDocument", { source: FAKE_DISPLAY });
    await signIn(a, USERS[0], password);
    await signIn(b, USERS[1], password);
    const hubId = await a.evaluate(
      `fetch("/api/servers", { credentials: "include" }).then((r) => r.json()).then((list) => (Array.isArray(list) ? list : list.servers).find((s) => s.name === ${JSON.stringify(HUB_NAME)})?.id)`,
    );
    await b.evaluate(
      `fetch("/api/servers/${hubId}/join", { method: "POST", credentials: "include" }).then((r) => r.status)`,
    );
    await openApp(b);
    await waitFor(b, "realtime connection", `!!document.querySelector(".dc-bottom-bar-status.is-online")`);
    await joinVoiceRoom(a);
    await joinVoiceRoom(b);
    await waitFor(a, "peer connected", "__e2e.connectedPeers() > 0", 30_000);
    await waitFor(b, "peer connected", "__e2e.connectedPeers() > 0", 30_000);

    await a.evaluate(`__e2e.button("Share screen").click()`);
    await waitFor(a, "share start button", `!!document.querySelector(".dc-media-start-button")`);
    await a.evaluate(`document.querySelector(".dc-media-start-button").click()`);

    const rids = await waitFor(a, "SFU sender with simulcast rids", `(${SFU_RIDS})`, 30_000).catch(() => null);
    check("sharer sends one video track through the SFU with rids f,p", rids === "f,p" || rids === "p,f", String(rids));

    const gate = await waitFor(b, "Start Watching button", `!!__e2e.button("Start Watching")`, 30_000).catch(
      () => false,
    );
    check("viewer sees the preview tile with Start Watching", !!gate);

    await b.evaluate(`__e2e.button("Start Watching").click()`);
    const full = await waitFor(
      b,
      "full-size inbound frames",
      `(${INBOUND_WIDTH}).then((w) => w >= 1000)`,
      30_000,
    ).catch(() => false);
    check("viewer decodes full-size frames while watching", !!full);

    await waitFor(b, "Stop Watching button", `!!__e2e.button("Stop Watching")`);
    await b.evaluate(`__e2e.button("Stop Watching").click()`);
    const small = await waitFor(
      b,
      "preview-size inbound frames",
      `(${INBOUND_WIDTH}).then((w) => w > 0 && w <= 400)`,
      20_000,
    ).catch(() => false);
    check("Stop Watching drops the viewer to the preview size", !!small);
  } finally {
    a.close();
    b.close();
  }
  finish("screen-sfu checks");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
