import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { register } from "node:module";
import { test } from "node:test";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { handleApi, default: worker } = await import("../../worker/index.ts");
const { boundedBodyJson } = await import("../../worker/lib/http.ts");
const { serveR2 } = await import("../../worker/lib/media.ts");
const { checkOutgoingDm } = await import("../../worker/lib/dm-e2ee.ts");
const { handleFeedbackRoutes } = await import("../../worker/routes/feedback.ts");

const SESSION = "security-audit-session";
const sessionHash = createHash("sha256").update(SESSION).digest("hex");
const user = {
  id: "audit-user",
  username: "audit-user",
  public_id: "DC-0000000000000042",
  suspended_at: null,
  suspended_until: null,
  must_reset_password: 0,
  deleted_at: null,
  erased_at: null,
  erasure_started_at: null,
};

function makeEnvironment({ attachmentAccess = null, rateLimitLimit = 8 } = {}) {
  const feedbackRows = [];
  const emailMessages = [];
  const queries = [];
  const mediaReads = [];
  const rateLimitCalls = [];
  const rateLimitCounts = new Map();
  const sessionUsers = new Map([[sessionHash, user]]);
  const db = {
    prepare(sql) {
      let bindings = [];
      const statement = {
        bind(...values) {
          bindings = values;
          return statement;
        },
        async first() {
          queries.push(sql);
          if (sql.includes("FROM decave_sessions s")) return sessionUsers.get(bindings[0]) ?? null;
          if (sql.includes("decave_user_safety_profiles")) return null;
          if (sql.includes("FROM decave_attachment_access")) return attachmentAccess;
          return null;
        },
        async all() {
          queries.push(sql);
          return { results: [] };
        },
        async run() {
          queries.push(sql);
          if (sql.includes("INSERT INTO decave_feedback")) feedbackRows.push([...bindings]);
          return { success: true, meta: { changes: 1 } };
        },
      };
      return statement;
    },
    async batch() {
      return [];
    },
  };
  return {
    env: {
      DB: db,
      MEDIA: {
        async get(key) {
          mediaReads.push(key);
          return null;
        },
      },
      FEEDBACK_TO_EMAIL: "security@example.test",
      EMAIL: {
        async send(message) {
          emailMessages.push(message);
          return { messageId: `local-${emailMessages.length}` };
        },
      },
      HUB_ROOM: {
        idFromName: () => "global",
        get: () => ({ fetch: async () => new Response("unexpected room access", { status: 500 }) }),
      },
      AUTH_RATE_LIMITER: {
        async limit({ key }) {
          rateLimitCalls.push(key);
          const count = (rateLimitCounts.get(key) ?? 0) + 1;
          rateLimitCounts.set(key, count);
          return { success: count <= rateLimitLimit };
        },
      },
    },
    feedbackRows,
    emailMessages,
    mediaReads,
    queries,
    rateLimitCalls,
    rateLimitCounts,
    addUserSession(token, sessionUser) {
      sessionUsers.set(createHash("sha256").update(token).digest("hex"), sessionUser);
    },
  };
}

function feedbackRequest(body, token = SESSION, ip = "198.51.100.7", extraHeaders = {}) {
  const headers = new Headers({ "content-type": "application/json", "CF-Connecting-IP": ip, ...extraHeaders });
  if (token) headers.set("authorization", `Bearer ${token}`);
  const requestBody = typeof body === "string" || body instanceof ReadableStream ? body : JSON.stringify(body);
  return new Request("https://app.de-cave.com/api/feedback", {
    method: "POST",
    headers,
    body: requestBody,
    ...(requestBody instanceof ReadableStream ? { duplex: "half" } : {}),
  });
}

async function submitFeedback(state, request) {
  return handleFeedbackRoutes({
    request,
    env: state.env,
    url: new URL("https://app.de-cave.com/api/feedback"),
    p: "/api/feedback",
    method: "POST",
  });
}

test("hostile browser origins cannot reach feedback mutation or WebSocket admission", async () => {
  const state = makeEnvironment();
  const feedback = await handleApi(
    new Request("https://app.de-cave.com/api/feedback", {
      method: "POST",
      headers: {
        authorization: `Bearer ${SESSION}`,
        "content-type": "application/json",
        Origin: "https://evil.example",
        "Sec-Fetch-Site": "cross-site",
      },
      body: JSON.stringify({ message: "forged" }),
    }),
    state.env,
  );
  assert.equal(feedback.status, 403);
  assert.equal(state.feedbackRows.length, 0);
  assert.equal(state.emailMessages.length, 0);

  let roomCalls = 0;
  state.env.HUB_ROOM.get = () => ({
    fetch: async () => {
      roomCalls += 1;
      return new Response("unexpected room access");
    },
  });
  const websocket = await worker.fetch(
    new Request("https://app.de-cave.com/ws", {
      headers: { Upgrade: "websocket", Origin: "https://evil.example" },
    }),
    state.env,
  );
  assert.equal(websocket.status, 403);
  assert.equal(roomCalls, 0);
});

test("a different account cannot fetch a private DM attachment from R2", async () => {
  const state = makeEnvironment({
    attachmentAccess: {
      kind: "dm",
      owner_user_id: "dm-owner",
      peer_user_id: "intended-recipient",
      hub_id: null,
      room_id: null,
    },
  });
  const response = await serveR2(
    new Request("https://app.de-cave.com/uploads/attachments/private-object", {
      headers: { authorization: `Bearer ${SESSION}` },
    }),
    state.env,
  );

  assert.equal(response.status, 403);
  assert.deepEqual(state.mediaReads, [], "authorization must complete before the private object is fetched");
});

test("a malformed encrypted-message envelope is rejected by the live validator", async () => {
  const state = makeEnvironment();
  const target = { ...user, id: "intended-recipient", public_id: "DC-0000000000000043" };
  const verdict = await checkOutgoingDm(state.env.DB, {
    enabled: true,
    sender: user,
    target,
    text: "",
    envelope: { v: 1, c: "not-a-valid-envelope" },
  });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "DM_E2EE_INVALID");
  // The validator returns a rejection rather than an outgoing object, so the
  // route cannot hand malformed ciphertext to message persistence.
});

test("bounded JSON rejects a declared oversize body without reading it and cancels chunked input promptly", async () => {
  let declaredReads = 0;
  const declaredBody = new ReadableStream(
    {
      pull(controller) {
        declaredReads += 1;
        controller.enqueue(new Uint8Array([0x7b, 0x7d]));
      },
    },
    { highWaterMark: 0 },
  );
  const declaredRequest = new Request("https://app.de-cave.com/api/example", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": "2048" },
    body: declaredBody,
    duplex: "half",
  });
  assert.equal(await boundedBodyJson(declaredRequest, 1024), null);
  assert.equal(declaredReads, 0);

  const chunkCount = 64;
  const chunk = new Uint8Array(512).fill(0x20);
  let consumedBytes = 0;
  let nextChunk = 0;
  let canceled = false;
  const body = new ReadableStream(
    {
      pull(controller) {
        if (nextChunk === chunkCount) {
          controller.close();
          return;
        }
        consumedBytes += chunk.byteLength;
        controller.enqueue(chunk.slice());
        nextChunk += 1;
      },
      cancel() {
        canceled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const request = new Request("https://app.de-cave.com/api/example", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    duplex: "half",
  });

  assert.equal(await boundedBodyJson(request, 1024), null);
  assert.equal(consumedBytes, 1536);
  assert.equal(nextChunk, 3);
  assert.equal(canceled, true);
});

test("bounded JSON retains its prior parsing behavior for valid, malformed, and non-object input", async () => {
  const read = async (body) =>
    boundedBodyJson(
      new Request("https://app.de-cave.com/api/example", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }),
      64,
    );

  assert.deepEqual(await read('{"message":"hello"}'), { message: "hello" });
  assert.deepEqual(await read("[1,2]"), [1, 2]);
  assert.deepEqual(await read("null"), {});
  assert.deepEqual(await read("not json"), {});
  assert.deepEqual(
    await boundedBodyJson(new Request("https://app.de-cave.com/api/example", { method: "POST" }), 64),
    {},
  );

  const lockedRequest = new Request("https://app.de-cave.com/api/example", {
    method: "POST",
    body: '{"message":"hello"}',
  });
  const lockedReader = lockedRequest.body.getReader();
  assert.deepEqual(await boundedBodyJson(lockedRequest, 64), {});
  lockedReader.releaseLock();
});

test("feedback rejects declared and streamed oversized bodies before persistence or notification", async () => {
  const state = makeEnvironment();
  const unauthenticated = await submitFeedback(state, feedbackRequest({ message: "no session" }, null));
  assert.equal(unauthenticated.status, 401);
  assert.equal(state.feedbackRows.length, 0);
  assert.equal(state.emailMessages.length, 0);

  const declared = await submitFeedback(
    state,
    feedbackRequest({ type: "bug", message: "still small" }, SESSION, "198.51.100.10", { "content-length": "40000" }),
  );
  assert.equal(declared.status, 413);

  const chunkSize = 4096;
  let consumedBytes = 0;
  let canceled = false;
  let nextChunk = 0;
  const streamedBody = new ReadableStream(
    {
      pull(controller) {
        if (nextChunk === 32) {
          controller.close();
          return;
        }
        const chunk = new Uint8Array(chunkSize).fill(0x20);
        consumedBytes += chunk.byteLength;
        controller.enqueue(chunk);
        nextChunk += 1;
      },
      cancel() {
        canceled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const streamed = await submitFeedback(state, feedbackRequest(streamedBody, SESSION, "198.51.100.11"));
  assert.equal(streamed.status, 413);
  assert.ok(consumedBytes < 32 * chunkSize);
  assert.equal(canceled, true);
  assert.equal(state.feedbackRows.length, 0);
  assert.equal(state.emailMessages.length, 0);
});

test("feedback accepts ordinary Unicode input, validates field bounds, and caps account submissions", async () => {
  const state = makeEnvironment();
  const valid = await submitFeedback(
    state,
    feedbackRequest({ type: "feature", message: "  Здравствуйте, 🪴  ", contact: "  joueur@example.test  " }),
  );
  assert.equal(valid.status, 200);
  assert.equal(state.feedbackRows[0][4], "feature");
  assert.equal(state.feedbackRows[0][5], "Здравствуйте, 🪴");
  assert.equal(state.feedbackRows[0][3], "joueur@example.test");
  assert.equal(state.emailMessages.length, 1);

  const tooLongMessage = await submitFeedback(
    state,
    feedbackRequest({ type: "bug", message: "x".repeat(4001) }, SESSION, "198.51.100.12"),
  );
  assert.equal(tooLongMessage.status, 400);
  const invalidType = await submitFeedback(
    state,
    feedbackRequest({ type: "other", message: "unambiguous" }, SESSION, "198.51.100.13"),
  );
  assert.equal(invalidType.status, 400);
  assert.equal(state.feedbackRows.length, 1);
  assert.equal(state.emailMessages.length, 1);

  const burstState = makeEnvironment();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await submitFeedback(
      burstState,
      feedbackRequest({ type: "bug", message: `submission ${attempt}` }, SESSION, `198.51.100.${attempt + 20}`),
    );
    assert.equal(response.status, 200);
  }
  const accountLimited = await submitFeedback(
    burstState,
    feedbackRequest({ type: "bug", message: "ninth submission" }, SESSION, "198.51.100.30"),
  );
  assert.equal(accountLimited.status, 429);
  assert.equal(burstState.feedbackRows.length, 8);
  assert.equal(burstState.emailMessages.length, 8);
  assert.ok(burstState.rateLimitCalls.includes("feedback-account:audit-user"));
});

test("feedback limits a source IP across different authenticated accounts", async () => {
  const state = makeEnvironment();
  const sharedIp = "203.0.113.22";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const token = `feedback-session-${attempt}`;
    state.addUserSession(token, { ...user, id: `audit-user-${attempt}`, username: `audit-user-${attempt}` });
    const response = await submitFeedback(
      state,
      feedbackRequest({ type: "feature", message: `submission ${attempt}` }, token, sharedIp),
    );
    assert.equal(response.status, 200);
  }
  const otherAccountToken = "feedback-session-other";
  state.addUserSession(otherAccountToken, { ...user, id: "audit-user-other", username: "audit-user-other" });
  const ipLimited = await submitFeedback(
    state,
    feedbackRequest({ type: "feature", message: "new account" }, otherAccountToken, sharedIp),
  );
  assert.equal(ipLimited.status, 429);
  assert.equal(state.feedbackRows.length, 8);
  assert.equal(state.emailMessages.length, 8);
  const ipKey = [...state.rateLimitCounts.keys()].find((key) => key.startsWith("feedback:"));
  assert.equal(state.rateLimitCounts.get(ipKey), 9);
  assert.equal(state.rateLimitCounts.get("feedback-account:audit-user-other"), 1);
});
