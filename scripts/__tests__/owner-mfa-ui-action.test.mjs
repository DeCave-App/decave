import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const actionSource = await readFile(new URL("../../src/app/actions/admin.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(actionSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});

function loadAdminActions() {
  const module = { exports: {} };
  const windowStub = { setTimeout: () => 1, clearTimeout: () => {} };
  const requireStub = (specifier) => {
    if (specifier === "../env") return { HTTP_URL: "https://api.example" };
    if (specifier === "../locale") return { localeForLanguage: () => "en", preferredTimeOptions: () => ({}) };
    if (specifier === "../desktop") return { hasDesktopActivityBridge: () => false };
    throw new Error(`Unexpected import in admin action test: ${specifier}`);
  };
  new Function("require", "module", "exports", "window", outputText)(requireStub, module, module.exports, windowStub);
  return module.exports.createAdminActions;
}

function stateProxy(initial, calls) {
  return new Proxy(initial, {
    get(target, property) {
      if (property in target) return target[property];
      if (typeof property === "string" && property.startsWith("set")) {
        return (value) => {
          calls.push([property, value]);
        };
      }
      return undefined;
    },
  });
}

function makeHarness({
  mfaEnabled = false,
  mfaPassword = "",
  reauthPassword = "",
  reauthCode = "",
  reauthToken = "",
  reauthExpiresAt = 0,
  response,
  responsePromise,
} = {}) {
  const stateCalls = [];
  const requests = [];
  const accountEditAccountIdRef = { current: "owner-1" };
  const ownerSecurityRoleRef = { current: true };
  const ownerSecurityOperationRef = { current: null };
  const ownerPrivilegedContextRef = {
    current: reauthToken ? { accountId: "owner-1" } : null,
  };
  const ownerSecurity = stateProxy(
    {
      ownerMfaEnabledState: mfaEnabled,
      ownerMfaCode: "",
      ownerMfaPassword: mfaPassword,
      ownerReauthPassword: reauthPassword,
      ownerReauthCode: reauthCode,
      ownerReauthToken: reauthToken,
      ownerReauthExpiresAt: reauthExpiresAt,
      platformOwnerActive: true,
    },
    stateCalls,
  );
  const adminDashboard = stateProxy({}, stateCalls);
  const authForm = stateProxy({}, stateCalls);
  const actions = loadAdminActions()({
    currentUser: { id: "owner-1" },
    setCurrentUser: () => {},
    setAuthReady: () => {},
    setAuthMode: () => {},
    setTurnstileToken: () => {},
    setTurnstileNonce: () => {},
    setAuthError: () => {},
    setShowSettings: () => {},
    accountEditAccountIdRef,
    ownerSecurityRoleRef,
    ownerSecurityOperationRef,
    ownerLoginChallengeToken: "",
    setOwnerLoginChallengeToken: () => {},
    ownerLoginMfaCode: "",
    setOwnerLoginMfaCode: () => {},
    setOwnerLoginMfaBusy: () => {},
    setShowAdminDashboard: () => {},
    setAdminDashboardTab: () => {},
    setShowHome: () => {},
    setShowServerBrowser: () => {},
    setShowSocial: () => {},
    ownerPrivilegedContextRef,
    storeToken: () => {},
    authorizedFetch: async (url, init) => {
      requests.push({ url, init });
      return responsePromise ?? response ?? new Response("{}", { status: 500 });
    },
    closePrimaryTransientOverlays: () => {},
    adminDashboard,
    ownerSecurity,
    authForm,
  });

  return { actions, accountEditAccountIdRef, ownerSecurityOperationRef, requests, stateCalls };
}

const successfulSetup = () =>
  new Response(
    JSON.stringify({
      secret: "ABCDEFGHIJKLMNOP",
      otpauth: "otpauth://totp/DeCave:owner?secret=ABCDEFGHIJKLMNOP",
    }),
    { status: 200 },
  );

test("owner MFA bootstrap keeps the password-only setup contract", async () => {
  const harness = makeHarness({ mfaPassword: "bootstrap-password", response: successfulSetup() });

  await harness.actions.startOwnerMfaSetup();

  const request = harness.requests[0];
  assert.equal(request.url, "https://api.example/api/admin/security/mfa/setup");
  assert.deepEqual(JSON.parse(request.init.body), { currentPassword: "bootstrap-password" });
  assert.equal(new Headers(request.init.headers).has("X-DeCave-Owner-Reauth"), false);
  assert.ok(harness.stateCalls.some(([name, value]) => name === "setOwnerMfaSecret" && value === "ABCDEFGHIJKLMNOP"));
});

test("enabled owner MFA replacement sends password and current factor proof", async () => {
  const harness = makeHarness({
    mfaEnabled: true,
    reauthPassword: "replacement-password",
    reauthCode: "ABCD-EFGH-IJKL-MNOP",
    response: successfulSetup(),
  });

  await harness.actions.startOwnerMfaSetup();

  const request = harness.requests[0];
  assert.deepEqual(JSON.parse(request.init.body), {
    currentPassword: "replacement-password",
    mfaCode: "ABCD-EFGH-IJKL-MNOP",
  });
  assert.equal(new Headers(request.init.headers).has("X-DeCave-Owner-Reauth"), false);
  assert.ok(harness.stateCalls.some(([name, value]) => name === "setOwnerMfaEnabledState" && value === false));
  assert.ok(harness.stateCalls.some(([name, value]) => name === "setOwnerRecoveryCodes" && value.length === 0));
});

test("enabled owner MFA replacement can use a valid owner reauth header", async () => {
  const harness = makeHarness({
    mfaEnabled: true,
    reauthPassword: "replacement-password",
    reauthToken: "owner-reauth-token",
    reauthExpiresAt: Date.now() + 60_000,
    response: successfulSetup(),
  });

  await harness.actions.startOwnerMfaSetup();

  const request = harness.requests[0];
  assert.deepEqual(JSON.parse(request.init.body), { currentPassword: "replacement-password" });
  assert.equal(new Headers(request.init.headers).get("X-DeCave-Owner-Reauth"), "owner-reauth-token");
});

test("a server response requiring existing-factor proof updates stale bootstrap state", async () => {
  const harness = makeHarness({
    mfaPassword: "password",
    response: new Response(JSON.stringify({ error: "Verify your current authenticator or recovery code." }), {
      status: 428,
    }),
  });

  await harness.actions.startOwnerMfaSetup();

  assert.ok(harness.stateCalls.some(([name, value]) => name === "setOwnerMfaEnabledState" && value === true));
  assert.ok(
    harness.stateCalls.some(
      ([name, value]) =>
        name === "setOwnerMfaNotice" && value === "Verify your current authenticator or recovery code.",
    ),
  );
});

test("account change during owner MFA setup prevents late response state updates", async () => {
  let resolveResponse;
  const responsePromise = new Promise((resolve) => {
    resolveResponse = resolve;
  });
  const harness = makeHarness({ mfaPassword: "password", responsePromise });

  const setup = harness.actions.startOwnerMfaSetup();
  harness.accountEditAccountIdRef.current = "owner-2";
  resolveResponse(successfulSetup());
  await setup;

  assert.equal(harness.ownerSecurityOperationRef.current, null);
  assert.equal(
    harness.stateCalls.some(([name, value]) => name === "setOwnerMfaSecret" && value),
    false,
  );
  assert.equal(
    harness.stateCalls.some(([name, value]) => name === "setOwnerMfaNotice" && value),
    false,
  );
});
