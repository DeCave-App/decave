import assert from "node:assert/strict";
import { test } from "node:test";

const { createFieldController } = await import("../../src/features/settings/fieldController.ts");

const flush = () => new Promise((resolve) => setImmediate(resolve));

function harness(initial, { debounceMs, fail } = {}) {
  let stored = initial;
  const writes = [];
  const applied = [];
  const timers = [];
  const failures = { next: fail ?? 0 };
  const controller = createFieldController({
    read: () => stored,
    async write(next) {
      writes.push(next);
      if (failures.next > 0) {
        failures.next -= 1;
        throw new Error("offline");
      }
      stored = next;
    },
    apply: (next) => applied.push(next),
    debounceMs,
    schedule: (fn, ms) => timers.push({ fn, ms }),
  });
  const runTimers = () => timers.splice(0).forEach((timer) => timer.fn());
  return { controller, writes, applied, timers, runTimers, failures, stored: () => stored };
}

test("set saves at once: saving, then saved, one write with the value", async () => {
  const { controller, writes } = harness(false);
  const seen = [];
  controller.subscribe(() => seen.push(controller.status));
  controller.set(true);
  assert.equal(controller.value, true);
  assert.equal(controller.status, "saving");
  await flush();
  assert.equal(controller.status, "saved");
  assert.deepEqual(writes, [true]);
  assert.ok(seen.includes("saving") && seen.at(-1) === "saved");
});

test("two sets inside the debounce window send one write with the last value", async () => {
  const { controller, writes, timers, runTimers, applied } = harness(50, { debounceMs: 400 });
  controller.set(60);
  controller.set(70);
  assert.equal(timers[0].ms, 400);
  assert.deepEqual(applied, [60, 70], "the app previews each value immediately");
  assert.deepEqual(writes, []);
  runTimers();
  await flush();
  assert.deepEqual(writes, [70]);
  assert.equal(controller.status, "saved");
});

test("undo puts back the value from before the last change only", async () => {
  const { controller, writes, stored } = harness("a");
  controller.set("b");
  await flush();
  controller.set("c");
  await flush();
  await controller.undo();
  assert.equal(controller.value, "b");
  assert.equal(stored(), "b");
  assert.deepEqual(writes, ["b", "c", "b"]);
  assert.equal(controller.canUndo, false);
});

test("a failed save shows the previous value and an error; retry sends the failed value", async () => {
  const { controller, writes, applied, stored } = harness(1, { fail: 1 });
  controller.set(2);
  await flush();
  assert.equal(controller.status, "error");
  assert.equal(controller.value, 1);
  assert.equal(applied.at(-1), 1, "the app is put back too");
  await controller.retry();
  assert.deepEqual(writes, [2, 2]);
  assert.equal(controller.value, 2);
  assert.equal(controller.status, "saved");
  assert.equal(stored(), 2);
});

test("a stale reply doesn't overwrite a newer change", async () => {
  let release;
  const writes = [];
  const controller = createFieldController({
    read: () => 0,
    write(next) {
      writes.push(next);
      return next === 1 ? new Promise((resolve, reject) => (release = reject)) : Promise.resolve();
    },
  });
  controller.set(1);
  controller.set(2);
  await flush();
  release(new Error("late failure"));
  await flush();
  assert.equal(controller.value, 2);
  assert.equal(controller.status, "saved");
});
