import test from "node:test";
import assert from "node:assert/strict";
import { ScreenFrameKeyring, encryptFrame, decryptFrame } from "../../src/voice/screen-sfu/frame-crypto.ts";

const rnd = (n) => crypto.getRandomValues(new Uint8Array(n));
const ring = async (index = 0, key = rnd(16)) => {
  const r = new ScreenFrameKeyring();
  await r.setKey(index, key);
  return r;
};
const buf = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
const same = (a, b) => assert.deepEqual(new Uint8Array(a), new Uint8Array(b));

test("vp8 key frame round trip keeps first 10 bytes clear", async () => {
  const r = await ring();
  const input = rnd(200);
  const out = new Uint8Array(await encryptFrame(buf(input), { codec: "vp8", keyFrame: true }, r));
  assert.deepEqual(out.slice(0, 10), input.slice(0, 10));
  assert.notDeepEqual(out.slice(10, 40), input.slice(10, 40));
  const back = await decryptFrame(buf(out), { codec: "vp8", keyFrame: true }, r);
  same(back, input);
});

test("vp8 delta frame keeps 3 bytes clear", async () => {
  const r = await ring();
  const input = rnd(200);
  const out = new Uint8Array(await encryptFrame(buf(input), { codec: "vp8", keyFrame: false }, r));
  assert.deepEqual(out.slice(0, 3), input.slice(0, 3));
  assert.notDeepEqual(out.slice(3, 33), input.slice(3, 33));
  same(await decryptFrame(buf(out), { codec: "vp8", keyFrame: false }, r), input);
});

test("h264 keeps NAL headers clear", async () => {
  const r = await ring();
  const input = rnd(200);
  input.set([0, 0, 0, 1, 0x65], 0);
  const out = new Uint8Array(await encryptFrame(buf(input), { codec: "h264", keyFrame: true }, r));
  assert.deepEqual(out.slice(0, 5), input.slice(0, 5));
  same(await decryptFrame(buf(out), { codec: "h264", keyFrame: true }, r), input);
});

test("trailer is IV(12) + 0x0c + keyIndex", async () => {
  const r = await ring(3);
  const out = new Uint8Array(await encryptFrame(buf(rnd(50)), { codec: "vp9", keyFrame: true }, r));
  assert.equal(out.length, 50 + 16 + 12 + 2);
  assert.equal(out.at(-2), 12);
  assert.equal(out.at(-1), 3);
});

test("wrong key returns null", async () => {
  const a = await ring(0);
  const b = await ring(0);
  const out = await encryptFrame(buf(rnd(100)), { codec: "vp8", keyFrame: false }, a);
  assert.equal(await decryptFrame(out, { codec: "vp8", keyFrame: false }, b), null);
});

test("tampered byte returns null", async () => {
  const r = await ring();
  const out = new Uint8Array(await encryptFrame(buf(rnd(100)), { codec: "vp8", keyFrame: false }, r));
  out[20] ^= 1;
  assert.equal(await decryptFrame(buf(out), { codec: "vp8", keyFrame: false }, r), null);
  const out2 = new Uint8Array(await encryptFrame(buf(rnd(100)), { codec: "vp8", keyFrame: false }, r));
  out2[1] ^= 1; // clear header is authenticated too
  assert.equal(await decryptFrame(buf(out2), { codec: "vp8", keyFrame: false }, r), null);
});

test("unknown key index returns null", async () => {
  const a = await ring(0);
  const b = await ring(5);
  const out = await encryptFrame(buf(rnd(100)), { codec: "vp8", keyFrame: false }, a);
  assert.equal(await decryptFrame(out, { codec: "vp8", keyFrame: false }, b), null);
});

test("previous index still decrypts after rotation", async () => {
  const r = await ring(0);
  const input = rnd(100);
  const out = await encryptFrame(buf(input), { codec: "vp8", keyFrame: false }, r);
  await r.setKey(1, rnd(16));
  same(await decryptFrame(out, { codec: "vp8", keyFrame: false }, r), input);
  await r.setKey(2, rnd(16));
  assert.equal(r.currentIndex, 2);
  assert.equal(await decryptFrame(out, { codec: "vp8", keyFrame: false }, r), null);
});

test("too-short frame returns null", async () => {
  const r = await ring();
  assert.equal(await decryptFrame(new ArrayBuffer(5), { codec: "vp8", keyFrame: false }, r), null);
});
