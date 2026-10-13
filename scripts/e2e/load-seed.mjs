// Seed a throwaway local D1 database with N load-test accounts for
// scripts/e2e/load-realtime.mjs. Never point this at the dev database.
//
//   npx wrangler d1 migrations apply decave-review-example --local --persist-to <dir>
//   node scripts/e2e/load-seed.mjs --persist <dir> --users 1000 --hubs 1 --out <tokens.json>
//
// Run it while the Worker is stopped (wrangler holds the SQLite file open).
import { createHash, randomBytes } from "node:crypto";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    persist: { type: "string" },
    users: { type: "string", default: "1000" },
    hubs: { type: "string", default: "1" },
    tokens: { type: "string", default: "4" },
    out: { type: "string" },
  },
});
if (!values.persist || !values.out) throw new Error("--persist and --out are required");

const dir = join(values.persist, "v3", "d1", "miniflare-D1DatabaseObject");
const file = readdirSync(dir).find((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite");
if (!file) throw new Error(`No D1 database under ${dir}; apply migrations first`);
const db = new DatabaseSync(join(dir, file));

const users = Number(values.users);
const hubs = Number(values.hubs);
const tokensPerUser = Number(values.tokens);
const now = new Date().toISOString();
const later = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
const hash = (value) => createHash("sha256").update(value).digest("hex");

if (db.prepare("SELECT 1 FROM decave_users WHERE username LIKE 'load%' LIMIT 1").get())
  throw new Error("Already seeded: delete the persist directory and re-apply migrations for a fresh run");
db.exec("BEGIN");
const insertUser = db.prepare(
  `INSERT INTO decave_users(id,username,password_salt,password_hash,created_at,public_id) VALUES(?,?,?,?,?,?)`,
);
const insertSession = db.prepare(
  `INSERT INTO decave_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)`,
);
const insertWsToken = db.prepare(
  `INSERT INTO decave_ws_tokens(token_hash,user_id,session_hash,expires_at,created_at,used_at) VALUES(?,?,?,?,?,NULL)`,
);
const accounts = [];
for (let i = 0; i < users; i++) {
  const id = `load-user-${i}`;
  insertUser.run(id, `load${i}`, "x", "x", now, `DC-LOAD${String(i).padStart(9, "0")}`);
  const session = randomBytes(32).toString("hex");
  insertSession.run(hash(session), id, later, now);
  const wsTokens = [];
  for (let t = 0; t < tokensPerUser; t++) {
    const token = randomBytes(32).toString("hex");
    insertWsToken.run(hash(token), id, hash(session), later, now);
    wsTokens.push(token);
  }
  accounts.push({ id, hub: 0, rooms: [], wsTokens });
}

const insertHub = db.prepare(
  `INSERT INTO decave_hubs(name,icon,owner_id,visibility,created_at,updated_at) VALUES(?,?,?,'private',?,?) RETURNING id`,
);
const insertRoom = db.prepare(
  `INSERT INTO decave_rooms(hub_id,name,type,position,created_at,updated_at) VALUES(?,?,?,?,?,?) RETURNING id`,
);
const insertMember = db.prepare(`INSERT INTO decave_hub_members(hub_id,user_id,role,joined_at) VALUES(?,?,?,?)`);
for (let h = 0; h < hubs; h++) {
  const owner = accounts[h % users];
  const hubId = Number(insertHub.get(`Load Hub ${h}`, "L", owner.id, now, now).id);
  const rooms = [
    Number(insertRoom.get(hubId, "general", "text", 0, now, now).id),
    Number(insertRoom.get(hubId, "random", "text", 1, now, now).id),
    Number(insertRoom.get(hubId, "Voice", "voice", 2, now, now).id),
  ];
  for (let i = h; i < users; i += hubs) {
    insertMember.run(hubId, accounts[i].id, accounts[i] === owner ? "owner" : "member", now);
    accounts[i].hub = hubId;
    accounts[i].rooms = rooms;
  }
}
db.exec("COMMIT");
writeFileSync(values.out, JSON.stringify(accounts));
console.log(`Seeded ${users} users across ${hubs} hub(s) into ${file}; tokens in ${values.out}`);
