import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { HubCustomRole, HubFriendRow, HubMemberRow } from "./types";
import { localeForLanguage } from "../../app/locale";

type MembersSectionProps = {
  members: readonly HubMemberRow[];
  loading: boolean;
  roles: readonly HubCustomRole[];
  friends: readonly HubFriendRow[];
  friendsLoading: boolean;
  isOwner: boolean;
  canManage: boolean;
  myRole: "owner" | "admin" | "member" | null;
  currentUserId?: string | null;
  renderAvatar: (person: { username: string; avatarUrl?: string | null }) => ReactNode;
  onAddFriend: (friend: HubFriendRow) => void;
  onChangeMemberRole: (member: HubMemberRow, role: "admin" | "member") => void;
  onAssignCustomRole: (member: HubMemberRow, roleId: string) => void;
  onModerateMember: (member: HubMemberRow, action: "timeout" | "ban") => void;
  onRemoveMember: (member: HubMemberRow) => void;
};

function MemberActions({
  member,
  onModerate,
  onRemove,
}: {
  member: HubMemberRow;
  onModerate: (action: "timeout" | "ban") => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        wrapRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    wrapRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  const run = (action: () => void) => {
    setOpen(false);
    action();
  };
  return (
    <div className="dch-actions" ref={wrapRef}>
      <button
        type="button"
        className="dcx-btn dcx-btn-sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        Actions
      </button>
      {open && (
        <div className="dch-menu" role="menu" id={menuId} aria-label={`Actions for ${member.username}`}>
          <button type="button" role="menuitem" onClick={() => run(() => onModerate("timeout"))}>
            Time out for 10 minutes
          </button>
          <button type="button" role="menuitem" onClick={() => run(onRemove)}>
            Remove from Hub
          </button>
          <button type="button" role="menuitem" className="is-danger" onClick={() => run(() => onModerate("ban"))}>
            Ban member
          </button>
        </div>
      )}
    </div>
  );
}

export function MembersSection(props: MembersSectionProps) {
  const {
    members,
    loading,
    roles,
    friends,
    friendsLoading,
    isOwner,
    canManage,
    myRole,
    currentUserId,
    renderAvatar,
    onAddFriend,
    onChangeMemberRole,
    onAssignCustomRole,
    onModerateMember,
    onRemoveMember,
  } = props;
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [friendQuery, setFriendQuery] = useState("");
  const baseId = useId();
  const roleById = new Map(roles.map((role) => [role.id, role]));
  const q = query.trim().toLowerCase();
  const filtered = members.filter((member) => {
    if (q && !member.username.toLowerCase().includes(q)) return false;
    if (roleFilter === "all") return true;
    if (roleFilter === "owner" || roleFilter === "admin" || roleFilter === "member") return member.role === roleFilter;
    return (member.customRoleIds ?? []).includes(roleFilter);
  });
  const fq = friendQuery.trim().toLowerCase();
  const visibleFriends = friends.filter((friend) => !fq || friend.username.toLowerCase().includes(fq));

  return (
    <>
      <section className="dcx-card">
        <div className="dch-table-tools">
          <label className="dcx-sr-only" htmlFor={`${baseId}-search`}>
            Search members
          </label>
          <input
            id={`${baseId}-search`}
            type="search"
            className="dcx-input"
            placeholder="Search members"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <label className="dcx-sr-only" htmlFor={`${baseId}-filter`}>
            Filter by role
          </label>
          <select
            id={`${baseId}-filter`}
            className="dcx-input dch-filter"
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value)}
          >
            <option value="all">All roles</option>
            <option value="owner">Owner</option>
            <option value="admin">Admins</option>
            <option value="member">Members</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </div>
        <div className="dch-table-wrap">
          <table className="dch-table">
            <caption className="dcx-sr-only">Hub members</caption>
            <thead>
              <tr>
                <th scope="col">Member</th>
                <th scope="col">Roles</th>
                {isOwner && <th scope="col">Access level</th>}
                {isOwner && roles.length > 0 && <th scope="col">Custom role</th>}
                <th scope="col">
                  <span className="dcx-sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="dch-empty">
                    Loading members…
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="dch-empty">
                    No members match your filters.
                  </td>
                </tr>
              )}
              {!loading &&
                filtered.map((member) => {
                  const isSelf = member.userId === currentUserId;
                  const canManageMember =
                    !isSelf &&
                    member.role !== "owner" &&
                    (myRole === "owner" || (myRole === "admin" && member.role === "member"));
                  return (
                    <tr key={member.userId}>
                      <td>
                        <div className="dch-member">
                          {renderAvatar(member)}
                          <span>
                            <strong>
                              {member.username}
                              {isSelf ? " (you)" : ""}
                            </strong>
                            {member.joinedAt && (
                              <small>Joined {new Date(member.joinedAt).toLocaleDateString(localeForLanguage())}</small>
                            )}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="dch-chips">
                          <span className={`dch-chip dch-chip-${member.role}`}>
                            {member.role === "owner" ? "Owner" : member.role === "admin" ? "Admin" : "Member"}
                          </span>
                          {(member.customRoleIds ?? [])
                            .map((id) => roleById.get(id))
                            .filter((role): role is HubCustomRole => Boolean(role))
                            .map((role) => (
                              <span
                                key={role.id}
                                className="dch-chip"
                                style={{ borderColor: role.color, color: role.color }}
                              >
                                {role.icon ? `${role.icon} ` : ""}
                                {role.name}
                              </span>
                            ))}
                        </div>
                      </td>
                      {isOwner && (
                        <td>
                          {member.role !== "owner" ? (
                            <select
                              className="dcx-input dch-cell-select"
                              aria-label={`Access level for ${member.username}`}
                              value={member.role}
                              onChange={(event) => onChangeMemberRole(member, event.target.value as "admin" | "member")}
                            >
                              <option value="member">Member</option>
                              <option value="admin">Admin</option>
                            </select>
                          ) : (
                            <span className="dcx-hint">—</span>
                          )}
                        </td>
                      )}
                      {isOwner && roles.length > 0 && (
                        <td>
                          {member.role !== "owner" ? (
                            <select
                              className="dcx-input dch-cell-select"
                              aria-label={`Custom role for ${member.username}`}
                              value={member.customRoleIds?.[0] ?? ""}
                              onChange={(event) => onAssignCustomRole(member, event.target.value)}
                            >
                              <option value="">No custom role</option>
                              {roles.map((role) => (
                                <option key={role.id} value={role.id}>
                                  {role.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="dcx-hint">—</span>
                          )}
                        </td>
                      )}
                      <td className="dch-cell-actions">
                        {canManageMember && (
                          <MemberActions
                            member={member}
                            onModerate={(action) => onModerateMember(member, action)}
                            onRemove={() => onRemoveMember(member)}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        <div className="dch-table-foot">
          {filtered.length} of {members.length} member{members.length === 1 ? "" : "s"}
        </div>
      </section>

      {canManage && (
        <section className="dcx-card">
          <div className="dcx-card-head">
            <h4>Add friends</h4>
            <p>Friends who aren’t in this Hub yet can be added directly.</p>
          </div>
          <div className="dcx-row-stack">
            <label className="dcx-sr-only" htmlFor={`${baseId}-friends`}>
              Search friends
            </label>
            <input
              id={`${baseId}-friends`}
              type="search"
              className="dcx-input"
              placeholder="Search friends"
              value={friendQuery}
              onChange={(event) => setFriendQuery(event.target.value)}
            />
          </div>
          {friendsLoading ? (
            <div className="dcx-row">
              <small className="dcx-hint">Loading friends…</small>
            </div>
          ) : visibleFriends.length === 0 ? (
            <div className="dcx-row">
              <small className="dcx-hint">No friends available to add.</small>
            </div>
          ) : (
            visibleFriends.map((friend) => (
              <div className="dcx-row" key={friend.userId}>
                <div className="dch-member">
                  {renderAvatar(friend)}
                  <span>
                    <strong>{friend.username}</strong>
                    <small>Friend · not in this Hub</small>
                  </span>
                </div>
                <div className="dcx-row-control">
                  <button type="button" className="dcx-btn dcx-btn-sm" onClick={() => onAddFriend(friend)}>
                    Add to Hub
                  </button>
                </div>
              </div>
            ))
          )}
        </section>
      )}
    </>
  );
}
