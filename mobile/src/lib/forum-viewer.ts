// What the signed-in member may do in a forum room, decided like web
// (src/features/forum/forumModel.ts). The server enforces all of it; this
// only decides which controls to show.

export type ForumViewerRole = { id: string; name: string; permissions: readonly string[] };

export type ForumViewer = {
  userId: string;
  hubRole: string | null | undefined;
  customRoles: readonly ForumViewerRole[];
  /** False when the Hub is owner-only posting (and I'm not the owner) or the room is read-only for me. */
  canPostInHub: boolean;
};

export type ForumRoomPolicy = {
  forumPostPolicy?: "everyone" | "staff" | "roles" | "members";
  forumPostRoleIds?: string[];
  forumPostMemberIds?: string[];
};

const isHubManager = (viewer: ForumViewer) => viewer.hubRole === "owner" || viewer.hubRole === "admin";

export function isForumStaff(viewer: ForumViewer): boolean {
  return (
    isHubManager(viewer) ||
    viewer.customRoles.some(
      (role) =>
        role.permissions.includes("moderateMessages") ||
        role.permissions.includes("manageRooms") ||
        /^mod(erator)?$/i.test(role.name.trim()),
    )
  );
}

export function canPinOrLock(viewer: ForumViewer): boolean {
  return isHubManager(viewer) || viewer.customRoles.some((role) => role.permissions.includes("manageRooms"));
}

export function canMarkSolved(viewer: ForumViewer, postAuthorId: string | undefined): boolean {
  return Boolean(postAuthorId && postAuthorId === viewer.userId) || isForumStaff(viewer);
}

export type PostRestriction =
  | { key: "ownerOnly" | "staff" | "roles" | "members" }
  | { key: "namedRoles"; roles: string; count: number };

/** Null when I may start posts here, otherwise which forum.restriction.* text explains why not. */
export function postRestriction(
  room: ForumRoomPolicy,
  viewer: ForumViewer,
  roleNames: Record<string, string>,
): PostRestriction | null {
  if (!viewer.canPostInHub) return { key: "ownerOnly" };
  if (isHubManager(viewer)) return null;
  const policy = room.forumPostPolicy ?? "everyone";
  if (policy === "everyone") return null;
  if (policy === "staff") return isForumStaff(viewer) ? null : { key: "staff" };
  if (policy === "roles") {
    const allowed = room.forumPostRoleIds ?? [];
    if (viewer.customRoles.some((role) => allowed.includes(role.id))) return null;
    const names = allowed.map((id) => roleNames[id]).filter(Boolean);
    return names.length ? { key: "namedRoles", roles: names.join(", "), count: names.length } : { key: "roles" };
  }
  return (room.forumPostMemberIds ?? []).includes(viewer.userId) ? null : { key: "members" };
}
