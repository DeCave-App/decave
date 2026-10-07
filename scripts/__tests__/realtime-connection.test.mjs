import assert from "node:assert/strict";
import test from "node:test";
import { connectRealtime } from "../../src/realtime/connection.ts";

// Fake clock: timers run only when the test advances time.
function createClock() {
  let now = 1_000_000;
  let nextId = 1;
  const timers = new Map();
  const add = (callback, ms, repeat) => {
    const id = nextId++;
    timers.set(id, { callback, at: now + ms, ms, repeat });
    return id;
  };
  return {
    now: () => now,
    setTimeout: (callback, ms) => add(callback, ms, false),
    setInterval: (callback, ms) => add(callback, ms, true),
    clearTimeout: (id) => timers.delete(id),
    clearInterval: (id) => timers.delete(id),
    pending: () => timers.size,
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, timer] = due;
        now = timer.at;
        if (timer.repeat) timer.at += timer.ms;
        else timers.delete(id);
        await timer.callback();
        await flush();
      }
      now = end;
    },
  };
}

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

class FakeSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.closed = null;
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close(code, reason) {
    this.closed = { code, reason };
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(frame) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

function setup({ envPatch, ...overrides } = {}) {
  const clock = createClock();
  const sockets = [];
  const listeners = { window: new Map(), document: new Map() };
  const target = (map) => ({
    addEventListener: (type, fn) => map.set(type, fn),
    removeEventListener: (type, fn) => {
      if (map.get(type) === fn) map.delete(type);
    },
  });
  const log = [];
  const calls = [];
  const statuses = [];
  const refs = {
    socketRef: { current: null },
    reconnectAttemptRef: { current: 0 },
    reconnectEnabledRef: { current: true },
  };
  const document = { ...target(listeners.document), visibilityState: "visible" };
  const options = {
    url: "wss://example.test/ws",
    ...refs,
    setStatus: (status) => statuses.push(status),
    identify: () => ({ type: "IDENTIFY", token: "token-1", serverId: 3, channelId: 16 }),
    refreshToken: async () => "token-2",
    isSessionExpired: async () => false,
    onSessionExpired: () => calls.push("sessionExpired"),
    onTokenRefreshed: (token) => calls.push(`token:${token}`),
    onFrame: (data) => calls.push(`frame:${data.type}`),
    onAuthError: (data) => calls.push(`authError:${data.message}`),
    onIdentified: (data, socket) => calls.push(`identified:${data.id}:${socket === sockets.at(-1)}`),
    onEvent: (data) => calls.push(`event:${data.type}`),
    onClosed: () => calls.push("closed"),
    onResume: () => calls.push("resume"),
    env: {
      createSocket: (url) => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
      now: clock.now,
      random: () => 0.5,
      window: target(listeners.window),
      document,
      console: { warn: (...args) => log.push(["warn", ...args]), error: (...args) => log.push(["error", ...args]) },
    },
    ...overrides,
  };
  envPatch?.(options.env);
  const connection = connectRealtime(options);
  return { connection, clock, sockets, listeners, document, log, calls, statuses, refs };
}

test("opens one socket, shares it, and identifies when it opens", () => {
  const { sockets, refs, statuses } = setup();
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].url, "wss://example.test/ws");
  assert.equal(refs.socketRef.current, sockets[0]);
  assert.deepEqual(statuses, ["Connecting..."]);
  sockets[0].open();
  assert.deepEqual(sockets[0].sent, [{ type: "IDENTIFY", token: "token-1", serverId: 3, channelId: 16 }]);
  assert.deepEqual(statuses, ["Connecting...", "Connecting..."]);
});

test("shows Reconnecting while a previous attempt failed", () => {
  const { statuses } = setup({ reconnectAttemptRef: { current: 2 } });
  assert.deepEqual(statuses, ["Reconnecting..."]);
});

test("every frame is broadcast first, then routed by type", () => {
  const { sockets, calls } = setup();
  sockets[0].open();
  sockets[0].receive({ type: "PONG" });
  sockets[0].receive({ type: "AUTH_ERROR", message: "Session expired." });
  sockets[0].receive({ type: "IDENTIFIED", id: "conn-1" });
  sockets[0].receive({ type: "CHAT_MESSAGE" });
  assert.deepEqual(calls, [
    "frame:PONG",
    "frame:AUTH_ERROR",
    "authError:Session expired.",
    "frame:IDENTIFIED",
    "identified:conn-1:true",
    "frame:CHAT_MESSAGE",
    "event:CHAT_MESSAGE",
  ]);
});

test("a throwing handler or bad JSON is logged, not thrown", () => {
  const { sockets, log } = setup({
    onEvent: () => {
      throw new Error("boom");
    },
  });
  sockets[0].open();
  sockets[0].receive({ type: "CHAT_MESSAGE" });
  sockets[0].onmessage({ data: "{not json" });
  assert.equal(log.length, 2);
  assert.equal(log[0][1], "Invalid WebSocket data:");
  assert.equal(log[1][1], "Invalid WebSocket data:");
});

test("IDENTIFIED resets the attempt count and starts the 20 s heartbeat", async () => {
  const { sockets, clock, refs } = setup({ reconnectAttemptRef: { current: 3 } });
  sockets[0].open();
  sockets[0].receive({ type: "IDENTIFIED", id: "conn-1" });
  assert.equal(refs.reconnectAttemptRef.current, 0);
  await clock.advance(19_999);
  assert.equal(sockets[0].sent.filter((f) => f.type === "PING").length, 0);
  await clock.advance(1);
  const pings = sockets[0].sent.filter((f) => f.type === "PING");
  assert.equal(pings.length, 1);
  assert.equal(pings[0].timestamp, clock.now());
});

test("a socket silent for over 55 s is closed by the watchdog", async () => {
  const { sockets, clock } = setup();
  sockets[0].open();
  sockets[0].receive({ type: "IDENTIFIED", id: "conn-1" });
  await clock.advance(50_000);
  sockets[0].receive({ type: "PONG" });
  await clock.advance(50_000);
  assert.equal(sockets[0].closed, null, "a recent PONG keeps the socket");
  await clock.advance(10_000);
  assert.deepEqual(sockets[0].closed, { code: 4000, reason: "Realtime heartbeat timed out" });
});

test("first close reconnects immediately with a fresh token", async () => {
  const { sockets, clock, calls, statuses, refs } = setup();
  sockets[0].open();
  sockets[0].receive({ type: "IDENTIFIED", id: "conn-1" });
  sockets[0].close();
  assert.equal(refs.socketRef.current, null);
  assert.ok(calls.includes("closed"));
  assert.equal(statuses.at(-1), "Reconnecting...");
  assert.equal(clock.pending(), 1, "heartbeat timers cleared, one reconnect timer");
  await clock.advance(0);
  assert.equal(refs.reconnectAttemptRef.current, 1);
  assert.equal(calls.at(-1), "token:token-2");
});

test("failed refreshes back off exponentially with jitter, capped at 15 s", async () => {
  const delays = [];
  const clockSetTimeout = { fn: null };
  const { sockets, clock, log } = setup({
    refreshToken: async () => {
      throw new Error("offline");
    },
    envPatch: (env) => {
      clockSetTimeout.fn = env.setTimeout;
      env.setTimeout = (callback, ms) => {
        delays.push(ms);
        return clockSetTimeout.fn(callback, ms);
      };
    },
  });
  sockets[0].open();
  sockets[0].close();
  await clock.advance(60_000);
  // First retry immediate; each failure then doubles the wait from 2 s up to a
  // 15 s cap, plus 175 ms of jitter at random() = 0.5.
  assert.deepEqual(delays.slice(0, 7), [0, 2175, 4175, 8175, 15175, 15175, 15175]);
  assert.equal(log[0][1], "Could not refresh DeCave realtime credentials:");
});

test("no token and a 401 ends the session without retrying", async () => {
  const { sockets, clock, calls } = setup({ refreshToken: async () => "", isSessionExpired: async () => true });
  sockets[0].open();
  sockets[0].close();
  await clock.advance(0);
  assert.equal(calls.at(-1), "sessionExpired");
  assert.equal(clock.pending(), 0);
});

test("no token without a 401 keeps retrying", async () => {
  const { sockets, clock, refs } = setup({ refreshToken: async () => "", isSessionExpired: async () => false });
  sockets[0].open();
  sockets[0].close();
  await clock.advance(0);
  assert.equal(refs.reconnectAttemptRef.current, 1);
  assert.equal(clock.pending(), 1);
});

test("closing after reconnects are disabled only reports Disconnected", async () => {
  const { sockets, clock, statuses, refs } = setup();
  sockets[0].open();
  refs.reconnectEnabledRef.current = false;
  sockets[0].close();
  assert.equal(statuses.at(-1), "Disconnected");
  assert.equal(clock.pending(), 0);
});

test("reconnectNow does nothing while a socket is open or connecting", async () => {
  const { connection, sockets, clock } = setup();
  connection.reconnectNow();
  assert.equal(clock.pending(), 0);
  sockets[0].open();
  connection.reconnectNow();
  assert.equal(clock.pending(), 0);
});

test("coming back online, focused or visible recovers a closed socket and media", async () => {
  const { sockets, listeners, document, calls, clock, refs } = setup({ onClosed: () => {} });
  sockets[0].open();
  refs.reconnectEnabledRef.current = false;
  sockets[0].close();
  refs.reconnectEnabledRef.current = true;
  listeners.window.get("online")();
  assert.equal(clock.pending(), 1, "reconnect scheduled");
  assert.equal(calls.at(-1), "resume");
  document.visibilityState = "hidden";
  const before = calls.length;
  listeners.document.get("visibilitychange")();
  assert.equal(calls.length, before, "hidden tabs do nothing");
  listeners.window.get("focus")();
  assert.equal(calls.at(-1), "resume");
});

test("dispose closes the socket, clears timers and listeners, and ignores late events", async () => {
  const { connection, sockets, clock, listeners, calls, refs } = setup();
  sockets[0].open();
  sockets[0].receive({ type: "IDENTIFIED", id: "conn-1" });
  const callsBefore = calls.length;
  connection.dispose();
  assert.equal(clock.pending(), 0);
  assert.equal(listeners.window.size, 0);
  assert.equal(listeners.document.size, 0);
  assert.notEqual(sockets[0].closed, null);
  assert.equal(refs.socketRef.current, null);
  sockets[0].receive({ type: "CHAT_MESSAGE" });
  assert.equal(calls.length, callsBefore, "no handlers after dispose, including onClosed");
});

test("send works only while this connection's socket is open", () => {
  const { connection, sockets } = setup();
  assert.equal(connection.send({ type: "X" }), false);
  sockets[0].open();
  assert.equal(connection.send({ type: "X" }), true);
  assert.deepEqual(sockets[0].sent.at(-1), { type: "X" });
});

test("a replaced socket's events are ignored", () => {
  const { sockets, calls, refs } = setup();
  sockets[0].open();
  refs.socketRef.current = null;
  sockets[0].receive({ type: "CHAT_MESSAGE" });
  assert.equal(calls.length, 0);
});
