import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

register("../test-support/cloudflare-workers-test-loader.mjs", import.meta.url);
const { D1Mock } = await import("../test-support/worker-sqlite-test-fixture.mjs");
const { accountExportChunks, accountExportSections } = await import("../../worker/lib/account-export.ts");
const { accountExportStatus, maskPushToken } = await import("../../shared/account-export.ts");
const { ensureGroupChatSchema } = await import("../../worker/db.ts");
const { ensurePushSchema } = await import("../../worker/push.ts");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const past = "2025-01-01T00:00:00.000Z";

async function collect(generator) {
  let text = "";
  for await (const chunk of generator) text += chunk;
  return text;
}

async function seededDb() {
  const db = new D1Mock();
  await ensureGroupChatSchema(db);
  await ensurePushSchema(db);
  for (const id of ["me", "peer"]) {
    db.exec(
      "INSERT INTO decave_users(id,username,password_salt,password_hash,created_at,platform_role) VALUES(?,?,?,?,?,'user')",
      id,
      `user-${id}`,
      "salt",
      "hash",
      past,
    );
  }
  db.exec(
    "INSERT INTO decave_dm_keys(key_id,user_id,x25519_public,ed25519_public,created_at) VALUES('k-me','me','xpub','edpub',?)",
    past,
  );
  db.exec(
    "INSERT INTO decave_dm_keys(key_id,user_id,x25519_public,ed25519_public,created_at) VALUES('k-peer','peer','px','pe',?)",
    past,
  );
  db.exec(
    "INSERT INTO decave_dm_key_backups(user_id,key_id,backup,updated_at) VALUES('me','k-me','BACKUP-CIPHERTEXT',?)",
    past,
  );
  db.exec(
    `INSERT INTO decave_dm_link_requests(id,user_id,requester_session_hash,link_public,created_at,expires_at,sealed)
     VALUES('link-1','me','SESSION-HASH','linkpub',?,?,'SEALED-KEY')`,
    past,
    past,
  );
  // 150 sent messages forces a second page.
  for (let index = 0; index < 150; index += 1) {
    db.exec(
      "INSERT INTO decave_direct_messages(id,from_user_id,to_user_id,text,envelope,created_at) VALUES(?,?,?,?,?,?)",
      `sent-${index}`,
      "me",
      "peer",
      "",
      `{"c":"ENVELOPE-${index}"}`,
      past,
    );
  }
  db.exec(
    "INSERT INTO decave_direct_messages(id,from_user_id,to_user_id,text,created_at) VALUES('in-1','peer','me','their words',?)",
    past,
  );
  db.exec(
    "INSERT INTO decave_dm_reaction_envelopes(message_id,user_id,envelope,updated_at) VALUES('in-1','me','REACTION-CIPHERTEXT',?)",
    past,
  );
  db.exec(
    "INSERT INTO decave_push_tokens(token,user_id,platform,created_at) VALUES('ExponentPushToken[abcdefghijklmnop]','me','ios',?)",
    past,
  );
  return db;
}

test("the account export streams E2EE data as opaque ciphertext and ends with a complete marker", async () => {
  const db = await seededDb();
  const text = await collect(
    accountExportChunks(db, { format: "decave-account-export-v2" }, accountExportSections("me")),
  );
  assert.deepEqual(accountExportStatus(text.slice(-512)), { complete: true });
  const data = JSON.parse(text);
  assert.equal(data.complete, true);
  assert.equal(Object.keys(data).at(-1), "complete", "the marker is written last");
  assert.equal(data.directMessagesSent.length, 150);
  assert.equal(data.directMessagesSent[149].envelope, '{"c":"ENVELOPE-149"}');
  assert.ok(!text.includes("their words"), "messages other people sent are not exported");
  assert.deepEqual(
    data.encryptionKeys.map((key) => key.key_id),
    ["k-me"],
  );
  assert.equal(data.encryptionKeyBackup[0].backup, "BACKUP-CIPHERTEXT");
  assert.equal(data.encryptionLinkRequests[0].sealed, "SEALED-KEY");
  assert.ok(!text.includes("SESSION-HASH"), "link requests omit the requesting session hash");
  assert.equal(data.directMessageReactionEnvelopes[0].envelope, "REACTION-CIPHERTEXT");
  assert.equal(data.pushTokens[0].token, "ExponentPushToken[************mnop]");
  assert.ok(!text.includes("abcdefghijklmnop"), "push tokens are masked");
});

test("the account export leaves out bot notices addressed to others and includes notices sent to the account", async () => {
  const db = await seededDb();
  // Builder-bot messages are stored under the publisher as author.
  db.exec(
    "INSERT INTO decave_hubs(id,name,icon,owner_id,visibility,created_at,updated_at) VALUES(1,'Hub','H','me','private',?,?)",
    past,
    past,
  );
  db.exec(
    "INSERT INTO decave_rooms(id,hub_id,name,type,created_at,updated_at) VALUES(1,1,'general','text',?,?)",
    past,
    past,
  );
  db.exec(
    `INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at,visible_to_user_id)
     VALUES('notice-for-peer',1,1,'me','secret form answer of peer',?,'peer')`,
    past,
  );
  db.exec(
    `INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at,visible_to_user_id)
     VALUES('notice-for-me',1,1,'peer','your roll is 4',?,'me')`,
    past,
  );
  const text = await collect(
    accountExportChunks(db, { format: "decave-account-export-v2" }, accountExportSections("me")),
  );
  const data = JSON.parse(text);
  assert.ok(!text.includes("secret form answer of peer"), "a notice for someone else is not exported");
  assert.ok(!data.hubRoomMessages.some((row) => row.text === "your roll is 4"));
  assert.deepEqual(
    data.hubBotNoticesReceived.map((row) => row.text),
    ["your roll is 4"],
  );
});

test("a failing section ends the export with complete:false, and truncation is detected", async () => {
  const db = await seededDb();
  const sections = [
    ...accountExportSections("me").slice(0, 2),
    { name: "broken", alias: "x", sql: "SELECT x.missing_column FROM decave_users x WHERE x.id=?", binds: ["me"] },
  ];
  const text = await collect(accountExportChunks(db, { format: "v2" }, sections));
  const data = JSON.parse(text);
  assert.equal(data.complete, false);
  assert.equal(accountExportStatus(text).complete, false);
  assert.match(accountExportStatus(text).error, /could not be completed/);

  const whole = await collect(accountExportChunks(db, { format: "v2" }, accountExportSections("me")));
  const truncated = accountExportStatus(whole.slice(0, Math.floor(whole.length / 2)));
  assert.equal(truncated.complete, false);
  assert.match(truncated.error, /did not finish/);
});

test("a lazily created table that does not exist yet exports as an empty list", async () => {
  const db = await seededDb();
  const sections = [
    { name: "notYet", alias: "n", sql: "SELECT n.id FROM decave_not_created n WHERE n.id=?", binds: ["me"] },
  ];
  const data = JSON.parse(await collect(accountExportChunks(db, {}, sections)));
  assert.deepEqual(data.notYet, []);
  assert.equal(data.complete, true);
});

test("push token masking keeps only the token family and last four characters", () => {
  assert.equal(maskPushToken("ExpoPushToken[1234567890abcdef]"), "ExpoPushToken[************cdef]");
  assert.equal(maskPushToken("short"), "*****");
  assert.equal(maskPushToken(undefined), "****");
});

test("the web and mobile apps refuse an export without the complete marker", () => {
  assert.equal(
    fs.readFileSync(path.join(root, "mobile/src/lib/account-export.ts"), "utf8").replace(/\r\n/g, "\n"),
    fs.readFileSync(path.join(root, "shared/account-export.ts"), "utf8").replace(/\r\n/g, "\n"),
    "mobile/src/lib/account-export.ts must stay identical to shared/account-export.ts",
  );
  const web = fs.readFileSync(path.join(root, "src/features/settings/AccountPanels.tsx"), "utf8");
  const mobile = fs.readFileSync(path.join(root, "mobile/app/account-security.tsx"), "utf8");
  assert.match(web, /accountExportStatus\(/);
  assert.match(mobile, /accountExportStatus\(body\)/);
});

test("activity schemas allow complete exports with and without a Steam link", async () => {
  const { ensureActivitySchema } = await import("../../worker/lib/activity.ts");
  const db = await seededDb();
  try {
    await ensureActivitySchema({ DB: db });
    db.exec("INSERT INTO decave_steam_links(user_id,steam_id,linked_at,updated_at) VALUES('me','123',?,?)", past, past);
    db.exec("INSERT INTO decave_activity_state(user_id,automatic_text,updated_at) VALUES('me','a game',?)", past);
    for (const user of ["me", "peer"]) {
      const data = JSON.parse(await collect(accountExportChunks(db, {}, accountExportSections(user))));
      assert.equal(data.complete, true, user);
      assert.ok(Array.isArray(data.feedback), "sections following Steam still export");
      assert.equal(data.steam.length, user === "me" ? 1 : 0);
      if (user === "me") {
        assert.equal(data.steam[0].created_at, past, "preserves the export field name");
        assert.equal(data.activity[0].automatic_text, "a game");
      }
    }
  } finally {
    db.sqlite.close();
  }
});
