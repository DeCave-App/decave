import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { NAMESPACES } = await import("../../shared/i18n/namespaces.ts");
const { SERVER_NOTICE_CODES, readServerNotice } = await import("../../shared/i18n/server-notices.ts");
const { noticeEnglish, serverNotice } = await import("../../worker/lib/notices.ts");
const { commandUsage } = await import("../../worker/bots/events.ts");
const { clipChatText } = await import("../../worker/twitch/clips.ts");
const runtime = await import("../../src/i18n/index.ts");
const { noticeText, serverMessage } = await import("../../src/i18n/notice.ts");

const readLocale = (locale) =>
  Object.fromEntries(
    NAMESPACES.map((ns) => [
      ns,
      JSON.parse(fs.readFileSync(path.join(root, "shared/i18n/locales", locale, `${ns}.json`), "utf8")),
    ]),
  );
const english = readLocale("en");
runtime.setCatalogSource({ english, load: async (locale) => readLocale(locale) });
await runtime.initI18n("en");

function lookup(code) {
  const [ns, ...rest] = code.split(".");
  let node = english[ns];
  for (const part of rest.slice(0, -1)) node = node?.[part];
  const leaf = rest.at(-1);
  if (typeof node?.[leaf] === "string") return node[leaf];
  if (typeof node?.[`${leaf}_other`] === "string" && typeof node?.[`${leaf}_one`] === "string")
    return node[`${leaf}_other`];
  return null;
}

function workerSources(dir = path.join(root, "worker"), files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) workerSources(full, files);
    else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) files.push(full);
  }
  return files;
}

test("every server notice code exists in the English catalogs", () => {
  assert.ok(SERVER_NOTICE_CODES.length > 0);
  assert.equal(new Set(SERVER_NOTICE_CODES).size, SERVER_NOTICE_CODES.length, "codes are unique");
  for (const code of SERVER_NOTICE_CODES) {
    assert.ok(lookup(code), `${code} is missing from shared/i18n/locales/en`);
  }
});

test("every notice code the Worker emits is registered", () => {
  const known = new Set(SERVER_NOTICE_CODES);
  const pattern = /["'`]((?:chat|dm|bots|streamer|hub|voice)\.(?:[A-Za-z]+\.)*server\.[A-Za-z]+)["'`]/g;
  const emitted = new Set();
  for (const file of workerSources()) {
    for (const match of fs.readFileSync(file, "utf8").matchAll(pattern)) emitted.add(match[1]);
  }
  assert.ok(emitted.size > 20, "the scan finds the Worker's notices");
  for (const code of emitted) assert.ok(known.has(code), `${code} is emitted but not in SERVER_NOTICE_CODES`);
});

test("the English sent with a notice is the text the server always sent", () => {
  assert.deepEqual(serverNotice("chat.server.roomReadOnly", { room: "rules" }), {
    message: "#rules is read-only.",
    notice: { code: "chat.server.roomReadOnly", params: { room: "rules" } },
  });
  assert.equal(
    noticeEnglish("chat.server.slowMode", { seconds: 10 }),
    "Slow mode is enabled. Wait 10 seconds between messages.",
  );
  assert.equal(noticeEnglish("chat.server.voiceRoomFull", { cap: 5 }), "This room is full (5/5).");
  assert.equal(noticeEnglish("dm.call.server.peerOffline"), "This friend is offline.");
  assert.equal(noticeEnglish("chat.server.forumTooManyTags", { max: 5 }), "Posts can have at most 5 tags.");
  assert.equal(
    commandUsage("roll", [
      { name: "sides", type: "number", required: true },
      { name: "note", type: "text", required: false },
    ]),
    "Usage: /roll <sides> [note]",
  );
  assert.equal(
    clipChatText({ title: "  Big   play ", creatorName: "kai", url: "https://clips.twitch.tv/x" }),
    "🎬 Big play\nClipped by kai\nhttps://clips.twitch.tv/x\nReact to vote for Clip of the week.",
  );
  assert.equal(
    clipChatText({ title: "", creatorName: "", url: "https://clips.twitch.tv/y" }),
    "🎬 New clip\nClipped by a viewer\nhttps://clips.twitch.tv/y\nReact to vote for Clip of the week.",
  );
  assert.equal(
    noticeEnglish("streamer.server.clipOfTheWeek", { count: 1, title: "Ace", link: "https://x" }),
    "🏆 Clip of the week (1 vote): Ace\nhttps://x",
  );
  assert.equal(
    noticeEnglish("streamer.server.clipOfTheWeek", { count: 3, title: "Ace", link: "https://x" }),
    "🏆 Clip of the week (3 votes): Ace\nhttps://x",
  );
  // Names are data: interpolation never re-reads them as markup.
  assert.equal(
    noticeEnglish("chat.server.roomReadOnly", { room: "{{room}} $t(chat.server.timedOut)" }),
    "#{{room}} $t(chat.server.timedOut) is read-only.",
  );
});

test("clients translate known notices and fall back to the English message", () => {
  const frame = { type: "ERROR", ...serverNotice("chat.server.roomReadOnly", { room: "news" }) };
  assert.equal(serverMessage(frame, "fallback"), "#news is read-only.");
  assert.equal(noticeText(frame.notice), "#news is read-only.");
  assert.equal(serverMessage({ message: "Old server text" }, "fallback"), "Old server text");
  assert.equal(serverMessage({ notice: { code: "chat.server.nope" }, message: "kept" }, "fallback"), "kept");
  assert.equal(serverMessage({ notice: { code: "common.app.name" }, message: "kept" }, "fallback"), "kept");
  assert.equal(serverMessage({}, "fallback"), "fallback");
  assert.equal(serverMessage(null, "fallback"), "fallback");
  assert.equal(readServerNotice({ code: "dm.call.server.blocked", params: [1] }), null);
  assert.deepEqual(readServerNotice({ code: "dm.call.server.blocked", params: { a: 1, b: {} } }), {
    code: "dm.call.server.blocked",
    params: { a: 1 },
  });
});
