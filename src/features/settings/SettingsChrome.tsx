// The Settings window frame: header, the grouped sidebar with search and
// "Your setup", the tab heading, and the "More options in the desktop app" line.

import { useMemo, type KeyboardEvent } from "react";
import "../shared/shared.css";
import "./settings.css";
import { Icon } from "../../components/Icon";
import {
  SETTINGS_ANCHORS,
  SETTINGS_GROUPS,
  SETTINGS_TABS,
  searchSettings,
  tabsMatching,
  type SettingsSearchResult,
  type SettingsTabId,
} from "./settingsMap";
import { useSettingsT } from "./useSettingsT";

export const DESKTOP_DOWNLOAD_URL = "https://de-cave.com/#download";

type SettingsHeaderProps = { username: string; onClose: () => void };

export function SettingsHeader({ username, onClose }: SettingsHeaderProps) {
  const { t } = useSettingsT();
  return (
    <div className="dc-settings-header dcs-header">
      <div>
        <h2 id="dcs-settings-title">{t("settings.window.title")}</h2>
        <p>
          {t("settings.window.signedInAs")} <strong>{username}</strong>
        </p>
      </div>
      <button
        type="button"
        className="dcx-btn dcx-btn-ghost dcs-close"
        onClick={onClose}
        title={t("settings.window.closeTitle")}
        aria-label={t("settings.window.close")}
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

type SettingsNavProps = {
  activeId: SettingsTabId;
  query: string;
  onQueryChange: (value: string) => void;
  onSelect: (tab: SettingsTabId, anchor?: string) => void;
  /** Undismissed checkup items, shown as a badge on "Your setup". */
  setupCount: number;
  /** Web hides desktop-only tabs. */
  isDesktop: boolean;
};

/**
 * Grouped settings navigation with search. Reuses the legacy
 * `dc-studio-settings-index` class so the existing shell grid places it in
 * the left column; on narrow windows it collapses into scrollable tabs.
 */
export function SettingsNav({ activeId, query, onQueryChange, onSelect, setupCount, isDesktop }: SettingsNavProps) {
  const { t, tk } = useSettingsT();
  const visibleTab = (id: SettingsTabId) => isDesktop || !SETTINGS_TABS[id].desktopOnly;
  const results = useMemo(
    () => (query.trim() ? searchSettings(query, tk).filter((result) => visibleTab(result.tab)) : null),
    [query, tk, isDesktop],
  );
  const shownTabs = new Set(results ? tabsMatching(results) : Object.keys(SETTINGS_TABS));
  const anchorResults = (results ?? []).filter((result): result is Required<SettingsSearchResult> =>
    Boolean(result.anchor),
  );

  const jumpToFirst = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || !results?.length) return;
    event.preventDefault();
    onSelect(results[0].tab, results[0].anchor);
  };

  const tabButton = (id: SettingsTabId, badge?: number) => {
    const active = id === activeId;
    return (
      <button
        key={id}
        type="button"
        className={`dcx-nav-item${active ? " is-active" : ""}`}
        aria-current={active ? "page" : undefined}
        onClick={() => onSelect(id)}
      >
        <span className="dcs-nav-label">
          <Icon name={SETTINGS_TABS[id].icon} size="sm" />
          {tk(SETTINGS_TABS[id].labelKey)}
        </span>
        {badge ? (
          <span className="dcs-nav-badge" aria-label={t("settings.window.setupBadge", { count: badge })}>
            {badge}
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <aside id="dcs-nav" className="dc-studio-settings-index dcs-nav" aria-label={t("settings.window.sections")}>
      <div className="dcs-search">
        <label htmlFor="dcs-settings-search" className="dcx-sr-only">
          {t("settings.window.search")}
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
          onKeyDown={jumpToFirst}
          placeholder={t("settings.window.search")}
        />
        {query && (
          <button
            type="button"
            className="dcx-btn dcx-btn-ghost dcx-btn-sm"
            onClick={() => onQueryChange("")}
            aria-label={t("settings.window.clearSearch")}
          >
            {t("settings.window.clear")}
          </button>
        )}
      </div>
      {anchorResults.length > 0 && (
        <div className="dcs-search-results" role="group" aria-label={t("settings.window.matchingSettings")}>
          {anchorResults.slice(0, 8).map((result) => {
            const anchor = SETTINGS_ANCHORS.find((item) => item.id === result.anchor);
            return (
              <button
                key={result.anchor}
                type="button"
                className="dcs-search-result"
                onClick={() => onSelect(result.tab, result.anchor)}
              >
                <strong>{anchor ? tk(anchor.labelKey) : result.anchor}</strong>
                <small>{tk(SETTINGS_TABS[result.tab].labelKey)}</small>
              </button>
            );
          })}
        </div>
      )}
      <nav className="dcs-nav-groups">
        {shownTabs.has("setup") && <div className="dcs-nav-group dcs-nav-setup">{tabButton("setup", setupCount)}</div>}
        {SETTINGS_GROUPS.map((group) => {
          const tabs = group.tabs.filter((id) => shownTabs.has(id) && visibleTab(id));
          if (!tabs.length) return null;
          return (
            <div className="dcs-nav-group" key={group.id} role="group" aria-labelledby={`dcs-group-${group.id}`}>
              <div className="dcs-nav-group-label" id={`dcs-group-${group.id}`}>
                {tk(group.labelKey)}
              </div>
              {tabs.map((id) => tabButton(id))}
            </div>
          );
        })}
        {results && !results.length && (
          <p className="dcs-nav-empty" role="status">
            {t("settings.window.noMatches", { query })}
          </p>
        )}
      </nav>
    </aside>
  );
}

export function SettingsSectionIntro({ tab }: { tab: SettingsTabId }) {
  const { tk } = useSettingsT();
  const meta = SETTINGS_TABS[tab];
  return (
    <header className="dcs-section-intro">
      <h3>{tk(meta.labelKey)}</h3>
      <p>{tk(meta.descriptionKey)}</p>
    </header>
  );
}

/** One line on web where a tab has settings only the desktop app can change. */
export function DesktopOnlyNote() {
  const { t } = useSettingsT();
  return (
    <p className="dcs-desktop-note">
      {t("settings.window.moreInDesktop")}{" "}
      <a href={DESKTOP_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">
        {t("settings.window.downloadDesktop")}
      </a>
    </p>
  );
}
