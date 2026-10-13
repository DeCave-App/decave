// How people are shown: avatar URLs, presence labels and colours, role icons.

import type { ServerRole, CustomRoleView, PresenceStatus } from "./types";
import { HTTP_URL } from "./env";
import { i18next } from "../i18n/index.ts";

function builtInRoleIcon(role?: ServerRole | null): string {
  return role === "owner" ? "👑" : role === "admin" ? "🛡️" : "👤";
}

export function memberRoleIcons(member: {
  role?: ServerRole | null;
  customRoles?: CustomRoleView[];
  faceitLevel?: number;
}): string {
  const custom = (member.customRoles ?? [])
    .map((role) => role.icon || (/^mod(erator)?$/i.test(role.name) ? "⚔️" : ""))
    .filter(Boolean);
  const faceit =
    typeof member.faceitLevel === "number" && member.faceitLevel >= 1 && member.faceitLevel <= 10
      ? `LVL${member.faceitLevel}`
      : "";
  return Array.from(new Set([builtInRoleIcon(member.role), ...custom, faceit]))
    .filter(Boolean)
    .join(" ");
}

export function resolveAvatarUrl(value?: string | null): string {
  if (!value) return "";
  if (/^https?:\/\//i.test(value) || value.startsWith("data:")) return value;
  if (value.startsWith("/")) return `${HTTP_URL}${value}`;
  return value;
}

export function presenceLabel(status?: PresenceStatus, online = true) {
  if (!online || status === "invisible") return i18next.t("chat.actions.presence.offline");
  if (status === "idle") return i18next.t("chat.actions.presence.idle");
  if (status === "dnd") return i18next.t("chat.actions.presence.dnd");
  return i18next.t("chat.actions.presence.online");
}

export function presenceColor(status?: PresenceStatus, online = true) {
  if (!online || status === "invisible") return "#687386";
  if (status === "idle") return "#f0b232";
  if (status === "dnd") return "#ed4245";
  return "#23d160";
}

export function presenceGlow(status?: PresenceStatus, online = true) {
  if (!online || status === "invisible") return "none";
  if (status === "idle") return "0 0 9px rgba(240,178,50,.45)";
  if (status === "dnd") return "0 0 9px rgba(237,66,69,.45)";
  return "0 0 9px rgba(35,209,96,.45)";
}
