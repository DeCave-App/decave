import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Icon } from "../../components/Icon";
import {
  HUB_HOME_LIMITS,
  HUB_HOME_SECTION_LABELS,
  hubRulesList,
  moveHubHomeSection,
  normalizeHubHomeConfig,
  type HubHomeConfig,
  type HubHomeSectionId,
} from "../../../shared/hub-home";
import "./hubHome.css";
import { localeForLanguage, preferredTimeOptions } from "../../app/locale";

export type HubHomePerson = { id: string; name: string; avatar: ReactNode; speaking?: boolean };

export type HubHomeLiveRoom = {
  roomId: number;
  name: string;
  icon?: string;
  people: HubHomePerson[];
  sharing: boolean;
  /** The viewer is connected to this room. */
  connected: boolean;
};

export type HubHomeEvent = {
  key: string;
  title: string;
  start: number;
  roomName?: string;
  going: number;
  myRsvp: "going" | "maybe" | "declined" | null;
};

export type HubHomeCatchUp = {
  roomId: number;
  name: string;
  icon?: string;
  kind: "text" | "forum";
  unread: number;
  mentions: number;
  /** Optional second line, e.g. the newest forum thread. */
  detail?: string;
};

export type HubHomeProps = {
  name: string;
  icon: ReactNode;
  bannerUrl?: string | null;
  accent?: string;
  description?: string;
  category?: string;
  tags: readonly string[];
  visibility: "public" | "private" | string;
  memberCount: number | null;
  onlineCount: number | null;
  /** Hide member counts and faces (official Hubs with private membership). */
  membershipPrivate: boolean;
  roleLabel?: string;
  /** Saved layout, Welcome message and Rules for this Hub. */
  home: HubHomeConfig;
  live: HubHomeLiveRoom[];
  events: HubHomeEvent[];
  catchUp: HubHomeCatchUp[];
  members: HubHomePerson[];
  friendsHere: number;
  muted: boolean;
  canManage: boolean;
  /** Owners and admins can customize Hub Home for everyone. */
  canCustomize: boolean;
  canCreateEvents: boolean;
  now?: number;
  onSaveHome: (config: HubHomeConfig) => Promise<void>;
  onOpenRoom: (roomId: number) => void;
  onJoinVoice: (roomId: number) => void;
  onOpenEvent: (key: string) => void;
  onOpenCalendar: () => void;
  onCreateEvent: () => void;
  onInvite: () => void;
  onManage: () => void;
  onToggleMute: () => void;
  onMarkAllRead: () => void;
  onOpenMembers: () => void;
  /** Owners/admins: the setup checklist, given a way to open Customize. */
  ownerTools?: (tools: { customize: () => void }) => ReactNode;
  /** Owners/admins: open Hub insights. */
  onOpenInsights?: () => void;
};

export function formatCountdown(start: number, now: number): string {
  const diff = start - now;
  if (diff <= 0) return "Happening now";
  const minutes = Math.round(diff / 60000);
  if (minutes < 60) return `In ${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `In ${hours}h ${minutes % 60}m`;
  const days = Math.round(hours / 24);
  return days === 1 ? "Tomorrow" : `In ${days} days`;
}

function formatWhen(start: number): string {
  const date = new Date(start);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(localeForLanguage(), {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    ...preferredTimeOptions(),
  }).format(date);
}

function count(value: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value).toLocaleString() : "—";
}

function sameConfig(a: HubHomeConfig, b: HubHomeConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function HubHome(props: HubHomeProps) {
  const now = props.now ?? Date.now();
  const nextEvent = props.events[0] ?? null;
  const joinable = props.live.find((room) => !room.connected) ?? null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<HubHomeConfig>(props.home);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Follow saved changes (e.g. another admin edited Home) while not editing.
  useEffect(() => {
    if (!editing) setDraft(props.home);
  }, [props.home, editing]);

  const config = editing ? draft : props.home;
  const dirty = editing && !sameConfig(normalizeHubHomeConfig(draft), props.home);
  const bannerStyle = {
    "--hh-accent": props.accent || "var(--ds-accent)",
    ...(props.bannerUrl ? { "--hh-banner": `url("${props.bannerUrl.replace(/"/g, "%22")}")` } : {}),
  } as CSSProperties;

  const startEditing = () => {
    setDraft(props.home);
    setSaveError("");
    setEditing(true);
  };
  const cancelEditing = () => {
    setDraft(props.home);
    setSaveError("");
    setEditing(false);
  };
  const save = async () => {
    setSaving(true);
    setSaveError("");
    try {
      await props.onSaveHome(normalizeHubHomeConfig(draft));
      setEditing(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save Hub Home.");
    } finally {
      setSaving(false);
    }
  };
  const setVisible = (id: HubHomeSectionId, visible: boolean) =>
    setDraft((current) => ({
      ...current,
      sections: current.sections.map((section) => (section.id === id ? { ...section, visible } : section)),
    }));
  const move = (id: HubHomeSectionId, delta: -1 | 1) =>
    setDraft((current) => ({ ...current, sections: moveHubHomeSection(current.sections, id, delta) }));

  const rules = hubRulesList(config.rules);

  /** Content of each section, or null when it has nothing to show (view mode hides it). */
  const sectionBody = (id: HubHomeSectionId): ReactNode | null => {
    switch (id) {
      case "welcome":
        if (editing) {
          return (
            <div className="hh-editor">
              <label className="hh-sr" htmlFor="hh-welcome-input">
                Welcome message
              </label>
              <textarea
                id="hh-welcome-input"
                className="hh-textarea"
                rows={4}
                maxLength={HUB_HOME_LIMITS.welcome}
                value={draft.welcome}
                placeholder="Say hello, explain what this Hub is for, and where new people should start."
                onChange={(event) => setDraft((current) => ({ ...current, welcome: event.target.value }))}
              />
              <small className="hh-count">
                {draft.welcome.length}/{HUB_HOME_LIMITS.welcome}
              </small>
            </div>
          );
        }
        return config.welcome ? <p className="hh-welcome-text">{config.welcome}</p> : null;
      case "rules":
        if (editing) {
          return (
            <div className="hh-editor">
              <label className="hh-sr" htmlFor="hh-rules-input">
                Rules, one per line
              </label>
              <textarea
                id="hh-rules-input"
                className="hh-textarea"
                rows={6}
                maxLength={HUB_HOME_LIMITS.rules}
                value={draft.rules}
                placeholder={"Be decent. No harassment.\nClips go in the clips room.\nMic required for ranked squads."}
                onChange={(event) => setDraft((current) => ({ ...current, rules: event.target.value }))}
              />
              <small className="hh-count">One rule per line · up to {HUB_HOME_LIMITS.ruleLines} rules</small>
            </div>
          );
        }
        return rules.length ? (
          <ol className="hh-rules">
            {rules.map((rule, index) => (
              <li key={`${index}-${rule}`}>{rule}</li>
            ))}
          </ol>
        ) : null;
      case "now":
        return (
          <div className="hh-now">
            {props.live.map((room) => (
              <article key={room.roomId} className="hh-now-card live">
                <span className="hh-tag">● Live voice</span>
                <strong>
                  {room.icon ? `${room.icon} ` : ""}
                  {room.name}
                </strong>
                <small>
                  {room.people
                    .slice(0, 3)
                    .map((person) => person.name)
                    .join(", ")}
                  {room.people.length > 3 ? ` and ${room.people.length - 3} more` : ""}
                  {room.sharing ? " · sharing screen" : ""}
                </small>
                <div className="hh-now-foot">
                  <span className="hh-faces">
                    {room.people.slice(0, 5).map((person) => (
                      <span
                        key={person.id}
                        className={`hh-face${person.speaking ? " speaking" : ""}`}
                        title={person.name}
                      >
                        {person.avatar}
                      </span>
                    ))}
                  </span>
                  {room.connected ? (
                    <button type="button" className="hh-btn sm" onClick={() => props.onOpenRoom(room.roomId)}>
                      Open
                    </button>
                  ) : (
                    <button type="button" className="hh-btn sm primary" onClick={() => props.onJoinVoice(room.roomId)}>
                      Join
                    </button>
                  )}
                </div>
              </article>
            ))}
            {nextEvent && (
              <article className="hh-now-card event">
                <span className="hh-tag">Next event · {formatCountdown(nextEvent.start, now)}</span>
                <strong>{nextEvent.title}</strong>
                <small>
                  {formatWhen(nextEvent.start)}
                  {nextEvent.roomName ? ` · ${nextEvent.roomName}` : ""} · {nextEvent.going} going
                </small>
                <div className="hh-now-foot">
                  <span className="hh-rsvp">
                    {nextEvent.myRsvp === "going"
                      ? "You're going"
                      : nextEvent.myRsvp === "maybe"
                        ? "You said maybe"
                        : "No reply yet"}
                  </span>
                  <button type="button" className="hh-btn sm" onClick={() => props.onOpenEvent(nextEvent.key)}>
                    Details
                  </button>
                </div>
              </article>
            )}
            {props.live.length === 0 && !nextEvent && (
              <div className="hh-empty">
                <strong>It's quiet right now</strong>
                <span>Nobody is in voice and nothing is scheduled.</span>
                {props.canCreateEvents && (
                  <button type="button" className="hh-btn sm" onClick={props.onCreateEvent}>
                    <Icon name="calendar" size="sm" />
                    Schedule an event
                  </button>
                )}
              </div>
            )}
          </div>
        );
      case "catchUp":
        return props.catchUp.length > 0 ? (
          <ul className="hh-list">
            {props.catchUp.map((item) => (
              <li key={item.roomId}>
                <button type="button" className="hh-row" onClick={() => props.onOpenRoom(item.roomId)}>
                  <span className="hh-row-icon" aria-hidden="true">
                    {item.icon || <Icon name={item.kind === "forum" ? "forum" : "hash"} size="sm" />}
                  </span>
                  <span className="hh-row-copy">
                    <strong>{item.name}</strong>
                    <small>
                      {item.detail ||
                        (item.mentions > 0
                          ? `${item.mentions} mention${item.mentions === 1 ? "" : "s"}`
                          : item.unread > 0
                            ? `${item.unread} new message${item.unread === 1 ? "" : "s"}`
                            : "New activity")}
                    </small>
                  </span>
                  {item.mentions > 0 ? (
                    <b className="hh-badge">{item.mentions > 99 ? "99+" : item.mentions}</b>
                  ) : item.unread > 0 ? (
                    <b className="hh-badge soft">{item.unread > 99 ? "99+" : item.unread}</b>
                  ) : (
                    <i className="hh-dot" aria-hidden="true" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hh-quiet">You're all caught up. New messages in this Hub show up here.</p>
        );
      case "about":
        return (
          <>
            <p className="hh-about">
              {props.description?.trim() ||
                (props.canManage
                  ? "Add a description in Manage Hub so new members know what this Hub is for."
                  : "This Hub has not added a description yet.")}
            </p>
            {props.tags.length > 0 && (
              <div className="hh-tags">
                {props.tags.slice(0, 8).map((tag) => (
                  <span key={tag}>#{tag}</span>
                ))}
              </div>
            )}
          </>
        );
      case "events":
        return props.events.length > 0 ? (
          <ul className="hh-list">
            {props.events.slice(0, 4).map((event) => {
              const date = new Date(event.start);
              return (
                <li key={event.key}>
                  <button type="button" className="hh-row" onClick={() => props.onOpenEvent(event.key)}>
                    <span className="hh-date" aria-hidden="true">
                      <b>{date.getDate()}</b>
                      <small>{date.toLocaleString(localeForLanguage(), { month: "short" })}</small>
                    </span>
                    <span className="hh-row-copy">
                      <strong>{event.title}</strong>
                      <small>
                        {formatWhen(event.start)} · {event.going} going
                      </small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="hh-quiet">
            No upcoming events.
            {props.canCreateEvents && (
              <>
                {" "}
                <button type="button" className="hh-link" onClick={props.onCreateEvent}>
                  Schedule one
                </button>
              </>
            )}
          </p>
        );
      case "members":
        if (props.membershipPrivate)
          return editing ? <p className="hh-quiet">Hidden: this Hub keeps its member list private.</p> : null;
        return (
          <div className="hh-members">
            <span className="hh-faces big">
              {props.members.slice(0, 8).map((person) => (
                <span key={person.id} className="hh-face" title={person.name}>
                  {person.avatar}
                </span>
              ))}
            </span>
            <small>
              {count(props.onlineCount)} online
              {props.friendsHere > 0 ? ` · ${props.friendsHere} friend${props.friendsHere === 1 ? "" : "s"} here` : ""}
            </small>
          </div>
        );
      default:
        return null;
    }
  };

  const headerLink = (id: HubHomeSectionId): ReactNode => {
    if (editing) return null;
    if (id === "catchUp" && props.catchUp.length > 0)
      return (
        <button type="button" className="hh-link" onClick={props.onMarkAllRead}>
          Mark all read
        </button>
      );
    if (id === "about" && props.canManage)
      return (
        <button type="button" className="hh-link" onClick={props.onManage}>
          Edit
        </button>
      );
    if ((id === "welcome" || id === "rules") && props.canCustomize)
      return (
        <button type="button" className="hh-link" onClick={startEditing}>
          Edit
        </button>
      );
    if (id === "events")
      return (
        <button type="button" className="hh-link" onClick={props.onOpenCalendar}>
          Calendar
        </button>
      );
    if (id === "members" && !props.membershipPrivate)
      return (
        <button type="button" className="hh-link" onClick={props.onOpenMembers}>
          See all
        </button>
      );
    return null;
  };

  const sectionTitle = (id: HubHomeSectionId): string =>
    id === "catchUp" && props.catchUp.length ? `Catch up · ${props.catchUp.length}` : HUB_HOME_SECTION_LABELS[id].title;

  const visibleSections = config.sections.filter((section) => editing || section.visible);
  const rendered = visibleSections.flatMap((section, index) => {
    const body = sectionBody(section.id);
    if (!editing && body === null) return [];
    const position = config.sections.findIndex((item) => item.id === section.id);
    return [
      <section
        key={section.id}
        className={`hh-card hh-card--${section.id}${!section.visible ? " is-hidden" : ""}${editing ? " is-editing" : ""}`}
        aria-labelledby={`hh-${section.id}`}
        data-section={section.id}
        style={{ ["--hh-order" as string]: index }}
      >
        <div className="hh-card-head">
          <h2 id={`hh-${section.id}`}>{sectionTitle(section.id)}</h2>
          {headerLink(section.id)}
          {editing && (
            <div className="hh-edit-tools">
              <button
                type="button"
                className="hh-tool"
                onClick={() => move(section.id, -1)}
                disabled={position <= 0}
                aria-label={`Move ${HUB_HOME_SECTION_LABELS[section.id].title} up`}
                title="Move up"
              >
                <Icon name="chevron-up" size="sm" />
              </button>
              <button
                type="button"
                className="hh-tool"
                onClick={() => move(section.id, 1)}
                disabled={position >= config.sections.length - 1}
                aria-label={`Move ${HUB_HOME_SECTION_LABELS[section.id].title} down`}
                title="Move down"
              >
                <Icon name="chevron-down" size="sm" />
              </button>
              <label className="hh-show">
                <input
                  type="checkbox"
                  checked={section.visible}
                  onChange={(event) => setVisible(section.id, event.target.checked)}
                />
                <span>{section.visible ? "Shown" : "Hidden"}</span>
              </label>
            </div>
          )}
        </div>
        {editing && <p className="hh-hint">{HUB_HOME_SECTION_LABELS[section.id].hint}</p>}
        {(!editing || section.visible || section.id === "welcome" || section.id === "rules") && body}
      </section>,
    ];
  });

  return (
    <section className={`hh-root${editing ? " is-editing" : ""}`} aria-label={`${props.name} Hub Home`}>
      <header className={`hh-banner${props.bannerUrl ? " has-image" : ""}`} style={bannerStyle}>
        <div className="hh-identity">
          <div className="hh-avatar" aria-hidden="true">
            {props.icon}
          </div>
          <div className="hh-title">
            <span className="hh-kicker">Hub Home{props.category ? ` · ${props.category}` : ""}</span>
            <h1>{props.name}</h1>
            <p className="hh-stats">
              {props.membershipPrivate ? (
                <span>
                  <Icon name="lock" size="sm" />
                  Membership private
                </span>
              ) : (
                <>
                  <span>
                    <i className="hh-online" aria-hidden="true" />
                    {count(props.onlineCount)} online
                  </span>
                  <span>{count(props.memberCount)} members</span>
                </>
              )}
              <span>{props.visibility === "private" ? "Private" : "Public"}</span>
              {props.roleLabel && <span>{props.roleLabel}</span>}
            </p>
          </div>
        </div>
        <div className="hh-actions">
          <button type="button" className="hh-btn ghost" onClick={props.onToggleMute} aria-pressed={props.muted}>
            <Icon name="bell" size="sm" />
            {props.muted ? "Muted" : "Notifications on"}
          </button>
          <button type="button" className="hh-btn" onClick={props.onInvite}>
            <Icon name="user-plus" size="sm" />
            Invite
          </button>
          {props.canCustomize && !editing && props.onOpenInsights && (
            <button type="button" className="hh-btn" onClick={props.onOpenInsights}>
              <Icon name="bar-chart" size="sm" />
              Insights
            </button>
          )}
          {props.canCustomize && !editing && (
            <button type="button" className="hh-btn" onClick={startEditing}>
              <Icon name="sliders" size="sm" />
              Customize
            </button>
          )}
          {joinable && !editing && (
            <button type="button" className="hh-btn primary" onClick={() => props.onJoinVoice(joinable.roomId)}>
              <Icon name="mic" size="sm" />
              Join {joinable.name}
            </button>
          )}
        </div>
      </header>

      {editing && (
        <div className="hh-editbar" role="region" aria-label="Customize Hub Home">
          <div>
            <strong>Customize Hub Home</strong>
            <span>Choose which sections everyone sees and in what order. Catch up is different for each member.</span>
            {saveError && (
              <span className="hh-error" role="alert">
                {saveError}
              </span>
            )}
          </div>
          <div className="hh-editbar-actions">
            <button type="button" className="hh-btn" onClick={cancelEditing} disabled={saving}>
              Cancel
            </button>
            <button type="button" className="hh-btn primary" onClick={() => void save()} disabled={saving || !dirty}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}

      {props.canCustomize && !editing && props.ownerTools?.({ customize: startEditing })}

      <div className="hh-sections">{rendered}</div>
      {!editing && rendered.length === 0 && (
        <p className="hh-quiet hh-nothing">
          {props.canCustomize
            ? "Every section is hidden. Use Customize to show some."
            : "This Hub has not set up its Home yet."}
        </p>
      )}
    </section>
  );
}
