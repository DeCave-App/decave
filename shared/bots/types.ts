// Shared bot rule types and limits. Used by the Worker, web and mobile.

export const BOT_LIMITS = {
  botsPerHub: 25,
  rulesPerBot: 50,
  actionsPerRule: 20,
  commandsPerHub: 100,
  variablesPerHub: 200,
  runsPerMinute: 120,
  messagesPerMinute: 30,
  webhooksPerMinute: 10,
  minScheduleMinutes: 5,
  maxWaitMinutes: 10080,
  maxChainDepth: 3,
  regexMaxLength: 200,
  regexMaxInput: 500,
  runLogDays: 30,
  autoPauseFailures: 50,
  aiPerDay: 5,
  formMaxFields: 5,
  cardMaxButtons: 5,
  renderMaxChars: 2000,
} as const;

export type BotCommandOptionType = "text" | "number" | "user" | "role" | "channel" | "choice";

export type BotCommandOption = {
  name: string;
  type: BotCommandOptionType;
  required: boolean;
  choices?: string[];
};

export type BotTrigger =
  | { type: "command"; name: string; options: BotCommandOption[] }
  | {
      type: "message";
      mode: "contains" | "startsWith" | "exact" | "regex";
      pattern: string;
      caseSensitive: boolean;
    }
  | { type: "memberJoin" }
  | { type: "memberLeave" }
  | { type: "roleAdded"; roleId: string }
  | { type: "roleRemoved"; roleId: string }
  | { type: "reactionAdded"; emoji: string; messageId?: string }
  | { type: "reactionRemoved"; emoji: string; messageId?: string }
  | { type: "component"; customId: string }
  | { type: "formSubmit"; formId: string }
  | { type: "voiceJoin"; roomId?: string }
  | { type: "voiceLeave"; roomId?: string }
  | {
      type: "schedule";
      every?: number;
      daily?: string;
      weekly?: { day: number; time: string };
      cron?: string;
      timezone: string;
    }
  | { type: "hubEventStart" }
  | { type: "streamLive" }
  | { type: "streamOffline" };

export type BotVariableScope = "user" | "hub";

export type BotCondition =
  | { type: "hasRole"; roleId: string }
  | { type: "lacksRole"; roleId: string }
  | { type: "channelIs"; channelId: string }
  | { type: "channelIsNot"; channelId: string }
  | { type: "accountAge"; minDays: number }
  | { type: "memberAge"; minDays: number }
  | {
      type: "variable";
      name: string;
      scope: BotVariableScope;
      op: "=" | "!=" | ">" | "<" | "contains";
      value: string | number;
    }
  | { type: "chance"; percent: number }
  | { type: "timeOfDay"; from: string; to: string; timezone: string }
  | { type: "weekday"; days: number[] };

export type BotCardButton = { customId: string; label: string; style: string };

export type BotCard = {
  title?: string;
  text?: string;
  color?: string;
  imageUrl?: string;
  fields?: { name: string; value: string }[];
  buttons?: BotCardButton[];
  select?: { customId: string; options: { label: string; value: string }[] };
};

export type BotFormField = { id: string; label: string; style: "short" | "long"; required: boolean };

export type BotAction =
  | { type: "sendMessage"; channel: string; text: string; card?: BotCard }
  | { type: "reply"; text: string; card?: BotCard }
  | { type: "editMessage"; messageRef: string; text: string }
  | { type: "pin"; messageRef: string }
  | { type: "unpin"; messageRef: string }
  | { type: "deleteTrigger" }
  | { type: "react"; emoji: string }
  | { type: "createThread"; name: string }
  | { type: "privateNotice"; text: string }
  | { type: "addRole"; roleId: string; durationMinutes?: number }
  | { type: "removeRole"; roleId: string; durationMinutes?: number }
  | { type: "toggleRole"; roleId: string; durationMinutes?: number }
  | { type: "openForm"; formId: string; title: string; fields: BotFormField[] }
  | { type: "startPoll"; question: string; options: string[] }
  | { type: "createEvent"; title: string; startsInMinutes: number; durationMinutes: number }
  | { type: "setVariable"; name: string; scope: BotVariableScope; value?: string | number }
  | { type: "addVariable"; name: string; scope: BotVariableScope; value?: string | number }
  | { type: "resetVariable"; name: string; scope: BotVariableScope }
  | { type: "wait"; minutes: number }
  | { type: "stop" }
  | { type: "runRule"; ruleId: string }
  | { type: "webhook"; url: string; method: "GET" | "POST"; body?: string };

export type BotRule = {
  v: 1;
  trigger: BotTrigger;
  scope: { channels: string[]; roles: string[] };
  cooldown: { perUser: number; perChannel: number };
  when?: { all?: BotCondition[]; any?: BotCondition[] };
  then: BotAction[];
  else?: BotAction[];
  allowBotTriggers?: boolean;
};
