import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);

const { AccountSessionGuard, commitForSession } = await import("../../src/app/account-session-guard.ts");
const { listHubEvents } = await import("../../src/features/events/api.ts");
const { loadAuthenticatedAttachmentImage } = await import("../../mobile/src/lib/legacy-attachment-download.ts");
const { enqueuePushAction, processPendingPushActions } = await import("../../mobile/src/lib/push-revocation-queue.ts");
const { DEFAULT_NOTIFICATION_SETTINGS, NotificationSettingsStore, notificationSettingsStorageKey } =
  await import("../../mobile/src/lib/notification-settings-store.ts");
const { accountExportStatus } = await import("../../shared/account-export.ts");

globalThis.window = { location: { origin: "https://client.example.test" } };
const { createHubDirectoryActions } = await import("../../src/app/actions/hub-directory.ts");
delete globalThis.window;

const root = path.resolve(process.cwd());

function compileClientModule(relativePath, globals) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8").replace(/^import[\s\S]*?;\s*$/gm, "");
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const context = vm.createContext({ console: { ...console, warn: () => {} }, exports: {}, ...globals });
  vm.runInContext(`${output}\nglobalThis.__clientExports = exports;`, context, { filename: relativePath });
  return context.__clientExports;
}

function createDraftHookHarness() {
  let state;
  let stateInitialized = false;
  let ref;
  let effectDeps;
  return {
    react: {
      useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
      useState: (initial) => {
        if (!stateInitialized) {
          state = initial();
          stateInitialized = true;
        }
        return [state, (next) => (state = typeof next === "function" ? next(state) : next)];
      },
      useRef: (initial) => (ref ??= { current: initial }),
      useEffect: (callback, deps) => {
        if (!effectDeps || deps.some((dep, index) => !Object.is(dep, effectDeps[index]))) {
          effectDeps = deps;
          callback();
        }
      },
      useCallback: (callback) => callback,
    },
    render: (useDraftInput, key) => useDraftInput(key),
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function eventsContext(guard, snapshot, scopeKey, authorizedFetch) {
  return {
    baseUrl: "https://api.example.test",
    authorizedFetch,
    sessionGuard: guard,
    sessionSnapshot: snapshot,
    scopeKey,
    isScopeCurrent: () => true,
  };
}

test("a delayed Hub events response from account A is rejected after switching to B", async () => {
  const guard = new AccountSessionGuard();
  const snapshotA = guard.switchTo("account-a");
  const responseA = deferred();
  const requestA = listHubEvents(
    eventsContext(guard, snapshotA, "1|hub:member", async () => responseA.promise),
    1,
    0,
    10,
  );

  const snapshotB = guard.switchTo("account-b");
  let committed = false;
  const bResponse = await listHubEvents(
    eventsContext(guard, snapshotB, "2|hub:member", async () =>
      Response.json({ events: [], truncated: false, canCreate: true }),
    ),
    1,
    0,
    10,
  );
  assert.equal(bResponse.canCreate, true);
  commitForSession(guard, snapshotB, bResponse, () => {
    committed = true;
  });

  responseA.resolve(Response.json({ events: [], truncated: false, canCreate: false }));
  await assert.rejects(requestA, /account or Hub access changed/i);
  assert.equal(committed, true);

  const staleCommit = commitForSession(guard, snapshotA, { account: "account-a" }, () => {
    committed = false;
  });
  assert.equal(staleCommit, false);
  assert.equal(committed, true);
});

test("a delayed /api/servers response from account A cannot replace account B's Hub list", async () => {
  const guard = new AccountSessionGuard();
  const staleJson = deferred();
  let staleJsonStarted = false;
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    if (fetchCount === 1)
      return {
        ok: true,
        json: () => {
          staleJsonStarted = true;
          return staleJson.promise;
        },
      };
    return Response.json([]);
  };
  const servers = [];
  const makeActions = (snapshot) =>
    createHubDirectoryActions({
      authToken: "session",
      setServers: (value) => {
        servers.value = typeof value === "function" ? value(servers.value ?? []) : value;
      },
      setSelectedServer: () => {},
      setSelectedChannel: () => {},
      setMessages: () => {},
      setDiscoverServers: () => {},
      setDiscoverLoading: () => {},
      setDiscoverError: () => {},
      activeServerRef: { current: 0 },
      activeChannelRef: { current: 0 },
      sessionGuard: guard,
      sessionSnapshot: snapshot,
    });

  try {
    const requestA = makeActions(guard.switchTo("account-a")).loadServers();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(staleJsonStarted, true);

    const requestB = makeActions(guard.switchTo("account-b")).loadServers();
    await requestB;
    assert.deepEqual(servers.value, []);
    staleJson.resolve([{ id: 101, channels: [] }]);
    await requestA;
    assert.deepEqual(servers.value, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("authenticated image fetch rejects external destinations and redirects but preserves valid attachment bodies", async () => {
  const calls = [];
  const baseUrl = "https://api.example.test";
  const fetcher = async (path, init, token) => {
    calls.push({ path, init, token });
    const response = new Response(Uint8Array.from([137, 80, 78, 71]), {
      status: 200,
      headers: { "content-type": "image/png", "content-length": "4" },
    });
    Object.defineProperty(response, "url", { value: `${baseUrl}${path}` });
    return response;
  };

  await assert.rejects(
    loadAuthenticatedAttachmentImage({
      url: "https://attacker.example/uploads/attachments/private.png",
      baseUrl,
      token: "session-secret",
      apiFetch: fetcher,
    }),
    /origin|attachment/i,
  );
  await assert.rejects(
    loadAuthenticatedAttachmentImage({
      url: "https://api.example.test/uploads/attachments/%2e%2e/private.png",
      baseUrl,
      token: "session-secret",
      apiFetch: fetcher,
    }),
    /path|separator|attachment/i,
  );
  assert.equal(calls.length, 0);

  const dataUri = await loadAuthenticatedAttachmentImage({
    url: "https://api.example.test/uploads/attachments/room/photo.png",
    baseUrl,
    token: "session-secret",
    apiFetch: fetcher,
  });
  assert.equal(dataUri, "data:image/png;base64,iVBORw==");
  assert.equal(calls[0].token, "session-secret");
  assert.equal(calls[0].path, "/uploads/attachments/room/photo.png");
  assert.equal(calls[0].init.redirect, "error");

  const redirectingFetch = async () => {
    const response = new Response(Uint8Array.from([1]), { status: 200, headers: { "content-type": "image/png" } });
    Object.defineProperties(response, {
      url: { value: "https://cdn.example.test/uploads/attachments/photo.png" },
      redirected: { value: true },
    });
    return response;
  };
  await assert.rejects(
    loadAuthenticatedAttachmentImage({
      url: "https://api.example.test/uploads/attachments/room/photo.png",
      baseUrl,
      token: "session-secret",
      apiFetch: redirectingFetch,
    }),
    /redirected/i,
  );
});

test("offline logout/unlink actions remain queued for retry before a new account registers", async () => {
  const accountAUnlink = { kind: "unlink", sessionToken: "session-a", pushToken: "expo-a" };
  const accountBUnlink = { kind: "unlink", sessionToken: "session-b", pushToken: "expo-b" };
  let pending = enqueuePushAction([accountAUnlink, accountBUnlink], { kind: "logout", sessionToken: "session-a" });
  assert.deepEqual(pending, [accountBUnlink, { kind: "logout", sessionToken: "session-a" }]);

  const offline = await processPendingPushActions(pending, async () => {
    throw new Error("offline");
  });
  pending = offline.remaining;
  assert.deepEqual(pending, [accountBUnlink, { kind: "logout", sessionToken: "session-a" }]);

  const retry = await processPendingPushActions(pending, async (action) => ({
    ok: action.kind === "logout",
    status: action.kind === "logout" ? 200 : 401,
  }));
  assert.deepEqual(retry.remaining, []);
  assert.deepEqual(retry.acknowledged, pending);
});

test("notification settings default privately across accounts and reject late account hydration", () => {
  const store = new NotificationSettingsStore();
  const sessionA = store.activate("account-a", "session-a");
  assert.ok(sessionA);
  assert.equal(store.hydrateServer(sessionA, { notificationPreview: "full" }), true);
  assert.equal(store.settingsFor(sessionA.key).notificationPreview, "full");

  const sessionBKey = store.sessionKey("account-b", "session-b");
  assert.deepEqual(store.settingsFor(sessionBKey), DEFAULT_NOTIFICATION_SETTINGS);
  const sessionB = store.activate("account-b", "session-b");
  assert.ok(sessionB);
  assert.equal(store.settingsFor(sessionB.key).notificationPreview, "hidden");
  assert.equal(store.hydrateServer(sessionA, { notificationPreview: "full" }), false);
  store.hydrateLocal(sessionB, { notificationPreview: "full" });
  assert.equal(store.hydrateServer(sessionB, { notificationPreview: "hidden" }), true);
  assert.equal(store.settingsFor(sessionB.key).notificationPreview, "hidden");

  const key = notificationSettingsStorageKey("account-b");
  assert.match(key, /^[\w.-]+$/);
});

test("drafts and last voice room reject stale account hydration and keep storage per account", async () => {
  const draftA = deferred();
  const voiceA = deferred();
  const scheduledTimers = [];
  const writes = [];
  const scheduleTimer = (callback) => {
    scheduledTimers.push(callback);
    return scheduledTimers.length;
  };
  const secureStore = {
    deleteItemAsync: async (key) => assert.match(key, /^[\w.-]+$/),
    getItemAsync: async (key) => {
      assert.match(key, /^[\w.-]+$/);
      if (key === "decave.drafts.v2.61.63.63.6f.75.6e.74.2d.61") return draftA.promise;
      if (key === "decave.drafts.v2.61.63.63.6f.75.6e.74.2d.62") return JSON.stringify({ room: "B draft" });
      if (key === "decave.lastVoiceRoom.v2.61.63.63.6f.75.6e.74.2d.61") return voiceA.promise;
      if (key === "decave.lastVoiceRoom.v2.61.63.63.6f.75.6e.74.2d.62")
        return JSON.stringify({ channelId: 22, hubId: 2, name: "B room" });
      return null;
    },
    setItemAsync: async (key, value) => {
      assert.match(key, /^[\w.-]+$/);
      writes.push({ key, value });
    },
  };
  const drafts = compileClientModule("mobile/src/lib/drafts.ts", {
    SecureStore: secureStore,
    setTimeout: scheduleTimer,
    clearTimeout: () => {},
  });
  const voice = compileClientModule("mobile/src/lib/last-voice-room.ts", {
    SecureStore: secureStore,
    setTimeout: scheduleTimer,
    clearTimeout: () => {},
  });

  drafts.setDraftAccount("account-a");
  voice.setLastVoiceRoomAccount("account-a");
  const staleVoiceLoad = voice.loadLastVoiceRoom();
  drafts.setDraftAccount("account-b");
  voice.setLastVoiceRoomAccount("account-b");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drafts.getDraft("room"), "B draft");
  assert.equal(
    JSON.stringify(await voice.loadLastVoiceRoom()),
    JSON.stringify({ channelId: 22, hubId: 2, name: "B room" }),
  );

  draftA.resolve(JSON.stringify({ room: "A secret draft" }));
  voiceA.resolve(JSON.stringify({ channelId: 11, hubId: 1, name: "A secret room" }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drafts.getDraft("room"), "B draft");
  assert.equal(await staleVoiceLoad, null);

  drafts.setDraft("persisted", "B save");
  scheduledTimers.at(-1)();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes, [
    {
      key: "decave.drafts.v2.61.63.63.6f.75.6e.74.2d.62",
      value: JSON.stringify({ room: "B draft", persisted: "B save" }),
    },
  ]);
});

test("logout deletes drafts and last-room writes that were already in flight without touching device settings", async () => {
  const values = new Map([["device.settings", "keep"]]);
  const draftWriteStarted = deferred();
  const finishDraftWrite = deferred();
  const voiceWriteStarted = deferred();
  const finishVoiceWrite = deferred();
  const secureStore = {
    deleteItemAsync: async (key) => values.delete(key),
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => {
      if (key.startsWith("decave.drafts.")) {
        draftWriteStarted.resolve();
        await finishDraftWrite.promise;
      } else if (key.startsWith("decave.lastVoiceRoom.")) {
        voiceWriteStarted.resolve();
        await finishVoiceWrite.promise;
      }
      values.set(key, value);
    },
  };
  const scheduledTimers = [];
  const drafts = compileClientModule("mobile/src/lib/drafts.ts", {
    SecureStore: secureStore,
    setTimeout: (callback) => (scheduledTimers.push(callback), scheduledTimers.length),
    clearTimeout: () => {},
  });
  const voice = compileClientModule("mobile/src/lib/last-voice-room.ts", { SecureStore: secureStore });

  drafts.setDraftAccount("logout-a");
  drafts.setDraft("private-room", "private draft");
  scheduledTimers.at(-1)();
  await draftWriteStarted.promise;
  drafts.setDraftAccount(null);
  finishDraftWrite.resolve();
  await new Promise((resolve) => setImmediate(resolve));

  voice.setLastVoiceRoomAccount("logout-a");
  const pendingVoiceWrite = voice.saveLastVoiceRoom({ channelId: 71, hubId: 7, name: "Private room" });
  await voiceWriteStarted.promise;
  voice.setLastVoiceRoomAccount(null);
  finishVoiceWrite.resolve();
  await pendingVoiceWrite;
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(
    [...values.keys()].some((key) => key.startsWith("decave.drafts.")),
    false,
  );
  assert.equal(
    [...values.keys()].some((key) => key.startsWith("decave.lastVoiceRoom.")),
    false,
  );
  assert.equal(values.get("device.settings"), "keep");
});

test("useDraftInput refreshes after delayed secure-store hydration", async () => {
  const hydration = deferred();
  const secureStore = {
    deleteItemAsync: async (key) => assert.match(key, /^[\w.-]+$/),
    getItemAsync: async (key) => {
      assert.match(key, /^[\w.-]+$/);
      return key === "decave.drafts.v2.61.63.63.6f.75.6e.74.2d.63" ? hydration.promise : null;
    },
    setItemAsync: async (key) => assert.match(key, /^[\w.-]+$/),
  };
  const hooks = createDraftHookHarness();
  const drafts = compileClientModule("mobile/src/lib/drafts.ts", {
    SecureStore: secureStore,
    ...hooks.react,
    setTimeout: () => 1,
    clearTimeout: () => {},
  });
  drafts.setDraftAccount("account-c");
  const render = () => hooks.render(drafts.useDraftInput, "room")[0];
  assert.equal(render(), "");

  hydration.resolve(JSON.stringify({ room: "Hydrated draft" }));
  await new Promise((resolve) => setImmediate(resolve));
  render();
  assert.equal(render(), "Hydrated draft");

  const typedHydration = deferred();
  const typedStore = {
    deleteItemAsync: async (key) => assert.match(key, /^[\w.-]+$/),
    getItemAsync: async (key) => {
      assert.match(key, /^[\w.-]+$/);
      return typedHydration.promise;
    },
    setItemAsync: async (key) => assert.match(key, /^[\w.-]+$/),
  };
  const typedHooks = createDraftHookHarness();
  const typedDrafts = compileClientModule("mobile/src/lib/drafts.ts", {
    SecureStore: typedStore,
    ...typedHooks.react,
    setTimeout: () => 1,
    clearTimeout: () => {},
  });
  typedDrafts.setDraftAccount("account-d");
  const [initialInput, setInput] = typedHooks.render(typedDrafts.useDraftInput, "room");
  assert.equal(initialInput, "");
  setInput("Typed while loading");
  typedHydration.resolve(JSON.stringify({ room: "Old saved draft" }));
  await new Promise((resolve) => setImmediate(resolve));
  typedHooks.render(typedDrafts.useDraftInput, "room");
  const [currentInput] = typedHooks.render(typedDrafts.useDraftInput, "room");
  assert.equal(currentInput, "Typed while loading");
});

test("home notes are saved and loaded from account-scoped keys and discard the legacy global value", () => {
  const values = new Map([["decave_home_notes_v1", "legacy private note"]]);
  const localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const home = compileClientModule("src/app/home-dashboard.ts", { localStorage, URL });

  assert.equal(home.loadHomeNotes("account-a"), "");
  home.saveHomeNotes("account-a", "A note");
  home.saveHomeNotes("account-b", "B note");
  assert.equal(home.loadHomeNotes("account-a"), "A note");
  assert.equal(home.loadHomeNotes("account-b"), "B note");
  assert.equal(values.has("decave_home_notes_v1"), false);
});

test("logout purge removes only that account's notes and forum draft and rejects a late forum save", () => {
  const values = new Map();
  const localStorage = {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const home = compileClientModule("src/app/home-dashboard.ts", { localStorage, URL });
  const forum = compileClientModule("src/features/forum/forumModel.ts", { window: { localStorage } });
  values.set(home.homeNotesStorageKey("account-a"), "A private note");
  values.set(home.homeNotesStorageKey("account-b"), "B private note");
  const staleVersion = forum.forumDraftSessionVersion("account-a");
  forum.saveForumDraft("account-a", 9, { body: "A private post" }, staleVersion);
  forum.saveForumDraft("account-b", 9, { body: "B private post" });

  values.delete(home.homeNotesStorageKey("account-a"));
  forum.clearForumDraftsForAccount("account-a");
  forum.saveForumDraft("account-a", 9, { body: "late save from old session" }, staleVersion);

  assert.equal(values.has(home.homeNotesStorageKey("account-a")), false);
  assert.equal(values.has(forum.forumDraftStorageKey("account-a", 9)), false);
  assert.equal(values.get(home.homeNotesStorageKey("account-b")), "B private note");
  assert.deepEqual(JSON.parse(values.get(forum.forumDraftStorageKey("account-b", 9))), { body: "B private post" });
});

test("legacy and proxied GIPHY URLs resolve only to the authenticated same-origin media proxy", () => {
  const apiBase = "https://api.example.test";
  const mobileMedia = compileClientModule("mobile/src/lib/chat-media.ts", { API_BASE: apiBase, URL });
  const webMedia = compileClientModule("src/app/message-payloads.ts", { HTTP_URL: apiBase, URL });
  const legacy = "https://media.giphy.com/media/abc/giphy.webp";
  const returnedProxy = "/api/giphy/media?url=https%3A%2F%2Fmedia.giphy.com%2Fmedia%2Fabc%2Fgiphy.webp";
  for (const media of [mobileMedia, webMedia]) {
    assert.equal(new URL(media.safeGiphyUrl(legacy)).origin, apiBase);
    assert.equal(new URL(media.safeGiphyUrl(returnedProxy)).pathname, "/api/giphy/media");
    assert.equal(media.safeGiphyUrl("/api/giphy/media?url=https%3A%2F%2Fevil.example%2Fx.png"), null);
    assert.equal(media.safeGiphyUrl("https://evil.example/api/giphy/media"), null);
    assert.equal(media.safeGiphyUrl("//evil.example/image.webp"), null);
  }

  const mediaSource = fs.readFileSync(path.join(root, "mobile/src/components/MessageMedia.tsx"), "utf8");
  const composerSource = fs.readFileSync(path.join(root, "mobile/src/components/ComposerMediaSheet.tsx"), "utf8");
  assert.match(mediaSource, /isGiphyProxyUrl\(url\)[\s\S]*Authorization: `Bearer \$\{token\}`/);
  assert.match(composerSource, /item\.previewUrl\.startsWith\("\/"\) \? `\$\{API_BASE\}\$\{item\.previewUrl\}`/);
  assert.match(composerSource, /Authorization: `Bearer \$\{token\}`/);
});

test("account export clients recognize complete streams and surface interrupted exports", () => {
  assert.deepEqual(accountExportStatus('{"friends":[],"complete":true}'), { complete: true });
  assert.deepEqual(accountExportStatus('{"friends":[],"complete":false,"error":"Retry the download."}'), {
    complete: false,
    error: "Retry the download.",
  });
  assert.deepEqual(accountExportStatus('{"friends":['), {
    complete: false,
    error: "The export did not finish. Retry the download.",
  });
});
