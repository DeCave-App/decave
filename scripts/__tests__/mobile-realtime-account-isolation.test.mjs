import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = fs.readFileSync(path.join(repoRoot, "mobile/src/providers/RealtimeProvider.tsx"), "utf8");
// The provider's notices come from the English catalogs.
const { default: mobileI18next } = await import("../test-support/mobile-i18n-english.mjs");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

function sameDependencies(left, right) {
  return left?.length === right?.length && left.every((value, index) => Object.is(value, right[index]));
}

function createProviderRuntime({ apiJson }) {
  const slots = [];
  let cursor = 0;
  let pendingEffects = [];
  let session = null;
  const sockets = [];
  const timers = new Map();
  let nextTimer = 1;

  const react = {
    createContext: () => ({ Provider: {} }),
    useContext: (context) => context.value,
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { kind: "state", value: typeof initial === "function" ? initial() : initial };
      const slot = slots[index];
      return [
        slot.value,
        (value) => {
          slot.value = typeof value === "function" ? value(slot.value) : value;
        },
      ];
    },
    useRef(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { kind: "ref", value: { current: initial } };
      return slots[index].value;
    },
    useCallback(callback, dependencies) {
      const index = cursor++;
      const slot = slots[index];
      if (!slot || !sameDependencies(slot.dependencies, dependencies)) {
        slots[index] = { kind: "memo", dependencies, value: callback };
      }
      return slots[index].value;
    },
    useMemo(factory, dependencies) {
      const index = cursor++;
      const slot = slots[index];
      if (!slot || !sameDependencies(slot.dependencies, dependencies)) {
        slots[index] = { kind: "memo", dependencies, value: factory() };
      }
      return slots[index].value;
    },
    useEffect(callback, dependencies) {
      const index = cursor++;
      const slot = slots[index];
      if (!slot || !sameDependencies(slot.dependencies, dependencies)) {
        slots[index] = { kind: "effect", dependencies, cleanup: slot?.cleanup ?? null };
        pendingEffects.push({ index, callback });
      }
    },
  };

  class FakeWebSocket {
    static OPEN = 1;
    static CONNECTING = 0;

    constructor(url) {
      this.url = url;
      this.readyState = FakeWebSocket.CONNECTING;
      this.sent = [];
      sockets.push(this);
    }

    send(value) {
      this.sent.push(JSON.parse(value));
    }

    close() {
      this.readyState = 3;
      this.onclose?.();
    }

    open() {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.();
    }

    receive(event) {
      this.onmessage?.({ data: JSON.stringify(event) });
    }
  }

  const module = { exports: {} };
  const dependencies = {
    react,
    "react/jsx-runtime": {
      jsx: (type, props) => ({ type, props }),
      jsxs: (type, props) => ({ type, props }),
    },
    "react-native": {
      AppState: { addEventListener: () => ({ remove() {} }) },
    },
    "@/src/lib/api": { apiJson, WS_URL: "wss://example.test/realtime" },
    "@/src/providers/SessionProvider": { useSession: () => session },
    i18next: { t: (...args) => mobileI18next.t(...args) },
  };
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const context = vm.createContext({
    exports: module.exports,
    module,
    require: (name) => {
      if (!(name in dependencies)) throw new Error(`Unexpected provider dependency: ${name}`);
      return dependencies[name];
    },
    WebSocket: FakeWebSocket,
    Math,
    setTimeout: (callback, delay) => {
      const id = nextTimer++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    console: { warn() {} },
  });
  vm.runInContext(compiled, context, { filename: "RealtimeProvider.runtime.js" });

  const Provider = module.exports.RealtimeProvider;
  function render(nextSession) {
    session = nextSession;
    cursor = 0;
    pendingEffects = [];
    const element = Provider({ children: null });
    return { value: element.props.value, effects: pendingEffects };
  }

  function commit(effects) {
    for (const effect of effects) {
      const slot = slots[effect.index];
      slot.cleanup?.();
      const cleanup = effect.callback();
      slot.cleanup = typeof cleanup === "function" ? cleanup : null;
    }
  }

  return { render, commit, sockets, timers };
}

test("an A socket cannot dispatch, revoke B, or send during B's render-to-effect gap", async () => {
  const runtime = createProviderRuntime({ apiJson: async () => ({ wsToken: "ws-token" }) });
  const invalidations = [];
  const a = { token: "token-A", user: { id: "account-A" }, invalidate: async (...args) => invalidations.push(args) };
  const first = runtime.render(a);
  runtime.commit(first.effects);
  await flush();
  const socketA = runtime.sockets[0];
  assert.ok(socketA);
  socketA.open();

  const received = [];
  first.value.subscribe((event) => received.push(event));

  const b = { token: "token-B", user: { id: "account-B" }, invalidate: async (...args) => invalidations.push(args) };
  const second = runtime.render(b);
  assert.equal(second.value.send({ type: "CALL_SIGNAL", toUserId: "account-B" }), false);
  socketA.receive({ type: "SESSION_REVOKED" });
  socketA.receive({ type: "DM_MESSAGE", id: "message-from-A" });

  assert.deepEqual(received, [], "stale A frames must not reach B's subscribers");
  assert.deepEqual(invalidations, [], "A's revocation frame must not invalidate B");
  assert.deepEqual(socketA.sent, [], "B's send callback must not reuse A's socket");
  assert.equal(second.value.lastEvent, null);

  runtime.commit(second.effects);
  await flush();
  const socketB = runtime.sockets[1];
  assert.ok(socketB);
  socketB.open();
  assert.equal(second.value.send({ type: "CALL_SIGNAL", toUserId: "account-B" }), true);
  assert.deepEqual(socketB.sent, [{ type: "CALL_SIGNAL", toUserId: "account-B" }]);

  socketB.receive({ type: "SESSION_REVOKED" });
  assert.equal(JSON.stringify(received), JSON.stringify([{ type: "SESSION_REVOKED" }]));
  assert.deepEqual(invalidations, [["This account was signed in somewhere else.", "token-B"]]);

  const current = runtime.render(b).value;
  assert.equal(JSON.stringify(current.lastEvent), JSON.stringify({ type: "SESSION_REVOKED" }));
  assert.equal(JSON.stringify(current.lastEventIdentity), JSON.stringify({ userId: "account-B", token: "token-B" }));
});

test("an A ws-token response arriving after B renders cannot create an A socket", async () => {
  const aliceTokenRequest = deferred();
  let firstRequest = true;
  const runtime = createProviderRuntime({
    apiJson: async (_path, _options, token) => {
      if (firstRequest && token === "token-A") {
        firstRequest = false;
        return aliceTokenRequest.promise;
      }
      return { wsToken: `ws-${token}` };
    },
  });
  const a = { token: "token-A", user: { id: "account-A" }, invalidate: async () => true };
  const first = runtime.render(a);
  runtime.commit(first.effects);
  await flush();

  const b = { token: "token-B", user: { id: "account-B" }, invalidate: async () => true };
  const second = runtime.render(b);
  aliceTokenRequest.resolve({ wsToken: "ws-token-A" });
  await flush();
  assert.equal(runtime.sockets.length, 0, "an obsolete credential response must not open A's socket");

  runtime.commit(second.effects);
  await flush();
  assert.equal(runtime.sockets.length, 1);
  runtime.sockets[0].open();
  assert.equal(second.value.send({ type: "CALL_SIGNAL" }), true);
  assert.deepEqual(runtime.sockets[0].sent, [{ type: "CALL_SIGNAL" }]);
});
