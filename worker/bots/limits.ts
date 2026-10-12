// Per-hub run budgets and rule cooldowns for builder bots.
//
// These live in module memory, so each Worker isolate (and each HubRoom
// Durable Object) keeps its own counters. That is an approximation: a hub's
// events mostly flow through its HubRoom plus a few routes, so a burst cannot
// go far past the limit, and nothing here needs to survive a restart.

import { BOT_LIMITS } from "../../shared/bots/types";

export type BotBudget = "runs" | "messages" | "webhooks";

const PER_MINUTE: Record<BotBudget, number> = {
  runs: BOT_LIMITS.runsPerMinute,
  messages: BOT_LIMITS.messagesPerMinute,
  webhooks: BOT_LIMITS.webhooksPerMinute,
};

const MAX_COOLDOWN_KEYS = 10_000;

let clock: () => number = () => Date.now();
const windows = new Map<string, { minute: number; count: number }>();
const cooldowns = new Map<string, number>();

export function limitsNow(): number {
  return clock();
}

/** Tests swap the clock so windows and cooldowns are deterministic. */
export function setLimitsClock(next: () => number): void {
  clock = next;
}

export function resetLimitsForTests(): void {
  windows.clear();
  cooldowns.clear();
  clock = () => Date.now();
}

/** Counts one use of the hub's per-minute budget; false when it is spent. */
export function takeBudget(hubId: number, budget: BotBudget): boolean {
  const minute = Math.floor(clock() / 60_000);
  const key = `${hubId}:${budget}`;
  const current = windows.get(key);
  if (!current || current.minute !== minute) {
    windows.set(key, { minute, count: 1 });
    return true;
  }
  if (current.count >= PER_MINUTE[budget]) return false;
  current.count += 1;
  return true;
}

/** True while any of the keys is still cooling down. */
export function onCooldown(keys: string[]): boolean {
  const now = clock();
  return keys.some((key) => (cooldowns.get(key) ?? 0) > now);
}

export function startCooldown(key: string, seconds: number): void {
  if (seconds <= 0) return;
  const now = clock();
  if (cooldowns.size >= MAX_COOLDOWN_KEYS) {
    for (const [k, until] of cooldowns) if (until <= now) cooldowns.delete(k);
    if (cooldowns.size >= MAX_COOLDOWN_KEYS) cooldowns.clear();
  }
  cooldowns.set(key, now + seconds * 1000);
}
