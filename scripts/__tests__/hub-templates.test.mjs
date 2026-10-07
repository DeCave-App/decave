import assert from "node:assert/strict";
import test from "node:test";
import { getHubTemplate, getHubTemplateDefinitions, HUB_TEMPLATE_DEFINITIONS } from "../../shared/hub-templates.ts";

test("all Hub templates have unique ids and usable room definitions", () => {
  const ids = HUB_TEMPLATE_DEFINITIONS.map((template) => template.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, 9);
  for (const template of HUB_TEMPLATE_DEFINITIONS) {
    assert.ok(template.name);
    assert.ok(template.description);
    assert.ok(template.rooms.length > 0);
    assert.equal(new Set(template.rooms.map((room) => `${room.type}:${room.name}`)).size, template.rooms.length);
    for (const room of template.rooms) {
      assert.ok(room.name);
      assert.ok(room.category);
      assert.ok(["text", "voice", "forum"].includes(room.type));
    }
  }
});

test("unknown template ids fail closed to Blank", () => {
  assert.equal(getHubTemplate("not-a-template").id, "blank");
  assert.equal(getHubTemplate(null).id, "blank");
});

test("Streamer template is capability-gated", () => {
  assert.equal(getHubTemplate("streamer").id, "blank");
  assert.equal(getHubTemplate("streamer", true).id, "streamer");
  assert.ok(getHubTemplateDefinitions(true).some((template) => template.id === "streamer"));
});

test("templates cover the core forum and private-room cases", () => {
  assert.ok(getHubTemplate("community").rooms.some((room) => room.type === "forum"));
  assert.ok(getHubTemplate("development").rooms.some((room) => room.type === "forum"));
  assert.ok(getHubTemplate("esports").rooms.some((room) => room.private));
});
