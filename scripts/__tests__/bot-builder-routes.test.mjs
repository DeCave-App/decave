import assert from "node:assert/strict";
import { register } from "node:module";
import { test, after } from "node:test";
import { D1Mock, MediaMock } from "../test-support/worker-sqlite-test-fixture.mjs";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { handleApi } = await import("../../worker/index.ts");
const { tokenHash } = await import("../../worker/db.ts");
const { TEMPLATES, BUILT_IN_COMMANDS } = await import("../../shared/bots/templates.ts");
const { validateRule } = await import("../../shared/bots/schema.ts");

const db = new D1Mock();
const env = {
  DB: db,
  MEDIA: new MediaMock(),
  ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  RECOVERY_RATE_LIMITER: { limit: async () => ({ success: true }) },
  HUB_ROOM: { idFromName: () => "global", get: () => ({ fetch: async () => Response.json({ success: true }) }) },
  BOTS_BUILDER_ENABLED: "true",
};
after(() => db.sqlite.close());

const now = new Date().toISOString();
for (const id of ["owner", "mod", "plain"]) {
  db.exec(
    "INSERT INTO decave_users(id,username,password_salt,password_hash,created_at) VALUES(?,?,'s','h',?)",
    id,
    id,
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
function makeHub(name) {
  const hub = Number(
    db.exec(
      "INSERT INTO decave_hubs(name,icon,owner_id,created_at,updated_at) VALUES(?,'x','owner',?,?)",
      name,
      now,
      now,
    ).lastInsertRowid,
  );
  db.exec("INSERT INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(?,?,'owner',?)", hub, "owner", now);
  return hub;
}
const addRoom = (hub, name, kind = "chat") =>
  Number(
    db.exec(
      "INSERT INTO decave_rooms(hub_id,name,type,kind,created_at,updated_at) VALUES(?,?,'text',?,?,?)",
      hub,
      name,
      kind,
      now,
      now,
    ).lastInsertRowid,
  );
const addRole = (hub, id, name, perms = []) =>
  db.exec(
    "INSERT INTO decave_custom_roles(id,hub_id,name,permissions_json,created_at) VALUES(?,?,?,?,?)",
    id,
    hub,
    name,
    JSON.stringify(perms),
    now,
  );

const hubA = makeHub("A");
const general = addRoom(hubA, "general");
const forum = addRoom(hubA, "ideas", "forum");
addRole(hubA, "role-vip", "VIP");
addRole(hubA, "role-rooms", "Room crew", ["manageRooms"]);
db.exec("INSERT INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(?,?,'member',?)", hubA, "mod", now);
db.exec("INSERT INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(?,?,'member',?)", hubA, "plain", now);

function call(path, { method = "GET", body, as = "owner", raw } = {}) {
  const h = new Headers();
  if (as) h.set("authorization", `Bearer tok-${as}`);
  if (body !== undefined || raw !== undefined) h.set("content-type", "application/json");
  return handleApi(
    new Request(`https://test.invalid${path}`, {
      method,
      headers: h,
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    }),
    env,
  );
}
const base = (hub) => `/api/servers/${hub}/bot-builder`;
const rule = (over = {}) => ({
  v: 1,
  trigger: { type: "memberJoin" },
  scope: { channels: ["*"], roles: [] },
  cooldown: { perUser: 0, perChannel: 0 },
  then: [{ type: "sendMessage", channel: String(general), text: "Hi {user}" }],
  ...over,
});
async function newBot(hub = hubA, extra = {}) {
  const res = await call(base(hub), { method: "POST", body: { name: "Helper", description: "d", ...extra } });
  assert.equal(res.status, 201);
  return res.json();
}
const botIn = async (hub, id) => (await (await call(base(hub))).json()).bots.find((b) => b.id === id);

test("feature flag off returns 404", async () => {
  env.BOTS_BUILDER_ENABLED = "false";
  const res = await call(base(hubA));
  env.BOTS_BUILDER_ENABLED = "true";
  assert.equal(res.status, 404);
});

test("members without Manage Bots get 403; a manageRooms role gets 200", async () => {
  assert.equal((await call(base(hubA), { as: "plain" })).status, 403);
  assert.equal((await call(base(hubA), { as: "mod" })).status, 403);
  db.exec("INSERT INTO decave_member_roles(hub_id,user_id,role_id) VALUES(?,?,'role-rooms')", hubA, "mod");
  const res = await call(base(hubA), { as: "mod" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store, private");
  const body = await res.json();
  assert.equal(body.aiAvailable, false);
  assert.equal(body.aiRemainingToday, 0);
  // "Twitch live alerts" is offered only on Hubs with DeCave's custom Twitch features.
  assert.deepEqual(
    body.templates.map((t) => t.id),
    TEMPLATES.map((t) => t.id).filter((id) => id !== "liveAlerts"),
  );
  db.exec("DELETE FROM decave_member_roles WHERE user_id='mod'");
});

test("a bot form can only be submitted once under concurrent requests", async () => {
  const formId = "concurrent-form";
  db.exec(
    `INSERT INTO decave_bot_pending_forms(hub_id,room_id,user_id,form_id,title,fields_json,expires_at)
     VALUES(?,?,?,?,?,?,?)`,
    hubA,
    general,
    "owner",
    formId,
    "One answer",
    JSON.stringify([{ id: "answer", label: "Answer", style: "short", required: true }]),
    Date.now() + 60_000,
  );

  const originalPrepare = db.prepare;
  const selectSql =
    "SELECT fields_json,expires_at FROM decave_bot_pending_forms WHERE hub_id=? AND room_id=? AND user_id=? AND form_id=?";
  let selected = 0;
  let releaseBoth;
  const bothReadTheForm = new Promise((resolve) => {
    releaseBoth = resolve;
  });
  db.prepare = function (sql) {
    const statement = originalPrepare.call(this, sql);
    if (sql !== selectSql) return statement;
    let bound;
    return {
      bind(...values) {
        bound = statement.bind(...values);
        return this;
      },
      async first() {
        const result = await bound.first();
        selected += 1;
        if (selected === 2) releaseBoth();
        await bothReadTheForm;
        return result;
      },
    };
  };
  try {
    const submit = () =>
      call(`/api/rooms/${general}/bot-forms/${formId}`, {
        method: "POST",
        body: { fields: { answer: "sent once" } },
      });
    const responses = await Promise.all([submit(), submit()]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 404]);
    assert.equal(db.scalar("SELECT COUNT(*) FROM decave_bot_pending_forms WHERE form_id=?", formId), 0);
  } finally {
    db.prepare = originalPrepare;
  }
});

test("create, list, patch and delete a bot with audit entries", async () => {
  const bot = await newBot();
  assert.equal(bot.kind, "builder");
  assert.equal(bot.hasUnpublishedChanges, false);
  assert.ok(await botIn(hubA, bot.id));
  const patched = await call(`${base(hubA)}/${bot.id}`, {
    method: "PATCH",
    body: { name: "Renamed", color: "#112233", avatarEmoji: "🤖", enabled: false, allowedRoomIds: [general] },
  });
  assert.equal(patched.status, 200);
  const updated = await patched.json();
  assert.equal(updated.name, "Renamed");
  assert.equal(updated.enabled, false);
  assert.deepEqual(updated.allowedRoomIds, [general]);
  const bad = await call(`${base(hubA)}/${bot.id}`, { method: "PATCH", body: { color: "red" } });
  assert.equal(bad.status, 400);
  assert.equal((await call(`${base(hubA)}/${bot.id}`, { method: "DELETE" })).status, 200);
  assert.equal((await call(`${base(hubA)}/${bot.id}`, { method: "DELETE" })).status, 404);
  const actions = db.sqlite
    .prepare("SELECT action FROM decave_audit WHERE hub_id=? ORDER BY rowid")
    .all(hubA)
    .map((r) => r.action);
  assert.deepEqual(actions.slice(-3), ["bot.create", "bot.update", "bot.delete"]);
});

test("invalid rule is rejected with a path; valid rule is saved as a draft", async () => {
  const bot = await newBot();
  const bad = await call(`${base(hubA)}/${bot.id}/rules/new`, {
    method: "PUT",
    body: rule({ then: [{ type: "sendMessage", channel: "99999", text: "x" }] }),
  });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).errors[0].path, "then[0].channel");
  const ok = await call(`${base(hubA)}/${bot.id}/rules/new`, { method: "PUT", body: rule() });
  assert.equal(ok.status, 200);
  const { ruleId } = await ok.json();
  const edit = await call(`${base(hubA)}/${bot.id}/rules/${ruleId}`, {
    method: "PUT",
    body: rule({ cooldown: { perUser: 5, perChannel: 0 } }),
  });
  assert.equal(edit.status, 200);
  const listed = await botIn(hubA, bot.id);
  assert.equal(listed.hasUnpublishedChanges, true);
  assert.equal(listed.rules[0].draft.cooldown.perUser, 5);
  assert.equal(listed.rules[0].published, null);
  const second = await (await call(`${base(hubA)}/${bot.id}/rules/new`, { method: "PUT", body: rule() })).json();
  const order = await call(`${base(hubA)}/${bot.id}/rules/order`, {
    method: "POST",
    body: { ruleIds: [second.ruleId, ruleId] },
  });
  assert.equal(order.status, 200);
  const reordered = await botIn(hubA, bot.id);
  assert.deepEqual(
    reordered.rules.map((r) => r.id),
    [second.ruleId, ruleId],
  );
  assert.equal((await call(`${base(hubA)}/${bot.id}/rules/${ruleId}`, { method: "DELETE" })).status, 200);
});

test("publish revalidates drafts: a deleted channel names the rule", async () => {
  const bot = await newBot();
  const doomed = addRoom(hubA, "doomed");
  const { ruleId } = await (
    await call(`${base(hubA)}/${bot.id}/rules/new`, {
      method: "PUT",
      body: rule({ then: [{ type: "sendMessage", channel: String(doomed), text: "x" }] }),
    })
  ).json();
  db.exec("DELETE FROM decave_rooms WHERE id=?", doomed);
  const res = await call(`${base(hubA)}/${bot.id}/publish`, { method: "POST" });
  assert.equal(res.status, 400);
  const { errors } = await res.json();
  assert.equal(errors[0].ruleId, ruleId);
  assert.equal(errors[0].path, "then[0].channel");
  await call(`${base(hubA)}/${bot.id}/rules/${ruleId}`, { method: "PUT", body: rule() });
  assert.equal((await call(`${base(hubA)}/${bot.id}/publish`, { method: "POST" })).status, 200);
  assert.equal((await botIn(hubA, bot.id)).hasUnpublishedChanges, false);
  const runs = await call(`${base(hubA)}/${bot.id}/runs?errors=1`);
  assert.equal(runs.status, 200);
  assert.deepEqual((await runs.json()).runs, []);
});

test("export swaps ids for names and import into another hub round-trips", async () => {
  const bot = await newBot();
  const source = rule({
    scope: { channels: [String(general)], roles: ["role-vip"] },
    when: { all: [{ type: "hasRole", roleId: "role-vip" }] },
    then: [
      { type: "sendMessage", channel: String(forum), text: "hello" },
      { type: "addRole", roleId: "role-vip" },
    ],
  });
  await call(`${base(hubA)}/${bot.id}/rules/new`, { method: "PUT", body: source });
  const exp = await (await call(`${base(hubA)}/${bot.id}/export`)).json();
  assert.equal(exp.rules[0].scope.channels[0], "#general");
  assert.equal(exp.rules[0].scope.roles[0], "@VIP");
  assert.equal(exp.rules[0].then[0].channel, "#ideas");

  const hubB = makeHub("B");
  const bGeneral = addRoom(hubB, "general");
  const bIdeas = addRoom(hubB, "ideas", "forum");
  const imp = await call(`${base(hubB)}/import`, { method: "POST", body: exp });
  assert.equal(imp.status, 201);
  const imported = await imp.json();
  assert.deepEqual(imported.unresolved, ["@VIP"]);
  const draft = imported.bot.rules[0].draft;
  assert.deepEqual(draft.scope.channels, [String(bGeneral)]);
  assert.equal(draft.then[0].channel, String(bIdeas));
  assert.equal(draft.scope.roles[0], "");
  const pub = await call(`${base(hubB)}/${imported.bot.id}/publish`, { method: "POST" });
  assert.equal(pub.status, 400);

  addRole(hubB, "b-vip", "VIP");
  const again = await (await call(`${base(hubB)}/import`, { method: "POST", body: exp })).json();
  assert.deepEqual(again.unresolved, []);
  const same = JSON.parse(
    JSON.stringify(again.bot.rules[0].draft)
      .replace(String(bGeneral), String(general))
      .replace(String(bIdeas), String(forum))
      .replaceAll("b-vip", "role-vip"),
  );
  assert.deepEqual(same, source);
});

test("every template can be created; reaction roles stay drafts until filled", async () => {
  const live = await call(base(hubA), {
    method: "POST",
    body: { name: "Live", description: "", templateId: "liveAlerts" },
  });
  assert.equal(live.status, 400, "Twitch live alerts need the Hub's custom Twitch features");
  for (const t of TEMPLATES.filter((template) => template.id !== "liveAlerts")) {
    const res = await call(base(hubA), { method: "POST", body: { name: t.name, description: "", templateId: t.id } });
    assert.equal(res.status, 201, t.id);
    const bot = await res.json();
    assert.ok(bot.rules.length > 0, t.id);
    const pub = await call(`${base(hubA)}/${bot.id}/publish`, { method: "POST" });
    assert.equal(pub.status, t.id === "reactionRoles" ? 400 : 200, t.id);
    await call(`${base(hubA)}/${bot.id}`, { method: "DELETE" });
  }
});

test("templates validate once their role ids are filled", () => {
  const ctx = {
    channelIds: new Set(["1"]),
    roleIds: new Set(["r"]),
    ruleIds: new Set(),
    builtInCommands: new Set(BUILT_IN_COMMANDS),
  };
  for (const t of TEMPLATES) {
    for (const r of t.rules({ firstTextRoomId: "1" })) {
      const filled = JSON.parse(JSON.stringify(r).replaceAll('"roleId":""', '"roleId":"r"'));
      const result = validateRule(filled, ctx);
      assert.equal(result.ok, true, `${t.id}: ${JSON.stringify(result.errors)}`);
    }
  }
});

test("bodies over 16 KB are refused with 413", async () => {
  const bot = await newBot();
  const huge = rule({ then: [{ type: "sendMessage", channel: String(general), text: "x".repeat(17 * 1024) }] });
  const res = await call(`${base(hubA)}/${bot.id}/rules/new`, { method: "PUT", body: huge });
  assert.equal(res.status, 413);
  const create = await call(base(hubA), {
    method: "POST",
    raw: JSON.stringify({ name: "x", description: "y".repeat(17 * 1024) }),
  });
  assert.equal(create.status, 413);
});

test("token bots are listed with kind token and cannot be edited here", async () => {
  db.exec(
    `INSERT INTO decave_hub_bots(id,hub_id,name,description,token_hash,created_by,capabilities,allowed_room_ids,enabled,created_at)
     VALUES('tok1',?,'Tok','','h','owner','["send_messages"]','[]',1,?)`,
    hubA,
    now,
  );
  const list = await (await call(base(hubA))).json();
  assert.equal(list.bots.find((b) => b.id === "tok1").kind, "token");
  assert.equal((await call(`${base(hubA)}/tok1`, { method: "DELETE" })).status, 404);
});

test("malformed import rules are rejected with 400, not 500", async () => {
  for (const bad of [{}, { trigger: {} }, [], "x", { trigger: { type: "memberJoin" }, scope: 5, then: "no" }]) {
    const res = await call(`${base(hubA)}/import`, { method: "POST", body: { name: "Bad", rules: [bad] } });
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.ok((await res.json()).errors.length > 0);
  }
});

test("voice triggers validate against voice rooms and round-trip through export", async () => {
  const voice = Number(
    db.exec(
      "INSERT INTO decave_rooms(hub_id,name,type,created_at,updated_at) VALUES(?,'lounge','voice',?,?)",
      hubA,
      now,
      now,
    ).lastInsertRowid,
  );
  const bot = await newBot();
  const bad = await call(`${base(hubA)}/${bot.id}/rules/new`, {
    method: "PUT",
    body: rule({ trigger: { type: "voiceJoin", roomId: String(general) } }),
  });
  assert.equal(bad.status, 400);
  const ok = await call(`${base(hubA)}/${bot.id}/rules/new`, {
    method: "PUT",
    body: rule({ trigger: { type: "voiceJoin", roomId: String(voice) } }),
  });
  assert.equal(ok.status, 200);
  const exp = await (await call(`${base(hubA)}/${bot.id}/export`)).json();
  assert.equal(exp.rules[0].trigger.roomId, "~lounge");
});

test("route-level: deleting a published rule waits for publish; rule pause applies at once", async () => {
  const bot = await newBot();
  const { ruleId } = await (await call(`${base(hubA)}/${bot.id}/rules/new`, { method: "PUT", body: rule() })).json();
  await call(`${base(hubA)}/${bot.id}/publish`, { method: "POST" });
  assert.equal((await call(`${base(hubA)}/${bot.id}/rules/${ruleId}`, { method: "DELETE" })).status, 200);
  let listed = await botIn(hubA, bot.id);
  assert.equal(listed.rules.length, 0);
  assert.equal(listed.hasUnpublishedChanges, true);
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_bot_rules WHERE id=?", ruleId), 1);
  await call(`${base(hubA)}/${bot.id}/publish`, { method: "POST" });
  assert.equal(db.scalar("SELECT COUNT(*) FROM decave_bot_rules WHERE id=?", ruleId), 0);

  const second = await (await call(`${base(hubA)}/${bot.id}/rules/new`, { method: "PUT", body: rule() })).json();
  const off = await call(`${base(hubA)}/${bot.id}/rules/${second.ruleId}`, {
    method: "PATCH",
    body: { enabled: false },
  });
  assert.equal(off.status, 200);
  listed = await botIn(hubA, bot.id);
  assert.equal(listed.rules[0].enabled, false);
  assert.equal(
    (await call(`${base(hubA)}/${bot.id}/rules/${second.ruleId}`, { method: "PATCH", body: {} })).status,
    400,
  );
});

test("templates and imports get the capabilities their rules need; a bot from scratch only sends messages", async () => {
  const scratch = await newBot();
  assert.deepEqual(scratch.capabilities, ["send_messages"]);
  const roles = await (
    await call(base(hubA), { method: "POST", body: { name: "Roles", templateId: "reactionRoles" } })
  ).json();
  assert.deepEqual([...roles.capabilities].sort(), ["manage_roles", "send_messages"]);
  const polls = await (await call(base(hubA), { method: "POST", body: { name: "Polls", templateId: "polls" } })).json();
  assert.deepEqual([...polls.capabilities].sort(), ["create_polls", "send_messages"]);
  const imp = await call(`${base(hubA)}/import`, {
    method: "POST",
    body: { name: "Imported", rules: [rule({ then: [{ type: "pin", messageRef: "trigger" }] })] },
  });
  assert.equal(imp.status, 201);
  assert.deepEqual([...(await imp.json()).bot.capabilities].sort(), ["manage_messages", "send_messages"]);
  for (const b of [scratch, roles, polls]) await call(`${base(hubA)}/${b.id}`, { method: "DELETE" });
});

test("a bot paused after repeated errors says so; a bot turned off by hand does not", async () => {
  const bot = await newBot();
  assert.equal((await botIn(hubA, bot.id)).pausedReason, null);
  db.exec("UPDATE decave_hub_bots SET enabled=0, failure_streak=50 WHERE id=?", bot.id);
  assert.equal((await botIn(hubA, bot.id)).pausedReason, "errors");
  db.exec("UPDATE decave_hub_bots SET enabled=0, failure_streak=0 WHERE id=?", bot.id);
  assert.equal((await botIn(hubA, bot.id)).pausedReason, null);
  await call(`${base(hubA)}/${bot.id}`, { method: "DELETE" });
});

test("the token-bot list leaves builder bots out", async () => {
  const bot = await newBot();
  const tokenList = await (await call(`/api/servers/${hubA}/bots`)).json();
  assert.ok(Array.isArray(tokenList));
  assert.ok(!tokenList.some((b) => b.id === bot.id));
  await call(`${base(hubA)}/${bot.id}`, { method: "DELETE" });
});
