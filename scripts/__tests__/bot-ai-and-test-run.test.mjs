import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { test, after } from "node:test";
import { D1Mock, MediaMock } from "../test-support/worker-sqlite-test-fixture.mjs";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { handleApi } = await import("../../worker/index.ts");
const { tokenHash } = await import("../../worker/db.ts");
const { CATALOGUE } = await import("../../shared/bots/catalogue.ts");

const db = new D1Mock();
const env = {
  DB: db,
  MEDIA: new MediaMock(),
  ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  RECOVERY_RATE_LIMITER: { limit: async () => ({ success: true }) },
  HUB_ROOM: { idFromName: () => "global", get: () => ({ fetch: async () => Response.json({ success: true }) }) },
  BOTS_BUILDER_ENABLED: "true",
  ANTHROPIC_API_KEY: "test-key",
};
const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
  db.sqlite.close();
});

const now = new Date().toISOString();
for (const id of ["owner", "secretmember"]) {
  db.exec(
    "INSERT INTO decave_users(id,username,password_salt,password_hash,created_at) VALUES(?,?,'s','h',?)",
    id,
    `${id}-name`,
    now,
  );
  db.exec(
    "INSERT INTO decave_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
    tokenHash(`tok-${id}`),
    id,
    new Date(Date.now() + 3600_000).toISOString(),
    now,
  );
}
const hub = Number(
  db.exec("INSERT INTO decave_hubs(name,icon,owner_id,created_at,updated_at) VALUES('Hub','x','owner',?,?)", now, now)
    .lastInsertRowid,
);
db.exec("INSERT INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(?,?,'owner',?)", hub, "owner", now);
db.exec(
  "INSERT INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(?,?,'member',?)",
  hub,
  "secretmember",
  now,
);
const room = (name, type, kind) =>
  Number(
    db.exec(
      "INSERT INTO decave_rooms(hub_id,name,type,kind,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      hub,
      name,
      type,
      kind,
      now,
      now,
    ).lastInsertRowid,
  );
const general = room("general", "text", "chat");
const forum = room("ideas", "text", "forum");
const lounge = room("lounge", "voice", "chat");
db.exec(
  "INSERT INTO decave_custom_roles(id,hub_id,name,permissions_json,created_at) VALUES('role-vip',?,'VIP','[]',?)",
  hub,
  now,
);
db.exec(
  "INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at) VALUES('m1',?,?,'secretmember','very private words',?)",
  general,
  hub,
  now,
);

function call(p, { method = "GET", body, as = "owner" } = {}) {
  const h = new Headers({ authorization: `Bearer tok-${as}` });
  if (body !== undefined) h.set("content-type", "application/json");
  return handleApi(
    new Request(`https://test.invalid${p}`, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
}
const base = `/api/servers/${hub}/bot-builder`;
const goodRule = {
  v: 1,
  trigger: { type: "memberJoin" },
  scope: { channels: ["*"], roles: [] },
  cooldown: { perUser: 0, perChannel: 0 },
  then: [{ type: "sendMessage", channel: String(general), text: "Welcome {user.mention}" }],
};
const toolReply = (input) =>
  Response.json({
    id: "msg_1",
    type: "message",
    role: "assistant",
    stop_reason: "tool_use",
    content: [{ type: "tool_use", id: "tu_1", name: "build_rules", input }],
  });
let calls = [];
function mockProvider(responder) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    return responder();
  };
}
const usage = () =>
  db.sqlite.prepare("SELECT COALESCE(SUM(count),0) AS n FROM decave_bot_ai_usage WHERE hub_id=?").get(hub).n;
const messageCount = () => db.sqlite.prepare("SELECT COUNT(*) AS n FROM decave_messages").get().n;

test("every trigger, condition and action type has a catalogue entry", () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, "..", "..", "shared", "bots", "types.ts"), "utf8");
  const typesOf = (name) => {
    const start = source.indexOf(`export type ${name} =`);
    assert.notEqual(start, -1, `missing ${name} declaration`);
    const nextDeclaration = source.indexOf("\nexport type ", start + 1);
    const end = nextDeclaration === -1 ? source.length : nextDeclaration;
    return [...source.slice(start, end).matchAll(/type: "(\w+)"/g)].map((m) => m[1]);
  };
  for (const [union, entries] of [
    ["BotTrigger", CATALOGUE.triggers],
    ["BotCondition", CATALOGUE.conditions],
    ["BotAction", CATALOGUE.actions],
  ]) {
    const types = typesOf(union);
    assert.ok(types.length > 5, union);
    assert.deepEqual(Object.keys(entries).sort(), [...new Set(types)].sort(), union);
    for (const entry of Object.values(entries)) {
      assert.ok(entry.label);
      for (const f of entry.fields) assert.ok(f.key && f.label && f.kind && typeof f.required === "boolean");
    }
  }
});

test("generate sends only the description, catalogue, room and role names; returns validated rules unsaved", async () => {
  mockProvider(() => toolReply({ rules: [goodRule], unsupported: ["play music"] }));
  const rulesBefore = db.sqlite.prepare("SELECT COUNT(*) AS n FROM decave_bot_rules").get().n;
  const res = await call(`${base}/generate`, {
    method: "POST",
    body: { description: "  Welcome new members in general and play music  " },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.rules, [goodRule]);
  assert.deepEqual(body.unsupported, ["play music"]);
  assert.equal(body.remainingToday, 4);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM decave_bot_rules").get().n, rulesBefore);

  assert.equal(calls.length, 1);
  const [{ url, init, body: sent }] = calls;
  assert.equal(url, "https://api.anthropic.com/v1/messages");
  assert.equal(init.method, "POST");
  const headers = new Headers(init.headers);
  assert.equal(headers.get("x-api-key"), "test-key");
  assert.equal(headers.get("anthropic-version"), "2023-06-01");
  assert.equal(headers.get("content-type"), "application/json");
  assert.ok(init.signal);
  assert.deepEqual(Object.keys(sent).sort(), ["max_tokens", "messages", "model", "system", "tool_choice", "tools"]);
  assert.equal(sent.model, "claude-sonnet-5-5");
  assert.equal(sent.max_tokens, 4000);
  assert.deepEqual(sent.tool_choice, { type: "tool", name: "build_rules" });
  assert.equal(sent.tools.length, 1);
  assert.equal(sent.tools[0].name, "build_rules");
  assert.ok(
    sent.tools[0].input_schema.properties.rules.items.properties.trigger.properties.type.enum.includes("command"),
  );
  assert.match(sent.system, /unsupported/);
  assert.equal(sent.messages.length, 1);
  const payload = JSON.parse(sent.messages[0].content);
  assert.deepEqual(Object.keys(payload).sort(), ["channels", "description", "roles", "voiceRooms"]);
  assert.equal(payload.description, "Welcome new members in general and play music");
  assert.deepEqual(payload.channels, [
    { id: String(general), name: "general" },
    { id: String(forum), name: "ideas" },
  ]);
  assert.deepEqual(payload.voiceRooms, [{ id: String(lounge), name: "lounge" }]);
  assert.deepEqual(payload.roles, [{ id: "role-vip", name: "VIP" }]);
  const wire = init.body;
  // Bare substrings: no username, member id or message text anywhere in the request.
  for (const secret of ["secretmember", "owner-name", "very private words", "very private"])
    assert.ok(!wire.includes(secret), secret);
});

test("edits send the existing rule; an invalid model reply is 422 and still counted", async () => {
  const bot = await (await call(base, { method: "POST", body: { name: "Helper" } })).json();
  const saved = await (await call(`${base}/${bot.id}/rules/new`, { method: "PUT", body: goodRule })).json();
  mockProvider(() =>
    toolReply({
      rules: [{ ...goodRule, then: [{ type: "sendMessage", channel: "999999", text: "x" }] }],
      unsupported: [],
    }),
  );
  const before = usage();
  const res = await call(`${base}/generate`, {
    method: "POST",
    body: { description: "change it", ruleId: saved.ruleId },
  });
  assert.equal(res.status, 422);
  assert.equal((await res.json()).error, "Couldn't build that, try rephrasing");
  assert.equal(usage(), before + 1);
  const payload = JSON.parse(calls[0].body.messages[0].content);
  assert.deepEqual(Object.keys(payload).sort(), ["channels", "description", "existingRule", "roles", "voiceRooms"]);
  assert.deepEqual(payload.existingRule, goodRule);
});

test("a provider error is counted; the 6th call of the day is 429 without calling the provider", async () => {
  mockProvider(() => new Response("overloaded", { status: 529 }));
  const res = await call(`${base}/generate`, { method: "POST", body: { description: "anything" } });
  assert.equal(res.status, 502);
  assert.equal(usage(), 3);
  mockProvider(() => toolReply({ rules: [goodRule], unsupported: [] }));
  for (let i = 0; i < 2; i++)
    assert.equal((await call(`${base}/generate`, { method: "POST", body: { description: "again" } })).status, 200);
  assert.equal(usage(), 5);
  calls = [];
  const sixth = await call(`${base}/generate`, { method: "POST", body: { description: "one more" } });
  assert.equal(sixth.status, 429);
  assert.equal(calls.length, 0);
  assert.equal((await (await call(base)).json()).aiRemainingToday, 0);
});

test("validation: empty or long descriptions are refused before any call", async () => {
  db.exec("DELETE FROM decave_bot_ai_usage");
  mockProvider(() => toolReply({ rules: [goodRule], unsupported: [] }));
  assert.equal((await call(`${base}/generate`, { method: "POST", body: { description: "  " } })).status, 400);
  assert.equal(
    (await call(`${base}/generate`, { method: "POST", body: { description: "x".repeat(1001) } })).status,
    400,
  );
  assert.equal(calls.length, 0);
  assert.equal(
    (await call(`${base}/generate`, { method: "POST", body: { description: "hi" }, as: "secretmember" })).status,
    403,
  );
});

test("no API key: aiAvailable false and generate 404; flag off 404", async () => {
  delete env.ANTHROPIC_API_KEY;
  const list = await (await call(base)).json();
  assert.equal(list.aiAvailable, false);
  assert.equal((await call(`${base}/generate`, { method: "POST", body: { description: "hi" } })).status, 404);
  env.ANTHROPIC_API_KEY = "test-key";
  env.BOTS_BUILDER_ENABLED = "false";
  assert.equal((await call(`${base}/generate`, { method: "POST", body: { description: "hi" } })).status, 404);
  env.BOTS_BUILDER_ENABLED = "true";
});

test("test run uses the draft rule, returns steps and posts nothing", async () => {
  const bot = await (await call(base, { method: "POST", body: { name: "Tester" } })).json();
  await call(`${base}/${bot.id}`, { method: "PATCH", body: { capabilities: ["send_messages"] } });
  const { ruleId } = await (await call(`${base}/${bot.id}/rules/new`, { method: "PUT", body: goodRule })).json();
  const before = messageCount();
  const res = await call(`${base}/${bot.id}/test`, {
    method: "POST",
    body: { ruleId, event: { kind: "memberJoin", data: {}, actorId: "owner" } },
  });
  assert.equal(res.status, 200);
  const { steps } = await res.json();
  assert.equal(steps.length, 1);
  assert.equal(steps[0].ruleId, ruleId);
  assert.equal(steps[0].action, "sendMessage");
  assert.match(steps[0].description, /Welcome/);
  assert.equal(messageCount(), before);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM decave_bot_runs").get().n, 0);

  const wrong = await call(`${base}/${bot.id}/test`, {
    method: "POST",
    body: { ruleId: "nope", event: { kind: "memberJoin", data: {} } },
  });
  assert.equal(wrong.status, 404);
  const badKind = await call(`${base}/${bot.id}/test`, {
    method: "POST",
    body: { ruleId, event: { kind: "dm", data: {} } },
  });
  assert.equal(badKind.status, 400);
});

test("an empty rule list with unsupported notes is a 200 answer", async () => {
  db.exec("DELETE FROM decave_bot_ai_usage");
  mockProvider(() => toolReply({ rules: [], unsupported: ["play music in voice"] }));
  const res = await call(`${base}/generate`, { method: "POST", body: { description: "play music" } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { rules: [], unsupported: ["play music in voice"], remainingToday: 4 });
  mockProvider(() => toolReply({ rules: [], unsupported: [] }));
  assert.equal((await call(`${base}/generate`, { method: "POST", body: { description: "x" } })).status, 422);
});

test("two concurrent requests at 4 used: exactly one reaches the provider", async () => {
  db.exec("DELETE FROM decave_bot_ai_usage");
  db.exec(
    "INSERT INTO decave_bot_ai_usage(hub_id,day,count) VALUES(?,?,4)",
    hub,
    new Date().toISOString().slice(0, 10),
  );
  mockProvider(() => toolReply({ rules: [goodRule], unsupported: [] }));
  const statuses = (
    await Promise.all([
      call(`${base}/generate`, { method: "POST", body: { description: "a" } }),
      call(`${base}/generate`, { method: "POST", body: { description: "b" } }),
    ])
  )
    .map((r) => r.status)
    .sort();
  assert.deepEqual(statuses, [200, 429]);
  assert.equal(calls.length, 1);
  assert.equal(usage(), 5);
});
