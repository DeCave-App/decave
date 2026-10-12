// What a bot rule can be built from: a label and the fields of every trigger,
// condition and action type in types.ts. The builder UI renders its forms from
// this, and AI rule generation sends it to the model as the list of what exists.
import type { BotAction, BotCondition, BotTrigger } from "./types.ts";

export type BotFieldKind =
  | "text"
  | "number"
  | "boolean"
  | "channel"
  | "voiceRoom"
  | "role"
  | "rule"
  | "emoji"
  | "choice"
  | "duration"
  | "template"
  | "options"
  | "card"
  | "form"
  | "schedule";

export type BotFieldDescriptor = {
  key: string;
  label: string;
  kind: BotFieldKind;
  required: boolean;
  /** Allowed values for "choice". */
  choices?: (string | number)[];
  /** The field holds a list of values of this kind. */
  multiple?: boolean;
  /** Extra guidance (units, formats, special values). */
  hint?: string;
};

export type BotCatalogueEntry = { label: string; description: string; fields: BotFieldDescriptor[] };

type Catalogue<T extends { type: string }> = { [K in T["type"]]: BotCatalogueEntry };

const field = (
  key: string,
  label: string,
  kind: BotFieldKind,
  required = true,
  extra: Partial<BotFieldDescriptor> = {},
): BotFieldDescriptor => ({ key, label, kind, required, ...extra });

const MINUTES = "Minutes.";
const scopeField = field("scope", "Variable scope", "choice", true, {
  choices: ["user", "hub"],
  hint: "user: one value per member; hub: one shared value.",
});
const durationField = field("durationMinutes", "Remove again after", "duration", false, {
  hint: "Minutes. Leave empty to keep it.",
});
const cardField = field("card", "Card", "card", false, {
  hint: "Optional rich card: title, text, color, imageUrl, fields, up to 5 buttons, one select.",
});

export const TRIGGER_CATALOGUE: Catalogue<BotTrigger> = {
  command: {
    label: "Slash command",
    description: "A member runs /name in a room.",
    fields: [
      field("name", "Command name", "text", true, { hint: "1-32 lowercase letters, digits or dashes, no slash." }),
      field("options", "Options", "options", true, {
        hint: "List of {name, type (text|number|user|role|channel|choice), required, choices?}. Read as {args.name}.",
      }),
    ],
  },
  message: {
    label: "Message posted",
    description: "A message in a room matches a pattern.",
    fields: [
      field("mode", "Match", "choice", true, { choices: ["contains", "startsWith", "exact", "regex"] }),
      field("pattern", "Pattern", "text", true, {
        hint: "Regex: up to 200 characters, one * or + at most, repeats only on single characters, groups only for (a|b) choices. Checks the first 500 characters.",
      }),
      field("caseSensitive", "Case sensitive", "boolean", true),
    ],
  },
  memberJoin: { label: "Member joins", description: "Someone joins the hub.", fields: [] },
  memberLeave: { label: "Member leaves", description: "Someone leaves the hub.", fields: [] },
  roleAdded: {
    label: "Role added",
    description: "A member gets a role.",
    fields: [field("roleId", "Role", "role")],
  },
  roleRemoved: {
    label: "Role removed",
    description: "A member loses a role.",
    fields: [field("roleId", "Role", "role")],
  },
  reactionAdded: {
    label: "Reaction added",
    description: "A member reacts with an emoji.",
    fields: [
      field("emoji", "Emoji", "emoji"),
      field("messageId", "Only on message", "text", false, { hint: "Message id; empty for any message." }),
    ],
  },
  reactionRemoved: {
    label: "Reaction removed",
    description: "A member removes a reaction.",
    fields: [
      field("emoji", "Emoji", "emoji"),
      field("messageId", "Only on message", "text", false, { hint: "Message id; empty for any message." }),
    ],
  },
  component: {
    label: "Button or select used",
    description: "A member clicks a card button or picks from a card select.",
    fields: [field("customId", "Button or select id", "text", true, { hint: "The customId set on the card." })],
  },
  formSubmit: {
    label: "Form submitted",
    description: "A member submits a form opened by this bot.",
    fields: [field("formId", "Form id", "text", true, { hint: "Fields are read as {form.fieldId}." })],
  },
  voiceJoin: {
    label: "Joins voice",
    description: "A member joins a voice room.",
    fields: [field("roomId", "Voice room", "voiceRoom", false, { hint: "Empty for any voice room." })],
  },
  voiceLeave: {
    label: "Leaves voice",
    description: "A member leaves a voice room.",
    fields: [field("roomId", "Voice room", "voiceRoom", false, { hint: "Empty for any voice room." })],
  },
  schedule: {
    label: "On a schedule",
    description: "Runs on a timer, at least 5 minutes apart.",
    fields: [
      field("schedule", "Schedule", "schedule", true, {
        hint: 'Exactly one of every (minutes, >=5), daily ("HH:MM"), weekly ({day 0-6, time "HH:MM"}) or cron, plus timezone (IANA name). Stored as those flat fields on the trigger.',
      }),
    ],
  },
  hubEventStart: { label: "Hub event starts", description: "A scheduled hub event begins.", fields: [] },
  streamLive: {
    label: "Stream goes live",
    description: "The hub's Twitch channel starts streaming (needs automatic live status in Stream Settings).",
    fields: [],
  },
  streamOffline: {
    label: "Stream ends",
    description: "The hub's Twitch channel stops streaming.",
    fields: [],
  },
};

export const CONDITION_CATALOGUE: Catalogue<BotCondition> = {
  hasRole: { label: "Has role", description: "The member has a role.", fields: [field("roleId", "Role", "role")] },
  lacksRole: {
    label: "Lacks role",
    description: "The member does not have a role.",
    fields: [field("roleId", "Role", "role")],
  },
  channelIs: {
    label: "Room is",
    description: "The event happened in a room.",
    fields: [field("channelId", "Room", "channel")],
  },
  channelIsNot: {
    label: "Room is not",
    description: "The event happened outside a room.",
    fields: [field("channelId", "Room", "channel")],
  },
  accountAge: {
    label: "Account age",
    description: "The account is at least this many days old.",
    fields: [field("minDays", "At least (days)", "number")],
  },
  memberAge: {
    label: "Member for",
    description: "The member joined the hub at least this many days ago.",
    fields: [field("minDays", "At least (days)", "number")],
  },
  variable: {
    label: "Variable",
    description: "Compares a stored variable.",
    fields: [
      field("name", "Variable", "text"),
      scopeField,
      field("op", "Comparison", "choice", true, { choices: ["=", "!=", ">", "<", "contains"] }),
      field("value", "Value", "text"),
    ],
  },
  chance: {
    label: "Random chance",
    description: "Passes this percent of the time.",
    fields: [field("percent", "Percent", "number", true, { hint: "0-100." })],
  },
  timeOfDay: {
    label: "Time of day",
    description: "The current time is in a window.",
    fields: [
      field("from", "From", "text", true, { hint: '"HH:MM".' }),
      field("to", "To", "text", true, { hint: '"HH:MM".' }),
      field("timezone", "Time zone", "text", true, { hint: "IANA name, e.g. Europe/Berlin." }),
    ],
  },
  weekday: {
    label: "Weekday",
    description: "Today is one of these days.",
    fields: [
      field("days", "Days", "choice", true, { choices: [0, 1, 2, 3, 4, 5, 6], multiple: true, hint: "0 = Sunday." }),
    ],
  },
};

export const ACTION_CATALOGUE: Catalogue<BotAction> = {
  sendMessage: {
    label: "Send message",
    description: "Posts a message in a room.",
    fields: [
      field("channel", "Room", "channel", true, { hint: 'A room id, or "trigger" for the room the event came from.' }),
      field("text", "Message", "template"),
      cardField,
    ],
  },
  reply: {
    label: "Reply",
    description: "Replies to the triggering message or command.",
    fields: [field("text", "Message", "template"), cardField],
  },
  editMessage: {
    label: "Edit message",
    description: "Edits a message the bot sent earlier in this run.",
    fields: [
      field("messageRef", "Message", "text", true, { hint: '"trigger" or a message id.' }),
      field("text", "New text", "template"),
    ],
  },
  pin: {
    label: "Pin message",
    description: "Pins a message.",
    fields: [field("messageRef", "Message", "text", true, { hint: '"trigger" or a message id.' })],
  },
  unpin: {
    label: "Unpin message",
    description: "Unpins a message.",
    fields: [field("messageRef", "Message", "text", true, { hint: '"trigger" or a message id.' })],
  },
  deleteTrigger: {
    label: "Delete triggering message",
    description: "Deletes the message that fired the rule.",
    fields: [],
  },
  react: {
    label: "React",
    description: "Adds a reaction to the triggering message.",
    fields: [field("emoji", "Emoji", "emoji")],
  },
  createThread: {
    label: "Create thread",
    description: "Starts a thread on the triggering message.",
    fields: [field("name", "Thread name", "template")],
  },
  privateNotice: {
    label: "Private notice",
    description: "A message only the member sees.",
    fields: [field("text", "Message", "template")],
  },
  addRole: {
    label: "Give role",
    description: "Gives the member a role.",
    fields: [field("roleId", "Role", "role"), durationField],
  },
  removeRole: {
    label: "Remove role",
    description: "Takes a role from the member.",
    fields: [field("roleId", "Role", "role"), durationField],
  },
  toggleRole: {
    label: "Toggle role",
    description: "Gives the role if missing, else removes it.",
    fields: [field("roleId", "Role", "role"), durationField],
  },
  openForm: {
    label: "Open form",
    description: "Shows the member a form (from a command, button or select only).",
    fields: [
      field("formId", "Form id", "text"),
      field("title", "Title", "text"),
      field("fields", "Fields", "form", true, {
        hint: "Up to 5 of {id, label, style (short|long), required}.",
      }),
    ],
  },
  startPoll: {
    label: "Start poll",
    description: "Posts a poll in the room.",
    fields: [
      field("question", "Question", "template"),
      field("options", "Choices", "template", true, { multiple: true, hint: "2-10 choices." }),
    ],
  },
  createEvent: {
    label: "Create hub event",
    description: "Schedules a hub event.",
    fields: [
      field("title", "Title", "template"),
      field("startsInMinutes", "Starts in", "duration", true, { hint: MINUTES }),
      field("durationMinutes", "Lasts", "duration", true, { hint: MINUTES }),
    ],
  },
  setVariable: {
    label: "Set variable",
    description: "Stores a value.",
    fields: [field("name", "Variable", "text"), scopeField, field("value", "Value", "template", false)],
  },
  addVariable: {
    label: "Add to variable",
    description: "Adds a number to a stored value.",
    fields: [field("name", "Variable", "text"), scopeField, field("value", "Amount", "number", false)],
  },
  resetVariable: {
    label: "Reset variable",
    description: "Deletes a stored value.",
    fields: [field("name", "Variable", "text"), scopeField],
  },
  wait: {
    label: "Wait",
    description: "Pauses before the next actions (at most 7 days).",
    fields: [field("minutes", "Wait", "duration", true, { hint: "Minutes, 1-10080." })],
  },
  stop: { label: "Stop", description: "Stops running this rule's actions.", fields: [] },
  runRule: {
    label: "Run another rule",
    description: "Runs another rule of this bot.",
    fields: [field("ruleId", "Rule", "rule")],
  },
  webhook: {
    label: "Call webhook",
    description: "Calls an HTTPS URL.",
    fields: [
      field("url", "URL", "template", true, { hint: "HTTPS only." }),
      field("method", "Method", "choice", true, { choices: ["GET", "POST"] }),
      field("body", "Body", "template", false),
    ],
  },
};

export const CATALOGUE = {
  triggers: TRIGGER_CATALOGUE,
  conditions: CONDITION_CATALOGUE,
  actions: ACTION_CATALOGUE,
} as const;

export const TRIGGER_TYPES = Object.keys(TRIGGER_CATALOGUE) as BotTrigger["type"][];
export const CONDITION_TYPES = Object.keys(CONDITION_CATALOGUE) as BotCondition["type"][];
export const ACTION_TYPES = Object.keys(ACTION_CATALOGUE) as BotAction["type"][];
