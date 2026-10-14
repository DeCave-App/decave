import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { createCameraAdvertWaiter } = await import("../../mobile/src/lib/voice-camera-advert.ts");

const voiceSource = fs.readFileSync(new URL("../../mobile/src/providers/VoiceProvider.tsx", import.meta.url), "utf8");

test("resolves after our own VOICE_STATE shows the camera, then settles", async () => {
  const waiter = createCameraAdvertWaiter();
  let done = null;
  const pending = waiter.wait("me", 1000, 20).then((value) => (done = value));
  waiter.observe([{ connectionId: "other", cameraSharing: true }]);
  waiter.observe([{ connectionId: "me", cameraSharing: false }]);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(done, null, "another participant's camera or our own flag off does not release the track");
  waiter.observe([{ connectionId: "me", cameraSharing: true }]);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(done, null, "the settle delay lets the other recipients' copies land first");
  assert.equal(await pending, true);
});

test("times out to false so the camera still starts when no state arrives", async () => {
  const waiter = createCameraAdvertWaiter();
  assert.equal(await waiter.wait("me", 10, 0), false);
  // A late state after the timeout is harmless.
  waiter.observe([{ connectionId: "me", cameraSharing: true }]);
});

test("a state seen before the wait began does not count", async () => {
  const waiter = createCameraAdvertWaiter();
  waiter.observe([{ connectionId: "me", cameraSharing: true }]);
  assert.equal(await waiter.wait("me", 15, 0), false);
});

test("mobile sends VOICE_CAMERA_STATE, waits for the advert, then attaches the camera", () => {
  const start = voiceSource.indexOf("const openAndShareCamera = async");
  assert.notEqual(start, -1);
  const body = voiceSource.slice(start, voiceSource.indexOf("const startScreenShare = async", start));
  const sent = body.indexOf('send({ type: "VOICE_CAMERA_STATE", cameraSharing: true })');
  const waited = body.indexOf("await waitForCameraAdvert();");
  const attached = body.indexOf("localCameraStreamRef.current = camera;");
  const queued = body.indexOf("await queueLocalTracksToPeer(session);");
  assert.ok(
    sent > 0 && waited > sent && attached > waited && queued > attached,
    "order: state, wait, attach, add tracks",
  );
  assert.match(voiceSource, /cameraAdvert\.observe\(next\);/, "every VOICE_STATE feeds the waiter");
});
