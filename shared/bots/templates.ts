// Starter bots offered in the builder. Pure data. The reaction-roles template
// has empty role ids the admin must pick: those rules are saved as drafts and
// fail publish until every id is filled in.
import type { BotRule } from "./types.ts";

export { BUILT_IN_COMMANDS } from "./builtins.ts";

export type BotTemplateId = "welcome" | "reactionRoles" | "polls" | "reminders" | "dice" | "liveAlerts";

export type BotTemplate = {
  id: BotTemplateId;
  name: string;
  description: string;
  rules(ctx: { firstTextRoomId: string }): BotRule[];
};

const base = { v: 1 as const, scope: { channels: ["*"], roles: [] }, cooldown: { perUser: 0, perChannel: 0 } };

export const TEMPLATES: BotTemplate[] = [
  {
    id: "welcome",
    name: "Welcome",
    description: "Greets every new member in a room.",
    rules: ({ firstTextRoomId }) => [
      {
        ...base,
        trigger: { type: "memberJoin" },
        then: [{ type: "sendMessage", channel: firstTextRoomId, text: "Welcome {user.mention}!" }],
      },
    ],
  },
  {
    id: "reactionRoles",
    name: "Reaction roles",
    description: "Members get a role when they react and lose it when they remove the reaction. Pick the role first.",
    rules: () => [
      {
        ...base,
        trigger: { type: "reactionAdded", emoji: "✅" },
        then: [{ type: "addRole", roleId: "" }],
      },
      {
        ...base,
        trigger: { type: "reactionRemoved", emoji: "✅" },
        then: [{ type: "removeRole", roleId: "" }],
      },
    ],
  },
  {
    id: "polls",
    name: "Polls",
    description: "/poll starts a poll from a question and two choices.",
    rules: () => [
      {
        ...base,
        trigger: {
          type: "command",
          name: "poll",
          options: [
            { name: "question", type: "text", required: true },
            { name: "yes", type: "text", required: true },
            { name: "no", type: "text", required: true },
          ],
        },
        then: [{ type: "startPoll", question: "{args.question}", options: ["{args.yes}", "{args.no}"] }],
      },
    ],
  },
  {
    id: "reminders",
    name: "Reminders",
    description: "/remind sends you a private reminder after 10 minutes (change the wait in the rule).",
    rules: () => [
      {
        ...base,
        trigger: {
          type: "command",
          name: "remind",
          options: [{ name: "text", type: "text", required: true }],
        },
        then: [
          { type: "privateNotice", text: "I will remind you in 10 minutes." },
          { type: "wait", minutes: 10 },
          { type: "privateNotice", text: "Reminder: {args.text}" },
        ],
      },
    ],
  },
  {
    id: "dice",
    name: "Dice",
    description: "/roll rolls a die with the number of sides you choose (default 6).",
    rules: () => [
      {
        ...base,
        trigger: { type: "command", name: "roll", options: [{ name: "sides", type: "number", required: false }] },
        then: [{ type: "sendMessage", channel: "trigger", text: "🎲 {user} rolled {random 1-{args.sides|default:6}}" }],
      },
    ],
  },
  {
    id: "liveAlerts",
    name: "Twitch live alerts",
    description:
      "Announces in a room when the hub's Twitch stream goes live. Turn on automatic live status in Stream Settings.",
    rules: ({ firstTextRoomId }) => [
      {
        ...base,
        trigger: { type: "streamLive" },
        then: [
          {
            type: "sendMessage",
            channel: firstTextRoomId,
            text: "🔴 {streamer} is live: {stream.title}\n🎮 {stream.game}\n{stream.url}",
          },
        ],
      },
    ],
  },
];
