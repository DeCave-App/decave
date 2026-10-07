// Hub setup checklist shown to owners and admins on Hub Home until done.

export type SetupAction = "manage" | "customize" | "createRoom" | "createEvent" | "invite";
export type SetupStep = {
  id: string;
  title: string;
  detail: string;
  done: boolean;
  action: SetupAction;
  actionLabel: string;
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
      title: "Say what your Hub is for",
      detail: "A short description shows on Discover and Hub Home.",
      done: facts.description.trim().length >= 10,
      action: "manage",
      actionLabel: "Add description",
    },
    {
      id: "artwork",
      title: "Add an icon or banner",
      detail: "Helps people spot your Hub in the top bar and on Discover.",
      done: facts.hasArtwork,
      action: "manage",
      actionLabel: "Add artwork",
    },
    {
      id: "welcome",
      title: "Write a welcome message",
      detail: "The first thing new members read on Hub Home.",
      done: facts.welcome.trim().length > 0,
      action: "customize",
      actionLabel: "Write welcome",
    },
    {
      id: "rules",
      title: "Set a few rules",
      detail: "Clear rules make moderation easier.",
      done: facts.rules.trim().length > 0,
      action: "customize",
      actionLabel: "Add rules",
    },
    {
      id: "rooms",
      title: "Create rooms for your topics",
      detail: "For example #lfg, #clips or #help next to #general.",
      done: facts.textRooms >= 2,
      action: "createRoom",
      actionLabel: "Create a room",
    },
    {
      id: "event",
      title: "Plan your first event",
      detail: "Game nights and tournaments bring people back.",
      done: facts.events > 0,
      action: "createEvent",
      actionLabel: "Create event",
    },
    {
      id: "invite",
      title: "Invite your first members",
      detail: "Share the invite link with friends.",
      done: facts.members >= 2,
      action: "invite",
      actionLabel: "Copy invite link",
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
