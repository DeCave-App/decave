import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { flipCameraTrack, mirrorForFacing, trackFacing } = await import("../../mobile/src/lib/camera-facing.ts");

function fakeTrack(settings) {
  const applied = [];
  return {
    applied,
    getSettings: () => ({ ...settings }),
    applyConstraints: async (constraints) => {
      applied.push(constraints);
      settings = { ...settings, facingMode: constraints.facingMode };
    },
  };
}

test("flips front to back and back to front, keeping the capture size", async () => {
  const track = fakeTrack({ deviceId: "front-cam", facingMode: "user", width: 1280, height: 720, frameRate: 30 });
  assert.equal(await flipCameraTrack(track), "environment");
  assert.deepEqual(track.applied[0], { width: 1280, height: 720, frameRate: 30, facingMode: "environment" });
  assert.equal("deviceId" in track.applied[0], false, "a pinned deviceId would keep the old camera");
  assert.equal(await flipCameraTrack(track), "user");
});

test("a track without facing info counts as the front camera", () => {
  assert.equal(trackFacing(fakeTrack({})), "user");
  assert.equal(trackFacing(null), "user");
  assert.equal(
    trackFacing({
      getSettings: () => {
        throw new Error("released");
      },
    }),
    "user",
  );
});

test("only the front camera is mirrored", () => {
  assert.equal(mirrorForFacing("user"), true);
  assert.equal(mirrorForFacing("environment"), false);
});

test("voice room and DM call self views mirror by facing and offer a camera switch", () => {
  const room = fs.readFileSync(new URL("../../mobile/app/voice/[id].tsx", import.meta.url), "utf8");
  const call = fs.readFileSync(new URL("../../mobile/src/providers/DirectCallProvider.tsx", import.meta.url), "utf8");
  for (const source of [room, call]) {
    assert.match(source, /mirror=\{mirrorForFacing\(cameraFacing\)\}/);
    assert.match(source, /flipCamera\(\)/);
    assert.match(source, /dm\.mobile\.call\.switchCamera/);
  }
});
