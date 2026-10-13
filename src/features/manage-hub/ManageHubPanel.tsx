import { hubMediaHintMessage } from "./hubMediaText";
import { useId, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_HUB_CATEGORY } from "../../../shared/hub-categories";
import { hubCategoryField, hubCategoryInput, hubCategoryText } from "../../i18n/hubCategory";
import { useDialogA11y } from "../shared/useDialogA11y";
import { TypeToConfirmDialog } from "../shared/TypeToConfirmDialog";
import { MembersSection } from "./MembersSection";
import { RolesSection } from "./RolesSection";
import type { HubProfileValues, HubRoom, ManageHubPanelProps, ManageHubSectionId } from "./types";
import "../shared/shared.css";
import "../room-settings/room-settings.css";
import "./manage-hub.css";
import { Icon } from "../../components/Icon";
import { BotsSection } from "../bots";
import { formatDate } from "../../i18n/format";

type NavItem = {
  id: ManageHubSectionId;
  group: "hub" | "people" | "content" | "advanced";
};

// Labels and descriptions: hub.manageHub.nav.<id>.label / .description.
const NAV: NavItem[] = [
  { id: "overview", group: "hub" },
  { id: "profile", group: "hub" },
  { id: "roles", group: "people" },
  { id: "members", group: "people" },
  { id: "invites", group: "people" },
  { id: "rooms", group: "content" },
  { id: "events", group: "content" },
  { id: "moderation", group: "advanced" },
  { id: "bots", group: "advanced" },
  { id: "danger", group: "advanced" },
];

const GROUPS: NavItem["group"][] = ["hub", "people", "content", "advanced"];

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
  const { t } = useTranslation(["hub"]);
  const { server, values, set, apiBaseUrl, isOwner, canManage, error, renderAvatar, onClose } = props;
  const canManageBots = canManage || props.canManageBots === true;
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
      category: server.category ?? DEFAULT_HUB_CATEGORY,
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
      { type: "text" as const, items: byType("text") },
      { type: "forum" as const, items: byType("forum") },
      { type: "voice" as const, items: byType("voice") },
    ].filter((group) => group.items.length > 0);
  }, [server.channels]);

  const visibleNav = NAV.filter((item) => (item.id === "danger" ? isOwner : item.id === "bots" ? canManageBots : true));
  const current = visibleNav.find((item) => item.id === section) ?? visibleNav[0];
  const memberCount = props.members.length || server.memberCount || 0;
  const onlineCount = props.members.filter((member) => member.online).length || server.onlineCount || 0;

  const dirtyBar = (keys: Array<keyof HubProfileValues>, dirty: boolean): ReactNode =>
    dirty && canManage ? (
      <div className="dcx-dirtybar" role="region" aria-label={t("hub.manageHub.unsavedChanges")}>
        <span aria-live="polite">{saving ? t("hub.manageHub.saving") : t("hub.manageHub.unsavedNotice")}</span>
        <div>
          <button type="button" className="dcx-btn dcx-btn-ghost" disabled={saving} onClick={() => resetKeys(keys)}>
            {t("hub.manageHub.reset")}
          </button>
          <button
            type="button"
            className="dcx-btn dcx-btn-primary"
            disabled={saving || props.mediaBusy || !values.name.trim()}
            onClick={() => void save()}
          >
            {saving ? t("hub.manageHub.saving") : t("hub.manageHub.saveChanges")}
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
        <aside className="dch-nav" aria-label={t("hub.manageHub.sectionsLabel")}>
          <div className="dch-nav-hub">
            <div className={`dch-hub-icon${values.iconRing ? " has-ring" : ""}`} aria-hidden="true">
              {iconPreview}
            </div>
            <div>
              <h2 id={titleId}>{t("hub.manageHub.title")}</h2>
              <p>{server.name}</p>
            </div>
          </div>
          <label className="dcx-sr-only" htmlFor={f("section-select")}>
            {t("hub.manageHub.section")}
          </label>
          <select
            id={f("section-select")}
            className="dcx-input dch-nav-select"
            value={current.id}
            onChange={(event) => setSection(event.target.value as ManageHubSectionId)}
          >
            {visibleNav.map((item) => (
              <option key={item.id} value={item.id}>
                {t(`hub.manageHub.nav.${item.id}.label`)}
                {dirtyBySection[item.id] ? " •" : ""}
              </option>
            ))}
          </select>
          <nav className="dch-nav-list">
            {GROUPS.map((group) => {
              const items = visibleNav.filter((item) => item.group === group);
              if (!items.length) return null;
              return (
                <div key={group} className="dch-nav-group" role="group" aria-labelledby={f(`grp-${group}`)}>
                  <div className="dch-nav-group-label" id={f(`grp-${group}`)}>
                    {t(`hub.manageHub.groups.${group}`)}
                  </div>
                  {items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`dcx-nav-item${item.id === current.id ? " is-active" : ""}${item.id === "danger" ? " is-danger" : ""}`}
                      aria-current={item.id === current.id ? "page" : undefined}
                      onClick={() => setSection(item.id)}
                    >
                      <span>{t(`hub.manageHub.nav.${item.id}.label`)}</span>
                      {dirtyBySection[item.id] && (
                        <i className="dch-dirty-dot" aria-label={t("hub.manageHub.unsavedChanges")} />
                      )}
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
              <h3>{t(`hub.manageHub.nav.${current.id}.label`)}</h3>
              <p>{t(`hub.manageHub.nav.${current.id}.description`)}</p>
            </div>
            <button
              type="button"
              className="dcx-btn dcx-btn-ghost dch-close"
              onClick={onClose}
              aria-label={t("hub.manageHub.close")}
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
                    {server.visibility === "public" ? t("hub.manageHub.publicHub") : t("hub.manageHub.privateHub")}
                    {server.category ? ` · ${hubCategoryText(server.category)}` : ""}
                  </small>
                </div>
              </div>
              <dl className="dch-stats">
                <div>
                  <dt>{t("hub.manageHub.stats.members")}</dt>
                  <dd>{memberCount}</dd>
                </div>
                <div>
                  <dt>{t("hub.manageHub.stats.online")}</dt>
                  <dd>{onlineCount}</dd>
                </div>
                <div>
                  <dt>{t("hub.manageHub.stats.rooms")}</dt>
                  <dd>{server.channels.length}</dd>
                </div>
                <div>
                  <dt>{t("hub.manageHub.stats.customRoles")}</dt>
                  <dd>{props.roles.length}</dd>
                </div>
              </dl>
              <section className="dcx-card">
                <div className="dcx-card-head">
                  <h4>{t("hub.manageHub.quickActions")}</h4>
                </div>
                <div className="dch-quick">
                  {canManage && (
                    <button type="button" className="dcx-btn" onClick={props.onCreateRoom}>
                      {t("hub.manageHub.createRoom")}
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
                    {t("hub.manageHub.invitePeople")}
                  </button>
                  <button type="button" className="dcx-btn" onClick={() => setSection("roles")}>
                    {t("hub.manageHub.editRoles")}
                  </button>
                  <button type="button" className="dcx-btn" onClick={() => setSection("members")}>
                    {t("hub.manageHub.manageMembers")}
                  </button>
                  <button type="button" className="dcx-btn" onClick={props.onOpenCalendar}>
                    {t("hub.manageHub.openCalendar")}
                  </button>
                  <button type="button" className="dcx-btn" onClick={() => setSection("profile")}>
                    {t("hub.manageHub.editProfile")}
                  </button>
                </div>
              </section>
              {props.importPanel && (
                <section className="dcx-card">
                  <div className="dcx-card-head">
                    <h4>{t("hub.manageHub.importDiscord.title")}</h4>
                    <p>{t("hub.manageHub.importDiscord.description")}</p>
                  </div>
                  <div className="dch-pad">{props.importPanel}</div>
                </section>
              )}
            </>
          )}

          {current.id === "profile" && (
            <fieldset className="dch-fieldset" disabled={!canManage}>
              <legend className="dcx-sr-only">{t("hub.manageHub.profile.legend")}</legend>
              <section className="dcx-card">
                <div className="dcx-card-head">
                  <h4>{t("hub.manageHub.profile.identity")}</h4>
                </div>
                <div className="dcx-row-stack">
                  <label className="dcx-field-label" htmlFor={f("name")}>
                    {t("hub.manageHub.profile.name")}
                  </label>
                  <input
                    id={f("name")}
                    className="dcx-input"
                    value={values.name}
                    maxLength={40}
                    onChange={(event) => set.name(event.target.value)}
                    aria-invalid={!values.name.trim()}
                  />
                  {!values.name.trim() && (
                    <span className="dch-field-error">{t("hub.manageHub.profile.nameRequired")}</span>
                  )}
                </div>
                <div className="dcx-row">
                  <div className="dch-member">
                    <div className={`dch-hub-icon${values.iconRing ? " has-ring" : ""}`} aria-hidden="true">
                      {iconPreview}
                    </div>
                    <div className="dcx-row-copy">
                      <strong>{t("hub.manageHub.profile.icon")}</strong>
                      <small>{t("hub.manageHub.profile.iconHint")}</small>
                    </div>
                  </div>
                  <div className="dcx-row-control">
                    <FileButton
                      label={props.mediaBusy ? t("hub.manageHub.uploading") : t("hub.manageHub.profile.uploadIcon")}
                      accept="image/png,image/jpeg,image/webp"
                      disabled={props.mediaBusy}
                      onFile={(file) => props.onUploadMedia("icon", file)}
                    />
                  </div>
                </div>
                <div className="dcx-row">
                  <div className="dcx-row-copy">
                    <label htmlFor={f("icon")}>{t("hub.manageHub.profile.fallbackIcon")}</label>
                    <small>{t("hub.manageHub.profile.fallbackIconHint")}</small>
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
                    {t("hub.manageHub.profile.description")}
                  </label>
                  <textarea
                    id={f("description")}
                    className="dcx-input"
                    rows={3}
                    maxLength={300}
                    value={values.description}
                    placeholder={t("hub.manageHub.profile.descriptionPlaceholder")}
                    onChange={(event) => set.description(event.target.value)}
                  />
                </div>
                <div className="dch-grid-2">
                  <div className="dch-field">
                    <label htmlFor={f("category")}>{t("hub.manageHub.profile.category")}</label>
                    <input
                      id={f("category")}
                      className="dcx-input"
                      value={hubCategoryField(values.category)}
                      maxLength={40}
                      placeholder={t("hub.manageHub.profile.categoryPlaceholder")}
                      onChange={(event) => set.category(hubCategoryInput(event.target.value))}
                    />
                  </div>
                  <div className="dch-field">
                    <label htmlFor={f("tags")}>{t("hub.manageHub.profile.tags")}</label>
                    <input
                      id={f("tags")}
                      className="dcx-input"
                      value={values.tags}
                      placeholder={t("hub.manageHub.profile.tagsPlaceholder")}
                      onChange={(event) => set.tags(event.target.value)}
                    />
                  </div>
                </div>
              </section>

              <section className="dcx-card">
                <div className="dcx-card-head">
                  <h4>{t("hub.manageHub.visibility.title")}</h4>
                  {!isOwner && <p>{t("hub.manageHub.visibility.ownerOnly")}</p>}
                </div>
                <div
                  className="dcr-choice-grid dcr-choice-grid-2 dcr-pad"
                  role="radiogroup"
                  aria-label={t("hub.manageHub.visibility.label")}
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
                      <strong>{t("hub.manageHub.visibility.public")}</strong>
                      <small>{t("hub.manageHub.visibility.publicHint")}</small>
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
                      <strong>{t("hub.manageHub.visibility.private")}</strong>
                      <small>{t("hub.manageHub.visibility.privateHint")}</small>
                    </span>
                  </label>
                </div>
              </section>

              <section className="dcx-card">
                <div className="dcx-card-head">
                  <h4>{t("hub.manageHub.appearance.title")}</h4>
                </div>
                <div className="dcx-row">
                  <div className="dcx-row-copy">
                    <label htmlFor={f("theme")}>{t("hub.manageHub.appearance.theme")}</label>
                    <small>{t("hub.manageHub.appearance.themeHint")}</small>
                  </div>
                  <div className="dcx-row-control">
                    <select
                      id={f("theme")}
                      className="dcx-input"
                      value={values.theme}
                      onChange={(event) => set.theme(event.target.value as HubProfileValues["theme"])}
                    >
                      <option value="midnight">{t("hub.manageHub.appearance.themes.midnight")}</option>
                      <option value="ocean">{t("hub.manageHub.appearance.themes.ocean")}</option>
                      <option value="forest">{t("hub.manageHub.appearance.themes.forest")}</option>
                      <option value="ember">{t("hub.manageHub.appearance.themes.ember")}</option>
                    </select>
                  </div>
                </div>
                <div className="dcx-row">
                  <div className="dcx-row-copy">
                    <label htmlFor={f("accent")}>{t("hub.manageHub.appearance.accent")}</label>
                    <small>{t("hub.manageHub.appearance.accentHint")}</small>
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
                    <label htmlFor={f("ring")}>{t("hub.manageHub.appearance.ring")}</label>
                    <small id={f("ring-d")}>{t("hub.manageHub.appearance.ringHint")}</small>
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
                          <img src={`${apiBaseUrl}${server.bannerUrl}`} alt={t("hub.manageHub.media.banner.current")} />
                        ) : (
                          <span>{t("hub.manageHub.media.banner.none")}</span>
                        )}
                      </div>
                      <div className="dcx-row-copy">
                        <strong>{t("hub.manageHub.media.banner.title")}</strong>
                        <small>{t("hub.manageHub.media.banner.hint", { spec: hubMediaHintMessage("banner") })}</small>
                      </div>
                    </div>
                    <div className="dch-media-actions">
                      <FileButton
                        label={
                          props.mediaBusy
                            ? t("hub.manageHub.uploading")
                            : server.bannerUrl
                              ? t("hub.manageHub.media.change")
                              : t("hub.manageHub.media.banner.add")
                        }
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
                          {t("hub.manageHub.media.remove")}
                        </button>
                      )}
                      <span className="dch-media-spacer" />
                      <label htmlFor={f("bannerbg")} className="dch-media-show">
                        {t("hub.manageHub.media.show")}
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
                      {server.bannerUrl ? t("hub.manageHub.media.banner.on") : t("hub.manageHub.media.banner.off")}
                    </small>
                  </div>
                  <div className="dch-media-card">
                    <div className="dch-media-head">
                      <div className="dch-media-prev is-wide">
                        {server.headerUrl ? (
                          <img src={`${apiBaseUrl}${server.headerUrl}`} alt={t("hub.manageHub.media.header.current")} />
                        ) : (
                          <span>{t("hub.manageHub.media.header.none")}</span>
                        )}
                      </div>
                      <div className="dcx-row-copy">
                        <strong>{t("hub.manageHub.media.header.title")}</strong>
                        <small>{t("hub.manageHub.media.header.hint", { spec: hubMediaHintMessage("header") })}</small>
                      </div>
                    </div>
                    <div className="dch-media-actions">
                      <FileButton
                        label={
                          props.mediaBusy
                            ? t("hub.manageHub.uploading")
                            : server.headerUrl
                              ? t("hub.manageHub.media.change")
                              : t("hub.manageHub.media.header.add")
                        }
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        disabled={props.mediaBusy}
                        onFile={(file) => props.onUploadMedia("header", file)}
                      />
                      {server.headerUrl && (
                        <button
                          type="button"
                          className="dcx-btn dcx-btn-ghost dch-media-remove"
                          disabled={props.mediaBusy}
                          onClick={() => props.onRemoveMedia("header")}
                        >
                          {t("hub.manageHub.media.remove")}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="dch-media-card">
                    <div className="dch-media-head">
                      <div className="dch-media-prev is-wide">
                        {server.chatBackgroundUrl ? (
                          <img
                            src={`${apiBaseUrl}${server.chatBackgroundUrl}`}
                            alt={t("hub.manageHub.media.chat.current")}
                          />
                        ) : (
                          <span>{t("hub.manageHub.media.chat.none")}</span>
                        )}
                      </div>
                      <div className="dcx-row-copy">
                        <strong>{t("hub.manageHub.media.chat.title")}</strong>
                        <small>
                          {t("hub.manageHub.media.chat.hint", { spec: hubMediaHintMessage("chat-background") })}
                        </small>
                      </div>
                    </div>
                    <div className="dch-media-actions">
                      <FileButton
                        label={
                          props.mediaBusy
                            ? t("hub.manageHub.uploading")
                            : server.chatBackgroundUrl
                              ? t("hub.manageHub.media.change")
                              : t("hub.manageHub.media.chat.add")
                        }
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
                          {t("hub.manageHub.media.remove")}
                        </button>
                      )}
                      <span className="dch-media-spacer" />
                      <label htmlFor={f("chatbg")} className="dch-media-show">
                        {t("hub.manageHub.media.show")}
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
                      {server.chatBackgroundUrl ? t("hub.manageHub.media.chat.on") : t("hub.manageHub.media.chat.off")}
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
                <h4>{t("hub.manageHub.invites.title")}</h4>
                <p>{t("hub.manageHub.invites.description")}</p>
              </div>
              <div className="dcx-row-stack">
                <label className="dcx-sr-only" htmlFor={f("invite")}>
                  {t("hub.manageHub.invites.label")}
                </label>
                <div className="dch-invite">
                  <input
                    id={f("invite")}
                    className="dcx-input"
                    readOnly
                    value={props.inviteUrl}
                    placeholder={
                      props.inviteBusy ? t("hub.manageHub.invites.generating") : t("hub.manageHub.invites.placeholder")
                    }
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  {props.inviteUrl ? (
                    <button
                      type="button"
                      className="dcx-btn dcx-btn-primary"
                      disabled={props.inviteBusy}
                      onClick={props.onCopyInvite}
                    >
                      {t("hub.manageHub.invites.copy")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="dcx-btn dcx-btn-primary"
                      disabled={props.inviteBusy}
                      onClick={props.onCreateInvite}
                    >
                      {t("hub.manageHub.invites.generate")}
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
                      {t("hub.manageHub.invites.another")}
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
                    {t("hub.manageHub.createRoom")}
                  </button>
                </div>
              )}
              {rooms.length === 0 && <p className="dcx-hint">{t("hub.manageHub.rooms.empty")}</p>}
              {rooms.map((group) => (
                <section
                  className="dcx-card"
                  key={group.type}
                  aria-label={t(`hub.manageHub.rooms.groups.${group.type}`)}
                >
                  <div className="dcx-card-head">
                    <h4>{t(`hub.manageHub.rooms.groups.${group.type}`)}</h4>
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
                              {room.private ? t("hub.manageHub.rooms.private") : t("hub.manageHub.rooms.public")}
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
                              aria-label={t("hub.manageHub.rooms.moveUp", { name: room.name })}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="dcx-btn dcx-btn-ghost dcx-btn-sm"
                              disabled={index === group.items.length - 1}
                              onClick={() => props.onReorderRoom(room.id, group.items[index + 1].id)}
                              aria-label={t("hub.manageHub.rooms.moveDown", { name: room.name })}
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              className="dcx-btn dcx-btn-sm"
                              onClick={() => props.onOpenRoomSettings(room)}
                            >
                              {t("hub.manageHub.rooms.settings")}
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
                    <strong>{t("hub.manageHub.events.calendar")}</strong>
                    <small>{t("hub.manageHub.events.calendarHint")}</small>
                  </div>
                  <div className="dcx-row-control">
                    <button type="button" className="dcx-btn" onClick={props.onOpenCalendar}>
                      {t("hub.manageHub.openCalendar")}
                    </button>
                    <button type="button" className="dcx-btn dcx-btn-primary" onClick={props.onCreateEvent}>
                      {t("hub.manageHub.events.create")}
                    </button>
                  </div>
                </div>
              </section>
              <section className="dcx-card">
                <div className="dcx-card-head">
                  <h4>{t("hub.manageHub.events.whoTitle")}</h4>
                  <p>{t("hub.manageHub.events.whoDescription")}</p>
                </div>
                <div className="dcx-row-stack">
                  <div className="dcx-notice dcx-notice-info">{t("hub.manageHub.events.noPermission")}</div>
                </div>
              </section>
            </>
          )}

          {current.id === "moderation" && (
            <>
              <fieldset className="dch-fieldset" disabled={!canManage}>
                <legend className="dcx-sr-only">{t("hub.manageHub.moderation.legend")}</legend>
                <section className="dcx-card">
                  <div className="dcx-row">
                    <div className="dcx-row-copy">
                      <label htmlFor={f("slow")}>{t("hub.manageHub.moderation.slowMode")}</label>
                      <small id={f("slow-d")}>{t("hub.manageHub.moderation.slowModeHint")}</small>
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
                    <h4>{t("hub.manageHub.moderation.assets")}</h4>
                    <p>{t("hub.manageHub.moderation.assetsHint")}</p>
                  </div>
                  <div className="dcx-row-stack">
                    <div className="dch-quick">
                      <FileButton
                        label={t("hub.manageHub.moderation.uploadEmote")}
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        disabled={props.assetBusy}
                        onFile={(file) => props.onUploadAsset("emote", file)}
                      />
                      <FileButton
                        label={t("hub.manageHub.moderation.uploadSticker")}
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
                          <small>
                            {asset.kind === "emote"
                              ? t("hub.manageHub.moderation.emote")
                              : t("hub.manageHub.moderation.sticker")}
                          </small>
                        </div>
                      </div>
                      <div className="dcx-row-control">
                        <button
                          type="button"
                          className="dcx-btn dcx-btn-danger dcx-btn-sm"
                          onClick={() => props.onDeleteAsset(asset)}
                          aria-label={t("hub.manageHub.moderation.deleteAsset", { name: asset.name })}
                        >
                          {t("hub.manageHub.moderation.delete")}
                        </button>
                      </div>
                    </div>
                  ))}
                </section>
              )}
              <section className="dcx-card">
                <div className="dcx-row">
                  <div className="dcx-row-copy">
                    <strong>{t("hub.manageHub.moderation.audit")}</strong>
                    <small>{t("hub.manageHub.moderation.auditHint")}</small>
                  </div>
                  <div className="dcx-row-control">
                    <button type="button" className="dcx-btn dcx-btn-sm" onClick={props.onLoadAudit}>
                      {props.auditLog.length
                        ? t("hub.manageHub.moderation.refresh")
                        : t("hub.manageHub.moderation.loadAudit")}
                    </button>
                  </div>
                </div>
                {props.auditLog.slice(0, 20).map((entry) => (
                  <div className="dcx-row" key={entry.id}>
                    <div className="dcx-row-copy">
                      <strong>{entry.action}</strong>
                      {entry.detail && <small>{entry.detail}</small>}
                    </div>
                    <small className="dcx-hint">{formatDate(entry.timestamp, "dateTime")}</small>
                  </div>
                ))}
              </section>
            </>
          )}

          {current.id === "bots" &&
            (canManageBots ? (
              <BotsSection
                hubId={server.id}
                apiBaseUrl={apiBaseUrl}
                authorizedFetch={props.authorizedFetch}
                rooms={server.channels}
                roles={props.roles}
                showTokenBots={Boolean(props.botsPanel)}
                fallback={props.botsPanel ?? <p className="dcx-hint">{t("hub.manageHub.botsUnavailable")}</p>}
              />
            ) : (
              <p className="dcx-hint">{t("hub.manageHub.botsUnavailable")}</p>
            ))}

          {current.id === "danger" && isOwner && (
            <section className="dcx-card dch-danger">
              <div className="dcx-row">
                <div className="dcx-row-copy">
                  <strong>{t("hub.manageHub.danger.title")}</strong>
                  <small>{t("hub.manageHub.danger.description")}</small>
                </div>
                <div className="dcx-row-control">
                  <button type="button" className="dcx-btn dcx-btn-danger" onClick={() => setConfirmDelete(true)}>
                    {t("hub.manageHub.danger.delete")}
                  </button>
                </div>
              </div>
            </section>
          )}
        </main>
      </div>

      {confirmDelete && (
        <TypeToConfirmDialog
          title={t("hub.manageHub.danger.confirmTitle", { name: server.name })}
          description={t("hub.manageHub.danger.confirmDescription")}
          confirmText={server.name}
          actionLabel={t("hub.manageHub.danger.delete")}
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
