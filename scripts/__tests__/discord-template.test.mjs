import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDiscordImportDryRun,
  extractDiscordTemplateCode,
  normalizeDiscordTemplatePayload,
  sanitizeDiscordImport,
} from "../../shared/discord-template.ts";

test("Discord template URL parsing accepts supported links only", () => {
  assert.equal(extractDiscordTemplateCode("https://discord.new/Ab_123"), "Ab_123");
  assert.equal(extractDiscordTemplateCode("https://discord.com/template/abc-987"), "abc-987");
  assert.equal(extractDiscordTemplateCode("https://discordapp.com/template/abc"), "abc");
  assert.equal(extractDiscordTemplateCode("https://discord.com/channels/123"), null);
  assert.equal(extractDiscordTemplateCode("https://example.com/abc"), null);
});

test("Discord template normalization maps supported rooms and reports unsupported types", () => {
  const preview = normalizeDiscordTemplatePayload(
    {
      name: "Raid Server",
      description: "A test template",
      serialized_source_guild: {
        channels: [
          { id: "cat", name: "COMMUNITY", type: 4 },
          { id: "text", name: "general", type: 0, parent_id: "cat" },
          { id: "voice", name: "Squad", type: 2, parent_id: "cat" },
          { id: "forum", name: "strategy", type: 15, parent_id: "cat" },
          { id: "stage", name: "Stage", type: 13, parent_id: "cat" },
        ],
        roles: [
          { name: "@everyone", color: 0 },
          { name: "Raid Lead", color: 16711935 },
        ],
      },
    },
    "abc",
  );
  assert.equal(preview.name, "Raid Server");
  assert.equal(preview.categories, 1);
  assert.deepEqual(
    preview.rooms.map((room) => room.type),
    ["text", "voice", "forum"],
  );
  assert.equal(preview.rooms[0].category, "COMMUNITY");
  assert.equal(preview.roles[0].color, "#ff00ff");
  assert.equal(preview.unsupported.length, 1);
});

test("Discord import sanitization strips client-controlled private flags and duplicates", () => {
  const safe = sanitizeDiscordImport({
    rooms: [
      { name: "general", type: "text", category: "COMMUNITY", private: true },
      { name: "general", type: "text", category: "COMMUNITY" },
    ],
    roles: [{ name: "Mod", color: "#12abef" }],
  });
  assert.ok(safe);
  assert.equal(safe.rooms.length, 1);
  assert.equal(safe.rooms[0].private, false);
  assert.equal(safe.roles[0].color, "#12abef");
});

test("Discord import dry-run separates new records from exact conflicts", () => {
  const dryRun = buildDiscordImportDryRun(
    {
      code: "abc",
      name: "Raid",
      rooms: [
        { name: "general", type: "text", category: "COMMUNITY", icon: "💬", private: false, sourceType: 0 },
        { name: "Squad", type: "voice", category: "VOICE", icon: "🔊", private: false, sourceType: 2 },
      ],
      roles: [{ name: "Mod", color: "#12abef" }],
      unsupported: ["Stage (Discord channel type 13)"],
    },
    [{ id: 4, name: "general", type: "text", category: "COMMUNITY" }],
    [],
  );
  assert.equal(dryRun.summary.conflicts, 1);
  assert.equal(dryRun.summary.rooms, 1);
  assert.equal(dryRun.summary.roles, 1);
  assert.equal(dryRun.conflicts[0].resolution, "skip");
});

test("Discord import dry-run treats roles as name conflicts and emits a stable fingerprint", () => {
  const source = { code: "abc", name: "Raid", rooms: [], roles: [{ name: "Mod", color: "#12abef" }], unsupported: [] };
  const first = buildDiscordImportDryRun(source, [], [{ id: "role-1", name: "Mod" }]);
  const second = buildDiscordImportDryRun(source, [], [{ id: "role-1", name: "Mod" }]);
  assert.equal(first.summary.conflicts, 1);
  assert.equal(first.fingerprint, second.fingerprint);
});
