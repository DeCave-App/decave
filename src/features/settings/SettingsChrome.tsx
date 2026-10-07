import { useEffect, useMemo } from "react";
import "../shared/shared.css";
import "./settings.css";

export type SettingsSectionMeta = { id: string; label: string; description?: string };

type GroupDef = { id: string; label: string; items: string[] };

/** Grouping of the user settings sections in the left navigation. */
export const SETTINGS_GROUPS: GroupDef[] = [
  { id: "user", label: "User", items: ["profile", "account", "privacy", "activity"] },
  { id: "app", label: "App", items: ["appearance", "notifications", "sounds", "voice", "keybinds", "language"] },
  { id: "more", label: "System & support", items: ["system", "support"] },
];

/** Extra search terms so the search box finds settings inside sections. */
const SECTION_KEYWORDS: Record<string, string> = {
  profile:
    "avatar photo picture banner header bio about status custom display name nickname pronouns accent color preview",
  account:
    "username email phone password two-factor 2fa mfa authenticator totp recovery codes sessions devices signed in last active sign out log out sign-in alerts new device login email export download data gdpr delete disable account decave id",
  privacy:
    "dm direct messages friends only friend requests block blocked unblock typing indicator stream preview streamer mode obs streamlabs automatic reports trust safety age notification preview",
  activity:
    "game playing rich presence steam epic detect excluded games who can see visibility friends nobody everyone",
  appearance:
    "theme skin dark light mode system automatic follow text size scale zoom font motion animation reduce compact cozy density contrast high underline links alt text image description accessibility",
  notifications:
    "desktop alerts mentions dms groups friend requests quiet hours schedule night do not disturb mute muted hubs rooms all messages nothing per hub per room preset permission",
  sounds: "ui sound theme message sent received voice join leave mute deafen screen share preview",
  voice:
    "microphone mic input speaker headset output volume test speakers camera webcam video preview push to talk noise suppression echo gain sensitivity threshold per-person user volume diagnostics",
  keybinds: "shortcuts keyboard hotkeys push to talk mute deafen ctrl k inbox",
  language: "date time format 12h 24h clock region locale language",
  system: "startup start with windows macos login autostart tray menu bar updates desktop version overlay",
  support: "help bug report contact email about version whats new patch notes changelog platform",
};

/** Sections that are saved through the shared Save button and can be reset. */
export const SAVEABLE_SETTINGS_SECTIONS = [
  "appearance",
  "notifications",
  "sounds",
  "privacy",
  "voice",
  "activity",
  "language",
];

export function filterSettingsSections(sections: readonly SettingsSectionMeta[], query: string): SettingsSectionMeta[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...sections];
  const terms = q.split(/\s+/);
  return sections.filter((section) => {
    const haystack =
      `${section.label} ${section.description ?? ""} ${SECTION_KEYWORDS[section.id] ?? ""}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

type SettingsHeaderProps = { username: string; onClose: () => void };

export function SettingsHeader({ username, onClose }: SettingsHeaderProps) {
  return (
    <div className="dc-settings-header dcs-header">
      <div>
        <h2 id="dcs-settings-title">Settings</h2>
        <p>
          Signed in as <strong>{username}</strong>
        </p>
      </div>
      <button
        type="button"
        className="dcx-btn dcx-btn-ghost dcs-close"
        onClick={onClose}
        title="Close settings (Esc)"
        aria-label="Close settings"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

type SettingsNavProps = {
  sections: readonly SettingsSectionMeta[];
  activeId: string;
  query: string;
  onQueryChange: (value: string) => void;
  onSelect: (id: string) => void;
  dirty: boolean;
};

/**
 * Grouped settings navigation with search. Reuses the legacy
 * `dc-studio-settings-index` class so the existing shell grid places it in
 * the left column; on narrow windows it collapses into scrollable tabs.
 */
export function SettingsNav({ sections, activeId, query, onQueryChange, onSelect, dirty }: SettingsNavProps) {
  const visible = useMemo(() => filterSettingsSections(sections, query), [sections, query]);
  const visibleIds = visible.map((section) => section.id).join(",");

  // When search hides the active section, jump to the first match.
  useEffect(() => {
    if (!query.trim() || !visible.length) return;
    if (!visible.some((section) => section.id === activeId)) onSelect(visible[0].id);
  }, [visibleIds, query]);

  const byId = new Map(visible.map((section) => [section.id, section]));
  const grouped = SETTINGS_GROUPS.map((group) => ({
    ...group,
    sections: group.items.map((id) => byId.get(id)).filter((item): item is SettingsSectionMeta => Boolean(item)),
  }));
  const known = new Set(SETTINGS_GROUPS.flatMap((group) => group.items));
  const other = visible.filter((section) => !known.has(section.id));
  if (other.length) grouped.push({ id: "other", label: "Other", items: [], sections: other });

  return (
    <aside id="dcs-nav" className="dc-studio-settings-index dcs-nav" aria-label="Settings sections">
      <div className="dcs-search">
        <label htmlFor="dcs-settings-search" className="dcx-sr-only">
          Search settings
        </label>
        <span aria-hidden="true" className="dcs-search-icon">
          ⌕
        </span>
        <input
          id="dcs-settings-search"
          type="search"
          className="dcx-input"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search settings"
        />
        {query && (
          <button
            type="button"
            className="dcx-btn dcx-btn-ghost dcx-btn-sm"
            onClick={() => onQueryChange("")}
            aria-label="Clear settings search"
          >
            Clear
          </button>
        )}
      </div>
      <nav className="dcs-nav-groups">
        {grouped
          .filter((group) => group.sections.length)
          .map((group) => (
            <div className="dcs-nav-group" key={group.id} role="group" aria-labelledby={`dcs-group-${group.id}`}>
              <div className="dcs-nav-group-label" id={`dcs-group-${group.id}`}>
                {group.label}
              </div>
              {group.sections.map((section) => {
                const active = section.id === activeId;
                return (
                  <button
                    key={section.id}
                    type="button"
                    className={`dcx-nav-item${active ? " is-active" : ""}`}
                    aria-current={active ? "page" : undefined}
                    onClick={() => onSelect(section.id)}
                  >
                    <span>{section.label}</span>
                    {active && dirty && SAVEABLE_SETTINGS_SECTIONS.includes(section.id) && (
                      <i className="dcs-dirty-dot" aria-label="Unsaved changes" />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        {!visible.length && (
          <p className="dcs-nav-empty" role="status">
            No settings match “{query}”.
          </p>
        )}
      </nav>
    </aside>
  );
}

type SettingsSectionIntroProps = { section: SettingsSectionMeta | undefined };

export function SettingsSectionIntro({ section }: SettingsSectionIntroProps) {
  if (!section) return null;
  return (
    <header className="dcs-section-intro">
      <h3>{section.label}</h3>
      {section.description && <p>{section.description}</p>}
    </header>
  );
}

type SettingsSaveBarProps = {
  dirty: boolean;
  saving: boolean;
  canReset: boolean;
  onReset: () => void;
  onSave: () => void;
  onClose: () => void;
};

/** Footer that turns into a sticky "unsaved changes" bar while edits are pending. */
export function SettingsSaveBar({ dirty, saving, canReset, onReset, onSave, onClose }: SettingsSaveBarProps) {
  if (!dirty && !saving) {
    return (
      <div className="dcs-footer">
        <span>
          All changes saved · Appearance, notifications and sounds follow your account to every device · Press Esc to
          close
        </span>
        <button type="button" className="modal-secondary" onClick={onClose}>
          Close
        </button>
      </div>
    );
  }
  return (
    <div className="dcx-dirtybar dcs-savebar" role="region" aria-label="Unsaved changes">
      <span aria-live="polite">{saving ? "Saving your changes…" : "You have unsaved changes"}</span>
      <div>
        {canReset && (
          <button type="button" className="dcx-btn dcx-btn-ghost" disabled={saving} onClick={onReset}>
            Reset section
          </button>
        )}
        <button type="button" className="modal-secondary" disabled={saving} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="modal-primary" disabled={saving} onClick={onSave}>
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
