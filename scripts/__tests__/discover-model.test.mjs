import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DISCOVER_FILTERS,
  activityScore,
  categoryCounts,
  filterHubs,
  friendsLine,
  hasActiveFilters,
  parseHubPreview,
  previewRoomSummary,
  sizeBucket,
  sortHubs,
} from "../../src/features/discover/discoverModel.ts";

const hub = (id, extra = {}) => ({
  id,
  name: `Hub ${id}`,
  icon: "H",
  memberCount: 10,
  onlineCount: 0,
  joined: false,
  ...extra,
});

const hubs = [
  hub(1, {
    name: "Night Shift",
    category: "Gaming",
    memberCount: 248,
    onlineCount: 14,
    voiceCount: 3,
    friendsInside: 2,
    friendNames: ["Jun", "Mara"],
    tags: ["coop"],
    createdAt: "2026-01-01T00:00:00Z",
  }),
  hub(2, {
    name: "Apex Scrims",
    category: "Esports",
    memberCount: 612,
    onlineCount: 31,
    voiceCount: 0,
    createdAt: "2026-09-01T00:00:00Z",
  }),
  hub(3, {
    name: "Indie Playtest",
    category: "Gaming",
    memberCount: 30,
    onlineCount: 0,
    description: "Try builds from indie devs",
    createdAt: "2026-05-01T00:00:00Z",
  }),
  hub(4, { name: "Official", category: "Community", memberCount: null, onlineCount: null, membershipPrivate: true }),
];

test("activity weighs people in voice above people online", () => {
  assert.equal(activityScore(hubs[0]), 3 * 3 + 14);
  assert.equal(activityScore(hubs[3]), 0);
  assert.deepEqual(
    sortHubs(hubs, "active").map((h) => h.id),
    [2, 1, 3, 4],
  );
});

test("sorts by friends, size and age", () => {
  assert.deepEqual(
    sortHubs(hubs, "friends")
      .map((h) => h.id)
      .slice(0, 1),
    [1],
  );
  assert.deepEqual(
    sortHubs(hubs, "largest").map((h) => h.id),
    [2, 1, 3, 4],
  );
  assert.deepEqual(
    sortHubs(hubs, "new").map((h) => h.id),
    [2, 3, 1, 4],
  );
});

test("size buckets skip Hubs whose member count is private", () => {
  assert.equal(sizeBucket(hubs[2]), "small");
  assert.equal(sizeBucket(hubs[0]), "medium");
  assert.equal(sizeBucket(hubs[1]), "large");
  assert.equal(sizeBucket(hubs[3]), null);
});

test("filters combine: query, category, size, friends and active", () => {
  const f = (patch) => filterHubs(hubs, { ...DEFAULT_DISCOVER_FILTERS, ...patch }).map((h) => h.id);
  assert.deepEqual(f({ query: "indie" }), [3]);
  assert.deepEqual(f({ query: "COOP" }), [1]);
  assert.deepEqual(f({ category: "Gaming" }), [1, 3]);
  assert.deepEqual(f({ size: "large" }), [2]);
  assert.deepEqual(f({ friendsOnly: true }), [1]);
  assert.deepEqual(f({ activeOnly: true }), [2, 1]);
  assert.deepEqual(f({ category: "Gaming", activeOnly: true }), [1]);
  assert.equal(hasActiveFilters(DEFAULT_DISCOVER_FILTERS), false);
  assert.equal(hasActiveFilters({ ...DEFAULT_DISCOVER_FILTERS, sort: "new" }), false);
  assert.equal(hasActiveFilters({ ...DEFAULT_DISCOVER_FILTERS, size: "small" }), true);
});

test("category counts are ordered by use", () => {
  assert.deepEqual(categoryCounts(hubs), [
    { name: "Gaming", count: 2 },
    { name: "Community", count: 1 },
    { name: "Esports", count: 1 },
  ]);
});

test("friends line names up to two friends", () => {
  assert.equal(friendsLine(hubs[0]), "Jun and Mara are here");
  assert.equal(friendsLine(hub(9, { friendsInside: 1, friendNames: ["Lina"] })), "Lina is here");
  assert.equal(friendsLine(hub(9, { friendsInside: 5, friendNames: ["A", "B", "C"] })), "A, B and 3 more are here");
  assert.equal(friendsLine(hub(9, { friendsInside: 2 })), "2 friends here");
  assert.equal(friendsLine(hubs[1]), "");
});

test("preview payloads are validated and summarised", () => {
  assert.equal(parseHubPreview(null), null);
  assert.equal(parseHubPreview({ name: "x" }), null);
  const preview = parseHubPreview({
    id: 2,
    name: "Apex",
    icon: "A",
    memberCount: 1,
    onlineCount: 1,
    joined: false,
    rooms: [
      { id: 1, name: "general", type: "text", category: "COMMUNITY", icon: "💬" },
      { id: 2, name: "vods", type: "forum", threadCount: 12 },
      { id: 3, name: "Squad 1", type: "voice", voiceCount: 3 },
      { id: "bad", name: 5 },
    ],
    nextEvent: { title: "Scrims", startsAt: 1_800_000_000_000, going: 16 },
  });
  assert.equal(preview.rooms.length, 3);
  assert.deepEqual(previewRoomSummary(preview.rooms), { text: 1, forum: 1, voice: 1, threads: 12 });
  assert.deepEqual(preview.nextEvent, { title: "Scrims", startsAt: 1_800_000_000_000, going: 16 });
  assert.equal(parseHubPreview({ id: 1, name: "n", rooms: "nope", nextEvent: { title: 1 } }).nextEvent, null);
});
