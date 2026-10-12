import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { canBeginWeekSelection, weekSelectionRange } from "../../src/features/calendar/weekSelection.ts";

const root = path.resolve(import.meta.dirname, "..", "..");

test("week calendar refuses past slots for click and drag creation", () => {
  const dayStart = new Date(2026, 9, 9).setHours(0, 0, 0, 0);
  const now = dayStart + 13 * 60 * 60_000 + 20 * 60_000;

  assert.equal(canBeginWeekSelection(dayStart, 26, now), false, "13:00 is already past");
  assert.equal(canBeginWeekSelection(dayStart, 27, now), true, "13:30 is still upcoming");
  assert.equal(weekSelectionRange(dayStart, 26, 26, false, now), null, "past click must not open composer");
  assert.equal(weekSelectionRange(dayStart, 27, 26, true, now), null, "dragging backward into the past is rejected");
  assert.deepEqual(weekSelectionRange(dayStart, 27, 28, true, now), {
    start: dayStart + 13.5 * 60 * 60_000,
    end: dayStart + 14.5 * 60 * 60_000,
  });
  assert.equal(weekSelectionRange(dayStart - 24 * 60 * 60_000, 30, 31, true, now), null, "past days are rejected");
});

test("HubCalendarPage routes pointer and keyboard creation through past-time guards", async () => {
  const source = await fs.readFile(path.join(root, "src/features/calendar/HubCalendarPage.tsx"), "utf8");
  assert.match(source, /canBeginWeekSelection\(day\.getTime\(\), slot, Date\.now\(\)\)/);
  assert.match(
    source,
    /weekSelectionRange\(day\.getTime\(\), current\.from, current\.to, current\.moved, Date\.now\(\)\)/,
  );
  assert.match(source, /e\.detail === 0 && slotStart >= Date\.now\(\)/);
});

test("opening Hub Home loads its selected hub events and switching hubs reloads the new selection", async () => {
  const app = await fs.readFile(path.join(root, "src/App.tsx"), "utf8");
  assert.match(app, /const hubHomeActive = hubPanels\.showHubHome && !isStreamerHub/);

  const loadEffect = [...app.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\}, \[([^\]]+)\]\);/g)].find(
    ([, body]) => body.includes("hubEvents.loadUpcoming") && body.includes("currentServer.id"),
  );
  assert.ok(loadEffect, "Hub Home must load upcoming events for its selected hub");
  const [, body, dependencies] = loadEffect;
  assert.match(body, /hubHomeActive/);
  assert.match(body, /hubEvents\.loadUpcoming\(\[currentServer\.id\]\)/);
  assert.match(dependencies, /hubHomeActive/);
  assert.match(dependencies, /currentServer\.id/);
  assert.match(dependencies, /hubEvents\.loadUpcoming/);
});
