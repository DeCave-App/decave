import assert from "node:assert/strict";
import { register } from "node:module";
import { after, test } from "node:test";
import { D1Mock, MediaMock } from "../test-support/worker-sqlite-test-fixture.mjs";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { handleApi } = await import("../../worker/index.ts");
const { tokenHash } = await import("../../worker/db.ts");
const { ensureHubFeatureSchema } = await import("../../worker/lib/hub-schema.ts");
const { userLocale, workerT } = await import("../../worker/lib/i18n.ts");

const db = new D1Mock();
const env = {
  DB: db,
  MEDIA: new MediaMock(),
  ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  RECOVERY_RATE_LIMITER: { limit: async () => ({ success: true }) },
  HUB_ROOM: { idFromName: () => "global", get: () => ({ fetch: async () => Response.json({ success: true }) }) },
};
await ensureHubFeatureSchema(env);
after(() => db.sqlite.close());

const now = new Date().toISOString();
for (const id of ["alice", "bob"]) {
  db.exec(
    "INSERT INTO decave_users(id,username,password_salt,password_hash,created_at,public_id) VALUES(?,?,'s','h',?,?)",
    id,
    `user-${id}`,
    now,
    `DC-${id}`,
  );
  db.exec(
    "INSERT INTO decave_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
    tokenHash(`tok-${id}`),
    id,
    new Date(Date.now() + 3600_000).toISOString(),
    now,
  );
  db.exec(
    `INSERT INTO decave_user_safety_profiles(user_id,age_status,age_band,teen_safety_mode,age_policy_version,
       age_assurance_method,created_at,updated_at) VALUES(?,'eligible','adult',0,'2026-10-v1-adults','self_attested',?,?)`,
    id,
    now,
    now,
  );
}

function call(path, { method = "GET", body, as = "alice" } = {}) {
  const headers = new Headers({ authorization: `Bearer tok-${as}` });
  if (body !== undefined) headers.set("content-type", "application/json");
  return handleApi(
    new Request(`https://app.de-cave.com${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
}
const me = async (as = "alice") => (await call("/api/auth/me", { as })).json();
const putLocale = (locale, as = "alice") => call("/api/account/locale", { method: "PUT", body: { locale }, as });

test("a new account has no saved language", async () => {
  assert.equal((await me()).locale, null);
  assert.equal(await userLocale(db, "alice"), "en");
});

test("saving a supported language shows up on /api/auth/me", async () => {
  const response = await putLocale("el");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { locale: "el" });
  assert.equal((await me()).locale, "el");
  assert.equal(await userLocale(db, "alice"), "el");
  assert.equal((await me("bob")).locale, null, "other accounts are unaffected");
});

test("unsupported languages are refused with an error code", async () => {
  for (const locale of ["pt-PT", "en-XA", "xx", 42, "", { code: "el" }]) {
    const response = await putLocale(locale);
    assert.equal(response.status, 400, JSON.stringify(locale));
    const body = await response.json();
    assert.equal(body.code, "account.localeInvalid");
    assert.equal(typeof body.error, "string");
  }
  assert.equal((await me()).locale, "el", "refused values change nothing");
});

test("null clears the saved language", async () => {
  const response = await putLocale(null);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { locale: null });
  assert.equal((await me()).locale, null);
});

test("a stored value that is no longer supported reads as unset", async () => {
  db.exec("UPDATE decave_users SET locale='xx' WHERE id='bob'");
  const response = await call("/api/auth/me", { as: "bob" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).locale, null);
  assert.equal(await userLocale(db, "bob"), "en");
  assert.equal(await userLocale(db, "nobody"), "en");
});

test("signed-out requests cannot save a language", async () => {
  const response = await handleApi(
    new Request("https://app.de-cave.com/api/account/locale", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale: "de" }),
    }),
    env,
  );
  assert.equal(response.status, 401);
});

test("workerT renders catalogs on the server", () => {
  assert.equal(workerT("en")("common.app.name"), "DeCave");
  assert.equal(workerT("el")("common.app.name"), "DeCave", "falls back to English while untranslated");
  assert.equal(workerT("en"), workerT("en"), "instances are cached per locale");
});
