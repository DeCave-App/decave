import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useDialogA11y } from "../shared/useDialogA11y";
import { TypeToConfirmDialog } from "../shared/TypeToConfirmDialog";
import "../shared/shared.css";
import "./room-settings.css";

export type RoomType = "text" | "voice" | "forum";
export type ForumPostPolicy = "everyone" | "staff" | "roles" | "members";

export type RoomSettingsValues = {
  name: string;
  icon: string;
  type: RoomType;
  isPrivate: boolean;
  memberIds: string[];
  forumGuidelines: string;
  forumPostPolicy: ForumPostPolicy;
  forumPostRoleIds: string[];
  forumPostMemberIds: string[];
};

export type RoomSettingsSetters = {
  [K in keyof RoomSettingsValues]: (value: RoomSettingsValues[K]) => void;
};

export type RoomSettingsMember = {
  userId: string;
  username: string;
  role: "owner" | "admin" | "member";
  avatarUrl?: string | null;
  customRoleIds?: string[];
};

export type RoomSettingsRole = { id: string; name: string; icon?: string; color?: string };

export type RoomSettingsSubmitExtra = { forumTags?: string[] };

type RoomSettingsPanelProps = {
  mode: "create" | "manage";
  hubName: string;
  values: RoomSettingsValues;
  set: RoomSettingsSetters;
  iconChoices: readonly string[];
  members: readonly RoomSettingsMember[];
  roles: readonly RoomSettingsRole[];
  currentUserId?: string | null;
  error?: string;
  /** Current moderator tag list; undefined when unknown. */
  initialForumTags?: readonly string[];
  /** Whether the backend stores `forumTags` (see docs/redesign-2026-10/api-contract.md). */
  forumTagsSupported: boolean;
  renderAvatar: (member: RoomSettingsMember) => ReactNode;
  onSubmit: (extra: RoomSettingsSubmitExtra) => void | Promise<void>;
  onClose: () => void;
  onDelete?: () => void | Promise<void>;
  /** Name the user must type to confirm deletion (defaults to the current name). */
  deleteConfirmName?: string;
};

type TabId = "general" | "permissions" | "forum";

const POLICY_LABELS: Record<ForumPostPolicy, string> = {
  everyone: "Everyone in the Hub",
  staff: "Owner, admins and moderators",
  roles: "Only selected roles",
  members: "Only selected members",
};

const MAX_TAGS = 20;

function normalizeTag(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 24);
}

export function RoomSettingsPanel(props: RoomSettingsPanelProps) {
  const {
    mode,
    hubName,
    values,
    set,
    iconChoices,
    members,
    roles,
    currentUserId,
    error,
    initialForumTags,
    forumTagsSupported,
    renderAvatar,
    onSubmit,
    onClose,
    onDelete,
    deleteConfirmName,
  } = props;
  const [tab, setTab] = useState<TabId>("general");
  const [memberSearch, setMemberSearch] = useState("");
  const [forumMemberSearch, setForumMemberSearch] = useState("");
  const [tags, setTags] = useState<string[]>(() => [...(initialForumTags ?? [])]);
  const [tagDraft, setTagDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const dialogRef = useDialogA11y<HTMLDivElement>(confirmDelete ? null : onClose);
  const titleId = useId();
  const baseId = useId();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: "general", label: "General" },
    { id: "permissions", label: "Permissions" },
    ...(values.type === "forum" ? [{ id: "forum" as const, label: "Forum" }] : []),
  ];
  const activeTab: TabId = tabs.some((item) => item.id === tab) ? tab : "general";

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = tabs.findIndex((item) => item.id === activeTab);
    let next = -1;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    event.preventDefault();
    setTab(tabs[next].id);
    tabRefs.current[tabs[next].id]?.focus();
  };

  const roleMemberCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const member of members)
      for (const roleId of member.customRoleIds ?? []) counts.set(roleId, (counts.get(roleId) ?? 0) + 1);
    return counts;
  }, [members]);

  const warnings: string[] = [];
  if (values.type === "forum" && values.forumPostPolicy === "roles") {
    if (!values.forumPostRoleIds.length)
      warnings.push(
        "“Only selected roles” is chosen but no roles are selected — only the owner and admins will be able to post.",
      );
    const emptyRoles = roles.filter(
      (role) => values.forumPostRoleIds.includes(role.id) && !roleMemberCounts.get(role.id),
    );
    if (emptyRoles.length)
      warnings.push(
        `${emptyRoles.map((role) => role.name).join(", ")} ${emptyRoles.length === 1 ? "has" : "have"} no members yet, so nobody gains posting access from ${emptyRoles.length === 1 ? "it" : "them"}.`,
      );
  }
  if (values.type === "forum" && values.forumPostPolicy === "members" && !values.forumPostMemberIds.length) {
    warnings.push(
      "“Only selected members” is chosen but no members are selected — only the owner and admins will be able to post.",
    );
  }

  const changeType = (type: RoomType) => {
    set.type(type);
    if (!values.icon || values.icon === "💬" || values.icon === "🔊" || values.icon === "🗂️")
      set.icon(type === "voice" ? "🔊" : type === "forum" ? "🗂️" : "💬");
  };

  const addTag = () => {
    const tag = normalizeTag(tagDraft);
    if (!tag) return;
    setTags((current) =>
      current.some((item) => item.toLowerCase() === tag.toLowerCase()) || current.length >= MAX_TAGS
        ? current
        : [...current, tag],
    );
    setTagDraft("");
  };
  const moveTag = (index: number, delta: number) =>
    setTags((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const submit = async () => {
    if (!values.name.trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit(values.type === "forum" && forumTagsSupported ? { forumTags: tags } : {});
    } finally {
      setBusy(false);
    }
  };

  const query = memberSearch.trim().toLowerCase();
  const staff = members.filter((member) => member.role === "owner" || member.role === "admin");
  const regular = members.filter((member) => member.role === "member" && member.userId !== currentUserId);
  const matches = (member: RoomSettingsMember, q: string) => !q || member.username.toLowerCase().includes(q);
  const toggleId = (list: string[], id: string) =>
    list.includes(id) ? list.filter((item) => item !== id) : [...list, id];

  const fieldId = (name: string) => `${baseId}-${name}`;

  return (
    <div
      className="dcx-modal-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="dcr-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-dc-dialog={confirmDelete ? undefined : "open"}
        tabIndex={-1}
      >
        <header className="dcr-head">
          <div className="dcr-head-icon" aria-hidden="true">
            {values.icon || (values.type === "voice" ? "🔊" : values.type === "forum" ? "🗂️" : "💬")}
          </div>
          <div className="dcr-head-copy">
            <h2 id={titleId}>{mode === "create" ? "Create room" : "Room settings"}</h2>
            <p>
              {mode === "create" ? (
                <>
                  New room in <strong>{hubName}</strong>
                </>
              ) : (
                <>
                  {values.name || "Untitled room"} · {hubName}
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            className="dcx-btn dcx-btn-ghost dcr-close"
            onClick={onClose}
            aria-label="Close room settings"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className="dcx-tabs dcr-tabs" role="tablist" aria-label="Room settings sections">
          {tabs.map((item) => (
            <button
              key={item.id}
              ref={(element) => {
                tabRefs.current[item.id] = element;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.id}`}
              aria-controls={`${baseId}-panel-${item.id}`}
              aria-selected={activeTab === item.id}
              tabIndex={activeTab === item.id ? 0 : -1}
              className="dcx-tab"
              onClick={() => setTab(item.id)}
              onKeyDown={onTabKeyDown}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div
          className="dcr-body"
          role="tabpanel"
          id={`${baseId}-panel-${activeTab}`}
          aria-labelledby={`${baseId}-tab-${activeTab}`}
        >
          {activeTab === "general" && (
            <>
              <section className="dcx-card">
                <div className="dcx-row-stack">
                  <label className="dcx-field-label" htmlFor={fieldId("name")}>
                    Room name
                  </label>
                  <input
                    id={fieldId("name")}
                    className="dcx-input"
                    value={values.name}
                    maxLength={40}
                    data-autofocus
                    placeholder="e.g. general-chat"
                    onChange={(event) => set.name(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void submit();
                    }}
                  />
                </div>
                <div className="dcx-row-stack">
                  <label className="dcx-field-label" htmlFor={fieldId("icon")}>
                    Icon or emoji
                  </label>
                  <div className="dcr-icon-editor">
                    <input
                      id={fieldId("icon")}
                      className="dcx-input dcr-icon-input"
                      value={values.icon}
                      maxLength={8}
                      onChange={(event) => set.icon(Array.from(event.target.value).slice(0, 4).join(""))}
                    />
                    <div className="dcr-icon-choices" role="group" aria-label="Suggested icons">
                      {iconChoices.map((icon) => (
                        <button
                          key={icon}
                          type="button"
                          className={`dcr-icon-choice${values.icon === icon ? " is-selected" : ""}`}
                          aria-pressed={values.icon === icon}
                          aria-label={`Use ${icon} as icon`}
                          onClick={() => set.icon(icon)}
                        >
                          {icon}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                {mode === "create" ? (
                  <fieldset className="dcx-row-stack dcr-fieldset">
                    <legend className="dcx-field-label">Room type</legend>
                    <span className="dcx-hint">The type can’t be changed after the room is created.</span>
                    <div className="dcr-choice-grid">
                      {(
                        [
                          ["text", "Text", "Conversations, links and media."],
                          ["voice", "Voice", "Talk, share your screen and stream."],
                          ["forum", "Forum", "Organized posts with replies and tags."],
                        ] as const
                      ).map(([type, label, copy]) => (
                        <label key={type} className={`dcr-choice${values.type === type ? " is-selected" : ""}`}>
                          <input
                            type="radio"
                            name={fieldId("type")}
                            value={type}
                            checked={values.type === type}
                            onChange={() => changeType(type)}
                          />
                          <span>
                            <strong>{label}</strong>
                            <small>{copy}</small>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ) : (
                  <div className="dcx-row">
                    <div className="dcx-row-copy">
                      <strong>Room type</strong>
                      <small>Set when the room was created.</small>
                    </div>
                    <div className="dcx-row-control">
                      <span className="dcr-pill">
                        {values.type === "voice" ? "Voice" : values.type === "forum" ? "Forum" : "Text"}
                      </span>
                    </div>
                  </div>
                )}
              </section>
              {mode === "manage" && onDelete && (
                <section className="dcx-card dcr-danger">
                  <div className="dcx-row">
                    <div className="dcx-row-copy">
                      <strong>Delete room</strong>
                      <small>Permanently removes the room and all of its saved messages.</small>
                    </div>
                    <div className="dcx-row-control">
                      <button type="button" className="dcx-btn dcx-btn-danger" onClick={() => setConfirmDelete(true)}>
                        Delete room
                      </button>
                    </div>
                  </div>
                </section>
              )}
            </>
          )}

          {activeTab === "permissions" && (
            <>
              <fieldset className="dcx-card dcr-fieldset">
                <legend className="dcx-sr-only">Room visibility</legend>
                <div className="dcr-choice-grid dcr-choice-grid-2 dcr-pad">
                  <label className={`dcr-choice${!values.isPrivate ? " is-selected" : ""}`}>
                    <input
                      type="radio"
                      name={fieldId("visibility")}
                      checked={!values.isPrivate}
                      onChange={() => set.isPrivate(false)}
                    />
                    <span>
                      <strong>Public</strong>
                      <small>Every Hub member can see and join this room.</small>
                    </span>
                  </label>
                  <label className={`dcr-choice${values.isPrivate ? " is-selected" : ""}`}>
                    <input
                      type="radio"
                      name={fieldId("visibility")}
                      checked={values.isPrivate}
                      onChange={() => set.isPrivate(true)}
                    />
                    <span>
                      <strong>Private</strong>
                      <small>Only selected members, plus the Hub owner and admins.</small>
                    </span>
                  </label>
                </div>
              </fieldset>
              {values.isPrivate && (
                <section className="dcx-card">
                  <div className="dcx-card-head">
                    <h4>Member access</h4>
                    <p>
                      {values.memberIds.length} member{values.memberIds.length === 1 ? "" : "s"} selected. Owners and
                      admins always have access.
                    </p>
                  </div>
                  <div className="dcx-row-stack">
                    <label className="dcx-sr-only" htmlFor={fieldId("member-search")}>
                      Search members
                    </label>
                    <input
                      id={fieldId("member-search")}
                      type="search"
                      className="dcx-input"
                      value={memberSearch}
                      onChange={(event) => setMemberSearch(event.target.value)}
                      placeholder="Search Hub members"
                    />
                  </div>
                  {staff
                    .filter((member) => matches(member, query))
                    .map((member) => (
                      <div className="dcx-row dcr-member" key={member.userId}>
                        <div className="dcr-member-id">
                          {renderAvatar(member)}
                          <div className="dcx-row-copy">
                            <strong>
                              {member.username}
                              {member.userId === currentUserId ? " (you)" : ""}
                            </strong>
                            <small>{member.role === "owner" ? "Owner" : "Admin"} · always has access</small>
                          </div>
                        </div>
                        <div className="dcx-row-control">
                          <label className="dcx-switch">
                            <input
                              type="checkbox"
                              checked
                              disabled
                              aria-label={`${member.username} always has access`}
                            />
                            <span />
                          </label>
                        </div>
                      </div>
                    ))}
                  {regular
                    .filter((member) => matches(member, query))
                    .map((member) => {
                      const enabled = values.memberIds.includes(member.userId);
                      return (
                        <div className="dcx-row dcr-member" key={member.userId}>
                          <div className="dcr-member-id">
                            {renderAvatar(member)}
                            <div className="dcx-row-copy">
                              <strong>{member.username}</strong>
                              <small>{enabled ? "Has access" : "No access"}</small>
                            </div>
                          </div>
                          <div className="dcx-row-control">
                            <label className="dcx-switch">
                              <input
                                type="checkbox"
                                checked={enabled}
                                onChange={() => set.memberIds(toggleId(values.memberIds, member.userId))}
                                aria-label={`Room access for ${member.username}`}
                              />
                              <span />
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  {!regular.some((member) => matches(member, query)) && (
                    <div className="dcx-row">
                      <small className="dcx-hint">
                        {regular.length === 0 ? "No other members in this Hub yet." : "No members match your search."}
                      </small>
                    </div>
                  )}
                </section>
              )}
              {values.type === "forum" && (
                <p className="dcx-hint dcr-pad-x">
                  Posting permissions for this forum are on the{" "}
                  <button type="button" className="dcr-link" onClick={() => setTab("forum")}>
                    Forum tab
                  </button>
                  .
                </p>
              )}
            </>
          )}

          {activeTab === "forum" && values.type === "forum" && (
            <>
              <section className="dcx-card">
                <div className="dcx-row-stack">
                  <label className="dcx-field-label" htmlFor={fieldId("guidelines")}>
                    Post guidelines
                  </label>
                  <span className="dcx-hint" id={fieldId("guidelines-hint")}>
                    Shown to people before they create a post.
                  </span>
                  <textarea
                    id={fieldId("guidelines")}
                    aria-describedby={fieldId("guidelines-hint")}
                    className="dcx-input"
                    rows={3}
                    maxLength={500}
                    value={values.forumGuidelines}
                    onChange={(event) => set.forumGuidelines(event.target.value)}
                    placeholder="Share the topic, rules, and what a useful post should include."
                  />
                </div>
                <div className="dcx-row">
                  <div className="dcx-row-copy">
                    <label htmlFor={fieldId("policy")}>Who can post</label>
                    <small>Everyone can still read and reply where they have access.</small>
                  </div>
                  <div className="dcx-row-control">
                    <select
                      id={fieldId("policy")}
                      className="dcx-input"
                      value={values.forumPostPolicy}
                      onChange={(event) => set.forumPostPolicy(event.target.value as ForumPostPolicy)}
                    >
                      {(Object.keys(POLICY_LABELS) as ForumPostPolicy[]).map((policy) => (
                        <option key={policy} value={policy}>
                          {POLICY_LABELS[policy]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {values.forumPostPolicy === "roles" && (
                  <fieldset className="dcx-row-stack dcr-fieldset">
                    <legend className="dcx-field-label">Roles allowed to post</legend>
                    {roles.length ? (
                      <div className="dcr-check-list">
                        {roles.map((role) => {
                          const count = roleMemberCounts.get(role.id) ?? 0;
                          return (
                            <label key={role.id} className="dcr-check">
                              <input
                                type="checkbox"
                                checked={values.forumPostRoleIds.includes(role.id)}
                                onChange={() => set.forumPostRoleIds(toggleId(values.forumPostRoleIds, role.id))}
                              />
                              <span
                                className="dcr-role-dot"
                                style={{ background: role.color || "#8a94a6" }}
                                aria-hidden="true"
                              />
                              <span>
                                {role.icon ? `${role.icon} ` : ""}
                                {role.name}
                              </span>
                              <small>
                                {count} member{count === 1 ? "" : "s"}
                              </small>
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="dcx-hint">
                        This Hub has no custom roles yet. Create them in Manage Hub → Roles.
                      </span>
                    )}
                  </fieldset>
                )}
                {values.forumPostPolicy === "members" && (
                  <fieldset className="dcx-row-stack dcr-fieldset">
                    <legend className="dcx-field-label">Members allowed to post</legend>
                    <label className="dcx-sr-only" htmlFor={fieldId("forum-member-search")}>
                      Search members
                    </label>
                    <input
                      id={fieldId("forum-member-search")}
                      type="search"
                      className="dcx-input"
                      value={forumMemberSearch}
                      onChange={(event) => setForumMemberSearch(event.target.value)}
                      placeholder="Search Hub members"
                    />
                    <div className="dcr-check-list dcr-check-list-scroll">
                      {members
                        .filter((member) => matches(member, forumMemberSearch.trim().toLowerCase()))
                        .map((member) => {
                          const automatic = member.role === "owner" || member.role === "admin";
                          const selected = values.forumPostMemberIds.includes(member.userId);
                          return (
                            <label key={member.userId} className="dcr-check">
                              <input
                                type="checkbox"
                                checked={automatic || selected}
                                disabled={automatic}
                                onChange={() =>
                                  set.forumPostMemberIds(toggleId(values.forumPostMemberIds, member.userId))
                                }
                              />
                              {renderAvatar(member)}
                              <span>{member.username}</span>
                              <small>{automatic ? `${member.role} · always allowed` : member.role}</small>
                            </label>
                          );
                        })}
                    </div>
                  </fieldset>
                )}
                {warnings.length > 0 && (
                  <div className="dcx-row-stack">
                    {warnings.map((warning) => (
                      <div key={warning} className="dcx-notice dcx-notice-warn" role="status">
                        {warning}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="dcx-card">
                <div className="dcx-card-head">
                  <h4>Post tags</h4>
                  <p>Moderators define the tags people can pick when posting. Use the arrows to set their order.</p>
                </div>
                {forumTagsSupported ? (
                  <>
                    <div className="dcx-row-stack">
                      <div className="dcr-tag-add">
                        <label className="dcx-sr-only" htmlFor={fieldId("tag")}>
                          New tag
                        </label>
                        <input
                          id={fieldId("tag")}
                          className="dcx-input"
                          value={tagDraft}
                          maxLength={24}
                          placeholder="Add a tag, e.g. Question"
                          onChange={(event) => setTagDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              addTag();
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="dcx-btn"
                          disabled={!normalizeTag(tagDraft) || tags.length >= MAX_TAGS}
                          onClick={addTag}
                        >
                          Add tag
                        </button>
                      </div>
                      <span className="dcx-hint">
                        {tags.length}/{MAX_TAGS} tags
                      </span>
                    </div>
                    {tags.length > 0 && (
                      <ul className="dcr-tag-list" aria-label="Forum tags">
                        {tags.map((tag, index) => (
                          <li key={tag}>
                            <span className="dcr-tag-chip">{tag}</span>
                            <span className="dcr-tag-actions">
                              <button
                                type="button"
                                className="dcx-btn dcx-btn-ghost dcx-btn-sm"
                                disabled={index === 0}
                                onClick={() => moveTag(index, -1)}
                                aria-label={`Move ${tag} up`}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                className="dcx-btn dcx-btn-ghost dcx-btn-sm"
                                disabled={index === tags.length - 1}
                                onClick={() => moveTag(index, 1)}
                                aria-label={`Move ${tag} down`}
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                className="dcx-btn dcx-btn-ghost dcx-btn-sm"
                                onClick={() => setTags((current) => current.filter((item) => item !== tag))}
                                aria-label={`Remove ${tag}`}
                              >
                                Remove
                              </button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <div className="dcx-row-stack">
                    <div className="dcx-notice dcx-notice-info">
                      Moderator tag lists aren’t available on this server yet. Posts can still use free-form tags.
                    </div>
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        {error && (
          <div className="dcx-notice dcx-notice-error dcr-error" role="alert">
            {error}
          </div>
        )}

        <footer className="dcr-footer">
          <button type="button" className="dcx-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="dcx-btn dcx-btn-primary"
            disabled={!values.name.trim() || busy}
            onClick={() => void submit()}
          >
            {busy ? (mode === "create" ? "Creating…" : "Saving…") : mode === "create" ? "Create room" : "Save changes"}
          </button>
        </footer>
      </div>

      {confirmDelete && onDelete && (
        <TypeToConfirmDialog
          title="Delete room?"
          description="This permanently deletes the room and every saved message in it. This can’t be undone."
          confirmText={(deleteConfirmName ?? values.name).trim() || "delete"}
          actionLabel="Delete room"
          busy={busy}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            setBusy(true);
            try {
              await onDelete();
            } finally {
              setBusy(false);
              setConfirmDelete(false);
            }
          }}
        />
      )}
    </div>
  );
}
