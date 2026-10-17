// Production D1 rejects a compound SELECT with more than 5 terms ("too many
// terms in compound SELECT"); local SQLite allows 500, so tests alone never
// catch it. Hub deletion failed for every Hub (Oct 2026) because a 10-term
// UNION slipped in. Keep every SQL literal in the Worker within the limit.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const MAX_TERMS = 5;

function workerFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : workerFiles(full);
    return /\.ts$/.test(entry.name) ? [full] : [];
  });
}

test("no Worker SQL literal has more than 5 compound SELECT terms", () => {
  const problems = [];
  for (const file of workerFiles(new URL("../../worker", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/`[^`]*`|"(?:[^"\\n]|\.)*"/g)) {
      const literal = match[0];
      const operators = (literal.match(/\b(?:UNION(?:\s+ALL)?|INTERSECT|EXCEPT)\b/gi) ?? []).length;
      if (operators + 1 > MAX_TERMS)
        problems.push(`${path.basename(file)}: ${operators + 1} terms near "${literal.slice(0, 60)}"`);
    }
    // A UNION built per value at runtime (`.map(() => " UNION ALL SELECT ?")`) has no fixed size.
    if (/map\([^)]*\)\s*=>\s*["'`][^"'`]*\bUNION\b/i.test(source))
      problems.push(`${path.basename(file)}: UNION built per value`);
  }
  assert.deepEqual(problems, []);
});

test("Hub media keys are one SELECT per source", async () => {
  const { HUB_MEDIA_OBJECT_KEY_SOURCES } = await import("../../worker/lib/media.ts");
  assert.ok(HUB_MEDIA_OBJECT_KEY_SOURCES.length >= 10);
  for (const sql of HUB_MEDIA_OBJECT_KEY_SOURCES) {
    assert.doesNotMatch(sql, /\bUNION\b/i);
    assert.equal((sql.match(/\?/g) ?? []).length, 1, sql);
  }
});

// Production D1 also caps a query at 100 bound parameters (local SQLite allows
// 32766). An IN list built per value must be chunked (lib/messages chunked, 90)
// or bounded by a validated cap; otherwise pass the list as one JSON value with
// `IN (SELECT value FROM json_each(?))`. New sites must be added here with
// the reason they stay under 100.
const BOUNDED_IN_LISTS = {
  "account-erasure.ts:tables": "fixed list of legacy table names",
  "db.ts:roleIds": "sliced to 50 role ids",
  "HubRoom.ts:memberIds": "group chats hold at most 20 members",
  "HubRoom.ts:chunk": "chunked",
  "dm-e2ee.ts:userIds": "DM or group chat members (max 20)",
  "hubs.ts:ids": "validated max of 12 role ids / chunked forum ids",
  "i18n.ts:chunk": "chunked at 90",
  "media.ts:chunk": "chunked",
  "media.ts:pending": "LIMIT 100 rows, one bind each",
  "messages.ts:ids": "chunked at 90",
  "official-post-translations.ts:ids": "one forum page (max 25 posts) plus locale",
  "push-policy.ts:chunk": "chunked at 90",
  "direct-messages.ts:keys": "attachments of a single message",
  "rooms.ts:attachmentKeys": "attachments of a single message",
  "hub-events.ts:marks": "event ids chunked at 90, plus user id",
  "hub-list.ts:ids": "rowsForIds chunks at 90, plus user id",
  "media.ts:placeholders": "chunked at 90",
  "messages.ts:placeholders": "chunked at 90",
  "realtime-roster.ts:placeholders": "chunked at 90",
  "realtime-roster.ts:list": "chunked at 45, used twice",
  "push.ts:placeholders": "chunked at 90, plus two timestamps",
  "dashboard.ts:successfulLoginEvents": "constant SQL literals, no binds",
};

test("dynamic IN lists in Worker SQL stay under D1's 100 bound parameters", () => {
  const unknown = [];
  for (const file of workerFiles(new URL("../../worker", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/IN \(\$\{([A-Za-z_]+)[.(}]/g)) {
      const key = `${path.basename(file)}:${match[1]}`;
      if (!BOUNDED_IN_LISTS[key]) unknown.push(key);
    }
  }
  assert.deepEqual(unknown, []);
});
