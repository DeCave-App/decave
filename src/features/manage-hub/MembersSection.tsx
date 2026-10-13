import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { HubCustomRole, HubFriendRow, HubMemberRow } from "./types";
import { formatDate } from "../../i18n/format";

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
  const { t } = useTranslation(["hub"]);
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
        {t("hub.manageHub.members.actions")}
      </button>
      {open && (
        <div
          className="dch-menu"
          role="menu"
          id={menuId}
          aria-label={t("hub.manageHub.members.actionsFor", { name: member.username })}
        >
          <button type="button" role="menuitem" onClick={() => run(() => onModerate("timeout"))}>
            {t("hub.manageHub.members.timeout")}
          </button>
          <button type="button" role="menuitem" onClick={() => run(onRemove)}>
            {t("hub.manageHub.members.remove")}
          </button>
          <button type="button" role="menuitem" className="is-danger" onClick={() => run(() => onModerate("ban"))}>
            {t("hub.manageHub.members.ban")}
          </button>
        </div>
      )}
    </div>
  );
}

const MEMBER_ROWS_PAGE = 200;

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
  const { t } = useTranslation(["hub"]);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  // Large Hubs: render rows in pages so the table stays responsive.
  const [shownRows, setShownRows] = useState(MEMBER_ROWS_PAGE);
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
            {t("hub.manageHub.members.search")}
          </label>
          <input
            id={`${baseId}-search`}
            type="search"
            className="dcx-input"
            placeholder={t("hub.manageHub.members.search")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <label className="dcx-sr-only" htmlFor={`${baseId}-filter`}>
            {t("hub.manageHub.members.filter")}
          </label>
          <select
            id={`${baseId}-filter`}
            className="dcx-input dch-filter"
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value)}
          >
            <option value="all">{t("hub.manageHub.members.filters.all")}</option>
            <option value="owner">{t("hub.manageHub.members.filters.owner")}</option>
            <option value="admin">{t("hub.manageHub.members.filters.admin")}</option>
            <option value="member">{t("hub.manageHub.members.filters.member")}</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </div>
        <div className="dch-table-wrap">
          <table className="dch-table">
            <caption className="dcx-sr-only">{t("hub.manageHub.members.caption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("hub.manageHub.members.columns.member")}</th>
                <th scope="col">{t("hub.manageHub.members.columns.roles")}</th>
                {isOwner && <th scope="col">{t("hub.manageHub.members.columns.access")}</th>}
                {isOwner && roles.length > 0 && <th scope="col">{t("hub.manageHub.members.columns.customRole")}</th>}
                <th scope="col">
                  <span className="dcx-sr-only">{t("hub.manageHub.members.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="dch-empty">
                    {t("hub.manageHub.members.loading")}
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="dch-empty">
                    {t("hub.manageHub.members.noMatch")}
                  </td>
                </tr>
              )}
              {!loading &&
                filtered.slice(0, shownRows).map((member) => {
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
                              {isSelf ? t("hub.manageHub.members.you") : ""}
                            </strong>
                            {member.joinedAt && (
                              <small>
                                {t("hub.manageHub.members.joined", { date: formatDate(member.joinedAt, "medium") })}
                              </small>
                            )}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="dch-chips">
                          <span className={`dch-chip dch-chip-${member.role}`}>
                            {t(`hub.manageHub.members.roles.${member.role}`)}
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
                              aria-label={t("hub.manageHub.members.accessFor", { name: member.username })}
                              value={member.role}
                              onChange={(event) => onChangeMemberRole(member, event.target.value as "admin" | "member")}
                            >
                              <option value="member">{t("hub.manageHub.members.roles.member")}</option>
                              <option value="admin">{t("hub.manageHub.members.roles.admin")}</option>
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
                              aria-label={t("hub.manageHub.members.customRoleFor", { name: member.username })}
                              value={member.customRoleIds?.[0] ?? ""}
                              onChange={(event) => onAssignCustomRole(member, event.target.value)}
                            >
                              <option value="">{t("hub.manageHub.members.noCustomRole")}</option>
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
          {t("hub.manageHub.members.count", { shown: filtered.length, count: members.length })}
          {filtered.length > shownRows && (
            <button
              type="button"
              className="dcx-btn dcx-btn-ghost"
              onClick={() => setShownRows((n) => n + MEMBER_ROWS_PAGE)}
            >
              {t("hub.manageHub.members.showMore", { count: Math.min(MEMBER_ROWS_PAGE, filtered.length - shownRows) })}
            </button>
          )}
        </div>
      </section>

      {canManage && (
        <section className="dcx-card">
          <div className="dcx-card-head">
            <h4>{t("hub.manageHub.members.addFriends")}</h4>
            <p>{t("hub.manageHub.members.addFriendsHint")}</p>
          </div>
          <div className="dcx-row-stack">
            <label className="dcx-sr-only" htmlFor={`${baseId}-friends`}>
              {t("hub.manageHub.members.searchFriends")}
            </label>
            <input
              id={`${baseId}-friends`}
              type="search"
              className="dcx-input"
              placeholder={t("hub.manageHub.members.searchFriends")}
              value={friendQuery}
              onChange={(event) => setFriendQuery(event.target.value)}
            />
          </div>
          {friendsLoading ? (
            <div className="dcx-row">
              <small className="dcx-hint">{t("hub.manageHub.members.loadingFriends")}</small>
            </div>
          ) : visibleFriends.length === 0 ? (
            <div className="dcx-row">
              <small className="dcx-hint">{t("hub.manageHub.members.noFriends")}</small>
            </div>
          ) : (
            visibleFriends.map((friend) => (
              <div className="dcx-row" key={friend.userId}>
                <div className="dch-member">
                  {renderAvatar(friend)}
                  <span>
                    <strong>{friend.username}</strong>
                    <small>{t("hub.manageHub.members.friendNotInHub")}</small>
                  </span>
                </div>
                <div className="dcx-row-control">
                  <button type="button" className="dcx-btn dcx-btn-sm" onClick={() => onAddFriend(friend)}>
                    {t("hub.manageHub.members.addToHub")}
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
