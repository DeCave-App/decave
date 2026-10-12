// Wakes the realtime Durable Object after a bot timer is written so its alarm
// covers the new fire time. Kept apart from timers.ts so action modules can
// use it without an import cycle through the engine.

import type { Env } from "../lib/env";
import { realtimeFetch } from "../lib/realtime";

// While the Durable Object is running due timers it re-arms itself afterwards,
// so timers written meanwhile (schedule re-arms, waits, role reverts) skip the
// wake-up request instead of calling back into the busy object.
// Assumption: this counter is per isolate. If a Worker request ever shares the
// Durable Object's isolate it may skip its wake-up too; that is still safe,
// because its timer row is written before the alarm's closing re-arm reads
// MIN(fire_at), so the alarm still covers it.
let runningInAlarm = 0;

export async function whileRunningTimers<T>(work: () => Promise<T>): Promise<T> {
  runningInAlarm += 1;
  try {
    return await work();
  } finally {
    runningInAlarm -= 1;
  }
}

/** Asks the room's Durable Object to re-arm its alarm. Never throws. */
export async function armRoomTimers(env: Env, roomId: number): Promise<void> {
  if (runningInAlarm > 0) return;
  try {
    await realtimeFetch(env, "/internal/bot-timers/arm", { roomId });
  } catch (error) {
    console.error("bot timer arm failed", roomId, error);
  }
}
