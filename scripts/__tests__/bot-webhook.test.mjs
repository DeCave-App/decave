import assert from "node:assert/strict";
import { register } from "node:module";
import { beforeEach, test } from "node:test";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { guardedFetch, webhookUrlProblem } = await import("../../worker/bots/webhook.ts");
const limits = await import("../../worker/bots/limits.ts");
const { getAction } = await import("../../worker/bots/actions/registry.ts");
await import("../../worker/bots/actions/webhook.ts");

beforeEach(() => limits.resetLimitsForTests());

const okFetch = (body = "{}", status = 200) => {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return new Response(body, { status });
  };
  fn.calls = calls;
  return fn;
};

test("refuses http, odd ports, logins and private hosts without calling fetch", async () => {
  const refused = [
    "http://example.com/x",
    "https://example.com:8443/x",
    "https://user:pw@example.com/x",
    "https://localhost/x",
    "https://app.localhost/x",
    "https://127.0.0.1/x",
    "https://10.0.0.1/x",
    "https://192.168.1.1/x",
    "https://172.16.5.5/x",
    "https://169.254.169.254/latest/meta-data",
    "https://100.64.0.1/x",
    "https://0.0.0.0/x",
    "https://224.0.0.1/x",
    "https://255.255.255.255/x",
    "https://[::1]/x",
    "https://[::]/x",
    "https://[fd00::1]/x",
    "https://[fe80::1]/x",
    "https://[::ffff:127.0.0.1]/x",
    "https://[::ffff:10.0.0.1]/x",
    "https://2130706433/x",
    "https://0x7f.1/x",
    "https://0177.0.0.1/x",
    "https://printer.local/x",
    "https://db.internal/x",
    "https://de-cave.com/api",
    "https://api.de-cave.com/api",
    "not a url",
  ];
  const fetchImpl = okFetch();
  for (const url of refused) {
    const result = await guardedFetch(url, { method: "GET" }, fetchImpl);
    assert.equal(result.ok, false, url);
  }
  assert.equal(fetchImpl.calls.length, 0);
});

test("allows public hosts including workers.dev and public IPs", () => {
  for (const url of [
    "https://example.com/x",
    "https://bot.someone.workers.dev/hook",
    "https://8.8.8.8/x",
    "https://[2606:4700::1111]/x",
    "https://notde-cave.com/x",
  ])
    assert.equal(webhookUrlProblem(url), null, url);
});

test("sends fixed headers, manual redirect and parses JSON", async () => {
  const fetchImpl = okFetch('{"a":1}', 201);
  const result = await guardedFetch("https://example.com/h", { method: "POST", body: '{"x":1}' }, fetchImpl);
  assert.deepEqual(result, { ok: true, status: 201, json: { a: 1 } });
  const { init } = fetchImpl.calls[0];
  assert.equal(init.redirect, "manual");
  assert.equal(init.body, '{"x":1}');
  assert.deepEqual(init.headers, { "User-Agent": "DeCave-Bot/1", "Content-Type": "application/json" });
  const get = okFetch("not json");
  const plain = await guardedFetch("https://example.com/h", { method: "GET", body: "ignored" }, get);
  assert.deepEqual(plain, { ok: true, status: 200, json: null });
  assert.equal(get.calls[0].init.body, undefined);
  assert.equal(get.calls[0].init.headers["Content-Type"], undefined);
});

test("redirects are refused, not followed", async () => {
  const fetchImpl = async () => new Response(null, { status: 301, headers: { location: "https://169.254.169.254/" } });
  const result = await guardedFetch("https://example.com/h", { method: "GET" }, fetchImpl);
  assert.deepEqual(result, { ok: false, reason: "Webhook redirects aren't followed" });
});

test("a slow response is aborted after 5000 ms", async () => {
  let fire;
  let delay;
  let cleared = false;
  const fetchImpl = (url, init) =>
    new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
  const pending = guardedFetch("https://example.com/h", { method: "GET" }, fetchImpl, {
    setTimer: (fn, ms) => {
      fire = fn;
      delay = ms;
      return 1;
    },
    clearTimer: () => (cleared = true),
  });
  assert.equal(delay, 5000);
  fire();
  assert.deepEqual(await pending, { ok: false, reason: "Webhook timed out" });
  assert.equal(cleared, true);
});

test("a 70 KB body is refused, even streamed without Content-Length", async () => {
  const big = "a".repeat(70 * 1024);
  const result = await guardedFetch("https://example.com/h", { method: "GET" }, okFetch(big));
  assert.deepEqual(result, { ok: false, reason: "Webhook response too large" });
  const chunk = new Uint8Array(16 * 1024);
  let pulled = 0;
  const stream = new ReadableStream({
    pull(controller) {
      pulled += 1;
      controller.enqueue(chunk);
    },
  });
  const streamed = await guardedFetch("https://example.com/h", { method: "GET" }, async () => new Response(stream));
  assert.deepEqual(streamed, { ok: false, reason: "Webhook response too large" });
  assert.ok(pulled <= 8, "stops reading soon after the cap");
});

function actionCtx(overrides = {}) {
  return { env: {}, event: { hubId: 7 }, vars: {}, steps: [], dryRun: false, ...overrides };
}

test("webhook action exposes status and top-level scalars as variables", async () => {
  const realFetch = globalThis.fetch;
  const body = { name: "Ada", n: 3, ok: true, nested: { a: 1 }, list: [1], long: "x".repeat(600) };
  for (let i = 0; i < 30; i++) body[`k${i}`] = i;
  globalThis.fetch = okFetch(JSON.stringify(body), 200);
  try {
    const handler = getAction("webhook");
    assert.equal(handler.capability, "webhooks");
    const ctx = actionCtx({ vars: { who: "ada" } });
    const result = await handler.run(ctx, {
      type: "webhook",
      url: "https://example.com/u/{who}",
      method: "POST",
      body: '{"u":"{who}"}',
    });
    assert.equal(result.ok, true);
    assert.equal(globalThis.fetch.calls[0].url, "https://example.com/u/ada");
    assert.equal(globalThis.fetch.calls[0].init.body, '{"u":"ada"}');
    assert.equal(result.vars["webhook.status"], 200);
    assert.equal(result.vars["webhook.name"], "Ada");
    assert.equal(result.vars["webhook.n"], 3);
    assert.equal(result.vars["webhook.long"].length, 500);
    assert.equal("webhook.nested" in result.vars, false);
    assert.ok(Object.keys(result.vars).filter((k) => k !== "webhook.status").length <= 20);

    globalThis.fetch = okFetch("plain text", 202);
    const plain = await handler.run(actionCtx(), { type: "webhook", url: "https://example.com/", method: "GET" });
    assert.deepEqual(plain.vars, { "webhook.status": 202 });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a rendered URL that lands on a private host is refused", async () => {
  const handler = getAction("webhook");
  const result = await handler.run(actionCtx({ vars: { h: "127.0.0.1" } }), {
    type: "webhook",
    url: "https://{h}/x",
    method: "GET",
  });
  assert.equal(result.ok, false);
});

test("dry run validates but makes no call and spends no budget", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = okFetch();
  try {
    const handler = getAction("webhook");
    const action = { type: "webhook", url: "https://example.com/p", method: "POST" };
    for (let i = 0; i < 15; i++) assert.equal((await handler.run(actionCtx({ dryRun: true }), action)).ok, true);
    assert.equal(globalThis.fetch.calls.length, 0);
    assert.equal((await handler.run(actionCtx({ dryRun: true }), { ...action, url: "http://example.com" })).ok, false);
    assert.equal(limits.takeBudget(7, "webhooks"), true);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the 11th webhook call in a minute is limited", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = okFetch();
  try {
    const handler = getAction("webhook");
    const action = { type: "webhook", url: "https://example.com/p", method: "GET" };
    for (let i = 0; i < 10; i++) assert.equal((await handler.run(actionCtx(), action)).ok, true);
    const eleventh = await handler.run(actionCtx(), action);
    assert.deepEqual(eleventh, { ok: false, reason: "Webhook limit reached", limited: true });
    assert.equal(globalThis.fetch.calls.length, 10);
  } finally {
    globalThis.fetch = realFetch;
  }
});

const tricky = 'a"b' + String.fromCharCode(92) + "c";

test("body templates keep JSON braces and escape substituted values", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = okFetch();
  try {
    await getAction("webhook").run(actionCtx({ vars: { who: tricky } }), {
      type: "webhook",
      url: "https://example.com/",
      method: "POST",
      body: '{"u":"{who}","e":{}}',
    });
    const sent = globalThis.fetch.calls[0].init.body;
    assert.deepEqual(JSON.parse(sent), { u: tricky, e: {} });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a body key named status can't overwrite the HTTP status; odd keys are skipped", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = okFetch('{"status":"queued","ok_key":1,"bad key":2,"a.b":3}', 200);
  try {
    const result = await getAction("webhook").run(actionCtx(), {
      type: "webhook",
      url: "https://example.com/",
      method: "GET",
    });
    assert.deepEqual(result.vars, { "webhook.ok_key": 1, "webhook.status": 200 });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a placeholder outside a JSON string becomes a JSON literal", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = okFetch();
  try {
    const run = (vars) =>
      getAction("webhook").run(actionCtx({ vars }), {
        type: "webhook",
        url: "https://example.com/",
        method: "POST",
        body: '{"n":{count}}',
      });
    await run({ count: '1,"admin":true' });
    assert.equal(globalThis.fetch.calls[0].init.body, '{"n":"1,\\"admin\\":true"}');
    await run({ count: 7 });
    assert.equal(globalThis.fetch.calls[1].init.body, '{"n":7}');
  } finally {
    globalThis.fetch = realFetch;
  }
});
