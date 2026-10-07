// Two-user voice smoke test against a running local Worker:
//   npx wrangler dev --local --port 8787     (serving a fresh `npm run build:web`)
//   npm run e2e:voice
//
// Checks that Settings starts a live microphone preview, that two users in the
// same voice room connect over WebRTC with audio packets flowing both ways,
// that mute shows up for the other person and that leaving ends the call.
//
// With --reconnect it instead waits, in a call, for the Worker to be restarted
// (do that by hand) and checks that both users rejoin voice on their own.
import {
  HUB_NAME,
  USERS,
  assertServerUp,
  audioFlowing,
  createChecks,
  joinVoiceRoom,
  launchBrowser,
  openApp,
  signIn,
  sleep,
  testPassword,
  waitFor,
} from "./browser.mjs";

const reconnectMode = process.argv.includes("--reconnect");
const { check, finish } = createChecks();

async function joinBothToVoice(a, b) {
  // Make sure B is in the public test Hub, then reload so the Hub list includes it.
  const hubId = await a.evaluate(
    `fetch("/api/servers", { credentials: "include" }).then((r) => r.json()).then((list) => (Array.isArray(list) ? list : list.servers).find((s) => s.name === ${JSON.stringify(HUB_NAME)})?.id)`,
  );
  if (!hubId) throw new Error(`${HUB_NAME} not found for ${USERS[0]}`);
  await b.evaluate(
    `fetch("/api/servers/${hubId}/join", { method: "POST", credentials: "include" }).then((r) => r.status)`,
  );
  await openApp(b);
  await waitFor(b, "realtime connection", `!!document.querySelector(".dc-bottom-bar-status.is-online")`);
  await joinVoiceRoom(a);
  await joinVoiceRoom(b);
  await waitFor(a, "peer connected", "__e2e.connectedPeers() > 0", 30_000);
  await waitFor(b, "peer connected", "__e2e.connectedPeers() > 0", 30_000);
  check("WebRTC peer connection established on both sides", true);
}

async function microphonePreview(a) {
  await a.evaluate(`__e2e.button("Settings").click()`);
  await sleep(600);
  await a.evaluate(`__e2e.button("Voice & video").click()`);
  const device = await waitFor(
    a,
    "live microphone preview",
    `[...document.querySelectorAll("[title]")].map((e) => e.getAttribute("title")).find((t) => /Fake Default Audio Input/.test(t))`,
    15_000,
  ).catch(() => "");
  check("Settings starts a live microphone preview", !!device, device);
  await a.evaluate(`document.querySelector('[aria-label="Close settings"]')?.click()`);
  await sleep(400);
}

async function callChecks(a, b) {
  const flowA = await audioFlowing(a);
  const flowB = await audioFlowing(b);
  check(
    "audio packets flow both ways for A",
    flowA.sentPerSec > 200 && flowA.receivedPerSec > 200,
    `${flowA.sentPerSec} B/s out, ${flowA.receivedPerSec} B/s in`,
  );
  check(
    "audio packets flow both ways for B",
    flowB.sentPerSec > 200 && flowB.receivedPerSec > 200,
    `${flowB.sentPerSec} B/s out, ${flowB.receivedPerSec} B/s in`,
  );

  const listed = await b.evaluate(
    `document.body.innerText.includes("smoketest1") && document.body.innerText.includes("smoketest2")`,
  );
  check("both participants listed in the room", listed);

  // Mute on A: B should see A muted (and not before).
  const shownMuted = `[...document.querySelectorAll("[aria-label*='muted' i], [title*='muted' i]")].some((el) => (el.closest("[data-user-id], li, .vr-person, .voice-presence-person, div")?.innerText || "").includes("smoketest1"))`;
  const mutedBefore = await b.evaluate(shownMuted);
  await a.evaluate(`(__e2e.button("Mute") || __e2e.button("Mute microphone")).click()`);
  const mutedSeen = await waitFor(b, "A shown as muted", shownMuted, 10_000).catch(() => false);
  check("mute on A is shown to B", !mutedBefore && !!mutedSeen, mutedBefore ? "already shown muted before muting" : "");

  // A leaves: B's peer connection ends.
  await a.evaluate(
    `(__e2e.button("Disconnect") || __e2e.button("Leave voice") || __e2e.button("Disconnect from voice")).click()`,
  );
  const peerClosed = await waitFor(b, "peer closed after A left", "__e2e.connectedPeers() === 0", 15_000).catch(
    () => false,
  );
  check("leaving ends the call for the other side", !!peerClosed);
}

async function reconnectChecks(a, b) {
  console.log("In a call: restart the local Worker now.");
  const start = Date.now();
  let dropped = null;
  let back = null;
  while (Date.now() - start < 150_000) {
    const peersA = await a.evaluate("__e2e.connectedPeers()").catch(() => -1);
    const peersB = await b.evaluate("__e2e.connectedPeers()").catch(() => -1);
    if (dropped === null && (peersA === 0 || peersB === 0)) dropped = Date.now();
    if (dropped !== null && peersA > 0 && peersB > 0) {
      back = Date.now();
      break;
    }
    await sleep(1000);
  }
  check("voice dropped when the Worker went away", dropped !== null);
  check(
    "both users rejoined voice on their own",
    back !== null,
    back ? `${Math.round((back - dropped) / 1000)} s after the drop` : "",
  );
  if (back) {
    await sleep(2000);
    const flowA = await audioFlowing(a);
    const flowB = await audioFlowing(b);
    check(
      "audio flows again after rejoining",
      flowA.receivedPerSec > 200 && flowB.receivedPerSec > 200,
      `${flowA.receivedPerSec} / ${flowB.receivedPerSec} B/s in`,
    );
  }
}

async function main() {
  await assertServerUp();
  const password = testPassword();
  const a = await launchBrowser("A", 9301);
  const b = await launchBrowser("B", 9302);
  try {
    await signIn(a, USERS[0], password);
    await signIn(b, USERS[1], password);
    check("both users signed in and connected", true);
    if (!reconnectMode) await microphonePreview(a);
    await joinBothToVoice(a, b);
    if (reconnectMode) await reconnectChecks(a, b);
    else await callChecks(a, b);
  } finally {
    a.close();
    b.close();
  }
  finish("voice checks");
}

main().catch((error) => {
  console.error(`✖ ${error.message}`);
  process.exitCode = 1;
});
