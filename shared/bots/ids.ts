// Rewrites the hub-specific ids inside a rule (rooms, roles, other rules).
// Pure and defensive: it may be given untrusted, malformed input (imports), in
// which case missing or wrong-typed parts are left alone for validateRule to report.
import type { BotRule } from "./types.ts";

export type IdMapper = {
  channel?: (id: string) => string;
  voice?: (id: string) => string;
  role?: (id: string) => string;
  rule?: (id: string) => string;
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export function mapRuleIds(rule: BotRule, map: IdMapper): BotRule {
  const channel = map.channel ?? ((id: string) => id);
  const voice = map.voice ?? ((id: string) => id);
  const role = map.role ?? ((id: string) => id);
  const ruleRef = map.rule ?? ((id: string) => id);
  const swap = (o: Obj, key: string, fn: (id: string) => string) => {
    if (typeof o[key] === "string") o[key] = fn(o[key]);
  };
  const swapList = (list: unknown, fn: (id: string) => string): unknown =>
    Array.isArray(list) ? list.map((v) => (typeof v === "string" ? fn(v) : v)) : list;

  const walk = (item: unknown) => {
    if (!isObj(item)) return;
    switch (item.type) {
      case "roleAdded":
      case "roleRemoved":
      case "hasRole":
      case "lacksRole":
      case "addRole":
      case "removeRole":
      case "toggleRole":
        swap(item, "roleId", role);
        break;
      case "voiceJoin":
      case "voiceLeave":
        swap(item, "roomId", voice);
        break;
      case "channelIs":
      case "channelIsNot":
        swap(item, "channelId", channel);
        break;
      case "sendMessage":
        if (item.channel !== "trigger") swap(item, "channel", channel);
        break;
      case "runRule":
        swap(item, "ruleId", ruleRef);
        break;
    }
  };

  // A deep copy keeps the caller's rule untouched; non-JSON input falls through unchanged.
  let out: Obj;
  try {
    const copy: unknown = JSON.parse(JSON.stringify(rule));
    if (!isObj(copy)) return rule;
    out = copy;
  } catch {
    return rule;
  }
  walk(out.trigger);
  if (isObj(out.scope)) {
    out.scope.channels = swapList(out.scope.channels, (id) => (id === "*" ? id : channel(id)));
    out.scope.roles = swapList(out.scope.roles, role);
  }
  if (isObj(out.when)) {
    for (const key of ["all", "any"]) {
      const list = out.when[key];
      if (Array.isArray(list)) list.forEach((c) => walk(c));
    }
  }
  for (const key of ["then", "else"]) {
    const list = out[key];
    if (Array.isArray(list)) list.forEach((a) => walk(a));
  }
  return out as unknown as BotRule;
}
