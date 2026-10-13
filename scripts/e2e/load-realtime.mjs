// Realtime load test: N simulated clients on the /ws endpoint of a local
// Worker seeded by scripts/e2e/load-seed.mjs. Measures connect latency while
// ramping, PING round trips at steady state, chat fan-out, room switches,
// voice joins and a reconnect burst.
//
//   node scripts/e2e/load-realtime.mjs --tokens <tokens.json> --users 1000
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import WebSocket from "ws";

const { values } = parseArgs({
  options: {
    tokens: { type: "string" },
    url: { type: "string", default: "ws://127.0.0.1:8787/ws" },
    users: { type: "string", default: "1000" },
    rate: { type: "string", default: "25" },
    steady: { type: "string", default: "20" },
    // Seconds to wait after the ramp before measuring steady state.
    settle: { type: "string", default: "5" },
    timeout: { type: "string", default: "60000" },
    // Share of clients that IDENTIFY like older builds (no "presence-diff").
    legacy: { type: "string", default: "0" },
  },
});
const accounts = JSON.parse(readFileSync(values.tokens, "utf8")).slice(0, Number(values.users));
const TIMEOUT = Number(values.timeout);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pct = (list, p) => {
  if (!list.length) return NaN;
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};
const summary = (label, list, extra = "") =>
  console.log(
    `${label.padEnd(28)} n=${String(list.length).padStart(5)}  p50=${pct(list, 50).toFixed(0)}ms  p95=${pct(list, 95).toFixed(0)}ms  max=${pct(list, 100).toFixed(0)}ms ${extra}`,
  );

let bytesIn = 0;
let framesIn = 0;

class Client {
  constructor(account, index) {
    this.account = account;
    this.index = index;
    this.tokenIndex = 0;
    this.waiters = [];
    this.closedReason = null;
    this.expectClose = false;
    this.legacy = index < Number(values.legacy) * accounts.length;
  }
  connect() {
    const token = this.account.wsTokens[this.tokenIndex++];
    if (!token) return Promise.reject(new Error("out of ws tokens"));
    const started = performance.now();
    this.closedReason = null;
    // Distinct fake client addresses so per-address admission limits model
    // real users rather than one host.
    const ip = `10.${(this.index >> 16) & 255}.${(this.index >> 8) & 255}.${this.index & 255}`;
    this.ws = new WebSocket(values.url, { headers: { "CF-Connecting-IP": ip } });
    this.ws.on("message", (raw) => {
      bytesIn += raw.length;
      framesIn++;
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      this.waiters = this.waiters.filter((w) => !w(msg));
    });
    const socket = this.ws;
    socket.on("close", (code, reason) => {
      // A replaced socket's late close must not mark the new connection closed.
      if (this.ws !== socket) return;
      this.closedReason = code;
      if (!this.expectClose) fail("closed by server", `${code} ${reason}`);
      this.expectClose = false;
    });
    this.ws.on("error", () => {});
    return new Promise((resolve, reject) => {
      this.ws.once("open", () => {
        this.ws.send(
          JSON.stringify({
            type: "IDENTIFY",
            token,
            client: "desktop",
            serverId: this.account.hub,
            channelId: this.account.rooms[0],
            ...(this.legacy ? {} : { features: ["presence-diff"] }),
          }),
        );
        this.wait((m) => m.type === "IDENTIFIED" || m.type === "AUTH_ERROR")
          .then((m) => (m.type === "IDENTIFIED" ? resolve(performance.now() - started) : reject(new Error(m.message))))
          .catch(reject);
      });
      this.ws.once("error", reject);
    });
  }
  wait(predicate, timeout = TIMEOUT) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), timeout);
      this.waiters.push((msg) => {
        if (!predicate(msg)) return false;
        clearTimeout(timer);
        resolve(msg);
        return true;
      });
    });
  }
  send(payload) {
    this.ws.send(JSON.stringify(payload));
  }
  open() {
    return this.ws?.readyState === WebSocket.OPEN && this.closedReason === null;
  }
}

const clients = accounts.map((account, index) => new Client(account, index));
const failures = new Map();
const fail = (phase, error) => {
  const key = `${phase}: ${error?.message ?? error}`;
  failures.set(key, (failures.get(key) ?? 0) + 1);
};

console.log(`Load test: ${clients.length} clients -> ${values.url} at ${values.rate}/s`);

// Phase 1: ramp up.
const connectTimes = [];
const rampStarted = performance.now();
const interval = 1000 / Number(values.rate);
const pending = [];
for (const client of clients) {
  pending.push(
    client
      .connect()
      .then((ms) => connectTimes.push(ms))
      .catch((error) => fail("connect", error)),
  );
  await sleep(interval);
}
await Promise.all(pending);
summary("connect (IDENTIFIED)", connectTimes, `in ${((performance.now() - rampStarted) / 1000).toFixed(1)}s`);
const live = () => clients.filter((c) => c.open());
console.log(`connected: ${live().length}/${clients.length}`);

// Let the presence fan-out from the ramp drain.
await sleep(Number(values.settle) * 1000);

// Phase 2: steady state. Each client pings every 5 s (staggered; the server
// allows 30 PINGs/min) while we measure round trips.
const pingTimes = [];
const steadyEnd = Date.now() + Number(values.steady) * 1000;
bytesIn = 0;
framesIn = 0;
let round = 0;
const inflight = [];
while (Date.now() < steadyEnd) {
  const tick = round++;
  for (const client of live()) {
    if ((client.index + tick) % 5 !== 0) continue;
    const stamp = performance.now();
    client.send({ type: "PING", timestamp: stamp });
    inflight.push(
      client
        .wait((m) => m.type === "PONG" && m.timestamp === stamp, 30_000)
        .then(() => pingTimes.push(performance.now() - stamp))
        .catch((error) => fail("ping", error)),
    );
  }
  await sleep(1000);
}
await Promise.all(inflight);
summary("ping round trip", pingTimes);
console.log(
  `idle traffic per client: ${(bytesIn / Math.max(1, live().length) / Number(values.steady)).toFixed(0)} B/s, ${framesIn} frames total`,
);

// Phase 3: chat fan-out. 20 senders, time until every other client in the
// room has the message.
const fanout = [];
for (let i = 0; i < 20; i++) {
  const sender = live()[i * 7];
  if (!sender) break;
  const marker = `load-${Date.now()}-${i}`;
  const room = sender.account.rooms[0];
  const receivers = live().filter((c) => c.account.rooms[0] === room);
  const started = performance.now();
  const arrivals = receivers.map((c) =>
    c.wait((m) => JSON.stringify(m).includes(marker), 30_000).then(() => performance.now() - started),
  );
  sender.send({ type: "CHAT_MESSAGE", channelId: room, text: marker });
  const results = await Promise.allSettled(arrivals);
  const done = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  if (done.length < results.length) fail("chat", new Error(`${results.length - done.length} missed`));
  fanout.push(Math.max(...done, 0));
  await sleep(250);
}
summary("chat delivered to all", fanout);

// Phase 4: 50 room switches (each used to rebroadcast presence to everyone).
const switches = [];
for (let i = 0; i < 50; i++) {
  const client = live()[i * 3];
  if (!client) break;
  const target = client.account.rooms[i % 2 === 0 ? 1 : 0];
  const started = performance.now();
  client.send({ type: "JOIN_CHANNEL", channelId: target });
  try {
    await client.wait((m) => m.type === "CHANNEL_JOINED" || m.type === "ERROR", 30_000);
    switches.push(performance.now() - started);
  } catch (error) {
    fail("switch", error);
  }
}
summary("room switch", switches);

// Phase 5: 8 users join one voice room; time until a bystander sees them.
const voice = [];
const voiceUsers = live().slice(100, 108);
const bystander = live()[1];
for (const client of voiceUsers) {
  const room = client.account.rooms[2];
  const started = performance.now();
  const seen = bystander.wait(
    (m) =>
      m.type === "VOICE_STATE" && (m.participants ?? []).some((p) => p.username === `load${clients.indexOf(client)}`),
    30_000,
  );
  client.send({ type: "VOICE_JOIN", channelId: room });
  try {
    await seen;
    voice.push(performance.now() - started);
  } catch (error) {
    fail("voice", error);
  }
}
summary("voice join seen by others", voice);
for (const client of voiceUsers) client.send({ type: "VOICE_LEAVE" });

// Phase 6: reconnect burst (100 clients drop and come back at once).
await sleep(2000);
const burst = live().slice(200, 300);
for (const client of burst) {
  client.expectClose = true;
  client.ws.close();
}
await sleep(1000);
const reconnect = [];
await Promise.all(
  burst.map((client) =>
    client
      .connect()
      .then((ms) => reconnect.push(ms))
      .catch((error) => fail("reconnect", error)),
  ),
);
summary("reconnect burst (100)", reconnect);

console.log(`still connected: ${live().length}/${clients.length}`);
if (failures.size) {
  console.log("failures:");
  for (const [key, count] of failures) console.log(`  ${count} x ${key}`);
}
for (const client of clients) client.ws?.terminate();
process.exit(0);
