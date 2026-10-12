// Two-user bot builder check against a running local Worker started from this
// checkout with BOTS_BUILDER_ENABLED=true:
//   npx wrangler dev --local --port 8788 --local-upstream 127.0.0.1:8788   (serving a fresh `npm run build:web`)
//   npm run e2e:bots
//
// Creates its own accounts (unique per run, random password, nothing stored),
// so it can be repeated. The admin makes a Hub with a Member role, publishes
// the Welcome bot (also giving the Member role) and the Dice bot. A second user
// joins by invite and runs /roll 6. Checks the welcome text, the role, the dice
// reply and the run log. Set E2E_BASE_URL to test another address.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { capabilitiesForRules } from "../../shared/bots/capabilities.ts";

// browser.mjs reads its base URL when it loads, so set it first.
process.env.DECAVE_E2E_BASE ??= process.env.E2E_BASE_URL ?? "http://127.0.0.1:8788";
const { assertServerUp, createChecks, launchBrowser, openApp, sleep, waitFor } = await import("./browser.mjs");

const { check, finish } = createChecks();
const suffix = `${Date.now().toString(36)}${crypto.randomBytes(2).toString("hex")}`;
const password = `E2e-${crypto.randomBytes(12).toString("base64url")}`;
const [admin, joiner] = ["admin", "joiner"].map((role) => ({
  role,
  username: `bots_${role}_${suffix}`,
  email: `bots-${role}-${suffix}@example.test`,
}));
const HUB_NAME = `Bots ${suffix}`;

// Runs fetch inside the page, so the session cookie rides along. Resolves { status, body }.
const api = (browser, path, method = "GET", body) =>
  browser.evaluate(`(async () => {
    const response = await fetch(${JSON.stringify(path)}, {
      method: ${JSON.stringify(method)},
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: ${body === undefined ? "undefined" : JSON.stringify(JSON.stringify(body))},
    });
    const text = await response.text();
    let parsed = text;
    try { parsed = JSON.parse(text); } catch {}
    return { status: response.status, body: parsed };
  })()`);

const must = async (label, promise, ok = [200, 201, 202]) => {
  const result = await promise;
  if (!ok.includes(result.status)) throw new Error(`${label}: HTTP ${result.status} ${JSON.stringify(result.body)}`);
  return result.body;
};

const register = (browser, account) =>
  must(
    `register ${account.role}`,
    api(browser, "/api/auth/register", "POST", {
      email: account.email,
      username: account.username,
      password,
      birthDate: "1990-01-01",
      acceptedTerms: true,
      turnstileToken: "e2e",
    }),
  );

// The local Worker writes verification emails to .wrangler/tmp/email instead of sending them.
const emailRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.wrangler/tmp/email");
function verificationToken(account) {
  for (const dir of fs.existsSync(emailRoot) ? fs.readdirSync(emailRoot) : []) {
    const texts = path.join(emailRoot, dir, "email-text");
    for (const file of fs.existsSync(texts) ? fs.readdirSync(texts) : []) {
      const text = fs.readFileSync(path.join(texts, file), "utf8");
      const token = text.includes(`Hi ${account.username},`) && /verify-email[?#]token=([0-9a-f]+)/.exec(text);
      if (token) return token[1];
    }
  }
  throw new Error(`No verification email found for ${account.username}`);
}

// The link is a GET that redirects to the app on success (400 when invalid).
// The redirect is not followed: its target is the configured auth base URL.
const verify = async (browser, account) => {
  const path = `/api/auth/verify-email?token=${verificationToken(account)}`;
  const status = await browser.evaluate(
    `fetch(${JSON.stringify(path)}, { credentials: "include", redirect: "manual" }).then((r) => r.status)`,
  );
  // A manual redirect surfaces as an opaque response with status 0.
  if (status !== 0 && status !== 302) throw new Error(`verify ${account.role}: HTTP ${status}`);
};

const login = (browser, account) =>
  must(
    `login ${account.role}`,
    api(browser, "/api/auth/login", "POST", { identifier: account.email, password, turnstileToken: "e2e" }),
  );

const createBot = (a, hubId, name, templateId) =>
  must(`create ${name}`, api(a, `/api/servers/${hubId}/bot-builder`, "POST", { name, templateId }));

const publish = (a, hubId, botId, label) =>
  must(`publish ${label}`, api(a, `/api/servers/${hubId}/bot-builder/${botId}/publish`, "POST", {}));

const roomHas = (roomId, test) =>
  `fetch("/api/channels/${roomId}/messages", { credentials: "include" }).then((r) => r.text()).then((t) => ${test})`;

async function main() {
  await assertServerUp();
  const a = await launchBrowser("admin", 9311);
  const b = await launchBrowser("joiner", 9312);
  try {
    await openApp(a);
    await register(a, admin);
    await register(a, joiner);
    await verify(a, admin);
    await verify(a, joiner);
    await login(a, admin);
    check("two fresh accounts created", true, suffix);

    // Hub, Member role, invite.
    const hub = await must("create hub", api(a, "/api/servers", "POST", { name: HUB_NAME }));
    const hubId = hub.id;
    const hubs = await must("list hubs", api(a, "/api/servers"));
    const room = hubs.find((h) => h.id === hubId).channels.find((r) => r.type === "text" && r.kind !== "forum");
    const role = await must("create role", api(a, `/api/servers/${hubId}/roles`, "POST", { name: "Member" }));
    const invite = await must("create invite", api(a, `/api/servers/${hubId}/invites`, "POST", {}));

    // Welcome greets in the first room and also gives the Member role.
    const welcome = await createBot(a, hubId, "Welcome", "welcome");
    const welcomeRule = welcome.rules[0];
    const draft = { ...welcomeRule.draft, then: [...welcomeRule.draft.then, { type: "addRole", roleId: role.id }] };
    await must(
      "edit welcome rule",
      api(a, `/api/servers/${hubId}/bot-builder/${welcome.id}/rules/${welcomeRule.id}`, "PUT", draft),
    );
    // A bot made from a template gets what its rules need; this one changed afterwards.
    await must(
      "allow roles",
      api(a, `/api/servers/${hubId}/bot-builder/${welcome.id}`, "PATCH", {
        capabilities: ["send_messages", ...capabilitiesForRules([draft])],
      }),
    );
    await publish(a, hubId, welcome.id, "Welcome");
    const dice = await createBot(a, hubId, "Dice", "dice");
    await publish(a, hubId, dice.id, "Dice");
    check("Welcome and Dice bots published", true);

    // The joiner signs in and joins by invite.
    await openApp(b);
    await login(b, joiner);
    await must("join by invite", api(b, `/api/invites/${invite.code}/join`, "POST", {}));
    check("second user joined by invite", true);

    const welcomed = await waitFor(
      a,
      "welcome message",
      roomHas(room.id, `t.includes(${JSON.stringify(joiner.username)}) && t.includes("Welcome")`),
      20_000,
    ).catch(() => false);
    check("welcome message names the new member", !!welcomed);

    const granted = await waitFor(
      a,
      "Member role granted",
      `fetch("/api/servers/${hubId}/members", { credentials: "include" }).then((r) => r.json()).then((m) => m.find((x) => x.username === ${JSON.stringify(joiner.username)})?.customRoleIds.includes(${JSON.stringify(role.id)}))`,
      20_000,
    ).catch(() => false);
    check("Member role was granted", !!granted);

    // The joiner runs /roll 6 from the composer.
    await openApp(b);
    // A first sign-in asks to save the DM recovery code before anything else.
    await waitFor(b, "recovery code dialog", `!!document.querySelector(".dc-e2ee-check input")`, 15_000).catch(
      () => {},
    );
    await b.evaluate(`document.querySelector(".dc-e2ee-check input")?.click()`);
    await sleep(300);
    await b.evaluate(`__e2e.button("Done")?.click()`);
    await waitFor(b, "realtime connection", `!!document.querySelector(".dc-bottom-bar-status.is-online")`);
    await b.evaluate(`__e2e.button("Open ${HUB_NAME}").click()`);
    await waitFor(b, "message box", `!!document.querySelector("textarea[placeholder^='Message #']")`);
    await b.evaluate(`(() => {
      const box = document.querySelector("textarea[placeholder^='Message #']");
      box.focus();
      __e2e.setInput(box, "/roll 6");
    })()`);
    await sleep(500);
    await b.evaluate(
      `document.querySelector("textarea[placeholder^='Message #']").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))`,
    );
    const rolled = await waitFor(
      a,
      "dice reply",
      roomHas(room.id, `/rolled [1-6]\\b/.test(t) && t.includes(${JSON.stringify(joiner.username)})`),
      20_000,
    ).catch(() => false);
    check(
      "/roll 6 got a dice reply",
      !!rolled,
      rolled
        ? ""
        : `box: ${await b.evaluate("(() => { const t = document.querySelector('textarea'); return t ? JSON.stringify([t.value, t.disabled, t.placeholder]) : 'none'; })()")} messages: ${(
            await api(a, `/api/channels/${room.id}/messages`)
          ).body
            .map((m) => m.text)
            .join(" | ")
            .slice(0, 300)}`,
    );

    for (const [bot, label] of [
      [welcome, "Welcome"],
      [dice, "Dice"],
    ]) {
      const { runs } = await must(`${label} runs`, api(a, `/api/servers/${hubId}/bot-builder/${bot.id}/runs`));
      check(
        `${label} run log lists ok runs`,
        runs.length > 0 && runs.every((r) => r.status === "ok"),
        runs.map((r) => (r.status === "ok" ? "ok" : `${r.status}: ${r.detail}`)).join(", "),
      );
    }
  } finally {
    a.close();
    b.close();
  }
  finish("bot checks");
}

main().catch((error) => {
  console.error(`✖ ${error.message}`);
  process.exitCode = 1;
});
