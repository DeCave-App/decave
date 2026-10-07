import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { Icon } from "../../components/Icon";
import { pillsThatFit, type HubSwitcherFit } from "./hubSwitcherFit";
import "./hubSwitcher.css";

export type HubSwitcherItem = {
  id: number;
  name: string;
  icon: string;
  /** Loadable icon URL, if the Hub has an uploaded icon. */
  iconUrl?: string | null;
  accent?: string;
  iconRing?: boolean;
  role?: string | null;
  muted: boolean;
  unread: number;
  mentions: number;
};

export type HubSwitcherProps = {
  hubs: HubSwitcherItem[];
  activeId: number;
  onSelect: (hubId: number) => void;
  onContextMenu: (event: MouseEvent<HTMLElement>, hubId: number) => void;
  onCreate: () => void;
};

const MORE_BUTTON = 46; // "+N" button width + gap
const ADD_BUTTON = 38; // "Create Hub" button width + gap

function HubBadge({ hub }: { hub: HubSwitcherItem }) {
  if (hub.mentions > 0)
    return (
      <b className="dc-hub-unread-badge mention" aria-label={`${hub.mentions} mentions`}>
        {hub.mentions > 99 ? "99+" : hub.mentions}
      </b>
    );
  if (hub.unread > 0 && !hub.muted)
    return <b className="dc-hub-unread-badge dot" aria-label={`${hub.unread} unread`} />;
  return null;
}

function HubGlyph({ hub }: { hub: HubSwitcherItem }) {
  return hub.iconUrl ? (
    <img className="dc-hub-switcher-image" src={hub.iconUrl} alt="" draggable={false} />
  ) : (
    <span className="dc-top-hub-fallback">{hub.icon}</span>
  );
}

/**
 * Hub pills in the top bar. Shrinks to icons, then to icons plus a "+N" menu,
 * so no Hub is ever scrolled out of sight on smaller windows.
 */
export function HubSwitcher(props: HubSwitcherProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [sizeTick, setSizeTick] = useState(0);
  const [fitState, setFitState] = useState<{ key: string; mode: HubSwitcherFit; visible: number[] | null }>({
    key: "",
    mode: "full",
    visible: null,
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  // The fit is only valid for the Hubs, active Hub and width it was measured
  // against; anything else starts again from full pills.
  const fitKey = `${props.hubs.map((hub) => `${hub.id}:${hub.name}`).join("|")}#${props.activeId}#${sizeTick}`;
  const fit = fitState.key === fitKey ? fitState : { key: fitKey, mode: "full" as HubSwitcherFit, visible: null };
  useEffect(() => {
    const row = rowRef.current;
    const host = row?.parentElement;
    if (!row || !host || typeof ResizeObserver === "undefined") return;
    let last = host.clientWidth;
    const observer = new ResizeObserver(() => {
      if (Math.abs(host.clientWidth - last) < 2) return;
      last = host.clientWidth;
      setSizeTick((tick) => tick + 1);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  // Step down until nothing overflows.
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const overflowing = row.scrollWidth > row.clientWidth + 1;
    if (!overflowing) return;
    if (fit.mode === "full") {
      setFitState({ key: fitKey, mode: "compact", visible: null });
      return;
    }
    if (fit.mode === "compact") {
      const buttons = Array.from(row.querySelectorAll<HTMLElement>("[data-hub-pill]"));
      const widths = buttons.map((button) => button.getBoundingClientRect().width);
      const activeIndex = props.hubs.findIndex((hub) => hub.id === props.activeId);
      setFitState({
        key: fitKey,
        mode: "overflow",
        visible: pillsThatFit(widths, activeIndex, row.clientWidth, MORE_BUTTON + ADD_BUTTON),
      });
    }
  }, [fit.mode, fitKey, props.hubs, props.activeId]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: globalThis.MouseEvent | globalThis.KeyboardEvent) => {
      if (event instanceof globalThis.KeyboardEvent) {
        if (event.key === "Escape") setMenuOpen(false);
        return;
      }
      const target = event.target as Node | null;
      if (
        target &&
        (moreRef.current?.contains(target) || document.querySelector(".dc-hub-more-menu")?.contains(target))
      )
        return;
      setMenuOpen(false);
    };
    window.addEventListener("mousedown", close, true);
    window.addEventListener("keydown", close, true);
    return () => {
      window.removeEventListener("mousedown", close, true);
      window.removeEventListener("keydown", close, true);
    };
  }, [menuOpen]);

  const visibleSet = fit.mode === "overflow" && fit.visible ? new Set(fit.visible) : null;
  const shown = props.hubs.filter((_, index) => !visibleSet || visibleSet.has(index));
  const hidden = visibleSet ? props.hubs.filter((_, index) => !visibleSet.has(index)) : [];
  const hiddenMentions = hidden.reduce((sum, hub) => sum + hub.mentions, 0);
  const hiddenUnread = hidden.some((hub) => hub.unread > 0 && !hub.muted);

  const openMenu = () => {
    const rect = moreRef.current?.getBoundingClientRect();
    if (rect) setMenuPos({ top: rect.bottom + 8, left: Math.max(8, Math.min(rect.left, window.innerWidth - 288)) });
    setMenuOpen((open) => !open);
  };

  return (
    <div
      ref={rowRef}
      className="vadrion-top-actions dc-top-hub-switcher"
      aria-label="Hubs"
      data-navigation-surface="hubs"
      data-fit={fit.mode}
    >
      {shown.map((hub) => {
        const active = hub.id === props.activeId;
        return (
          <button
            key={hub.id}
            type="button"
            data-hub-pill=""
            className={`dc-top-hub-button${active ? " active" : ""}${hub.iconRing ? " custom-ring" : ""}${hub.muted ? " muted" : ""}`}
            onClick={() => props.onSelect(hub.id)}
            onContextMenu={(event) => props.onContextMenu(event, hub.id)}
            title={`${hub.name}${hub.role ? ` (${hub.role})` : ""}${hub.muted ? " · muted" : ""}${hub.unread ? ` · ${hub.unread} unread` : ""}`}
            aria-label={`Open ${hub.name}`}
            aria-pressed={active}
            aria-current={active ? "page" : undefined}
            data-hub-id={hub.id}
            style={{ "--dc-top-hub-color": hub.accent ?? "#7c5cff" } as CSSProperties}
          >
            <HubGlyph hub={hub} />
            <span className="dc-top-hub-name">{hub.name}</span>
            <HubBadge hub={hub} />
          </button>
        );
      })}
      {hidden.length > 0 && (
        <button
          ref={moreRef}
          type="button"
          className="dc-top-hub-more"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={`${hidden.length} more Hubs${hiddenMentions ? `, ${hiddenMentions} mentions` : hiddenUnread ? ", unread messages" : ""}`}
          title={`${hidden.length} more Hubs`}
          onClick={openMenu}
        >
          +{hidden.length}
          {hiddenMentions > 0 ? (
            <b className="dc-hub-unread-badge mention">{hiddenMentions > 99 ? "99+" : hiddenMentions}</b>
          ) : hiddenUnread ? (
            <b className="dc-hub-unread-badge dot" />
          ) : null}
        </button>
      )}
      <button
        type="button"
        className="dc-top-hub-add"
        title="Create Hub"
        aria-label="Create Hub"
        onClick={props.onCreate}
      >
        <Icon name="plus" />
        <small>Add</small>
      </button>
      {menuOpen && hidden.length > 0 && menuPos && (
        <div
          className="dc-hub-more-menu"
          role="menu"
          aria-label="More Hubs"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          {hidden.map((hub) => (
            <button
              key={hub.id}
              type="button"
              role="menuitem"
              className={`dc-hub-more-item${hub.muted ? " muted" : ""}`}
              onClick={() => {
                setMenuOpen(false);
                props.onSelect(hub.id);
              }}
              onContextMenu={(event) => props.onContextMenu(event, hub.id)}
            >
              <span className="dc-hub-more-icon">
                <HubGlyph hub={hub} />
              </span>
              <span className="dc-hub-more-name">{hub.name}</span>
              {hub.mentions > 0 ? (
                <b className="dc-hub-more-badge">{hub.mentions > 99 ? "99+" : hub.mentions}</b>
              ) : hub.unread > 0 && !hub.muted ? (
                <i className="dc-hub-more-dot" />
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
