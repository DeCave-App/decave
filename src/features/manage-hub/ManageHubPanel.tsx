import { hubMediaHint } from "../../../shared/hub-media-specs";
import { useId, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useDialogA11y } from "../shared/useDialogA11y";
import { TypeToConfirmDialog } from "../shared/TypeToConfirmDialog";
import { MembersSection } from "./MembersSection";
import { RolesSection } from "./RolesSection";
import type { HubProfileValues, HubRoom, ManageHubPanelProps, ManageHubSectionId } from "./types";
import "../shared/shared.css";
import "../room-settings/room-settings.css";
import "./manage-hub.css";
import { Icon } from "../../components/Icon";
import { localeForLanguage, preferredTimeOptions } from "../../app/locale";

type NavItem = {
  id: ManageHubSectionId;
  label: string;
  description: string;
  group: "hub" | "people" | "content" | "advanced";
};

const NAV: NavItem[] = [
  { id: "overview", label: "Overview", description: "Stats and quick actions for this Hub.", group: "hub" },
  {
    id: "profile",
    label: "Profile & appearance",
    description: "Name, icon, banner, theme and discovery details.",
    group: "hub",
  },
  {
    id: "roles",
    label: "Roles & permissions",
    description: "Create roles and choose exactly what each one can do.",
    group: "people",
  },
  {
    id: "members",
    label: "Members",
    description: "Find members, assign roles and take moderation actions.",
    group: "people",
  },
  { id: "invites", label: "Invites", description: "Share one-time invite links with new people.", group: "people" },
  { id: "rooms", label: "Rooms", description: "Order rooms and open their settings.", group: "content" },
  { id: "events", label: "Events", description: "The Hub calendar and who can schedule events.", group: "content" },
  {
    id: "moderation",
    label: "Moderation & safety",
    description: "Slow mode, custom emotes and stickers, and the audit log.",
    group: "advanced",
  },
  { id: "bots", label: "Bots", description: "Connect bots and webhooks to rooms.", group: "advanced" },
  { id: "danger", label: "Danger zone", description: "Irreversible actions for this Hub.", group: "advanced" },
];

const GROUP_LABELS: Record<NavItem["group"], string> = {
  hub: "Hub",
  people: "People",
  content: "Content",
  advanced: "Advanced",
};

const PROFILE_KEYS: Array<keyof HubProfileValues> = [
  "name",
  "icon",
  "visibility",
  "description",
  "accent",
  "theme",
  "useBannerBackground",
  "useChatBackground",
  "iconRing",
  "category",
  "tags",
];
const MODERATION_KEYS: Array<keyof HubProfileValues> = ["slowMode"];

function Switch({
  id,
  checked,
  disabled,
  onChange,
  describedBy,
}: {
  id: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  describedBy?: string;
}) {
  return (
    <label className="dcx-switch">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span aria-hidden="true" />
    </label>
  );
}

function FileButton({
  label,
  accept,
  disabled,
  onFile,
}: {
  label: string;
  accept: string;
  disabled?: boolean;
  onFile: (file: File) => void;
}) {
  return (
    <label className={`dcx-btn dcx-btn-sm dch-file${disabled ? " is-disabled" : ""}`}>
      {label}
      <input
        type="file"
        accept={accept}
        className="dcx-sr-only"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.currentTarget.value = "";
        }}
      />
    </label>
  );
}

export function ManageHubPanel(props: ManageHubPanelProps) {
  const { server, values, set, apiBaseUrl, isOwner, canManage, error, renderAvatar, onClose } = props;
  const [section, setSection] = useState<ManageHubSectionId>("overview");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const dialogRef = useDialogA11y<HTMLDivElement>(confirmDelete ? null : onClose);
  const titleId = useId();
  const baseId = useId();
  const f = (name: string) => `${baseId}-${name}`;

  const saved: HubProfileValues = useMemo(
    () => ({
      name: server.name,
      icon: server.icon,
      visibility: server.visibility,
      description: server.description ?? "",
      accent: server.accent ?? "#7c5cff",
      theme: server.theme ?? "midnight",
      useBannerBackground: server.useBannerBackground === true,
      useChatBackground: server.useChatBackground === true,
      iconRing: server.iconRing === true,
      category: server.category ?? "Gaming",
      tags: (server.tags ?? []).join(", "),
      slowMode: server.slowModeSeconds ?? 0,
    }),
    [server],
  );

  const changed = (keys: Array<keyof HubProfileValues>) =>
    keys.filter((key) => String(values[key]).trim() !== String(saved[key]).trim());
  const profileDirty = changed(PROFILE_KEYS).length > 0;
  const moderationDirty = changed(MODERATION_KEYS).length > 0;
  const dirtyBySection: Partial<Record<ManageHubSectionId, boolean>> = {
    profile: profileDirty,
    moderation: moderationDirty,
  };

  const resetKeys = (keys: Array<keyof HubProfileValues>) => {
    for (const key of keys) (set[key] as (value: HubProfileValues[typeof key]) => void)(saved[key]);
  };
  const save = async () => {
    if (saving || !values.name.trim()) return;
    setSaving(true);
    try {
      await props.onSave();
    } finally {
      setSaving(false);
    }
  };

  const rooms = useMemo(() => {
    const byType = (type: HubRoom["type"]) =>
      server.channels.filter((room) => room.type === type).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    return [
      { type: "text" as const, label: "Text rooms", items: byType("text") },
      { type: "forum" as const, label: "Forum rooms", items: byType("forum") },
      { type: "voice" as const, label: "Voice rooms", items: byType("voice") },
    ].filter((group) => group.items.length > 0);
  }, [server.channels]);

  const visibleNav = NAV.filter((item) => (item.id === "danger" ? isOwner : item.id === "bots" ? canManage : true));
  const current = visibleNav.find((item) => item.id === section) ?? visibleNav[0];
  const memberCount = props.members.length || server.memberCount || 0;
  const onlineCount = props.members.filter((member) => member.online).length || server.onlineCount || 0;

  const dirtyBar = (keys: Array<keyof HubProfileValues>, dirty: boolean): ReactNode =>
    dirty && canManage ? (
      <div className="dcx-dirtybar" role="region" aria-label="Unsaved changes">
        <span aria-live="polite">{saving ? "Saving…" : "You have unsaved changes"}</span>
        <div>
          <button type="button" className="dcx-btn dcx-btn-ghost" disabled={saving} onClick={() => resetKeys(keys)}>
            Reset
          </button>
          <button
            type="button"
            className="dcx-btn dcx-btn-primary"
            disabled={saving || props.mediaBusy || !values.name.trim()}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    ) : null;

  const iconPreview = server.iconUrl ? (
    <img src={`${apiBaseUrl}${server.iconUrl}`} alt="" />
  ) : (
    <span>{values.icon || server.icon || server.name.charAt(0).toUpperCase()}</span>
  );

  return (
    <div
      className="dcx-modal-overlay dch-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="dch-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-dc-dialog={confirmDelete ? undefined : "open"}
        tabIndex={-1}
        style={{ "--dch-accent": values.accent } as CSSProperties}
      >
        <aside className="dch-nav" aria-label="Manage Hub sections">
          <div className="dch-nav-hub">
            <div className={`dch-hub-icon${values.iconRing ? " has-ring" : ""}`} aria-hidden="true">
              {iconPreview}
            </div>
            <div>
              <h2 id={titleId}>Manage Hub</h2>
              <p>{server.name}</p>
            </div>
          </div>
          <label className="dcx-sr-only" htmlFor={f("section-select")}>
            Section
          </label>
          <select
            id={f("section-select")}
            className="dcx-input dch-nav-select"
            value={current.id}
            onChange={(event) => setSection(event.target.value as ManageHubSectionId)}
          >
            {visibleNav.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
                {dirtyBySection[item.id] ? " •" : ""}
              </option>
            ))}
          </select>
          <nav className="dch-nav-list">
            {(Object.keys(GROUP_LABELS) as NavItem["group"][]).map((group) => {
              const items = visibleNav.filter((item) => item.group === group);
              if (!items.length) return null;
              return (
                <div key={group} className="dch-nav-group" role="group" aria-labelledby={f(`grp-${group}`)}>
                  <div className="dch-nav-group-label" id={f(`grp-${group}`)}>
                    {GROUP_LABELS[group]}
                  </div>
                  {items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`dcx-nav-item${item.id === current.id ? " is-active" : ""}${item.id === "danger" ? " is-danger" : ""}`}
                      aria-current={item.id === current.id ? "page" : undefined}
                      onClick={() => setSection(item.id)}
                    >
                      <span>{item.label}</span>
                      {dirtyBySection[item.id] && <i className="dch-dirty-dot" aria-label="Unsaved changes" />}
                    </button>
                  ))}
                </div>
              );
            })}
          </nav>
        </aside>

        <main className="dch-main">
          <header className="dch-main-head">
            <div>
              <h3>{current.label}</h3>
              <p>{current.description}</p>
            </div>
            <button
              type="button"
              className="dcx-btn dcx-btn-ghost dch-close"
              onClick={onClose}
              aria-label="Close Manage Hub"
            >
              <Icon name="close" />
            </button>
          </header>
          {error && (
            <div className="dcx-notice dcx-notice-error" role="alert">
              {error}
            </div>
          )}

          {current.id === "overview" && (
            <>
              <div
                className="dch-hero"
                style={
                  server.bannerUrl
                    ? {
                        backgroundImage: `linear-gradient(180deg, rgba(5,8,16,.25), rgba(5,8,16,.92)), url(${apiBaseUrl}${server.bannerUrl})`,
                      }
                    : undefined
                }
              >
                <div className={`dch-hub-icon dch-hub-icon-lg${values.iconRing ? " has-ring" : ""}`} aria-hidden="true">
                  {iconPreview}
                </div>
                <div>
                  <strong>{server.name}</strong>
                  <small>
                    {server.visibility === "public" ? "Public Hub" : "Private Hub"}
                    {server.category ? ` · ${server.category}` : ""}
                  </small>
                </div>
              </div>
              <dl className="dch-stats">
                <div>
                  <dt>Members</dt>
                  <dd>{memberCount}</dd>
                </div>
                <div>
                  <dt>Online</dt>
                  <dd>{onlineCount}</dd>
                </div>
                <div>
                  <dt>Rooms</dt>
                  <dd>{server.channels.length}</dd>
                </div>
                <div>
                  <dt>Custom roles</dt>
                  <dd>{props.roles.length}</dd>
                </div>
              </dl>
              <section className="dcx-card">
                <div className="dcx-card-head">
                  <h4>Quick actions</h4>
                </div>
                <div className="dch-quick">
                  {canManage && (
                    <button type="button" className="dcx-btn" onClick={props.onCreateRoom}>
                      Create room
                    </button>
                  )}
                  <button
                    type="button"
                    className="dcx-btn"
                    onClick={() => {
                      setSection("invites");
                      if (!props.inviteUrl) props.onCreateInvite();
                    }}
                  >
                    Invite people
                  </button>
                  <button type="button" className="dcx-btn" onClick={() => setSection("roles")}>
                    Edit roles
                  </button>
                  <button type="button" className="dcx-btn" onClick={() => setSection("members")}>
                    Manage members
                  </button>
                  <button type="button" className="dcx-btn" onClick={props.onOpenCalendar}>
                    Open calendar
                  </button>
                  <button type="button" className="dcx-btn" onClick={() => setSection("profile")}>
                    Edit profile
                  </button>
                </div>
              </section>
              {props.importPanel && (
                <section className="dcx-card">
                  <div className="dcx-card-head">
                    <h4>Import from Discord</h4>
                    <p>Review a Discord template before adding its rooms and roles.</p>
                  </div>
                  <div className="dch-pad">{props.importPanel}</div>
                </section>
              )}
            </>
          )}

          {current.id === "profile" && (
            <fieldset className="dch-fieldset" disabled={!canManage}>
              <legend className="dcx-sr-only">Profile and appearance</legend>
              <section className="dcx-card">
                <div className="dcx-card-head">
                  <h4>Identity</h4>
                </div>
                <div className="dcx-row-stack">
                  <label className="dcx-field-label" htmlFor={f("name")}>
                    Hub name
                  </label>
                  <input
                    id={f("name")}
                    className="dcx-input"
                    value={values.name}
                    maxLength={40}
                    onChange={(event) => set.name(event.target.value)}
                    aria-invalid={!values.name.trim()}
                  />
                  {!values.name.trim() && <span className="dch-field-error">A Hub name is required.</span>}
                </div>
                <div className="dcx-row">
                  <div className="dch-member">
                    <div className={`dch-hub-icon${values.iconRing ? " has-ring" : ""}`} aria-hidden="true">
                      {iconPreview}
                    </div>
                    <div className="dcx-row-copy">
                      <strong>Hub icon</strong>
                      <small>PNG, JPEG or WebP. Applies immediately after upload.</small>
                    </div>
                  </div>
                  <div className="dcx-row-control">
                    <FileButton
                      label={props.mediaBusy ? "Uploading…" : "Upload icon"}
                      accept="image/png,image/jpeg,image/webp"
                      disabled={props.mediaBusy}
                      onFile={(file) => props.onUploadMedia("icon", file)}
                    />
                  </div>
                </div>
                <div className="dcx-row">
                  <div className="dcx-row-copy">
                    <label htmlFor={f("icon")}>Fallback emoji or letters</label>
                    <small>Shown when there’s no uploaded icon.</small>
                  </div>
                  <div className="dcx-row-control">
                    <input
                      id={f("icon")}
                      className="dcx-input dch-short"
                      value={values.icon}
                      maxLength={8}
                      onChange={(event) => set.icon(Array.from(event.target.value).slice(0, 4).join(""))}
                    />
                  </div>
                </div>
                <div className="dcx-row-stack">
                  <label className="dcx-field-label" htmlFor={f("description")}>
                    Description
                  </label>
                  <textarea
                    id={f("description")}
                    className="dcx-input"
                    rows={3}
                    maxLength={300}
                    value={values.description}
                    placeholder="What is this Hub about?"
                    onChange={(event) => set.description(event.target.value)}
                  />
                </div>
                <div className="dch-grid-2">
                  <div className="dch-field">
                    <label htmlFor={f("category")}>Category</label>
                    <input
                      id={f("category")}
                      className="dcx-input"
                      value={values.category}
                      maxLength={40}
                      placeholder="Racing, MMO, Community"
                      onChange={(event) => set.category(event.target.value)}
                    />
                  </div>
                  <div className="dch-field">
                    <label htmlFor={f("tags")}>Tags</label>
                    <input
                      id={f("tags")}
                      className="dcx-input"
                      value={values.tags}
                      placeholder="racing, EU, casual"
                      onChange={(event) => set.tags(event.target.value)}
                    />
                  </div>
                </div>
              </section>

              <section className="dcx-card">
                <div className="dcx-card-head">
                  <h4>Visibility</h4>
                  {!isOwner && <p>Only the Hub owner can change visibility.</p>}
                </div>
                <div
                  className="dcr-choice-grid dcr-choice-grid-2 dcr-pad"
                  role="radiogroup"
                  aria-label="Hub visibility"
                >
                  <label className={`dcr-choice${values.visibility === "public" ? " is-selected" : ""}`}>
                    <input
                      type="radio"
                      name={f("visibility")}
                      checked={values.visibility === "public"}
                      disabled={!isOwner}
                      onChange={() => set.visibility("public")}
                    />
                    <span>
                      <strong>Public</strong>
                      <small>Anyone can find this Hub in Discover and join.</small>
                    </span>
                  </label>
                  <label className={`dcr-choice${values.visibility === "private" ? " is-selected" : ""}`}>
                    <input
                      type="radio"
                      name={f("visibility")}
                      checked={values.visibility === "private"}
                      disabled={!isOwner}
                      onChange={() => set.visibility("private")}
                    />
                    <span>
                      <strong>Private</strong>
                      <small>Only invited people can join.</small>
                    </span>
                  </label>
                </div>
              </section>

              <section className="dcx-card">
                <div className="dcx-card-head">
                  <h4>Appearance</h4>
                </div>
                <div className="dcx-row">
                  <div className="dcx-row-copy">
                    <label htmlFor={f("theme")}>Theme</label>
                    <small>Color preset used across this Hub.</small>
                  </div>
                  <div className="dcx-row-control">
                    <select
                      id={f("theme")}
                      className="dcx-input"
                      value={values.theme}
                      onChange={(event) => set.theme(event.target.value as HubProfileValues["theme"])}
                    >
                      <option value="midnight">Midnight</option>
                      <option value="ocean">Ocean</option>
                      <option value="forest">Forest</option>
                      <option value="ember">Ember</option>
                    </select>
                  </div>
                </div>
                <div className="dcx-row">
                  <div className="dcx-row-copy">
                    <label htmlFor={f("accent")}>Accent color</label>
                    <small>Used for highlights and the icon ring.</small>
                  </div>
                  <div className="dcx-row-control">
                    <input
                      id={f("accent")}
                      type="color"
                      className="dch-color"
                      value={values.accent}
                      onChange={(event) => set.accent(event.target.value)}
                    />
                  </div>
                </div>
                <div className="dcx-row">
                  <div className="dcx-row-copy">
                    <label htmlFor={f("ring")}>Highlight icon ring</label>
                    <small id={f("ring-d")}>Draw the accent color around the Hub icon.</small>
                  </div>
                  <div className="dcx-row-control">
                    <Switch
                      id={f("ring")}
                      describedBy={f("ring-d")}
                      checked={values.iconRing}
                      onChange={set.iconRing}
                    />
                  </div>
                </div>
                <div className="dch-media-pair">
                  <div className="dch-media-card">
                    <div className="dch-media-head">
                      <div className="dch-media-prev is-side">
                        {server.bannerUrl ? (
                          <img src={`${apiBaseUrl}${server.bannerUrl}`} alt="Current sidebar banner" />
                        ) : (
                          <span>No banner</span>
                        )}
                      </div>
                      <div className="dcx-row-copy">
                        <strong>Sidebar banner</strong>
                        <small>Fills the Hub sidebar behind the room list. {hubMediaHint("banner")}.</small>
                      </div>
                    </div>
                    <div className="dch-media-actions">
                      <FileButton
                        label={props.mediaBusy ? "Uploading…" : server.bannerUrl ? "Change" : "Add banner"}
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        disabled={props.mediaBusy}
                        onFile={(file) => props.onUploadMedia("banner", file)}
                      />
                      {server.bannerUrl && (
                        <button
                          type="button"
                          className="dcx-btn dcx-btn-ghost dch-media-remove"
                          disabled={props.mediaBusy}
                          onClick={() => props.onRemoveMedia("banner")}
                        >
                          Remove
                        </button>
                      )}
                      <span className="dch-media-spacer" />
                      <label htmlFor={f("bannerbg")} className="dch-media-show">
                        Show
                      </label>
                      <Switch
                        id={f("bannerbg")}
                        describedBy={f("bannerbg-d")}
                        checked={values.useBannerBackground}
                        disabled={!server.bannerUrl || props.mediaBusy}
                        onChange={set.useBannerBackground}
                      />
                    </div>
                    <small id={f("bannerbg-d")} className="dch-media-note">
                      {server.bannerUrl ? "Dimmed for readability." : "Add a banner to turn this on."}
                    </small>
                  </div>
                  <div className="dch-media-card">
                    <div className="dch-media-head">
                      <div className="dch-media-prev is-wide">
                        {server.chatBackgroundUrl ? (
                          <img src={`${apiBaseUrl}${server.chatBackgroundUrl}`} alt="Current chat background" />
                        ) : (
                          <span>No photo</span>
                        )}
                      </div>
                      <div className="dcx-row-copy">
                        <strong>Chat background</strong>
                        <small>Behind the message list, dimmed automatically. {hubMediaHint("chat-background")}.</small>
                      </div>
                    </div>
                    <div className="dch-media-actions">
                      <FileButton
                        label={props.mediaBusy ? "Uploading…" : server.chatBackgroundUrl ? "Change" : "Add photo"}
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        disabled={props.mediaBusy}
                        onFile={(file) => props.onUploadMedia("chat-background", file)}
                      />
                      {server.chatBackgroundUrl && (
                        <button
                          type="button"
                          className="dcx-btn dcx-btn-ghost dch-media-remove"
                          disabled={props.mediaBusy}
                          onClick={() => props.onRemoveMedia("chat-background")}
                        >
                          Remove
                        </button>
                      )}
                      <span className="dch-media-spacer" />
                      <label htmlFor={f("chatbg")} className="dch-media-show">
                        Show
                      </label>
                      <Switch
                        id={f("chatbg")}
                        describedBy={f("chatbg-d")}
                        checked={values.useChatBackground}
                        disabled={!server.chatBackgroundUrl || props.mediaBusy}
                        onChange={set.useChatBackground}
                      />
                    </div>
                    <small id={f("chatbg-d")} className="dch-media-note">
                      {server.chatBackgroundUrl ? "Shown in every room of this Hub." : "Add a photo to turn this on."}
                    </small>
                  </div>
                </div>
                {props.mediaError && (
                  <div className="dcx-row-stack">
                    <div className="dcx-notice dcx-notice-error" role="alert">
                      {props.mediaError}
                    </div>
                  </div>
                )}
              </section>
              {dirtyBar(PROFILE_KEYS, profileDirty)}
            </fieldset>
          )}

          {current.id === "roles" && (
            <RolesSection
              hubId={server.id}
              apiBaseUrl={apiBaseUrl}
              authorizedFetch={props.authorizedFetch}
              isOwner={isOwner}
              roles={props.roles}
              iconChoices={props.roleIconChoices ?? []}
              members={props.members}
              onRolesChanged={props.onRolesChanged}
            />
          )}

          {current.id === "members" && (
            <MembersSection
              members={props.members}
              loading={props.membersLoading}
              roles={props.roles}
              friends={props.friends}
              friendsLoading={props.friendsLoading}
              isOwner={isOwner}
              canManage={canManage}
              myRole={server.myRole}
              currentUserId={props.currentUserId}
              renderAvatar={renderAvatar}
              onAddFriend={props.onAddFriend}
              onChangeMemberRole={props.onChangeMemberRole}
              onAssignCustomRole={props.onAssignCustomRole}
              onModerateMember={props.onModerateMember}
              onRemoveMember={props.onRemoveMember}
            />
          )}

          {current.id === "invites" && (
            <section className="dcx-card">
              <div className="dcx-card-head">
                <h4>One-time invite link</h4>
                <p>Each link works once and expires after 24 hours. Use it for people who aren’t your friends yet.</p>
              </div>
              <div className="dcx-row-stack">
                <label className="dcx-sr-only" htmlFor={f("invite")}>
                  Invite link
                </label>
                <div className="dch-invite">
                  <input
                    id={f("invite")}
                    className="dcx-input"
                    readOnly
                    value={props.inviteUrl}
                    placeholder={props.inviteBusy ? "Generating secure invite…" : "Generate a link to share"}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  {props.inviteUrl ? (
                    <button
                      type="button"
                      className="dcx-btn dcx-btn-primary"
                      disabled={props.inviteBusy}
                      onClick={props.onCopyInvite}
                    >
                      Copy link
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="dcx-btn dcx-btn-primary"
                      disabled={props.inviteBusy}
                      onClick={props.onCreateInvite}
                    >
                      Generate
                    </button>
                  )}
                </div>
                {props.inviteUrl && (
                  <div>
                    <button
                      type="button"
                      className="dcx-btn dcx-btn-ghost dcx-btn-sm"
                      disabled={props.inviteBusy}
                      onClick={props.onCreateInvite}
                    >
                      Generate another link
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}

          {current.id === "rooms" && (
            <>
              {canManage && (
                <div className="dch-section-actions">
                  <button type="button" className="dcx-btn dcx-btn-primary" onClick={props.onCreateRoom}>
                    Create room
                  </button>
                </div>
              )}
              {rooms.length === 0 && <p className="dcx-hint">This Hub has no rooms yet.</p>}
              {rooms.map((group) => (
                <section className="dcx-card" key={group.type} aria-label={group.label}>
                  <div className="dcx-card-head">
                    <h4>{group.label}</h4>
                  </div>
                  <ol className="dch-room-list">
                    {group.items.map((room, index) => (
                      <li key={room.id} className="dcx-row">
                        <div className="dch-member">
                          <span className="dch-room-icon" aria-hidden="true">
                            {room.icon || (room.type === "voice" ? "🔊" : room.type === "forum" ? "🗂️" : "#")}
                          </span>
                          <div className="dcx-row-copy">
                            <strong>{room.name}</strong>
                            <small>
                              {room.private ? "Private" : "Public"}
                              {room.category ? ` · ${room.category}` : ""}
                            </small>
                          </div>
                        </div>
                        {canManage && (
                          <div className="dcx-row-control">
                            <button
                              type="button"
                              className="dcx-btn dcx-btn-ghost dcx-btn-sm"
                              disabled={index === 0}
                              onClick={() => props.onReorderRoom(room.id, group.items[index - 1].id)}
                              aria-label={`Move ${room.name} up`}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="dcx-btn dcx-btn-ghost dcx-btn-sm"
                              disabled={index === group.items.length - 1}
                              onClick={() => props.onReorderRoom(room.id, group.items[index + 1].id)}
                              aria-label={`Move ${room.name} down`}
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              className="dcx-btn dcx-btn-sm"
                              onClick={() => props.onOpenRoomSettings(room)}
                            >
                              Settings
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </>
          )}

          {current.id === "events" && (
            <>
              <section className="dcx-card">
                <div className="dcx-row">
                  <div className="dcx-row-copy">
                    <strong>Hub calendar</strong>
                    <small>See upcoming events, RSVPs and schedule new ones.</small>
                  </div>
                  <div className="dcx-row-control">
                    <button type="button" className="dcx-btn" onClick={props.onOpenCalendar}>
                      Open calendar
                    </button>
                    <button type="button" className="dcx-btn dcx-btn-primary" onClick={props.onCreateEvent}>
                      Create event
                    </button>
                  </div>
                </div>
              </section>
              <section className="dcx-card">
                <div className="dcx-card-head">
                  <h4>Who can create events</h4>
                  <p>
                    Events are posted into a text room, so anyone who can post in a text room can schedule events there.
                    To limit who creates events, make rooms private on the Rooms page and grant access to specific
                    members.
                  </p>
                </div>
                <div className="dcx-row-stack">
                  <div className="dcx-notice dcx-notice-info">
                    A dedicated “create events” permission isn’t available yet.
                  </div>
                </div>
              </section>
            </>
          )}

          {current.id === "moderation" && (
            <>
              <fieldset className="dch-fieldset" disabled={!canManage}>
                <legend className="dcx-sr-only">Moderation settings</legend>
                <section className="dcx-card">
                  <div className="dcx-row">
                    <div className="dcx-row-copy">
                      <label htmlFor={f("slow")}>Slow mode</label>
                      <small id={f("slow-d")}>
                        Seconds members must wait between messages (0–120). Staff are exempt.
                      </small>
                    </div>
                    <div className="dcx-row-control">
                      <input
                        id={f("slow")}
                        aria-describedby={f("slow-d")}
                        type="number"
                        min={0}
                        max={120}
                        className="dcx-input dch-short"
                        value={values.slowMode}
                        onChange={(event) => set.slowMode(Math.max(0, Math.min(120, Number(event.target.value) || 0)))}
                      />
                    </div>
                  </div>
                </section>
                {dirtyBar(MODERATION_KEYS, moderationDirty)}
              </fieldset>
              {canManage && (
                <section className="dcx-card">
                  <div className="dcx-card-head">
                    <h4>Emotes & stickers</h4>
                    <p>Custom images members can use in this Hub.</p>
                  </div>
                  <div className="dcx-row-stack">
                    <div className="dch-quick">
                      <FileButton
                        label="Upload emote"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        disabled={props.assetBusy}
                        onFile={(file) => props.onUploadAsset("emote", file)}
                      />
                      <FileButton
                        label="Upload sticker"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        disabled={props.assetBusy}
                        onFile={(file) => props.onUploadAsset("sticker", file)}
                      />
                    </div>
                  </div>
                  {props.assets.map((asset) => (
                    <div className="dcx-row" key={asset.id}>
                      <div className="dch-member">
                        <img className="dch-asset" src={`${apiBaseUrl}${asset.url}`} alt="" />
                        <div className="dcx-row-copy">
                          <strong>:{asset.name}:</strong>
                          <small>{asset.kind === "emote" ? "Emote" : "Sticker"}</small>
                        </div>
                      </div>
                      <div className="dcx-row-control">
                        <button
                          type="button"
                          className="dcx-btn dcx-btn-danger dcx-btn-sm"
                          onClick={() => props.onDeleteAsset(asset)}
                          aria-label={`Delete ${asset.name}`}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </section>
              )}
              <section className="dcx-card">
                <div className="dcx-row">
                  <div className="dcx-row-copy">
                    <strong>Audit log</strong>
                    <small>Recent changes to settings, roles and members.</small>
                  </div>
                  <div className="dcx-row-control">
                    <button type="button" className="dcx-btn dcx-btn-sm" onClick={props.onLoadAudit}>
                      {props.auditLog.length ? "Refresh" : "Load audit log"}
                    </button>
                  </div>
                </div>
                {props.auditLog.slice(0, 20).map((entry) => (
                  <div className="dcx-row" key={entry.id}>
                    <div className="dcx-row-copy">
                      <strong>{entry.action}</strong>
                      {entry.detail && <small>{entry.detail}</small>}
                    </div>
                    <small className="dcx-hint">
                      {new Date(entry.timestamp).toLocaleString(localeForLanguage(), preferredTimeOptions())}
                    </small>
                  </div>
                ))}
              </section>
            </>
          )}

          {current.id === "bots" &&
            (props.botsPanel ?? <p className="dcx-hint">Bots are available to Hub owners and admins.</p>)}

          {current.id === "danger" && isOwner && (
            <section className="dcx-card dch-danger">
              <div className="dcx-row">
                <div className="dcx-row-copy">
                  <strong>Delete this Hub</strong>
                  <small>Permanently deletes the Hub, every room and all saved messages. This can’t be undone.</small>
                </div>
                <div className="dcx-row-control">
                  <button type="button" className="dcx-btn dcx-btn-danger" onClick={() => setConfirmDelete(true)}>
                    Delete Hub
                  </button>
                </div>
              </div>
            </section>
          )}
        </main>
      </div>

      {confirmDelete && (
        <TypeToConfirmDialog
          title={`Delete ${server.name}?`}
          description="This permanently deletes the Hub, all of its rooms and every saved message."
          confirmText={server.name}
          actionLabel="Delete Hub"
          busy={deleting}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            setDeleting(true);
            try {
              await props.onDelete();
            } finally {
              setDeleting(false);
              setConfirmDelete(false);
            }
          }}
        />
      )}
    </div>
  );
}
