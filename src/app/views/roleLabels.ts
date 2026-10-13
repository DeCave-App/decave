// Hub role names in the UI language: "Owner" for labels, "owner" inside sentences.
// Unknown roles are shown as they come from the server.

import { i18next } from "../../i18n";

/** Capitalized role name, e.g. "Owner". */
export function hubRoleTitle(role: string): string {
  if (role === "owner") return i18next.t("common.roles.owner");
  if (role === "admin") return i18next.t("common.roles.admin");
  if (role === "moderator") return i18next.t("common.roles.moderator");
  if (role === "member") return i18next.t("common.roles.member");
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/** Role name as it reads inside a sentence, e.g. "owner". */
export function hubRoleName(role: string): string {
  if (role === "owner") return i18next.t("common.roles.ownerLower");
  if (role === "admin") return i18next.t("common.roles.adminLower");
  if (role === "moderator") return i18next.t("common.roles.moderatorLower");
  if (role === "member") return i18next.t("common.roles.memberLower");
  return role;
}
