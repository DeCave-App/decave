import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { createRealtimeClient, screenSfuEnabled, RealtimeSfuError } = await import("../../worker/lib/realtime-sfu.ts");

const TOKEN = "secret-token-value";
const env = {
  CLOUDFLARE_REALTIME_APP_ID: "app123",
  CLOUDFLARE_REALTIME_APP_TOKEN: TOKEN,
  SCREEN_SFU_ENABLED: "true",
};
const BASE = "https://rtc.live.cloudflare.com/v1/apps/app123";

function fake(responder) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    const r = responder(calls.at(-1));
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  };
  return { calls, client: createRealtimeClient(env, fetchImpl) };
}

test("screenSfuEnabled needs flag and both secrets", () => {
  assert.equal(screenSfuEnabled(env), true);
  assert.equal(screenSfuEnabled({ ...env, SCREEN_SFU_ENABLED: "false" }), false);
  assert.equal(screenSfuEnabled({ ...env, SCREEN_SFU_ENABLED: undefined }), false);
  assert.equal(screenSfuEnabled({ ...env, CLOUDFLARE_REALTIME_APP_ID: "" }), false);
  assert.equal(screenSfuEnabled({ ...env, CLOUDFLARE_REALTIME_APP_TOKEN: undefined }), false);
});

test("newSession", async () => {
  const { calls, client } = fake(() => ({ body: { sessionId: "s1" } }));
  assert.deepEqual(await client.newSession(), { sessionId: "s1" });
  assert.equal(calls[0].url, `${BASE}/sessions/new`);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers.Authorization, `Bearer ${TOKEN}`);
});

test("pushTrack", async () => {
  const { calls, client } = fake(() => ({
    body: { sessionDescription: { type: "answer", sdp: "A" }, tracks: [{ trackName: "t", mid: "0" }] },
  }));
  const r = await client.pushTrack("s1", { type: "offer", sdp: "O" }, "0", "t");
  assert.deepEqual(r, { answer: { type: "answer", sdp: "A" } });
  assert.equal(calls[0].url, `${BASE}/sessions/s1/tracks/new`);
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].body, {
    sessionDescription: { type: "offer", sdp: "O" },
    tracks: [{ location: "local", mid: "0", trackName: "t" }],
  });
});

test("pullTrack", async () => {
  const { calls, client } = fake(() => ({
    body: {
      requiresImmediateRenegotiation: true,
      tracks: [{ trackName: "t", mid: "3" }],
      sessionDescription: { type: "offer", sdp: "X" },
    },
  }));
  const r = await client.pullTrack("s2", { sessionId: "s1", trackName: "t" }, "f");
  assert.deepEqual(r, { offer: { type: "offer", sdp: "X" }, mid: "3", requiresImmediateRenegotiation: true });
  assert.equal(calls[0].url, `${BASE}/sessions/s2/tracks/new`);
  assert.deepEqual(calls[0].body, {
    tracks: [
      {
        location: "remote",
        sessionId: "s1",
        trackName: "t",
        simulcast: { preferredRid: "f", priorityOrdering: "asciibetical", ridNotAvailable: "asciibetical" },
      },
    ],
  });
});

test("pullTrack without offer yields null", async () => {
  const { client } = fake(() => ({
    body: { requiresImmediateRenegotiation: false, tracks: [{ trackName: "t", mid: "3" }] },
  }));
  const r = await client.pullTrack("s2", { sessionId: "s1", trackName: "t" }, "p");
  assert.equal(r.offer, null);
});

test("setLayer, renegotiate, closeTracks", async () => {
  const { calls, client } = fake(() => ({ body: { tracks: [{ trackName: "t", mid: "3" }] } }));
  await client.setLayer("s2", "3", { sessionId: "s1", trackName: "t" }, "p");
  await client.renegotiate("s2", { type: "answer", sdp: "A" });
  await client.closeTracks("s2", ["3", "4"]);
  assert.equal(calls[0].url, `${BASE}/sessions/s2/tracks/update`);
  assert.equal(calls[0].method, "PUT");
  assert.deepEqual(calls[0].body, {
    tracks: [{ location: "remote", sessionId: "s1", trackName: "t", mid: "3", simulcast: { preferredRid: "p" } }],
  });
  assert.equal(calls[1].url, `${BASE}/sessions/s2/renegotiate`);
  assert.equal(calls[1].method, "PUT");
  assert.deepEqual(calls[1].body, { sessionDescription: { type: "answer", sdp: "A" } });
  assert.equal(calls[2].url, `${BASE}/sessions/s2/tracks/close`);
  assert.equal(calls[2].method, "PUT");
  assert.deepEqual(calls[2].body, { tracks: [{ mid: "3" }, { mid: "4" }], force: true });
});

test("per-track errorCode throws RealtimeSfuError without token", async () => {
  const { client } = fake(() => ({
    body: { tracks: [{ trackName: "t", errorCode: "boom", errorDescription: "bad" }] },
  }));
  await assert.rejects(
    () => client.pushTrack("s1", { type: "offer", sdp: "O" }, "0", "t"),
    (e) => e instanceof RealtimeSfuError && e.code === "boom" && !e.message.includes(TOKEN),
  );
});

test("top-level error and non-2xx throw", async () => {
  const a = fake(() => ({ body: { errorCode: "nope", errorDescription: "x" } }));
  await assert.rejects(
    () => a.client.newSession(),
    (e) => e instanceof RealtimeSfuError && e.code === "nope",
  );
  const b = fake(() => ({ status: 500, body: { detail: TOKEN } }));
  await assert.rejects(
    () => b.client.newSession(),
    (e) => e instanceof RealtimeSfuError && !e.message.includes(TOKEN),
  );
});

test("a hung Cloudflare request times out as RealtimeSfuError timeout", async () => {
  const env = { CLOUDFLARE_REALTIME_APP_ID: "app", CLOUDFLARE_REALTIME_APP_TOKEN: "tok" };
  const hang = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason));
    });
  const client = createRealtimeClient(env, hang, 20);
  await assert.rejects(client.newSession(), (e) => e instanceof RealtimeSfuError && e.code === "timeout");
});
