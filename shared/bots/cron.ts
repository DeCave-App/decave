// 5-field cron parsing for bot schedules ("minute hour day month weekday";
// *, a, a-b, steps and lists; weekday 0-7 with 7 = Sunday). Pure: shared by
// the rule validator and the Worker's scheduler.

export type Cron = {
  minutes: number[];
  hours: number[];
  days: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
  anyDay: boolean;
  anyWeekday: boolean;
};

function cronField(text: string, min: number, max: number): number[] | null {
  const values = new Set<number>();
  for (const part of text.split(",")) {
    const match = /^(\*|\d{1,2}(?:-\d{1,2})?)(?:\/(\d{1,2}))?$/.exec(part);
    if (!match) return null;
    const step = match[2] === undefined ? 1 : Number(match[2]);
    if (step < 1) return null;
    let from = min;
    let to = max;
    if (match[1] !== "*") {
      const [a, b] = match[1].split("-").map(Number);
      from = a;
      to = b ?? (match[2] === undefined ? a : max);
    }
    if (from < min || to > max || from > to) return null;
    for (let value = from; value <= to; value += step) values.add(value);
  }
  return [...values].sort((a, b) => a - b);
}

export function parseCron(text: string): Cron | null {
  const fields = text.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const minutes = cronField(fields[0], 0, 59);
  const hours = cronField(fields[1], 0, 23);
  const days = cronField(fields[2], 1, 31);
  const months = cronField(fields[3], 1, 12);
  const weekdays = cronField(fields[4], 0, 7);
  if (!minutes || !hours || !days || !months || !weekdays) return null;
  return {
    minutes,
    hours,
    days: new Set(days),
    months: new Set(months),
    weekdays: new Set(weekdays.map((d) => d % 7)),
    anyDay: fields[2] === "*",
    anyWeekday: fields[4] === "*",
  };
}

/**
 * The shortest gap, in minutes, between two fires within the minute field,
 * counting the wrap into the next hour. Conservative: the wrap is counted even
 * when the next hour never fires.
 */
export function cronMinuteGap(cron: Cron): number {
  const minutes = cron.minutes;
  if (minutes.length < 2) return 60;
  let gap = minutes[0] + 60 - minutes[minutes.length - 1];
  for (let i = 1; i < minutes.length; i += 1) gap = Math.min(gap, minutes[i] - minutes[i - 1]);
  return gap;
}
