import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { register } from "node:module";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { handleApi } = await import("../../worker/index.ts");
import { D1Mock, MediaMock } from "../test-support/worker-sqlite-test-fixture.mjs";

const NOW = "2099-01-01T00:00:00.000Z";
const db = new D1Mock();
db.exec(
  `INSERT INTO decave_users
   (id,username,password_salt,password_hash,created_at,public_id,bio,status,status_text,activity_text,accent,
    email,email_normalized,email_verified_at,requires_email_verification,platform_role,
    suspended_at,suspended_until,suspension_reason,must_reset_password,deleted_at,delete_after,deletion_reason,erased_at)
   VALUES('u1','user-1','salt','hash',?,'DC-0000000000000001','','online','','','#7c5cff','u1@example.test','u1@example.test',?,0,'user',NULL,NULL,'',0,NULL,NULL,'',NULL)`,
  NOW,
  NOW,
);
db.exec(
  "INSERT INTO decave_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
  createHash("sha256").update("voice-token").digest("hex"),
  "u1",
  "2100-01-01T00:00:00.000Z",
  NOW,
);
db.exec(
  `INSERT INTO decave_hubs(id,name,icon,owner_id,visibility,description,accent,category,slow_mode_seconds,icon_key,banner_key,created_at,updated_at,theme,use_banner_background)
   VALUES(1,'Test Hub','T','u1','private','','#123456','Gaming',0,'','',?,?, 'forest',1)`,
  NOW,
  NOW,
);
db.exec("INSERT INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(1,'u1','owner',?)", NOW);
db.exec(
  `INSERT INTO decave_rooms
   (id,hub_id,name,type,category,position,private,created_at,updated_at,kind,forum_guidelines,forum_post_policy,forum_post_role_ids_json,forum_post_member_ids_json)
   VALUES(10,1,'general','text','General',0,0,?,?, 'chat', '', 'everyone', '[]', '[]')`,
  NOW,
  NOW,
);
const env = {
  DB: db,
  MEDIA: new MediaMock(),
  ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  EMAIL: { send: async () => ({ messageId: "test" }) },
  AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  RECOVERY_RATE_LIMITER: { limit: async () => ({ success: true }) },
  HUB_ROOM: { idFromName: () => "global", get: () => ({ fetch: async () => new Response("ok") }) },
};

async function upload(size, headers = {}) {
  const response = await handleApi(
    new Request("https://test.invalid/api/channels/10/attachments", {
      method: "POST",
      headers: { authorization: "Bearer voice-token", "x-file-name": "v.m4a", "x-file-type": "audio/mp4", ...headers },
      body: new Uint8Array(size).fill(1),
    }),
    env,
  );
  return { response, data: await response.json() };
}

const THREE_MB = 3 * 1024 * 1024;

test("hub voice upload over 3 MB is rejected", async () => {
  const over = await upload(THREE_MB + 1, { "x-voice-note": "1" });
  assert.equal(over.response.status, 413);
  assert.equal(over.data.code, "upload.voiceTooLarge");
  const exact = await upload(THREE_MB, { "x-voice-note": "1" });
  assert.equal(exact.response.status, 200);
  const plain = await upload(THREE_MB + 1);
  assert.equal(plain.response.status, 200, "without the header the 25 MB cap still applies");
});
