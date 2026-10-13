import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useDialogA11y } from "../shared/useDialogA11y";
import { TypeToConfirmDialog } from "../shared/TypeToConfirmDialog";
import "../shared/shared.css";
import "./room-settings.css";
import { filterRoomIcons } from "./roomIcons";
import { RoomStyleSection, type RoomBackgroundChange } from "./RoomStyleSection";

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

export type ChatPostPolicy = "everyone" | "staff" | "roles";
export type RoomSettingsSubmitExtra = {
  forumTags?: string[];
  userLimit?: number;
  postPolicy?: ChatPostPolicy;
  postRoleIds?: string[];
  accent?: string | null;
  background?: File | null;
};

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
  /** Voice room player cap (0 = no limit); undefined hides the field (Hub without voice limits). */
  initialUserLimit?: number;
  /** Chat rooms: current "who can post" setting; undefined hides it (voice/forum rooms). */
  initialPostPolicy?: { policy: ChatPostPolicy; roleIds: string[] };
  /** Room accent and background (absolute URL); undefined hides the Style section. */
  initialStyle?: { accent: string | null; backgroundUrl: string | null };
};

type TabId = "general" | "permissions" | "forum";

// Labels: hub.roomSettings.forum.policies.<policy>.
const FORUM_POLICIES: ForumPostPolicy[] = ["everyone", "staff", "roles", "members"];

const MAX_TAGS = 20;
const DEFAULT_ROOM_ICON: Record<RoomType, string> = { text: "💬", voice: "🔊", forum: "🗂️" };

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
    initialUserLimit,
    initialPostPolicy,
    initialStyle,
  } = props;
  const { t } = useTranslation(["hub"]);
  const [accent, setAccent] = useState<string | null>(initialStyle?.accent ?? null);
  const [background, setBackground] = useState<RoomBackgroundChange>(undefined);
  const [postPolicy, setPostPolicy] = useState<ChatPostPolicy>(initialPostPolicy?.policy ?? "everyone");
  const [postRoleIds, setPostRoleIds] = useState<string[]>(initialPostPolicy?.roleIds ?? []);
  const showPostPolicy = mode === "manage" && values.type === "text" && initialPostPolicy !== undefined;
  const [userLimit, setUserLimit] = useState(initialUserLimit ?? 0);
  const showUserLimit = mode === "manage" && values.type === "voice" && initialUserLimit !== undefined;
  const [tab, setTab] = useState<TabId>("general");
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [iconSearch, setIconSearch] = useState("");
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
    { id: "general", label: t("hub.roomSettings.tabs.general") },
    { id: "permissions", label: t("hub.roomSettings.tabs.permissions") },
    ...(values.type === "forum" ? [{ id: "forum" as const, label: t("hub.roomSettings.tabs.forum") }] : []),
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
    if (!values.forumPostRoleIds.length) warnings.push(t("hub.roomSettings.forum.warnings.noRoles"));
    const emptyRoles = roles.filter(
      (role) => values.forumPostRoleIds.includes(role.id) && !roleMemberCounts.get(role.id),
    );
    if (emptyRoles.length)
      warnings.push(
        t("hub.roomSettings.forum.warnings.emptyRoles", {
          count: emptyRoles.length,
          names: emptyRoles.map((role) => role.name).join(", "),
        }),
      );
  }
  if (values.type === "forum" && values.forumPostPolicy === "members" && !values.forumPostMemberIds.length) {
    warnings.push(t("hub.roomSettings.forum.warnings.noMembers"));
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
      await onSubmit({
        ...(values.type === "forum" && forumTagsSupported ? { forumTags: tags } : {}),
        ...(showUserLimit ? { userLimit } : {}),
        ...(showPostPolicy ? { postPolicy, postRoleIds: postPolicy === "roles" ? postRoleIds : [] } : {}),
        ...(initialStyle && accent !== initialStyle.accent ? { accent } : {}),
        ...(initialStyle && background !== undefined ? { background } : {}),
      });
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
            {values.icon || DEFAULT_ROOM_ICON[values.type]}
          </div>
          <div className="dcr-head-copy">
            <h2 id={titleId}>{mode === "create" ? t("hub.roomSettings.createTitle") : t("hub.roomSettings.title")}</h2>
            <p>
              {mode === "create" ? (
                <Trans
                  t={t}
                  i18nKey="hub.roomSettings.newRoomIn"
                  values={{ hub: hubName }}
                  components={{ strong: <strong /> }}
                />
              ) : (
                <>
                  {values.name || t("hub.roomSettings.untitled")} · {hubName}
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            className="dcx-btn dcx-btn-ghost dcr-close"
            onClick={onClose}
            aria-label={t("hub.roomSettings.close")}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className="dcx-tabs dcr-tabs" role="tablist" aria-label={t("hub.roomSettings.sections")}>
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
                    {t("hub.roomSettings.name")}
                  </label>
                  <input
                    id={fieldId("name")}
                    className="dcx-input"
                    value={values.name}
                    maxLength={40}
                    data-autofocus
                    placeholder={t("hub.roomSettings.namePlaceholder")}
                    onChange={(event) => set.name(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void submit();
                    }}
                  />
                </div>
                <div className="dcx-row-stack">
                  <label className="dcx-field-label" htmlFor={fieldId("icon")}>
                    {t("hub.roomSettings.icon.label")}
                  </label>
                  <div className="dcr-icon-editor">
                    <input
                      id={fieldId("icon")}
                      className="dcx-input dcr-icon-input"
                      value={values.icon}
                      maxLength={8}
                      onChange={(event) => set.icon(Array.from(event.target.value).slice(0, 4).join(""))}
                    />
                    <div className="dcr-icon-choices" role="group" aria-label={t("hub.roomSettings.icon.suggested")}>
                      {iconChoices.map((icon) => (
                        <button
                          key={icon}
                          type="button"
                          className={`dcr-icon-choice${values.icon === icon ? " is-selected" : ""}`}
                          aria-pressed={values.icon === icon}
                          aria-label={t("hub.roomSettings.icon.use", { icon })}
                          onClick={() => set.icon(icon)}
                        >
                          {icon}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="dcr-icon-more"
                        aria-expanded={iconPickerOpen}
                        onClick={() => setIconPickerOpen((open) => !open)}
                      >
                        {iconPickerOpen ? t("hub.roomSettings.icon.fewer") : t("hub.roomSettings.icon.more")}
                      </button>
                    </div>
                  </div>
                  {iconPickerOpen && (
                    <div className="dcr-icon-picker">
                      <input
                        className="dcx-input dcr-icon-search"
                        type="search"
                        placeholder={t("hub.roomSettings.icon.searchPlaceholder")}
                        aria-label={t("hub.roomSettings.icon.search")}
                        value={iconSearch}
                        onChange={(event) => setIconSearch(event.target.value)}
                      />
                      <div className="dcr-icon-groups">
                        {filterRoomIcons(iconSearch).map((group) => (
                          <section key={group.id} aria-label={t(`hub.roomSettings.iconGroups.${group.id}`)}>
                            <h4>{t(`hub.roomSettings.iconGroups.${group.id}`)}</h4>
                            <div className="dcr-icon-choices" role="group">
                              {group.icons.map(([icon, words]) => (
                                <button
                                  key={`${group.id}-${icon}`}
                                  type="button"
                                  className={`dcr-icon-choice${values.icon === icon ? " is-selected" : ""}`}
                                  aria-pressed={values.icon === icon}
                                  aria-label={t("hub.roomSettings.icon.useNamed", { icon, name: words.split(" ")[0] })}
                                  title={words}
                                  onClick={() => set.icon(icon)}
                                >
                                  {icon}
                                </button>
                              ))}
                            </div>
                          </section>
                        ))}
                        {filterRoomIcons(iconSearch).length === 0 && (
                          <small className="dcx-hint">{t("hub.roomSettings.icon.noMatch")}</small>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                {mode === "create" ? (
                  <fieldset className="dcx-row-stack dcr-fieldset">
                    <legend className="dcx-field-label">{t("hub.roomSettings.type.label")}</legend>
                    <span className="dcx-hint">{t("hub.roomSettings.type.fixed")}</span>
                    <div className="dcr-choice-grid">
                      {(["text", "voice", "forum"] as const).map((type) => (
                        <label key={type} className={`dcr-choice${values.type === type ? " is-selected" : ""}`}>
                          <input
                            type="radio"
                            name={fieldId("type")}
                            value={type}
                            checked={values.type === type}
                            onChange={() => changeType(type)}
                          />
                          <span>
                            <strong>{t(`hub.roomSettings.type.${type}.label`)}</strong>
                            <small>{t(`hub.roomSettings.type.${type}.description`)}</small>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ) : (
                  <div className="dcx-row">
                    <div className="dcx-row-copy">
                      <strong>{t("hub.roomSettings.type.label")}</strong>
                      <small>{t("hub.roomSettings.type.setAtCreation")}</small>
                    </div>
                    <div className="dcx-row-control">
                      <span className="dcr-pill">
                        {t(
                          `hub.roomSettings.type.${values.type === "voice" || values.type === "forum" ? values.type : "text"}.label`,
                        )}
                      </span>
                    </div>
                  </div>
                )}
                {showPostPolicy && (
                  <fieldset className="dcx-row-stack">
                    <legend className="dcx-field-label">{t("hub.roomSettings.post.label")}</legend>
                    <small>{t("hub.roomSettings.post.hint")}</small>
                    {(["everyone", "staff", "roles"] as const).map((value) => (
                      <label key={value} className={`dcr-choice${postPolicy === value ? " is-selected" : ""}`}>
                        <input
                          type="radio"
                          name={fieldId("post-policy")}
                          value={value}
                          checked={postPolicy === value}
                          onChange={() => setPostPolicy(value)}
                        />
                        <span>
                          <strong>{t(`hub.roomSettings.post.${value}.label`)}</strong>
                          <small>{t(`hub.roomSettings.post.${value}.description`)}</small>
                        </span>
                      </label>
                    ))}
                    {postPolicy === "roles" && (
                      <div className="dcr-role-picks">
                        {roles.length ? (
                          roles.map((role) => (
                            <label key={role.id} className="dcr-role-pick">
                              <input
                                type="checkbox"
                                checked={postRoleIds.includes(role.id)}
                                onChange={(event) =>
                                  setPostRoleIds((current) =>
                                    event.target.checked
                                      ? [...current, role.id]
                                      : current.filter((id) => id !== role.id),
                                  )
                                }
                              />
                              <span>{role.name}</span>
                            </label>
                          ))
                        ) : (
                          <small>{t("hub.roomSettings.post.noRoles")}</small>
                        )}
                      </div>
                    )}
                  </fieldset>
                )}
                {showUserLimit && (
                  <div className="dcx-row">
                    <div className="dcx-row-copy">
                      <label htmlFor={fieldId("user-limit")}>
                        <strong>{t("hub.roomSettings.userLimit.label")}</strong>
                      </label>
                      <small>{t("hub.roomSettings.userLimit.hint")}</small>
                    </div>
                    <div className="dcx-row-control">
                      <input
                        id={fieldId("user-limit")}
                        className="dcx-input"
                        type="number"
                        min={0}
                        max={99}
                        value={userLimit}
                        onChange={(event) =>
                          setUserLimit(Math.max(0, Math.min(99, Math.floor(Number(event.target.value) || 0))))
                        }
                      />
                    </div>
                  </div>
                )}
              </section>
              {mode === "manage" && initialStyle && (
                <RoomStyleSection
                  roomName={values.name}
                  roomIcon={values.icon}
                  accent={accent}
                  onAccentChange={setAccent}
                  savedBackgroundUrl={initialStyle.backgroundUrl}
                  background={background}
                  onBackgroundChange={setBackground}
                />
              )}
              {mode === "manage" && onDelete && (
                <section className="dcx-card dcr-danger">
                  <div className="dcx-row">
                    <div className="dcx-row-copy">
                      <strong>{t("hub.roomSettings.delete.title")}</strong>
                      <small>{t("hub.roomSettings.delete.description")}</small>
                    </div>
                    <div className="dcx-row-control">
                      <button type="button" className="dcx-btn dcx-btn-danger" onClick={() => setConfirmDelete(true)}>
                        {t("hub.roomSettings.delete.action")}
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
                <legend className="dcx-sr-only">{t("hub.roomSettings.visibility.label")}</legend>
                <div className="dcr-choice-grid dcr-choice-grid-2 dcr-pad">
                  <label className={`dcr-choice${!values.isPrivate ? " is-selected" : ""}`}>
                    <input
                      type="radio"
                      name={fieldId("visibility")}
                      checked={!values.isPrivate}
                      onChange={() => set.isPrivate(false)}
                    />
                    <span>
                      <strong>{t("hub.roomSettings.visibility.public")}</strong>
                      <small>{t("hub.roomSettings.visibility.publicHint")}</small>
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
                      <strong>{t("hub.roomSettings.visibility.private")}</strong>
                      <small>{t("hub.roomSettings.visibility.privateHint")}</small>
                    </span>
                  </label>
                </div>
              </fieldset>
              {values.isPrivate && (
                <section className="dcx-card">
                  <div className="dcx-card-head">
                    <h4>{t("hub.roomSettings.access.title")}</h4>
                    <p>{t("hub.roomSettings.access.selected", { count: values.memberIds.length })}</p>
                  </div>
                  <div className="dcx-row-stack">
                    <label className="dcx-sr-only" htmlFor={fieldId("member-search")}>
                      {t("hub.roomSettings.access.search")}
                    </label>
                    <input
                      id={fieldId("member-search")}
                      type="search"
                      className="dcx-input"
                      value={memberSearch}
                      onChange={(event) => setMemberSearch(event.target.value)}
                      placeholder={t("hub.roomSettings.access.searchPlaceholder")}
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
                              {member.userId === currentUserId ? t("hub.roomSettings.access.you") : ""}
                            </strong>
                            <small>
                              {member.role === "owner"
                                ? t("hub.roomSettings.access.ownerAlways")
                                : t("hub.roomSettings.access.adminAlways")}
                            </small>
                          </div>
                        </div>
                        <div className="dcx-row-control">
                          <label className="dcx-switch">
                            <input
                              type="checkbox"
                              checked
                              disabled
                              aria-label={t("hub.roomSettings.access.alwaysAria", { name: member.username })}
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
                              <small>
                                {enabled ? t("hub.roomSettings.access.has") : t("hub.roomSettings.access.none")}
                              </small>
                            </div>
                          </div>
                          <div className="dcx-row-control">
                            <label className="dcx-switch">
                              <input
                                type="checkbox"
                                checked={enabled}
                                onChange={() => set.memberIds(toggleId(values.memberIds, member.userId))}
                                aria-label={t("hub.roomSettings.access.toggleAria", { name: member.username })}
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
                        {regular.length === 0
                          ? t("hub.roomSettings.access.noOthers")
                          : t("hub.roomSettings.access.noMatch")}
                      </small>
                    </div>
                  )}
                </section>
              )}
              {values.type === "forum" && (
                <p className="dcx-hint dcr-pad-x">
                  <Trans
                    t={t}
                    i18nKey="hub.roomSettings.access.forumTabHint"
                    components={{
                      tab: <button type="button" className="dcr-link" onClick={() => setTab("forum")} />,
                    }}
                  />
                </p>
              )}
            </>
          )}

          {activeTab === "forum" && values.type === "forum" && (
            <>
              <section className="dcx-card">
                <div className="dcx-row-stack">
                  <label className="dcx-field-label" htmlFor={fieldId("guidelines")}>
                    {t("hub.roomSettings.forum.guidelines")}
                  </label>
                  <span className="dcx-hint" id={fieldId("guidelines-hint")}>
                    {t("hub.roomSettings.forum.guidelinesHint")}
                  </span>
                  <textarea
                    id={fieldId("guidelines")}
                    aria-describedby={fieldId("guidelines-hint")}
                    className="dcx-input"
                    rows={3}
                    maxLength={500}
                    value={values.forumGuidelines}
                    onChange={(event) => set.forumGuidelines(event.target.value)}
                    placeholder={t("hub.roomSettings.forum.guidelinesPlaceholder")}
                  />
                </div>
                <div className="dcx-row">
                  <div className="dcx-row-copy">
                    <label htmlFor={fieldId("policy")}>{t("hub.roomSettings.forum.policyLabel")}</label>
                    <small>{t("hub.roomSettings.forum.policyHint")}</small>
                  </div>
                  <div className="dcx-row-control">
                    <select
                      id={fieldId("policy")}
                      className="dcx-input"
                      value={values.forumPostPolicy}
                      onChange={(event) => set.forumPostPolicy(event.target.value as ForumPostPolicy)}
                    >
                      {FORUM_POLICIES.map((policy) => (
                        <option key={policy} value={policy}>
                          {t(`hub.roomSettings.forum.policies.${policy}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {values.forumPostPolicy === "roles" && (
                  <fieldset className="dcx-row-stack dcr-fieldset">
                    <legend className="dcx-field-label">{t("hub.roomSettings.forum.rolesAllowed")}</legend>
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
                              <small>{t("hub.roomSettings.forum.roleMembers", { count })}</small>
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="dcx-hint">{t("hub.roomSettings.forum.noRoles")}</span>
                    )}
                  </fieldset>
                )}
                {values.forumPostPolicy === "members" && (
                  <fieldset className="dcx-row-stack dcr-fieldset">
                    <legend className="dcx-field-label">{t("hub.roomSettings.forum.membersAllowed")}</legend>
                    <label className="dcx-sr-only" htmlFor={fieldId("forum-member-search")}>
                      {t("hub.roomSettings.access.search")}
                    </label>
                    <input
                      id={fieldId("forum-member-search")}
                      type="search"
                      className="dcx-input"
                      value={forumMemberSearch}
                      onChange={(event) => setForumMemberSearch(event.target.value)}
                      placeholder={t("hub.roomSettings.access.searchPlaceholder")}
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
                              <small>
                                {automatic
                                  ? t("hub.roomSettings.forum.alwaysAllowed", {
                                      role: t(`hub.roomSettings.roles.${member.role}`),
                                    })
                                  : t(`hub.roomSettings.roles.${member.role}`)}
                              </small>
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
                  <h4>{t("hub.roomSettings.tags.title")}</h4>
                  <p>{t("hub.roomSettings.tags.description")}</p>
                </div>
                {forumTagsSupported ? (
                  <>
                    <div className="dcx-row-stack">
                      <div className="dcr-tag-add">
                        <label className="dcx-sr-only" htmlFor={fieldId("tag")}>
                          {t("hub.roomSettings.tags.new")}
                        </label>
                        <input
                          id={fieldId("tag")}
                          className="dcx-input"
                          value={tagDraft}
                          maxLength={24}
                          placeholder={t("hub.roomSettings.tags.placeholder")}
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
                          {t("hub.roomSettings.tags.add")}
                        </button>
                      </div>
                      <span className="dcx-hint">
                        {t("hub.roomSettings.tags.count", { count: tags.length, max: MAX_TAGS })}
                      </span>
                    </div>
                    {tags.length > 0 && (
                      <ul className="dcr-tag-list" aria-label={t("hub.roomSettings.tags.list")}>
                        {tags.map((tag, index) => (
                          <li key={tag}>
                            <span className="dcr-tag-chip">{tag}</span>
                            <span className="dcr-tag-actions">
                              <button
                                type="button"
                                className="dcx-btn dcx-btn-ghost dcx-btn-sm"
                                disabled={index === 0}
                                onClick={() => moveTag(index, -1)}
                                aria-label={t("hub.roomSettings.tags.moveUp", { tag })}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                className="dcx-btn dcx-btn-ghost dcx-btn-sm"
                                disabled={index === tags.length - 1}
                                onClick={() => moveTag(index, 1)}
                                aria-label={t("hub.roomSettings.tags.moveDown", { tag })}
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                className="dcx-btn dcx-btn-ghost dcx-btn-sm"
                                onClick={() => setTags((current) => current.filter((item) => item !== tag))}
                                aria-label={t("hub.roomSettings.tags.removeTag", { tag })}
                              >
                                {t("hub.roomSettings.tags.remove")}
                              </button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <div className="dcx-row-stack">
                    <div className="dcx-notice dcx-notice-info">{t("hub.roomSettings.tags.unsupported")}</div>
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
            {t("hub.roomSettings.cancel")}
          </button>
          <button
            type="button"
            className="dcx-btn dcx-btn-primary"
            disabled={!values.name.trim() || busy}
            onClick={() => void submit()}
          >
            {busy
              ? mode === "create"
                ? t("hub.roomSettings.creating")
                : t("hub.roomSettings.saving")
              : mode === "create"
                ? t("hub.roomSettings.createTitle")
                : t("hub.roomSettings.saveChanges")}
          </button>
        </footer>
      </div>

      {confirmDelete && onDelete && (
        <TypeToConfirmDialog
          title={t("hub.roomSettings.delete.confirmTitle")}
          description={t("hub.roomSettings.delete.confirmDescription")}
          confirmText={(deleteConfirmName ?? values.name).trim() || t("hub.roomSettings.delete.confirmWord")}
          actionLabel={t("hub.roomSettings.delete.action")}
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
