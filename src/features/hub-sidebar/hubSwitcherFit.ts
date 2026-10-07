// Top-bar Hub switcher: which Hub pills fit. Pure so it can be tested.
//
// The switcher tries, in order: full pills (icon + name), compact pills (icon
// only, the active Hub keeps its name), then compact pills plus a "+N" menu
// for the rest. The active Hub is always visible.

export type HubSwitcherFit = "full" | "compact" | "overflow";

/**
 * Indices (in original order) of the pills that fit in `available` pixels
 * when `reserve` pixels are kept for the "+N" and "Create Hub" buttons.
 */
export function pillsThatFit(
  widths: readonly number[],
  activeIndex: number,
  available: number,
  reserve: number,
  gap = 4,
): number[] {
  if (!widths.length) return [];
  let room = available - reserve;
  const visible = new Set<number>();
  if (activeIndex >= 0 && activeIndex < widths.length) {
    visible.add(activeIndex);
    room -= widths[activeIndex];
  }
  for (let index = 0; index < widths.length; index += 1) {
    if (visible.has(index)) continue;
    const cost = widths[index] + gap;
    if (cost > room) break;
    visible.add(index);
    room -= cost;
  }
  return [...visible].sort((a, b) => a - b);
}
