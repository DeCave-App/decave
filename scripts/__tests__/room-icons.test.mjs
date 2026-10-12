import assert from "node:assert/strict";
import { test } from "node:test";

const { ROOM_ICON_GROUPS, filterRoomIcons } = await import("../../src/features/room-settings/roomIcons.ts");

test("room icon picker has a large grouped set and search finds icons by purpose", () => {
  const all = ROOM_ICON_GROUPS.flatMap((group) => group.icons.map(([icon]) => icon));
  assert.ok(all.length >= 120, `only ${all.length} icons`);
  assert.ok(filterRoomIcons("rules").some((g) => g.icons.some(([icon]) => icon === "📖")));
  assert.ok(filterRoomIcons("clips").some((g) => g.icons.some(([icon]) => icon === "🎬")));
  assert.ok(filterRoomIcons("afk").some((g) => g.icons.some(([icon]) => icon === "💤")));
  assert.equal(filterRoomIcons("zzzz-no-match").length, 0);
  assert.equal(filterRoomIcons("").length, ROOM_ICON_GROUPS.length);
});
