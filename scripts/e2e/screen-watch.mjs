// Two-user screen-share check against a running local Worker:
//   npx wrangler dev --local --port 8787     (serving a fresh `npm run build:web`)
//   node scripts/e2e/screen-watch.mjs
//
// A shares a (fake, animated canvas) screen. Checks that A sends only a small
// preview to B until B clicks Start Watching, full quality while B watches,
// and the preview again after B clicks Stop Watching.
import {
  HUB_NAME,
  USERS,
  assertServerUp,
  createChecks,
  joinVoiceRoom,
  launchBrowser,
  openApp,
  signIn,
  sleep,
  testPassword,
  waitFor,
} from "./browser.mjs";

const { check, finish } = createChecks();

// Replaces the screen picker with an animated noise canvas.
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

const SCREEN_SENDER = `(() => {
  for (const pc of window.__e2ePeers) {
    if (pc.connectionState === "closed") continue;
    const sender = pc.getSenders().find((s) => s.track?.kind === "video");
    if (sender) return sender.getParameters().encodings[0] ?? null;
  }
  return null;
})()`;

async function videoSentKbps(browser) {
  const read = `(async () => { let sent = 0; for (const pc of window.__e2ePeers) { if (pc.connectionState === "closed") continue; (await pc.getStats()).forEach((s) => { if (s.type === "outbound-rtp" && s.kind === "video") sent += s.bytesSent || 0; }); } return sent; })()`;
  const before = await browser.evaluate(read);
  await sleep(3000);
  const after = await browser.evaluate(read);
  return Math.round(((after - before) * 8) / 3 / 1000);
}

async function main() {
  await assertServerUp();
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
    await b.evaluate(`fetch("/api/servers/${hubId}/join", { method: "POST", credentials: "include" }).then((r) => r.status)`);
    await openApp(b);
    await waitFor(b, "realtime connection", `!!document.querySelector(".dc-bottom-bar-status.is-online")`);
    await joinVoiceRoom(a);
    await joinVoiceRoom(b);
    await waitFor(a, "peer connected", "__e2e.connectedPeers() > 0", 30_000);
    await waitFor(b, "peer connected", "__e2e.connectedPeers() > 0", 30_000);

    await a.evaluate(`__e2e.button("Share screen").click()`);
    await waitFor(a, "share start button", `!!document.querySelector(".dc-media-start-button")`);
    await a.evaluate(`document.querySelector(".dc-media-start-button").click()`);
    await waitFor(b, "Start Watching button", `!!__e2e.button("Start Watching")`, 30_000);

    const preview = await waitFor(a, "preview encoding", `(${SCREEN_SENDER})?.maxBitrate === 250000 && (${SCREEN_SENDER})`, 15_000).catch(() => null);
    check("A sends only a preview before B watches", !!preview, JSON.stringify(preview));
    await sleep(3000);
    const previewKbps = await videoSentKbps(a);
    check("preview video stays small", previewKbps < 600, `${previewKbps} kbps`);

    await b.evaluate(`__e2e.button("Start Watching").click()`);
    const full = await waitFor(a, "full encoding", `(${SCREEN_SENDER})?.maxBitrate > 1000000 && (${SCREEN_SENDER})`, 15_000).catch(() => null);
    check("A sends full quality while B watches", !!full, JSON.stringify(full));
    await sleep(6000);
    const fullKbps = await videoSentKbps(a);
    check("watched video uses much more bitrate", fullKbps > previewKbps * 2, `${fullKbps} kbps`);

    await waitFor(b, "Stop Watching button", `!!__e2e.button("Stop Watching")`);
    await b.evaluate(`__e2e.button("Stop Watching").click()`);
    const back = await waitFor(a, "preview again", `(${SCREEN_SENDER})?.maxBitrate === 250000`, 15_000).catch(() => false);
    check("Stop Watching returns A to the preview", !!back);
    const gate = await waitFor(b, "Start Watching again", `!!__e2e.button("Start Watching")`, 5_000).catch(() => false);
    check("B sees Start Watching again", !!gate);
  } finally {
    a.close();
    b.close();
  }
  finish("screen-watch checks");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
