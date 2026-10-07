import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Icon, type IconName } from "../../components/Icon";
import { useDialogA11y } from "../shared/useDialogA11y";
import {
  getHubTemplate,
  getHubTemplateDefinitions,
  type HubTemplateId,
  type HubTemplateRoom,
} from "../../../shared/hub-templates";
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

const VISIBILITY_OPTIONS: Array<{ value: Visibility; icon: IconName; title: string; description: string }> = [
  { value: "private", icon: "lock", title: "Private", description: "Only people you invite or grant access can join." },
  { value: "public", icon: "globe", title: "Public", description: "Listed in Discover so anyone can find and join." },
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
      setIconError("Choose a PNG, JPG, WebP or GIF image.");
      return;
    }
    if (file.size > ICON_LIMIT) {
      setIconError("Icon must be 3 MB or smaller.");
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
            <span className="ds-kicker">New Hub</span>
            <h2 id={f("title")}>Create a Hub</h2>
            <p id={f("desc")}>
              Name it, pick who can join, and choose a starting layout. You will be the owner, and everything can be
              changed later.
            </p>
          </div>
          <button type="button" className="ds-btn ds-btn-ghost ds-icon-btn" aria-label="Close" onClick={props.onCancel}>
            <Icon name="close" />
          </button>
        </header>

        <div className="chm-body">
          <section className="chm-col chm-basics" aria-labelledby={f("basics")}>
            <h3 id={f("basics")} className="chm-section-title">
              <span>1</span>Basics
            </h3>

            <div className="chm-identity">
              <label className="chm-icon-picker" htmlFor={f("icon")} title="Upload Hub icon">
                {iconPreview ? (
                  <img src={iconPreview} alt="Hub icon preview" />
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
                <label htmlFor={f("name")}>Hub name</label>
                <input
                  id={f("name")}
                  className="ds-input"
                  type="text"
                  placeholder="e.g. Friday Night Squad"
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
                      Icon: {iconFile.name} ·{" "}
                      <button type="button" className="chm-link" onClick={() => setIconFile(null)}>
                        Remove
                      </button>
                    </>
                  ) : (
                    "Optional icon: square PNG, JPG, WebP or GIF up to 3 MB."
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
              <legend>Who can join</legend>
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
                    <strong>{option.title}</strong>
                    <small>{option.description}</small>
                  </span>
                  <span className="chm-choice-check" aria-hidden="true">
                    <Icon name="check" size="sm" />
                  </span>
                </label>
              ))}
            </fieldset>

            {props.importSlot && (
              <details className="chm-import">
                <summary>Import structure from a Discord template</summary>
                {props.importSlot}
              </details>
            )}
          </section>

          <section className="chm-col chm-templates" aria-labelledby={f("tpl")}>
            <h3 id={f("tpl")} className="chm-section-title">
              <span>2</span>Starting template
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
                    aria-label={`${option.name} template: ${option.description} ${option.rooms.length} rooms.`}
                    className={`chm-template${isSelected ? " is-selected" : ""}`}
                    onClick={() => props.onTemplateChange(option.id)}
                  >
                    <span className="chm-template-icon" aria-hidden="true">
                      <Icon name={TEMPLATE_ICONS[option.id] ?? "layout-dashboard"} />
                    </span>
                    <span className="chm-template-copy">
                      <strong>{option.name}</strong>
                      <small>{option.rooms.length} rooms</small>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="chm-preview" aria-live="polite">
              <div className="chm-preview-head">
                <div>
                  <span className="ds-kicker">What you get</span>
                  <strong>{selected.name}</strong>
                  <p>{selected.description}</p>
                </div>
                <div
                  className="chm-preview-stats"
                  aria-label={`${counts.text} text, ${counts.voice} voice, ${counts.forum} forum rooms`}
                >
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
                    <small>{category}</small>
                    <ul>
                      {rooms.map((room) => (
                        <li key={`${category}-${room.type}-${room.name}`}>
                          <Icon name={roomIcon(room)} size="sm" />
                          <span>{room.name}</span>
                          {room.private && <Icon name="lock" size="sm" title="Private room" />}
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
                  <strong>{trimmed}</strong> · {props.visibility === "public" ? "Public" : "Private"} · {selected.name}
                </>
              ) : (
                "Enter a name to continue."
              )}
            </span>
          )}
          <div className="ds-modal-actions">
            <button type="button" className="ds-btn" onClick={props.onCancel}>
              Cancel
            </button>
            <button type="button" className="ds-btn ds-btn-primary" disabled={!trimmed || props.busy} onClick={submit}>
              <Icon name="plus" />
              {props.busy ? "Creating…" : "Create Hub"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
