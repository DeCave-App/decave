const SLOT_MINUTES = 30;
const MINUTE_MS = 60_000;

/** Returns whether a week-view drag may start at this half-hour slot. */
export function canBeginWeekSelection(dayStart: number, slot: number, now: number): boolean {
  return (
    Number.isFinite(dayStart) &&
    Number.isInteger(slot) &&
    slot >= 0 &&
    dayStart + slot * SLOT_MINUTES * MINUTE_MS >= now
  );
}

/** Builds a week-view event range, rejecting selections whose start has passed. */
export function weekSelectionRange(
  dayStart: number,
  fromSlot: number,
  toSlot: number,
  moved: boolean,
  now: number,
): { start: number; end: number } | null {
  if (
    !Number.isFinite(dayStart) ||
    !Number.isInteger(fromSlot) ||
    !Number.isInteger(toSlot) ||
    fromSlot < 0 ||
    toSlot < 0
  )
    return null;

  const firstSlot = Math.min(fromSlot, toSlot);
  const lastSlot = Math.max(fromSlot, toSlot);
  const start = dayStart + firstSlot * SLOT_MINUTES * MINUTE_MS;
  const end = moved ? dayStart + (lastSlot + 1) * SLOT_MINUTES * MINUTE_MS : start + 60 * MINUTE_MS;
  return start >= now && end > start ? { start, end } : null;
}
