// Hub setup checklist shown to owners and admins on Hub Home until done.

export type SetupAction = "manage" | "customize" | "createRoom" | "createEvent" | "invite";
export type SetupStepId = "describe" | "artwork" | "welcome" | "rules" | "rooms" | "event" | "invite";
/** Title, detail and button text: hub.hubHome.setup.steps.<id>.title / .detail / .action. */
export type SetupStep = {
  id: SetupStepId;
  done: boolean;
  action: SetupAction;
};

export type SetupFacts = {
  description: string;
  hasArtwork: boolean;
  welcome: string;
  rules: string;
  textRooms: number;
  events: number;
  members: number;
};

export function hubSetupSteps(facts: SetupFacts): SetupStep[] {
  return [
    {
      id: "describe",
      done: facts.description.trim().length >= 10,
      action: "manage",
    },
    {
      id: "artwork",
      done: facts.hasArtwork,
      action: "manage",
    },
    {
      id: "welcome",
      done: facts.welcome.trim().length > 0,
      action: "customize",
    },
    {
      id: "rules",
      done: facts.rules.trim().length > 0,
      action: "customize",
    },
    {
      id: "rooms",
      done: facts.textRooms >= 2,
      action: "createRoom",
    },
    {
      id: "event",
      done: facts.events > 0,
      action: "createEvent",
    },
    {
      id: "invite",
      done: facts.members >= 2,
      action: "invite",
    },
  ];
}

/** Hours (0-23, UTC) shifted to local time: index i = messages during local hour i. */
export function hoursToLocal(hoursUtc: readonly number[], offsetMinutes = -new Date().getTimezoneOffset()): number[] {
  const shift = Math.round(offsetMinutes / 60);
  return Array.from({ length: 24 }, (_, localHour) => hoursUtc[(((localHour - shift) % 24) + 24) % 24] ?? 0);
}

/** "+25%", "−40%", "New" or "Same" for this week against last week. */
export function weekChange(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? "New" : "Same";
  const change = Math.round(((current - previous) / previous) * 100);
  if (change === 0) return "Same";
  return change > 0 ? `+${change}%` : `−${Math.abs(change)}%`;
}
