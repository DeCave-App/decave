import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRoomBoxes,
  categoryTitle,
  denser,
  estimateBoxesHeight,
  neighbourInBox,
  packRows,
  pickDensity,
  tileWidth,
} from "../../src/features/hub-sidebar/roomBoxesModel.ts";

const room = (id, name, type, category = "") => ({ id, name, type, category });

// Close to the Community template plus a few extras (20 rooms).
const communityHub = [
  room(1, "welcome", "text", "INFORMATION"),
  room(2, "announcements", "text", "INFORMATION"),
  room(3, "rules", "text", "INFORMATION"),
  room(4, "general", "text", "COMMUNITY"),
  room(5, "media", "text", "COMMUNITY"),
  room(6, "discussions", "forum", "COMMUNITY"),
  room(7, "events", "text", "COMMUNITY"),
  room(8, "Lounge", "voice", "VOICE"),
  room(9, "Community Voice", "voice", "VOICE"),
  room(10, "scrims", "text", "Competitive"),
  room(11, "strategy", "text", "Competitive"),
  room(12, "ranked", "text", "Competitive"),
  room(13, "feedback", "forum", "COMMUNITY"),
  room(14, "staff", "text", "STAFF"),
  room(15, "mod-log", "text", "STAFF"),
  room(16, "memes", "text", "COMMUNITY"),
  room(17, "music", "text", "COMMUNITY"),
  room(18, "AFK", "voice", "VOICE"),
  room(19, "Squad 2", "voice", "VOICE"),
  room(20, "faq", "text", "INFORMATION"),
];

test("category titles read in sentence case, owner casing is kept", () => {
  assert.equal(categoryTitle("START HERE"), "Start here");
  assert.equal(categoryTitle("  INFORMATION "), "Information");
  assert.equal(categoryTitle("Competitive"), "Competitive");
  assert.equal(categoryTitle("lfg & scrims"), "lfg & scrims");
  assert.equal(categoryTitle(""), "Rooms");
  assert.equal(categoryTitle(undefined), "Rooms");
});

test("every room lands in exactly one box, categories first, then forums and voice", () => {
  const boxes = buildRoomBoxes(communityHub);
  assert.deepEqual(
    boxes.map((box) => box.title),
    ["Information", "Community", "Competitive", "Staff", "Forums", "Voice"],
  );
  const ids = boxes.flatMap((box) => box.rooms.map((r) => r.id)).sort((a, b) => a - b);
  assert.deepEqual(
    ids,
    communityHub.map((r) => r.id),
  );
  assert.deepEqual(
    boxes.find((box) => box.kind === "forum").rooms.map((r) => r.name),
    ["discussions", "feedback"],
  );
  assert.deepEqual(
    boxes.find((box) => box.title === "Information").rooms.map((r) => r.name),
    ["welcome", "announcements", "rules", "faq"],
  );
});

test("rooms without a category share a Rooms box; category matching ignores case and spacing", () => {
  const boxes = buildRoomBoxes([
    room(1, "a", "text", ""),
    room(2, "b", "text", "Clips "),
    room(3, "c", "text", "clips"),
    room(4, "d", "text"),
  ]);
  assert.deepEqual(
    boxes.map((box) => [box.title, box.rooms.length]),
    [
      ["Rooms", 2],
      ["Clips", 2],
    ],
  );
});

test("official (owner-only posting) hubs hide the voice box, like the old list", () => {
  const boxes = buildRoomBoxes(communityHub, { ownerOnlyPosting: true });
  assert.equal(
    boxes.some((box) => box.kind === "voice"),
    false,
  );
});

test("Alt+Arrow neighbours stay inside the room's own box", () => {
  const boxes = buildRoomBoxes(communityHub);
  assert.equal(neighbourInBox(boxes, 2, 1), 3);
  assert.equal(neighbourInBox(boxes, 20, 1), null); // last in Information, never jumps into Community
  assert.equal(neighbourInBox(boxes, 4, -1), null);
  assert.equal(neighbourInBox(boxes, 99, 1), null);
});

test("density only gets denser as space shrinks and never hides rooms", () => {
  const boxes = buildRoomBoxes(communityHub);
  const roomy = estimateBoxesHeight(boxes, "roomy");
  const compact = estimateBoxesHeight(boxes, "compact");
  assert.ok(roomy > compact && compact > estimateBoxesHeight(boxes, "chips"), `${roomy} > ${compact}`);
  assert.equal(pickDensity(boxes, roomy), "roomy");
  assert.equal(pickDensity(boxes, roomy - 1), "compact");
  const chips = estimateBoxesHeight(boxes, "chips");
  const tight = estimateBoxesHeight(boxes, "tight");
  assert.ok(chips > tight, `${chips} > ${tight}`);
  assert.equal(pickDensity(boxes, compact - 1), "chips");
  assert.equal(pickDensity(boxes, chips - 1), "tight");
  assert.equal(pickDensity(boxes, 10), "chips"); // nothing fits: chips, and the list scrolls
  assert.equal(pickDensity(boxes, 0), "roomy"); // not measured yet
});

test("a live voice room takes a wide tile, so it costs more height", () => {
  const boxes = buildRoomBoxes(communityHub);
  assert.ok(estimateBoxesHeight(boxes, "roomy", new Set([8])) > estimateBoxesHeight(boxes, "roomy"));
});

test("a 20-room hub fits without scrolling on a 1080p sidebar, roomy when taller", () => {
  // ~1080 window minus top bar, header strip and nav row leaves about 830px.
  const boxes = buildRoomBoxes(communityHub);
  assert.equal(pickDensity(boxes, 830), "compact");
  assert.equal(pickDensity(boxes, 950), "roomy");
});

test("long names widen their tile instead of being cut, so they take more rows", () => {
  assert.ok(tileWidth("announcements", "roomy") > tileWidth("faq", "roomy"));
  assert.equal(packRows([100, 100, 100], 248), 2); // two per row
  assert.equal(packRows([60, 60, 60], 248), 1); // short names share a row
  assert.equal(packRows([400], 248), 1); // wider than the box: one full row, never more
  assert.equal(packRows([], 248), 0);
  const longNames = buildRoomBoxes([1, 2, 3, 4].map((id) => room(id, `a-really-long-room-name-${id}`, "text", "X")));
  const shortNames = buildRoomBoxes([1, 2, 3, 4].map((id) => room(id, `r${id}`, "text", "X")));
  assert.ok(estimateBoxesHeight(longNames, "compact") > estimateBoxesHeight(shortNames, "compact"));
});

test("a narrower sidebar needs more height", () => {
  const boxes = buildRoomBoxes(communityHub);
  assert.ok(
    estimateBoxesHeight(boxes, "compact", new Set(), 240) >= estimateBoxesHeight(boxes, "compact", new Set(), 320),
  );
});

test("denser() steps roomy -> compact -> chips -> tight and stops", () => {
  assert.equal(denser("roomy"), "compact");
  assert.equal(denser("compact"), "chips");
  assert.equal(denser("chips"), "tight");
  assert.equal(denser("tight"), "tight");
});

test("a 20-room hub still fits without scrolling on a 1366x768 laptop", () => {
  // 768 minus top bar (68), slim header strip (60) and nav row (~45) leaves about 590px.
  assert.notEqual(pickDensity(buildRoomBoxes(communityHub), 590), "chips");
});
