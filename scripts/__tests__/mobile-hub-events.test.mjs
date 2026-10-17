import test from "node:test";
import assert from "node:assert/strict";

const model = await import("../../mobile/src/lib/hub-events-model.ts");
const { validateHubEventInput } = await import("../../shared/hub-events.ts");

const NOW = Date.UTC(2026, 9, 16, 12, 0);
const event = (patch = {}) => ({
  id: "e1",
  hubId: 1,
  channelId: 5,
  voiceChannelId: null,
  title: "Raid night",
  description: "Bring snacks",
  coverUrl: null,
  startsAt: NOW + 3_600_000,
  endsAt: NOW + 7_200_000,
  timezone: "UTC",
  recurrence: "none",
  audience: "all",
  audienceIds: [],
  reminderMinutes: 30,
  capacity: null,
  gameTag: null,
  createdBy: "u1",
  createdAt: NOW,
  updatedAt: NOW,
  cancelledAt: null,
  occurrenceStart: NOW + 3_600_000,
  occurrenceEnd: NOW + 7_200_000,
  rsvpCounts: { going: 0, maybe: 0, declined: 0 },
  myRsvp: null,
  goingUserIds: [],
  canManage: true,
  ...patch,
});

test("the chat announcement is web's legacy card with the event id", () => {
  const text = model.chatEventAnnouncement(event());
  assert.ok(text.startsWith("__DECAVE_EVENT__"));
  const raw = JSON.parse(text.slice("__DECAVE_EVENT__".length));
  assert.equal(raw.inviteMode, "all");
  assert.deepEqual(model.parseChatEvent(text), {
    title: "Raid night",
    startAt: new Date(NOW + 3_600_000).toISOString(),
    description: "Bring snacks",
    eventId: "e1",
  });
  assert.equal(model.parseChatEvent('__DECAVE_EVENT__{"title":"x","startAt":"nope"}'), null);
  assert.equal(model.parseChatEvent("hello"), null);
});

const draft = (patch = {}) => ({
  title: "Scrims",
  description: "",
  coverUrl: "",
  startsAt: NOW + 3_600_000,
  endMode: "duration",
  durationMs: 3_600_000,
  endsAtInput: NOW + 7_200_000,
  recurrence: "none",
  voiceChannelId: null,
  channelId: 5,
  audience: "all",
  roleIds: [],
  memberIds: [],
  reminderMinutes: 30,
  capacity: "",
  gameTag: "",
  ...patch,
});

test("drafts are checked like web's composer", () => {
  assert.deepEqual(model.validateEventDraft(draft(), NOW, null), {});
  assert.equal(model.validateEventDraft(draft({ title: " " }), NOW, null).title.key, "titleMissing");
  assert.equal(model.validateEventDraft(draft({ startsAt: NOW - 3_600_000 }), NOW, null).startsAt.key, "startPast");
  assert.deepEqual(
    model.validateEventDraft(draft({ startsAt: NOW - 3_600_000 }), NOW, { startsAt: NOW - 3_600_000 }),
    {},
    "an unchanged past start can be kept when editing",
  );
  assert.equal(
    model.validateEventDraft(draft({ endMode: "end", endsAtInput: NOW }), NOW, null).endsAt.key,
    "endBeforeStart",
  );
  assert.equal(
    model.validateEventDraft(draft({ endMode: "end", endsAtInput: NOW + 20 * 86_400_000 }), NOW, null).endsAt.key,
    "tooLong",
  );
  assert.equal(model.validateEventDraft(draft({ audience: "roles" }), NOW, null).audienceIds.key, "noRoles");
  assert.equal(model.validateEventDraft(draft({ capacity: "0" }), NOW, null).capacity.key, "capacity");
  assert.equal(model.validateEventDraft(draft({ coverUrl: "http://x" }), NOW, null).coverUrl.key, "cover");
});

test("a valid draft passes the server's own validation", () => {
  const d = draft({ endMode: "none", recurrence: "weekly", capacity: "10", gameTag: "Valorant" });
  const result = validateHubEventInput(
    {
      title: d.title,
      description: d.description,
      coverUrl: null,
      startsAt: d.startsAt,
      endsAt: model.draftEndsAt(d),
      timezone: "Europe/Athens",
      recurrence: d.recurrence,
      audience: d.audience,
      audienceIds: [],
      reminderMinutes: d.reminderMinutes,
      capacity: 10,
      gameTag: d.gameTag,
      channelId: d.channelId,
      voiceChannelId: null,
    },
    NOW,
  );
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("month grid is 6 Monday-first weeks", () => {
  const grid = model.monthGrid(new Date(2026, 9, 16));
  assert.equal(grid.length, 42);
  assert.equal(grid[0].getDay(), 1);
  assert.ok(grid.some((day) => day.getMonth() === 9 && day.getDate() === 1));
});

test("an RSVP to a series updates every loaded occurrence", () => {
  const a = event({ occurrenceStart: NOW, occurrenceEnd: NOW + 3_600_000 });
  const b = event({ occurrenceStart: NOW + 7 * 86_400_000, occurrenceEnd: NOW + 7 * 86_400_000 + 3_600_000 });
  const updated = { ...a, myRsvp: "going", rsvpCounts: { going: 1, maybe: 0, declined: 0 } };
  const [first, second] = model.applyEventUpdate([a, b], updated);
  assert.equal(first.myRsvp, "going");
  assert.equal(second.myRsvp, "going");
  assert.equal(second.occurrenceStart, b.occurrenceStart, "each occurrence keeps its own time");
});

test("full events block Going unless I'm already going", () => {
  assert.equal(model.isEventFull(event({ capacity: 2, rsvpCounts: { going: 2, maybe: 0, declined: 0 } })), true);
  assert.equal(
    model.isEventFull(event({ capacity: 2, myRsvp: "going", rsvpCounts: { going: 2, maybe: 0, declined: 0 } })),
    false,
  );
});

test("default start is a future half hour", () => {
  const start = model.defaultEventStart(NOW + 60_000);
  assert.ok(start >= NOW + 30 * 60_000);
  assert.equal(start % (30 * 60_000), 0);
});
