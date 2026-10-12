// The bot capability each action needs. The worker's action handlers declare
// the same (a test keeps the two in step); the builder uses this to grant what
// template and imported rules need, and to tell admins what a bot is missing.
import type { BotAction, BotRule } from "./types.ts";

export type BotCapabilityName =
  "send_messages" | "create_polls" | "create_events" | "manage_roles" | "manage_messages" | "webhooks";

export const ACTION_CAPABILITY: Record<BotAction["type"], BotCapabilityName | null> = {
  sendMessage: "send_messages",
  reply: "send_messages",
  privateNotice: "send_messages",
  editMessage: "send_messages",
  react: "send_messages",
  createThread: "send_messages",
  pin: "manage_messages",
  unpin: "manage_messages",
  deleteTrigger: "manage_messages",
  startPoll: "create_polls",
  createEvent: "create_events",
  addRole: "manage_roles",
  removeRole: "manage_roles",
  toggleRole: "manage_roles",
  webhook: "webhooks",
  openForm: null,
  setVariable: null,
  addVariable: null,
  resetVariable: null,
  wait: null,
  stop: null,
  runRule: null,
};

/** Every capability the rules' actions (then and else) need, in first-use order. */
export function capabilitiesForRules(rules: readonly BotRule[]): BotCapabilityName[] {
  const needed = new Set<BotCapabilityName>();
  for (const rule of rules)
    for (const action of [...(rule.then ?? []), ...(rule.else ?? [])]) {
      const capability = ACTION_CAPABILITY[action.type];
      if (capability) needed.add(capability);
    }
  return [...needed];
}
