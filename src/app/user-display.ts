// How people are shown: avatar URLs, presence labels and colours, role icons.

import type { ServerRole, CustomRoleView, PresenceStatus } from "./types";
import { HTTP_URL } from "./env";

function builtInRoleIcon(role?: ServerRole | null): string {
  return role === "owner" ? "👑" : role === "admin" ? "🛡️" : "👤";
}

export function memberRoleIcons(member: { role?: ServerRole | null; customRoles?: CustomRoleView[] }): string {
  const custom = (member.customRoles ?? [])
    .map((role) => role.icon || (/^mod(erator)?$/i.test(role.name) ? "⚔️" : ""))
    .filter(Boolean);
  return Array.from(new Set([builtInRoleIcon(member.role), ...custom])).join(" ");
}

export function resolveAvatarUrl(value?: string | null): string {
  if (!value) return "";
  if (/^https?:\/\//i.test(value) || value.startsWith("data:")) return value;
  if (value.startsWith("/")) return `${HTTP_URL}${value}`;
  return value;
}

export function presenceLabel(status?: PresenceStatus, online = true) {
  if (!online || status === "invisible") return "Offline";
  if (status === "idle") return "Idle";
  if (status === "dnd") return "Do Not Disturb";
  return "Online";
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
