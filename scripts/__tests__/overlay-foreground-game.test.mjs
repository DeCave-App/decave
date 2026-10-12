import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { isGameForeground, watchForegroundGame } = require("../../electron/foreground-game.cjs");

test("the overlay counts only games as the foreground", () => {
  const games = new Set([4242]);
  assert.equal(isGameForeground({ pid: 4242, name: "cs2", fullscreen: false }, games), true, "detected Steam game");
  assert.equal(
    isGameForeground({ pid: 7, name: "TslGame", fullscreen: true }, games),
    true,
    "fullscreen game-like app",
  );
  for (const name of ["explorer", "DeCave", "chrome", "msedge", "firefox", "discord", "spotify", "vlc", "steam"])
    assert.equal(isGameForeground({ pid: 9, name, fullscreen: true }, games), false, `${name} is never a game`);
  assert.equal(isGameForeground({ pid: 9, name: "notepadpp", fullscreen: false }, games), false, "windowed non-game");
  assert.equal(isGameForeground({ pid: 9, name: "EpicGamesLauncher", fullscreen: true }, games), false);
  assert.equal(isGameForeground(null, games), false);
});

test("the watcher reports changes from the helper and stops it", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  let killed = false;
  child.kill = () => (killed = true);
  const seen = [];
  const stop = watchForegroundGame({
    platform: "win32",
    spawnProcess: () => child,
    listGameProcessIds: async () => new Set([4242]),
    onChange: (isGame) => seen.push(isGame),
  });
  await new Promise((resolve) => setImmediate(resolve));
  child.stdout.emit("data", '{"pid":11,"name":"explorer","fullscreen":true}\n');
  child.stdout.emit("data", '{"pid":4242,"name":"cs2","full');
  child.stdout.emit("data", 'screen":true}\n');
  child.stdout.emit("data", '{"pid":12,"name":"chrome","fullscreen":false}\n');
  assert.deepEqual(seen, [false, true, false]);
  stop();
  assert.equal(killed, true);
});
