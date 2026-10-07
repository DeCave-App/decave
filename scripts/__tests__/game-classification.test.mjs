import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { steamAppTypes, isGameProduct, isGameProcess } = createRequire(import.meta.url)(
  "../../electron/game-classification.cjs",
);

function fixture(version, type) {
  const indexed = version === 41;
  const strings = ["appinfo", "common", "type"];
  const key = (i) => (indexed ? Buffer.from([i, 0, 0, 0]) : Buffer.from(strings[i] + "\0"));
  const body = Buffer.concat([
    Buffer.from([0]),
    key(0),
    Buffer.from([0]),
    key(1),
    Buffer.from([1]),
    key(2),
    Buffer.from(type + "\0"),
    Buffer.from([8, 8, 8]),
  ]);
  const header = Buffer.alloc(indexed ? 16 : 8);
  header.writeUInt32LE(0x07564400 + version);
  const entry = Buffer.alloc(version === 39 ? 48 : 68);
  entry.writeUInt32LE(431960);
  entry.writeUInt32LE(entry.length - 8 + body.length, 4);
  const footer = Buffer.alloc(4);
  if (indexed) header.writeBigUInt64LE(BigInt(header.length + entry.length + body.length + 4), 8);
  const count = Buffer.alloc(4);
  count.writeUInt32LE(strings.length);
  return Buffer.concat([
    header,
    entry,
    body,
    footer,
    ...(indexed ? [count, Buffer.from(strings.join("\0") + "\0")] : []),
  ]);
}

test("reads game/application types from all supported Steam cache versions", () => {
  for (const version of [39, 40, 41]) {
    assert.equal(steamAppTypes(fixture(version, "Application")).get("431960"), "application");
    assert.equal(steamAppTypes(fixture(version, "Game")).get("431960"), "game");
  }
});
test("rejects software, unknown products and helper processes", () => {
  assert.equal(isGameProduct("steam", "431960", "Wallpaper Engine", "game"), false);
  assert.equal(isGameProduct("steam", "999", "An editor", "application"), false);
  assert.equal(isGameProduct("steam", "999", "Unknown"), false);
  assert.equal(isGameProduct("steam", "999", "A game", "game"), true);
  assert.equal(isGameProduct("steam", "578080", "PUBG"), true);
  assert.equal(isGameProduct("epic", "999", "Unreal Engine", "game"), false);
  assert.equal(isGameProduct("epic", "999", "Fortnite"), true);
  for (const name of ["wallpaper64.exe", "CrashReportClient.exe", "ExecPubg.exe", "EasyAntiCheat.exe", "Launcher.exe"])
    assert.equal(isGameProcess(name), false);
  assert.equal(isGameProcess("TslGame.exe"), true);
});
test("malformed or unsupported caches fail closed", () => {
  assert.equal(steamAppTypes(Buffer.alloc(2)).size, 0);
  assert.equal(steamAppTypes(Buffer.alloc(100)).size, 0);
  assert.equal(steamAppTypes(fixture(41, "Game").subarray(0, 80)).size, 0);
});
