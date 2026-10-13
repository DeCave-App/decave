// Bot run-log reasons and Twitch clip posts: English stays exactly as before,
// and a code travels with it so the bot builder and forum show DeCave's
// wording in the viewer's language.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { D1Mock, MediaMock } from "../test-support/worker-sqlite-test-fixture.mjs";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { NAMESPACES } = await import("../../shared/i18n/namespaces.ts");
const { readBotRunNotice, parseBotRunNotice } = await import("../../shared/bots/run-notice.ts");
const { FORUM_POST_PREFIX } = await import("../../shared/forum.ts");
const { refusal, withAction } = await import("../../worker/bots/reasons.ts");
const { webhookUrlProblem, webhookUrlRefusal } = await import("../../worker/bots/webhook.ts");
const { clipForumPayload, clipChatText } = await import("../../worker/twitch/clips.ts");
const { ensureHubFeatureSchema } = await import("../../worker/lib/hub-schema.ts");
const store = await import("../../worker/bots/store.ts");
const runtime = await import("../../src/i18n/index.ts");
const { runNoticeText } = await import("../../src/features/bots/runText.ts");
const { displayForumPayload } = await import("../../src/features/forum/forumModel.ts");

const readLocale = (locale) =>
  Object.fromEntries(
    NAMESPACES.map((ns) => [
      ns,
      JSON.parse(fs.readFileSync(path.join(root, "shared/i18n/locales", locale, `${ns}.json`), "utf8")),
    ]),
  );
const english = readLocale("en");
// A stand-in translation, so the tests see the client switch languages.
const greek = {
  bots: {
    run: { server: { messageLimit: "Όριο μηνυμάτων", unknownAction: "Άγνωστη ενέργεια {{action}}" } },
    activity: { detail: "{{action}} → {{text}}" },
  },
  streamer: {
    server: { clipDefaultTitle: "Νέο κλιπ", clipForumBody: "🎬 Κλιπ από {{creator}}\n{{url}}" },
  },
};
runtime.setCatalogSource({ english, load: async () => greek });
await runtime.initI18n("en");

test("refusals keep the English reason and carry its code", () => {
  assert.deepEqual(refusal("bots.run.server.messageLimit"), {
    reason: "Message limit reached",
    notice: { code: "bots.run.server.messageLimit" },
  });
  assert.equal(refusal("bots.run.server.unknownAction", { action: "zap" }).reason, "Unknown action zap");
  assert.equal(
    refusal("bots.run.server.commandMissingOption", { option: "sides", usage: "/roll <sides>" }).reason,
    "Missing sides. Usage: /roll <sides>",
  );
  assert.equal(refusal("bots.run.server.wouldWait", { count: 1 }).reason, "Would wait 1 minutes");
  assert.equal(refusal("bots.run.server.timerDropped", { kind: "wait" }).reason, "Timer failed twice; wait dropped");
  assert.deepEqual(withAction(withAction({ code: "bots.run.server.messageLimit" }, "sendMessage"), "runRule"), {
    code: "bots.run.server.messageLimit",
    action: "runRule: sendMessage",
  });
  assert.equal(withAction(undefined, "sendMessage"), undefined);
});

test("webhook URL problems keep their English and gain a code", () => {
  assert.equal(webhookUrlProblem("http://example.com"), "Webhook URL must use https");
  assert.equal(webhookUrlProblem("https://localhost/x"), "Webhook host isn't allowed");
  assert.equal(webhookUrlProblem("https://example.com/x"), null);
  assert.deepEqual(webhookUrlRefusal("not a url")?.notice, { code: "bots.run.server.webhookUrlInvalid" });
});

test("run notices are read strictly", () => {
  assert.equal(readBotRunNotice({ code: "common.app.name" }), null);
  assert.deepEqual(readBotRunNotice({ code: "bots.run.server.messageLimit", action: "sendMessage" }), {
    code: "bots.run.server.messageLimit",
    action: "sendMessage",
  });
  assert.deepEqual(readBotRunNotice({ code: "bots.run.server.messageLimit", action: 5 }), {
    code: "bots.run.server.messageLimit",
  });
  assert.equal(parseBotRunNotice("{bad json"), null);
  assert.equal(parseBotRunNotice(null), null);
});

test("the run log stores and returns the notice next to the English detail", async () => {
  const db = new D1Mock();
  const env = { DB: db, MEDIA: new MediaMock() };
  await ensureHubFeatureSchema(env);
  const now = new Date().toISOString();
  db.exec(
    "INSERT INTO decave_users(id,username,password_salt,password_hash,created_at) VALUES('u1','owner','s','h',?)",
    now,
  );
  const hub = db.exec(
    "INSERT INTO decave_hubs(name,icon,owner_id,created_at,updated_at) VALUES('H','x','u1',?,?)",
    now,
    now,
  );
  const bot = await store.createBuilderBot(db, {
    hubId: Number(hub.lastInsertRowid),
    name: "B",
    description: "",
    createdBy: "u1",
  });
  await store.logRun(db, {
    botId: bot.id,
    ruleId: null,
    trigger: "message",
    status: "limited",
    detail: "sendMessage: Message limit reached",
    notice: { code: "bots.run.server.messageLimit", action: "sendMessage" },
  });
  await store.logRun(db, { botId: bot.id, ruleId: null, trigger: "message", status: "error", detail: "boom" });
  const runs = await store.listRuns(db, bot.id);
  assert.equal(runs.length, 2);
  const [plain, coded] = runs;
  assert.equal(plain.detail, "boom");
  assert.equal(plain.notice, null);
  assert.equal(coded.detail, "sendMessage: Message limit reached");
  assert.deepEqual(coded.notice, { code: "bots.run.server.messageLimit", action: "sendMessage" });
});

test("the bot builder shows run reasons in the UI language", async () => {
  const notice = { code: "bots.run.server.messageLimit", action: "sendMessage" };
  assert.equal(runNoticeText(notice, "sendMessage: Message limit reached"), "sendMessage: Message limit reached");
  assert.equal(runNoticeText(null, "Old English detail"), "Old English detail");
  assert.equal(runNoticeText({ code: "nope.server.x" }, "kept"), "kept");
  await runtime.initI18n("el");
  try {
    assert.equal(runNoticeText(notice, "sendMessage: Message limit reached"), "sendMessage → Όριο μηνυμάτων");
    assert.equal(
      runNoticeText({ code: "bots.run.server.unknownAction", params: { action: "zap" } }, "Unknown action zap"),
      "Άγνωστη ενέργεια zap",
    );
  } finally {
    await runtime.initI18n("en");
  }
});

test("clip forum posts keep their English and carry notices for the DeCave wording", () => {
  const titled = clipForumPayload({ title: "  Big   play ", creatorName: "kai", url: "https://clips.twitch.tv/x" });
  assert.equal(titled.title, "Big play");
  assert.equal(titled.body, "🎬 Clipped by kai\nhttps://clips.twitch.tv/x\n\nReact to vote for Clip of the week.");
  assert.deepEqual(titled.notice, {
    code: "streamer.server.clipForumBody",
    params: { creator: "kai", url: "https://clips.twitch.tv/x" },
  });
  assert.equal("titleNotice" in titled, false, "a clip's own title is never replaced");
  const untitled = clipForumPayload({ title: "", creatorName: "", url: "https://clips.twitch.tv/y" });
  assert.equal(untitled.title, "New clip");
  assert.equal(
    untitled.body,
    "🎬 Clipped by a viewer\nhttps://clips.twitch.tv/y\n\nReact to vote for Clip of the week.",
  );
  assert.deepEqual(untitled.titleNotice, { code: "streamer.server.clipDefaultTitle" });
  assert.equal(
    clipChatText({ title: "", creatorName: "kai", url: "https://clips.twitch.tv/z" }),
    "🎬 New clip\nClipped by kai\nhttps://clips.twitch.tv/z\nReact to vote for Clip of the week.",
  );
});

test("forum views translate a bot's clip post but never a member's", async () => {
  const payload = clipForumPayload({ title: "", creatorName: "kai", url: "https://clips.twitch.tv/x" });
  const text = `${FORUM_POST_PREFIX}${JSON.stringify(payload)}`;
  const fromBot = { text, bot: { id: "b1", name: "Twitch Clips" } };
  const fromMember = { text };
  await runtime.initI18n("el");
  try {
    const shown = displayForumPayload(fromBot);
    assert.equal(shown.title, "Νέο κλιπ");
    assert.equal(shown.body, "🎬 Κλιπ από kai\nhttps://clips.twitch.tv/x");
    const member = displayForumPayload(fromMember);
    assert.equal(member.title, "New clip");
    assert.equal(member.body, payload.body);
    const titled = clipForumPayload({ title: "Ace", creatorName: "kai", url: "https://clips.twitch.tv/x" });
    const titledShown = displayForumPayload({
      text: `${FORUM_POST_PREFIX}${JSON.stringify(titled)}`,
      bot: fromBot.bot,
    });
    assert.equal(titledShown.title, "Ace", "the clip's own title stays as written");
  } finally {
    await runtime.initI18n("en");
  }
  assert.equal(displayForumPayload(fromBot).title, "New clip");
});
