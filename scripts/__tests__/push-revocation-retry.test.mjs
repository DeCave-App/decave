import assert from "node:assert/strict";
import test from "node:test";
import { createPushRevocationRetryLifecycle } from "../../mobile/src/lib/push-revocation-retry.ts";

function fakeScheduler() {
  let nextId = 0;
  const timers = new Map();
  const cancelled = [];
  return {
    timers,
    cancelled,
    schedule(callback, delayMs) {
      const id = ++nextId;
      timers.set(id, { callback, delayMs });
      return id;
    },
    cancel(id) {
      cancelled.push(id);
      timers.delete(id);
    },
    async runNext() {
      const [id, timer] = timers.entries().next().value ?? [];
      assert.ok(timer, "expected a scheduled retry");
      timers.delete(id);
      timer.callback();
      await flush();
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

test("drains the persisted queue at startup without a signed-in session", async () => {
  const scheduler = fakeScheduler();
  let attempts = 0;
  const lifecycle = createPushRevocationRetryLifecycle({
    drain: async () => {
      attempts += 1;
      return true;
    },
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  lifecycle.start();
  await flush();

  assert.equal(attempts, 1);
  assert.equal(scheduler.timers.size, 0);
  lifecycle.stop();
});

test("backs off after an offline drain, then retries until the queue is acknowledged", async () => {
  const scheduler = fakeScheduler();
  const results = [false, false, true];
  let attempts = 0;
  const lifecycle = createPushRevocationRetryLifecycle({
    drain: async () => {
      attempts += 1;
      return results.shift();
    },
    delaysMs: [100, 200],
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  lifecycle.start();
  await flush();
  assert.equal(attempts, 1);
  assert.deepEqual(
    [...scheduler.timers.values()].map(({ delayMs }) => delayMs),
    [100],
  );

  await scheduler.runNext();
  assert.equal(attempts, 2);
  assert.deepEqual(
    [...scheduler.timers.values()].map(({ delayMs }) => delayMs),
    [200],
  );

  await scheduler.runNext();
  assert.equal(attempts, 3);
  assert.equal(scheduler.timers.size, 0);
  lifecycle.stop();
});

test("startup drains once while inactive, then retries only while foregrounded", async () => {
  const scheduler = fakeScheduler();
  const results = [false, false, true];
  let attempts = 0;
  const lifecycle = createPushRevocationRetryLifecycle({
    drain: async () => {
      attempts += 1;
      return results.shift();
    },
    active: false,
    delaysMs: [100],
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  lifecycle.start();
  await flush();
  assert.equal(attempts, 1, "startup should inspect the queue even while inactive");
  assert.equal(scheduler.timers.size, 0, "inactive startup failure must not poll in background");

  lifecycle.setActive(true);
  await flush();
  assert.equal(attempts, 2, "foregrounding should retry immediately");
  assert.equal(scheduler.timers.size, 1, "active failures should use bounded backoff");

  lifecycle.setActive(false);
  assert.equal(scheduler.timers.size, 0, "backgrounding should cancel the retry timer");
  lifecycle.setActive(true);
  await flush();
  assert.equal(attempts, 3, "the next foreground transition should retry immediately");
  assert.equal(scheduler.timers.size, 0, "acknowledgement should stop retries");
  lifecycle.stop();
});

test("foreground retry cancels backoff and an in-flight kick runs after the current pass", async () => {
  const scheduler = fakeScheduler();
  const firstPass = deferred();
  let attempts = 0;
  let active = 0;
  let maxActive = 0;
  const lifecycle = createPushRevocationRetryLifecycle({
    drain: async () => {
      attempts += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        if (attempts === 1) return await firstPass.promise;
        return false;
      } finally {
        active -= 1;
      }
    },
    delaysMs: [100],
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  lifecycle.start();
  await flush();
  lifecycle.retryNow();
  assert.equal(attempts, 1, "a foreground event must not overlap an active drain");
  firstPass.resolve(false);
  await flush();
  assert.equal(attempts, 2, "the in-flight foreground kick should run immediately afterward");
  assert.equal(maxActive, 1);
  assert.equal(scheduler.timers.size, 1);

  lifecycle.retryNow();
  await flush();
  assert.equal(attempts, 3, "foreground recovery should bypass the retry delay");
  assert.equal(scheduler.cancelled.length, 1);
  lifecycle.stop();
});

test("retries the original queued credential after an account switch and stops on cleanup", async () => {
  const scheduler = fakeScheduler();
  const firstPass = deferred();
  const currentAccount = "new-account";
  const queuedCredential = "old-account-session";
  const credentialsUsed = [];
  let attempts = 0;
  let active = 0;
  let maxActive = 0;
  const lifecycle = createPushRevocationRetryLifecycle({
    // The persisted queue owns its credential; the current account is not an input.
    drain: async (...args) => {
      assert.equal(args.length, 0);
      assert.equal(currentAccount, "new-account");
      attempts += 1;
      credentialsUsed.push(queuedCredential);
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        if (attempts === 1) return await firstPass.promise;
        return true;
      } finally {
        active -= 1;
      }
    },
    delaysMs: [100],
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  lifecycle.start();
  await flush();
  lifecycle.retryNow();
  firstPass.resolve(false);
  await flush();

  assert.deepEqual(credentialsUsed, ["old-account-session", "old-account-session"]);
  assert.equal(maxActive, 1);
  assert.equal(scheduler.timers.size, 0);
  lifecycle.stop();

  const failedLifecycle = createPushRevocationRetryLifecycle({
    drain: async () => false,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });
  failedLifecycle.start();
  await flush();
  assert.equal(scheduler.timers.size, 1);
  failedLifecycle.stop();
  assert.equal(scheduler.timers.size, 0, "cleanup should cancel pending retries");
});
