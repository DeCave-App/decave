import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icon, type IconName } from "../../components/Icon";
import { useDialogA11y } from "../shared/useDialogA11y";
import {
  getHubTemplate,
  getHubTemplateDefinitions,
  type HubTemplateId,
  type HubTemplateRoom,
} from "../../../shared/hub-templates";
import { templateCategoryName, templateDescription, templateName, templateRoomName } from "./templateText";
import "./createHub.css";

type Visibility = "private" | "public";

const TEMPLATE_ICONS: Partial<Record<HubTemplateId, IconName>> = {
  blank: "layout-dashboard",
  friends: "users",
  gaming: "gamepad",
  community: "globe",
  creator: "video",
  esports: "crown",
  development: "settings",
  support: "message",
  project: "calendar-days",
  streamer: "screen",
};

const VISIBILITY_OPTIONS: Array<{ value: Visibility; icon: IconName }> = [
  { value: "private", icon: "lock" },
  { value: "public", icon: "globe" },
];

const ICON_LIMIT = 3 * 1024 * 1024;

function roomIcon(room: HubTemplateRoom): IconName {
  if (room.type === "voice") return "volume";
  if (room.type === "forum") return "forum";
  return "hash";
}

export type CreateHubModalProps = {
  name: string;
  onNameChange: (value: string) => void;
  visibility: Visibility;
  onVisibilityChange: (value: Visibility) => void;
  template: HubTemplateId;
  onTemplateChange: (value: HubTemplateId) => void;
  streamerHubsEnabled: boolean;
  error: string;
  busy?: boolean;
  /** Optional extra section (Discord structure import). */
  importSlot?: ReactNode;
  onCancel: () => void;
  onCreate: (iconFile: File | null) => void;
};

export function CreateHubModal(props: CreateHubModalProps) {
  const { t } = useTranslation(["hub"]);
  const uid = useId();
  const f = (suffix: string) => `${uid}-${suffix}`;
  const dialogRef = useDialogA11y<HTMLDivElement>(props.onCancel);
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [iconError, setIconError] = useState("");
  const iconPreview = useMemo(() => (iconFile ? URL.createObjectURL(iconFile) : ""), [iconFile]);
  useEffect(
    () => () => {
      if (iconPreview) URL.revokeObjectURL(iconPreview);
    },
    [iconPreview],
  );

  const definitions = getHubTemplateDefinitions(props.streamerHubsEnabled);
  const selected = getHubTemplate(props.template, props.streamerHubsEnabled);
  const groups = selected.rooms.reduce<Record<string, HubTemplateRoom[]>>((acc, room) => {
    (acc[room.category] ??= []).push(room);
    return acc;
  }, {});
  const counts = {
    text: selected.rooms.filter((room) => room.type === "text").length,
    voice: selected.rooms.filter((room) => room.type === "voice").length,
    forum: selected.rooms.filter((room) => room.type === "forum").length,
  };
  const trimmed = props.name.trim();
  const initials = trimmed
    ? trimmed
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? "")
        .join("")
    : "";

  const pickIcon = (file: File | undefined) => {
    setIconError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setIconError(t("hub.createHub.iconWrongType"));
      return;
    }
    if (file.size > ICON_LIMIT) {
      setIconError(t("hub.createHub.iconTooLarge"));
      return;
    }
    setIconFile(file);
  };

  const submit = () => {
    if (trimmed && !props.busy) props.onCreate(iconFile);
  };

  return (
    <div className="modal-overlay chm-overlay" onClick={props.onCancel}>
      <div
        ref={dialogRef}
        className="chm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={f("title")}
        aria-describedby={f("desc")}
        data-dc-dialog="open"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="chm-head">
          <div>
            <span className="ds-kicker">{t("hub.createHub.kicker")}</span>
            <h2 id={f("title")}>{t("hub.createHub.title")}</h2>
            <p id={f("desc")}>{t("hub.createHub.intro")}</p>
          </div>
          <button
            type="button"
            className="ds-btn ds-btn-ghost ds-icon-btn"
            aria-label={t("hub.createHub.close")}
            onClick={props.onCancel}
          >
            <Icon name="close" />
          </button>
        </header>

        <div className="chm-body">
          <section className="chm-col chm-basics" aria-labelledby={f("basics")}>
            <h3 id={f("basics")} className="chm-section-title">
              <span>1</span>
              {t("hub.createHub.basics")}
            </h3>

            <div className="chm-identity">
              <label className="chm-icon-picker" htmlFor={f("icon")} title={t("hub.createHub.uploadIcon")}>
                {iconPreview ? (
                  <img src={iconPreview} alt={t("hub.createHub.iconPreview")} />
                ) : (
                  <span aria-hidden="true">{initials || <Icon name="image" />}</span>
                )}
                <i aria-hidden="true">
                  <Icon name="camera" size="sm" />
                </i>
              </label>
              <input
                id={f("icon")}
                className="chm-visually-hidden"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                aria-describedby={f("icon-d")}
                onChange={(event) => {
                  pickIcon(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              <div className="chm-field">
                <label htmlFor={f("name")}>{t("hub.createHub.nameLabel")}</label>
                <input
                  id={f("name")}
                  className="ds-input"
                  type="text"
                  placeholder={t("hub.createHub.namePlaceholder")}
                  value={props.name}
                  maxLength={40}
                  autoFocus
                  onChange={(event) => props.onNameChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") submit();
                  }}
                />
                <small id={f("icon-d")}>
                  {iconFile ? (
                    <>
                      {t("hub.createHub.iconFile", { name: iconFile.name })} ·{" "}
                      <button type="button" className="chm-link" onClick={() => setIconFile(null)}>
                        {t("hub.createHub.removeIcon")}
                      </button>
                    </>
                  ) : (
                    t("hub.createHub.iconHint")
                  )}
                </small>
                {iconError && (
                  <small className="chm-error" role="alert">
                    {iconError}
                  </small>
                )}
              </div>
            </div>

            <fieldset className="chm-visibility">
              <legend>{t("hub.createHub.whoCanJoin")}</legend>
              {VISIBILITY_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={`chm-choice${props.visibility === option.value ? " is-selected" : ""}`}
                >
                  <input
                    type="radio"
                    name={f("visibility")}
                    value={option.value}
                    checked={props.visibility === option.value}
                    onChange={() => props.onVisibilityChange(option.value)}
                  />
                  <span className="chm-choice-icon" aria-hidden="true">
                    <Icon name={option.icon} />
                  </span>
                  <span className="chm-choice-copy">
                    <strong>{t(`hub.createHub.visibility.${option.value}.title`)}</strong>
                    <small>{t(`hub.createHub.visibility.${option.value}.description`)}</small>
                  </span>
                  <span className="chm-choice-check" aria-hidden="true">
                    <Icon name="check" size="sm" />
                  </span>
                </label>
              ))}
            </fieldset>

            {props.importSlot && (
              <details className="chm-import">
                <summary>{t("hub.createHub.importDiscord")}</summary>
                {props.importSlot}
              </details>
            )}
          </section>

          <section className="chm-col chm-templates" aria-labelledby={f("tpl")}>
            <h3 id={f("tpl")} className="chm-section-title">
              <span>2</span>
              {t("hub.createHub.startingTemplate")}
            </h3>
            <div className="chm-template-grid" role="radiogroup" aria-labelledby={f("tpl")}>
              {definitions.map((option) => {
                const isSelected = option.id === selected.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    aria-label={t("hub.createHub.templateAria", {
                      name: templateName(option),
                      description: templateDescription(option),
                      count: option.rooms.length,
                    })}
                    className={`chm-template${isSelected ? " is-selected" : ""}`}
                    onClick={() => props.onTemplateChange(option.id)}
                  >
                    <span className="chm-template-icon" aria-hidden="true">
                      <Icon name={TEMPLATE_ICONS[option.id] ?? "layout-dashboard"} />
                    </span>
                    <span className="chm-template-copy">
                      <strong>{templateName(option)}</strong>
                      <small>{t("hub.createHub.roomCount", { count: option.rooms.length })}</small>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="chm-preview" aria-live="polite">
              <div className="chm-preview-head">
                <div>
                  <span className="ds-kicker">{t("hub.createHub.whatYouGet")}</span>
                  <strong>{templateName(selected)}</strong>
                  <p>{templateDescription(selected)}</p>
                </div>
                <div className="chm-preview-stats" aria-label={t("hub.createHub.previewStats", counts)}>
                  {counts.text > 0 && (
                    <span>
                      <Icon name="hash" size="sm" />
                      {counts.text}
                    </span>
                  )}
                  {counts.voice > 0 && (
                    <span>
                      <Icon name="volume" size="sm" />
                      {counts.voice}
                    </span>
                  )}
                  {counts.forum > 0 && (
                    <span>
                      <Icon name="forum" size="sm" />
                      {counts.forum}
                    </span>
                  )}
                </div>
              </div>
              <div className="chm-preview-rail">
                {Object.entries(groups).map(([category, rooms]) => (
                  <div key={category} className="chm-preview-group">
                    <small>{templateCategoryName(category)}</small>
                    <ul>
                      {rooms.map((room) => (
                        <li key={`${category}-${room.type}-${room.name}`}>
                          <Icon name={roomIcon(room)} size="sm" />
                          <span>{templateRoomName(room.name)}</span>
                          {room.private && <Icon name="lock" size="sm" title={t("hub.createHub.privateRoom")} />}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        <footer className="chm-foot">
          {props.error ? (
            <p className="ds-notice dc-modal-error chm-foot-error" role="alert">
              {props.error}
            </p>
          ) : (
            <span className="chm-foot-summary">
              {trimmed ? (
                <>
                  <strong>{trimmed}</strong> · {t(`hub.createHub.visibility.${props.visibility}.title`)} ·{" "}
                  {templateName(selected)}
                </>
              ) : (
                t("hub.createHub.enterName")
              )}
            </span>
          )}
          <div className="ds-modal-actions">
            <button type="button" className="ds-btn" onClick={props.onCancel}>
              {t("hub.createHub.cancel")}
            </button>
            <button type="button" className="ds-btn ds-btn-primary" disabled={!trimmed || props.busy} onClick={submit}>
              <Icon name="plus" />
              {props.busy ? t("hub.createHub.creating") : t("hub.createHub.create")}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
