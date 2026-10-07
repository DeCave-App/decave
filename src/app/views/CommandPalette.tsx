// Search and quick switch: jump to people, Hubs, rooms, forums and settings.

import { Fragment, type Dispatch, type SetStateAction } from "react";
import { Icon } from "../../components/Icon";
import type { GlobalCommandItem } from "../types";

type Props = {
  setShowCommandPalette: Dispatch<SetStateAction<boolean>>;
  commandPaletteQuery: string;
  setCommandPaletteQuery: Dispatch<SetStateAction<string>>;
  commandPaletteIndex: number;
  setCommandPaletteIndex: Dispatch<SetStateAction<number>>;
  setShowInbox: Dispatch<SetStateAction<boolean>>;
  visibleGlobalCommands: GlobalCommandItem[];
};

export function CommandPalette({
  setShowCommandPalette,
  commandPaletteQuery,
  setCommandPaletteQuery,
  commandPaletteIndex,
  setCommandPaletteIndex,
  setShowInbox,
  visibleGlobalCommands,
}: Props) {
  return (
    <div
      className="modal-overlay dc-command-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setShowCommandPalette(false);
      }}
    >
      <section className="dc-command-palette" role="dialog" aria-modal="true" aria-label="Search and quick switch">
        <label className="dc-command-input ds-search">
          <Icon name="search" size="sm" />
          <input
            className="ds-input"
            type="search"
            value={commandPaletteQuery}
            onChange={(event) => {
              setCommandPaletteQuery(event.target.value);
              setCommandPaletteIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setCommandPaletteIndex((index) => Math.min(index + 1, visibleGlobalCommands.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setCommandPaletteIndex((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter") {
                const item = visibleGlobalCommands[commandPaletteIndex];
                if (item) {
                  event.preventDefault();
                  setShowCommandPalette(false);
                  item.run();
                }
              }
            }}
            placeholder="Search people, Hubs, rooms, forums, and settings"
            aria-label="Search people, Hubs, rooms, forums, and settings"
            autoFocus
          />
        </label>
        <div className="dc-command-results">
          {visibleGlobalCommands.map((item, index) => {
            const showGroup = index === 0 || visibleGlobalCommands[index - 1].group !== item.group;
            return (
              <Fragment key={item.id}>
                {showGroup && <div className="dc-cmd-group">{item.group}</div>}
                <button
                  type="button"
                  className={`dc-cmd-row${index === commandPaletteIndex ? " is-selected" : ""}`}
                  ref={index === commandPaletteIndex ? (node) => node?.scrollIntoView({ block: "nearest" }) : undefined}
                  onMouseMove={() => {
                    if (index !== commandPaletteIndex) setCommandPaletteIndex(index);
                  }}
                  onClick={() => {
                    setShowCommandPalette(false);
                    item.run();
                  }}
                >
                  <span className={`dc-cmd-icon${item.group === "Friends" ? " is-round" : ""}`}>
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt="" />
                    ) : item.icon ? (
                      <Icon name={item.icon} size="sm" />
                    ) : (
                      <span>{item.label.slice(0, 1).toUpperCase()}</span>
                    )}
                    {item.group === "Friends" && <i className={`dc-cmd-presence${item.online ? " is-online" : ""}`} />}
                  </span>
                  <span className="dc-cmd-label">{item.label}</span>
                  {item.meta && <span className="dc-cmd-chip">{item.meta}</span>}
                  {index === commandPaletteIndex && (
                    <kbd className="dc-cmd-enter" aria-hidden="true">
                      ↵
                    </kbd>
                  )}
                </button>
              </Fragment>
            );
          })}
          {visibleGlobalCommands.length === 0 && (
            <div className="ds-empty">
              <span className="ds-empty-icon">
                <Icon name="search" />
              </span>
              <h3>No results</h3>
              <p>Try a Hub, room, friend, or settings section.</p>
            </div>
          )}
        </div>
        <footer>
          <span>
            <kbd>Ctrl</kbd>
            <kbd>K</kbd> to open anywhere · <kbd>Esc</kbd> to close
          </span>
          <button
            type="button"
            className="ds-btn ds-btn-ghost ds-btn-sm"
            onClick={() => {
              setShowCommandPalette(false);
              setShowInbox(true);
            }}
          >
            <Icon name="bell" />
            Open Inbox
          </button>
        </footer>
      </section>
    </div>
  );
}
