import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import { test } from "node:test";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { handleApi } = await import("../../worker/index.ts");
const { giphyMediaTarget, GIPHY_MEDIA_MAX_BYTES } = await import("../../worker/routes/integrations.ts");
const { hashPassword } = await import("../../worker/db.ts");
const { D1Mock, MediaMock } = await import("../test-support/worker-sqlite-test-fixture.mjs");

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
const workerHttp = await read("worker/lib/http.ts");
const electronMain = await read("electron/main.cjs");
const webPayloads = await read("src/app/message-payloads.ts");
const webRendering = await read("src/app/actions/message-rendering.tsx");
const webHubChat = await read("src/app/actions/hub-chat.tsx");
const mobileMedia = await read("mobile/src/lib/chat-media.ts");
const mobileMessageMedia = await read("mobile/src/components/MessageMedia.tsx");
const mobilePicker = await read("mobile/src/components/ComposerMediaSheet.tsx");

const NOW = "2099-01-01T00:00:00.000Z";
const TOKEN = "giphy-proxy-token-u1";
const hashToken = (value) => createHash("sha256").update(value).digest("hex");

const db = new D1Mock();
const { salt, hash } = await hashPassword("correct horse battery staple");
db.exec(
  `INSERT INTO decave_users
   (id,username,password_salt,password_hash,created_at,public_id,bio,status,status_text,activity_text,accent,
    email,email_normalized,email_verified_at,requires_email_verification,platform_role,
    suspended_at,suspended_until,suspension_reason,must_reset_password,deleted_at,delete_after,deletion_reason,erased_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  "u1",
  "user-u1",
  salt,
  hash,
  NOW,
  "DC-0000000000000001",
  "",
  "online",
  "",
  "",
  "#7c5cff",
  "u1@example.test",
  "u1@example.test",
  NOW,
  0,
  "user",
  null,
  null,
  "",
  0,
  null,
  null,
  "",
  null,
);
db.exec(
  "INSERT INTO decave_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
  hashToken(TOKEN),
  "u1",
  "2100-01-01T00:00:00.000Z",
  NOW,
);

const env = {
  DB: db,
  MEDIA: new MediaMock(),
  ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  RECOVERY_RATE_LIMITER: { limit: async () => ({ success: true }) },
  OWNER_MFA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  HUB_ROOM: {
    idFromName: () => "global",
    get: () => ({ fetch: async () => Response.json({ userIds: [], count: 0, success: true }) }),
  },
};

const MEDIA_URL = "https://media2.giphy.com/media/v1.Y2lkPTc5/xT9IgG50Fb7Mi0prBC/giphy.webp?cid=abc&rid=giphy.webp";

function proxyRequest(target, { token = TOKEN, headers = {} } = {}) {
  const requestHeaders = new Headers(headers);
  if (token) requestHeaders.set("authorization", `Bearer ${token}`);
  return handleApi(
    new Request(`https://test.invalid/api/giphy/media?u=${encodeURIComponent(target)}`, { headers: requestHeaders }),
    env,
  );
}

async function withUpstream(handler, run) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({ url, init });
    return handler(url, init, calls.length);
  };
  try {
    await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

test("giphyMediaTarget accepts only GIPHY media hosts and canonicalizes the URL", () => {
  assert.equal(
    giphyMediaTarget(MEDIA_URL)?.toString(),
    "https://media2.giphy.com/media/v1.Y2lkPTc5/xT9IgG50Fb7Mi0prBC/giphy.webp",
  );
  assert.equal(giphyMediaTarget("https://media.giphy.com/media/abc/giphy.gif")?.hostname, "media.giphy.com");
  assert.equal(giphyMediaTarget("https://i.giphy.com/abc123.webp")?.hostname, "i.giphy.com");
  assert.equal(giphyMediaTarget("https://MEDIA4.GIPHY.COM/media/abc/200w.mp4")?.hostname, "media4.giphy.com");
  for (const rejected of [
    "http://media.giphy.com/media/abc/giphy.gif",
    "https://giphy.com/gifs/abc",
    "https://api.giphy.com/v1/gifs/abc.gif",
    "https://giphy-analytics.giphy.com/x.gif",
    "https://media10.giphy.com/media/abc/giphy.gif",
    "https://media.giphy.com.evil.test/media/abc/giphy.gif",
    "https://evilmedia.giphy.com/media/abc/giphy.gif",
    "https://user:pass@media.giphy.com/media/abc/giphy.gif",
    "https://media.giphy.com:8443/media/abc/giphy.gif",
    "https://media.giphy.com/media/abc/giphy.html",
    "https://media.giphy.com/media/%2e%2e/giphy.gif",
    "https://media.giphy.com/media//giphy.gif",
    "https://127.0.0.1/media/abc/giphy.gif",
    "javascript:alert(1)",
    "",
    null,
    `https://media.giphy.com/${"a".repeat(2100)}.gif`,
  ]) {
    assert.equal(giphyMediaTarget(rejected), null, String(rejected));
  }
});

test("the GIF media proxy requires an authenticated session", async () => {
  await withUpstream(
    () => {
      throw new Error("must not reach GIPHY");
    },
    async (calls) => {
      const response = await proxyRequest(MEDIA_URL, { token: "" });
      assert.equal(response.status, 401);
      assert.equal(calls.length, 0);
    },
  );
});

test("the GIF media proxy rejects non-GIPHY targets without fetching", async () => {
  await withUpstream(
    () => {
      throw new Error("must not fetch");
    },
    async (calls) => {
      for (const target of ["https://example.com/a.gif", "http://media.giphy.com/media/a/giphy.gif", "not a url"]) {
        const response = await proxyRequest(target);
        assert.equal(response.status, 400, target);
      }
      assert.equal(calls.length, 0);
    },
  );
});

test("the GIF media proxy fetches anonymously and returns cacheable media", async () => {
  await withUpstream(
    () => new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/webp", "Content-Length": "3" } }),
    async (calls) => {
      // Cookie auth, as an <img> on web and desktop sends it.
      const response = await proxyRequest(MEDIA_URL, {
        token: "",
        headers: {
          cookie: `__Host-decave_session=${TOKEN}`,
          "CF-Connecting-IP": "203.0.113.9",
          "User-Agent": "Viewer/1",
        },
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "image/webp");
      assert.match(response.headers.get("cache-control") ?? "", /private, max-age=\d{6,}, immutable/);
      assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
      assert.equal(calls.length, 1);
      const [{ url, init }] = calls;
      assert.equal(url, "https://media2.giphy.com/media/v1.Y2lkPTc5/xT9IgG50Fb7Mi0prBC/giphy.webp");
      assert.equal(init.redirect, "manual");
      assert.ok(init.cf?.cacheTtl > 0);
      const sent = new Headers(init.headers);
      assert.equal(sent.get("cookie"), null);
      assert.equal(sent.get("authorization"), null);
      assert.equal(sent.get("cf-connecting-ip"), null);
      assert.equal(sent.get("x-forwarded-for"), null);
      assert.match(sent.get("user-agent") ?? "", /^DeCave-Media-Proxy/);
    },
  );
});

test("the GIF media proxy refuses redirects off GIPHY media hosts", async () => {
  await withUpstream(
    () => new Response(null, { status: 302, headers: { Location: "https://evil.test/a.gif" } }),
    async (calls) => {
      const response = await proxyRequest(MEDIA_URL);
      assert.equal(response.status, 502);
      assert.equal(calls.length, 1);
    },
  );
  await withUpstream(
    (url) =>
      url.includes("media2")
        ? new Response(null, { status: 302, headers: { Location: "https://media0.giphy.com/media/a/giphy.gif" } })
        : new Response("GIF89a", { headers: { "Content-Type": "image/gif" } }),
    async (calls) => {
      const response = await proxyRequest(MEDIA_URL);
      assert.equal(response.status, 200);
      assert.equal(calls[1].url, "https://media0.giphy.com/media/a/giphy.gif");
    },
  );
});

test("the GIF media proxy only relays bounded GIF, WebP and MP4 bodies", async () => {
  await withUpstream(
    () => new Response("<html>", { headers: { "Content-Type": "text/html" } }),
    async () => assert.equal((await proxyRequest(MEDIA_URL)).status, 502),
  );
  await withUpstream(
    () =>
      new Response("x", {
        headers: { "Content-Type": "image/gif", "Content-Length": String(GIPHY_MEDIA_MAX_BYTES + 1) },
      }),
    async () => assert.equal((await proxyRequest(MEDIA_URL)).status, 502),
  );
  await withUpstream(
    () => new Response("video", { headers: { "Content-Type": "video/mp4" } }),
    async () => assert.equal((await proxyRequest(MEDIA_URL)).status, 200),
  );
});

test("app CSPs no longer allow GIPHY or removed media hosts", () => {
  for (const source of [workerHttp, electronMain]) {
    assert.doesNotMatch(source, /giphy\.com/);
    assert.doesNotMatch(source, /duckduckgo|jtvnw|ytimg/);
    assert.match(source, /img-src 'self' data: blob:;/);
    assert.match(source, /media-src 'self' blob:;/);
  }
});

test("web and mobile clients load GIF media only through the DeCave proxy", () => {
  assert.match(webPayloads, /\/api\/giphy\/media\?u=\$\{encodeURIComponent\(safe\)\}/);
  assert.doesNotMatch(webRendering, /<img src=\{gifUrl\}/);
  assert.match(webRendering, /<img src=\{gifSrc\}/);
  assert.match(webHubChat, /giphyMediaProxyUrl\(gif\.previewUrl\)/);
  assert.doesNotMatch(webHubChat, /src=\{gif\.previewUrl\}/);
  assert.match(mobileMedia, /\/api\/giphy\/media/);
  assert.match(mobileMedia, /Authorization: `Bearer \$\{token\}`/);
  assert.match(mobileMessageMedia, /giphyImageSource\(url, token\)/);
  assert.match(mobilePicker, /giphyImageSource\(item\.previewUrl, token\)/);
  assert.doesNotMatch(mobilePicker, /uri: item\.previewUrl/);
});
