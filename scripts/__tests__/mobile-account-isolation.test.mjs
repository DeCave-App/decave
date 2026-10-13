import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

// Mobile screens show text through t(); slices run with the English catalogs.
await import("../test-support/i18n-english.mjs");
const { i18next } = await import("../../src/i18n/index.ts");
const t = (key, options) => i18next.t(key, options);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
const sessionSource = read("mobile/src/providers/SessionProvider.tsx");
const deviceSource = read("mobile/app/devices.tsx");
const realtimeSource = read("mobile/src/providers/RealtimeProvider.tsx");
const notificationSource = read("mobile/src/providers/NotificationProvider.tsx");

function requiredSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function sessionTokenRuntimeSource() {
  return read("mobile/src/lib/session-token.ts")
    .replace('return store ?? await import("expo-secure-store") as SessionTokenStore;', "return store ?? sessionStore;")
    .replace(/^export /gm, "");
}

function compile(code, globals = {}) {
  const context = vm.createContext(globals);
  const output = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  vm.runInContext(output, context, { filename: "mobile-account-isolation-runtime.ts" });
  return context;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

function secureStore({ blockDelete = false } = {}) {
  const values = new Map();
  const deleteStarted = deferred();
  const deleteGate = deferred();
  const control = { blockDelete, deleteBlocked: false, deleteStarted, deleteGate };
  return {
    values,
    control,
    store: {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only",
      async getItemAsync(key) {
        return values.get(key) ?? null;
      },
      async setItemAsync(key, value) {
        values.set(key, value);
      },
      async deleteItemAsync(key) {
        if (control.blockDelete && !control.deleteBlocked) {
          control.deleteBlocked = true;
          deleteStarted.resolve();
          await deleteGate.promise;
        }
        values.delete(key);
      },
    },
  };
}

const sessionKey = "decave.mobile.session.v1";

function sessionLogoutRuntime() {
  const storage = secureStore();
  const offlineRevoke = deferred();
  const state = { queueTokens: [], revokeTokens: [], authGeneration: 0, notice: "" };
  const logoutSnippet = requiredSlice(
    sessionSource,
    "const logout = async () => {",
    "const value = useMemo<SessionContextValue>",
  );
  const prelude = `
let token = "token-A";
let user = { id: "account-A" };
let loading = false;
const tokenRef = { current: token };
function setToken(value) { token = value; tokenRef.current = value; }
function setUser(value) { user = value; }
function beginAuthOperation() { return { generation: ++state.authGeneration }; }
function ownsAuthOperation(operation) { return operation.generation === state.authGeneration; }
function settleRestoreLoading() { loading = false; }
function beginNewLogin(value) {
  beginAuthOperation();
  const version = beginSessionTokenMutation();
  setToken(value);
  setUser({ id: "account-B" });
  return saveSessionToken(value, version);
}
globalThis.invokeLogout = logout;
globalThis.seedToken = (value) => saveSessionToken(value);
globalThis.loadSavedToken = () => loadSessionToken();
globalThis.startNewLogin = beginNewLogin;
globalThis.authState = () => ({ token, user, notice: state.notice });
`;
  const context = compile(`${sessionTokenRuntimeSource()}\n${logoutSnippet}\n${prelude}`, {
    sessionStore: storage.store,
    state,
    clearPushMemory() {},
    queuePushSessionRevocation: async (value) => {
      state.queueTokens.push(value);
      throw new Error("offline revocation queue unavailable");
    },
    revokePushSession: (value) => {
      state.revokeTokens.push(value);
      return offlineRevoke.promise;
    },
    pushRetryLifecycleRef: { current: null },
    setDraftAccount() {},
    setLastVoiceRoomAccount() {},
    setPendingChallenge() {},
    forgetSignedOutAccount: async () => {},
    setSessionNotice: (value) => {
      state.notice = value;
    },
    dmE2ee: { stop: async () => {} },
    mfaFlightRef: { current: null },
  });
  return { context, storage, offlineRevoke, state };
}

function deviceRuntime({ apiJson, blockDelete = false } = {}) {
  const storage = secureStore({ blockDelete });
  const state = { authGeneration: 0, invalidations: [], alerts: [], routes: [] };
  const invalidateSnippet = requiredSlice(
    sessionSource,
    'const invalidate = async (notice = "", expectedToken?: string) => {',
    "const restore = async () => {",
  ).replace("const invalidate = async", "const actualInvalidate = async");
  const logoutAllSnippet = requiredSlice(
    deviceSource,
    "const logoutAll = () => {",
    "const logoutSession = (session: DeviceSession) => {",
  );
  const prelude = `
let token = "token-A";
let user = { id: "account-A" };
let loading = false;
const tokenRef = { current: token };
function setToken(value) { token = value; tokenRef.current = value; }
function setUser(value) { user = value; }
function beginAuthOperation() { return { generation: ++state.authGeneration }; }
function ownsAuthOperation(operation) { return operation.generation === state.authGeneration; }
function settleRestoreLoading() { loading = false; }
const invalidationCalls = [];
const invalidate = (...args) => {
  invalidationCalls.push(args);
  return actualInvalidate(...args);
};
function startNewLogin(value) {
  beginAuthOperation();
  const version = beginSessionTokenMutation();
  setToken(value);
  setUser({ id: "account-B" });
  return saveSessionToken(value, version);
}
globalThis.seedToken = (value) => saveSessionToken(value);
globalThis.startNewLogin = startNewLogin;
globalThis.invalidationState = () => [...invalidationCalls];
`;
  const context = compile(
    `${sessionTokenRuntimeSource()}\n${invalidateSnippet}\n${prelude}\n${logoutAllSnippet}\nglobalThis.invokeLogoutAll = logoutAll;`,
    {
      sessionStore: storage.store,
      state,
      Alert: { alert: (...args) => state.alerts.push(args) },
      t,
      apiJson,
      router: { replace: (route) => state.routes.push(route) },
      clearPushMemory() {},
      setDraftAccount() {},
      setLastVoiceRoomAccount() {},
      setPendingChallenge() {},
      setSessionNotice() {},
    },
  );
  return { context, storage, state };
}

function realtimeRuntime(userId, token) {
  const state = { entry: null };
  const socket = { send() {} };
  const identityRef = { current: { userId, token } };
  const lifecycleRef = { current: 1 };
  const socketRef = { current: socket };
  const socketOwnerRef = {
    current: { socket, lifecycle: 1, userId, token },
  };
  const handler = requiredSlice(realtimeSource, "socket.onmessage = (message) => {", "socket.onerror = () => {");
  const context = compile(handler, {
    lifecycle: 1,
    lifecycleRef,
    disposed: false,
    user: { id: userId },
    token,
    identityRef,
    socketRef,
    socketOwnerRef,
    listenersRef: { current: new Set() },
    socket,
    ownsSocket: (candidate) =>
      lifecycleRef.current === 1 &&
      identityRef.current.userId === userId &&
      identityRef.current.token === token &&
      socketRef.current === candidate &&
      socketOwnerRef.current?.socket === candidate &&
      socketOwnerRef.current.lifecycle === 1 &&
      socketOwnerRef.current.userId === userId &&
      socketOwnerRef.current.token === token,
    wsToken: "ws-token",
    attemptsRef: { current: 0 },
    setLastEventEntry: (entry) => {
      state.entry = entry;
    },
    setConnectionId() {},
    setConnectionState() {},
    invalidate: async () => true,
  });
  return {
    state,
    identityRef,
    deliver(event) {
      context.socket.onmessage({ data: JSON.stringify(event) });
    },
  };
}

function notificationRuntime({ user, token, event, eventIdentity }) {
  let effectCallback;
  const open = deferred();
  const state = { openCalls: 0, scheduled: [] };
  const eventGuard = notificationSource.indexOf("lastEventIdentity?.userId !== user.id");
  assert.notEqual(eventGuard, -1, "missing notification event owner guard");
  const effectStart = notificationSource.lastIndexOf("useEffect(() => {", eventGuard);
  const effectEnd = notificationSource.indexOf("const value = useMemo<NotificationContextValue>", effectStart);
  assert.notEqual(effectStart, -1, "missing notification effect");
  assert.notEqual(effectEnd, -1, "missing end of notification effect");
  const effectSnippet = notificationSource.slice(effectStart, effectEnd);
  const context = compile(effectSnippet, {
    useEffect: (callback) => {
      effectCallback = callback;
    },
    lastEvent: event,
    lastEventIdentity: eventIdentity,
    user,
    token,
    permissionState: "granted",
    settingsRef: {
      current: {
        enabled: true,
        dms: true,
        groups: true,
        mentions: true,
        hubMessages: true,
        sound: false,
        notificationPreview: "sender-and-message",
      },
    },
    identityRef: { current: { userId: user?.id ?? null, token } },
    lastHandledRef: { current: null },
    mutedRef: { current: new Set() },
    pathnameRef: { current: "/" },
    Platform: { OS: "android" },
    Notifications: {
      scheduleNotificationAsync: async (request) => {
        state.scheduled.push(request);
      },
    },
    dmE2ee: {
      open: (message) => {
        state.openCalls += 1;
        state.openedMessage = message;
        return open.promise;
      },
    },
    stringValue: (value) => (typeof value === "string" ? value : ""),
    privacyText: (_mode, sender, text) => ({ title: sender, body: text }),
  });
  return {
    context,
    state,
    open,
    run() {
      effectCallback();
    },
  };
}

test("logout clears the saved token when queueing revocation fails and an old offline retry cannot delete the next login", async () => {
  const runtime = sessionLogoutRuntime();
  await runtime.context.seedToken("token-A");
  assert.equal(runtime.storage.values.get(sessionKey), "token-A");

  await runtime.context.invokeLogout();
  assert.equal(runtime.state.queueTokens[0], "token-A");
  assert.equal(runtime.state.revokeTokens[0], "token-A", "failed queueing should attempt offline revocation");
  assert.equal(
    runtime.storage.values.has(sessionKey),
    false,
    "logout must clear local credentials despite failed revocation queueing",
  );
  assert.equal(runtime.context.authState().token, null);

  await runtime.context.startNewLogin("token-B");
  assert.equal(runtime.storage.values.get(sessionKey), "token-B");
  runtime.offlineRevoke.resolve();
  await flush();

  assert.equal(
    runtime.storage.values.get(sessionKey),
    "token-B",
    "a delayed A revocation retry must not clear B's saved credential",
  );
  assert.equal(await runtime.context.loadSavedToken(), "token-B");
});

test("logout-all reports failures, navigates after acknowledgement, and ignores stale account completions", async () => {
  const rejected = deviceRuntime({
    apiJson: async () => {
      throw new Error("server rejected logout-all");
    },
  });
  await rejected.context.seedToken("token-A");
  rejected.context.invokeLogoutAll();
  rejected.state.alerts[0][2][1].onPress();
  await flush();
  assert.equal(
    rejected.context.invalidationState().length,
    0,
    "a rejected server request must not invalidate the local session",
  );
  assert.deepEqual(rejected.state.routes, [], "a rejected server request must not navigate to login");
  assert.equal(rejected.storage.values.get(sessionKey), "token-A");
  assert.equal(rejected.state.alerts[1][0], "Could not log out all sessions");

  const acknowledged = deviceRuntime({ apiJson: async () => ({ ok: true }) });
  await acknowledged.context.seedToken("token-A");
  acknowledged.context.invokeLogoutAll();
  acknowledged.state.alerts[0][2][1].onPress();
  await flush();
  const acknowledgedInvalidations = acknowledged.context.invalidationState();
  assert.equal(acknowledgedInvalidations.length, 1);
  assert.equal(acknowledgedInvalidations[0][0], "All DeCave sessions were signed out.");
  assert.equal(acknowledgedInvalidations[0][1], "token-A");
  assert.deepEqual(
    acknowledged.state.routes,
    ["/login"],
    "an acknowledged logout-all should navigate after invalidation completes",
  );
  assert.equal(acknowledged.storage.values.has(sessionKey), false);

  const response = deferred();
  const staleResponse = deviceRuntime({ apiJson: () => response.promise });
  await staleResponse.context.seedToken("token-A");
  staleResponse.context.invokeLogoutAll();
  staleResponse.state.alerts[0][2][1].onPress();
  await flush();
  await staleResponse.context.startNewLogin("token-B");
  response.resolve({ ok: true });
  await flush();
  assert.equal(
    staleResponse.context.invalidationState().length,
    0,
    "a response for A must not invalidate a session switched to B before acknowledgement",
  );
  assert.deepEqual(staleResponse.state.routes, []);
  assert.equal(staleResponse.storage.values.get(sessionKey), "token-B");

  const blockedResponse = deferred();
  const staleInvalidation = deviceRuntime({ apiJson: () => blockedResponse.promise, blockDelete: true });
  await staleInvalidation.context.seedToken("token-A");
  staleInvalidation.context.invokeLogoutAll();
  staleInvalidation.state.alerts[0][2][1].onPress();
  blockedResponse.resolve({ ok: true });
  await staleInvalidation.storage.control.deleteStarted.promise;
  const replacementLogin = staleInvalidation.context.startNewLogin("token-B");
  staleInvalidation.storage.control.deleteGate.resolve();
  await replacementLogin;
  await flush();
  assert.equal(staleInvalidation.context.invalidationState().length, 1);
  assert.deepEqual(
    staleInvalidation.state.routes,
    [],
    "a stale invalidate completion must not navigate after a newer login",
  );
  assert.equal(
    staleInvalidation.storage.values.get(sessionKey),
    "token-B",
    "the old clear must not delete the newer credential",
  );
});

test("notifications reject events owned by another account and decrypted messages that finish after an account switch", async () => {
  const realtime = realtimeRuntime("account-A", "token-A");
  const message = {
    type: "DM_MESSAGE",
    message: { id: "dm-1", fromUserId: "sender", toUserId: "account-A", text: "ciphertext" },
    sender: { username: "Sender" },
  };
  realtime.deliver(message);
  assert.equal(realtime.state.entry.event.type, "DM_MESSAGE");
  assert.equal(realtime.state.entry.identity.userId, "account-A");
  assert.equal(realtime.state.entry.identity.token, "token-A");

  const staleSocket = realtimeRuntime("account-A", "token-A");
  staleSocket.identityRef.current = { userId: "account-B", token: "token-B" };
  staleSocket.deliver(message);
  assert.equal(staleSocket.state.entry, null, "an A socket must not emit after the active identity changes to B");

  const afterSwitch = notificationRuntime({
    user: { id: "account-B" },
    token: "token-B",
    event: realtime.state.entry.event,
    eventIdentity: realtime.state.entry.identity,
  });
  afterSwitch.run();
  assert.equal(afterSwitch.state.openCalls, 0, "an A-owned realtime event must not reach B's notification decryptor");
  assert.equal(afterSwitch.state.scheduled.length, 0);

  const wrongRecipient = notificationRuntime({
    user: { id: "account-B" },
    token: "token-B",
    event: message,
    eventIdentity: { userId: "account-B", token: "token-B" },
  });
  wrongRecipient.run();
  assert.equal(wrongRecipient.state.openCalls, 0, "a correctly owned event addressed to another user must not notify");

  const lateDecrypt = notificationRuntime({
    user: { id: "account-B" },
    token: "token-B",
    event: {
      type: "DM_MESSAGE",
      message: { id: "dm-2", fromUserId: "sender", toUserId: "account-B", text: "ciphertext" },
      sender: { username: "Sender" },
    },
    eventIdentity: { userId: "account-B", token: "token-B" },
  });
  lateDecrypt.run();
  assert.equal(lateDecrypt.state.openCalls, 1);
  lateDecrypt.context.identityRef.current = { userId: "account-C", token: "token-C" };
  lateDecrypt.open.resolve({ e2ee: "plain", text: "message for B" });
  await flush();
  assert.equal(
    lateDecrypt.state.scheduled.length,
    0,
    "decrypt completion for B must not schedule after switching to C",
  );

  const currentDecrypt = notificationRuntime({
    user: { id: "account-B" },
    token: "token-B",
    event: {
      type: "DM_MESSAGE",
      message: { id: "dm-3", fromUserId: "sender", toUserId: "account-B", text: "ciphertext" },
      sender: { username: "Sender" },
    },
    eventIdentity: { userId: "account-B", token: "token-B" },
  });
  currentDecrypt.run();
  currentDecrypt.open.resolve({ e2ee: "plain", text: "message for B" });
  await flush();
  assert.equal(currentDecrypt.state.scheduled.length, 1, "a current account's message should still schedule normally");
});
