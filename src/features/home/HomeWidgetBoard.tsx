import { useState, type DragEvent, type ReactNode } from "react";
import {
  HOME_PRESETS,
  HOME_WIDGET_SIZE_LABELS,
  type HomePreset,
  type HomeWidgetDefinition,
  type HomeWidgetId,
  type HomeWidgetSize,
} from "./homeLayout";
import { Icon, type IconName } from "../../components/Icon";

export type HomeBoardItem = {
  id: string;
  size: HomeWidgetSize;
  title: string;
  icon: IconName;
  sizes: readonly HomeWidgetSize[];
  /** Optional header action (e.g. "All friends"), hidden while customizing. */
  action?: ReactNode;
  live?: boolean;
  content: ReactNode;
};

const DRAG_TYPE = "application/x-decave-home-widget";

export function HomeWidgetBoard(props: {
  items: HomeBoardItem[];
  customizing: boolean;
  onMove: (id: string, toIndex: number) => void;
  onResize: (id: string, size: HomeWidgetSize) => void;
  onRemove: (id: string) => void;
  onAddFirst: () => void;
}) {
  const { items, customizing } = props;
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const endDrag = () => {
    setDragId(null);
    setOverId(null);
  };
  const dropOn = (event: DragEvent<HTMLElement>, targetId: string | null) => {
    if (!customizing) return;
    event.preventDefault();
    event.stopPropagation();
    const id = dragId ?? event.dataTransfer.getData(DRAG_TYPE);
    if (id && id !== targetId) {
      const from = items.findIndex((item) => item.id === id);
      const to = targetId ? items.findIndex((item) => item.id === targetId) : items.length - 1;
      if (from >= 0 && to >= 0) {
        props.onMove(id, to);
      }
    }
    endDrag();
  };

  if (!items.length) {
    return (
      <div className="hdx-board-empty">
        <strong>Your Home is empty</strong>
        <small>Pick widgets to show here.</small>
        <button type="button" className="dcx-btn dcx-btn-primary" onClick={props.onAddFirst}>
          ＋ Add widgets
        </button>
      </div>
    );
  }

  return (
    <div
      className={`hdx-board${customizing ? " customizing" : ""}`}
      onDragOver={(event) => {
        if (customizing) event.preventDefault();
      }}
      onDrop={(event) => dropOn(event, null)}
    >
      {items.map((item, index) => (
        <section
          key={item.id}
          className={`hdx-card hdx-widget size-${item.size}${dragId === item.id ? " dragging" : ""}${overId === item.id && dragId !== item.id ? " drop-target" : ""}`}
          aria-labelledby={`hdx-w-${item.id}`}
          data-widget-id={item.id}
          draggable={customizing}
          onDragStart={(event) => {
            if (!customizing) return;
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData(DRAG_TYPE, item.id);
            setDragId(item.id);
          }}
          onDragEnter={() => {
            if (customizing) setOverId(item.id);
          }}
          onDragOver={(event) => {
            if (customizing) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }
          }}
          onDrop={(event) => dropOn(event, item.id)}
          onDragEnd={endDrag}
        >
          <header>
            <h2 id={`hdx-w-${item.id}`}>
              {customizing && (
                <span className="hdx-grip" aria-hidden="true">
                  ⠿
                </span>
              )}
              {item.live && <i className="hdx-dot" aria-hidden="true" />}
              <span className="hdx-widget-icon" aria-hidden="true">
                <Icon name={item.icon} />
              </span>
              <span className="hdx-widget-title">{item.title}</span>
            </h2>
            {customizing ? (
              <div className="hdx-widget-tools" role="group" aria-label={`${item.title} widget options`}>
                {item.sizes.length > 1 && (
                  <select
                    className="hdx-size-select"
                    value={item.size}
                    aria-label={`${item.title} size`}
                    onChange={(event) => props.onResize(item.id, event.target.value as HomeWidgetSize)}
                  >
                    {item.sizes.map((size) => (
                      <option key={size} value={size}>
                        {HOME_WIDGET_SIZE_LABELS[size]}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  className="hdx-tool"
                  disabled={index === 0}
                  aria-label={`Move ${item.title} earlier`}
                  title="Move earlier"
                  onClick={() => props.onMove(item.id, index - 1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="hdx-tool"
                  disabled={index === items.length - 1}
                  aria-label={`Move ${item.title} later`}
                  title="Move later"
                  onClick={() => props.onMove(item.id, index + 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="hdx-tool danger"
                  aria-label={`Hide ${item.title}`}
                  title="Hide widget"
                  onClick={() => props.onRemove(item.id)}
                >
                  <Icon name="close" size="sm" />
                </button>
              </div>
            ) : (
              item.action
            )}
          </header>
          <div className="hdx-widget-body" {...(customizing ? ({ inert: "" } as Record<string, string>) : {})}>
            {item.content}
          </div>
        </section>
      ))}
    </div>
  );
}

export function HomeWidgetLibrary(props: {
  definitions: readonly HomeWidgetDefinition[];
  enabled: ReadonlySet<string>;
  onToggle: (id: HomeWidgetId) => void;
  onApplyPreset: (preset: HomePreset) => void;
  onReset: () => void;
  onClose: () => void;
  /** External web-widget form, owned by the app (security-sensitive). */
  external: ReactNode;
}) {
  return (
    <aside className="hdx-library" aria-label="Widget library">
      <header className="hdx-library-head">
        <div>
          <span className="hdx-kicker">Customize Home</span>
          <strong>Choose your widgets</strong>
          <small>Toggle widgets on or off, then drag cards (or use ↑ ↓) to reorder them.</small>
        </div>
        <div className="hdx-library-actions">
          <button type="button" className="dcx-btn" onClick={props.onReset}>
            Reset to default
          </button>
          <button type="button" className="dcx-btn dcx-btn-primary" onClick={props.onClose}>
            Done
          </button>
        </div>
      </header>

      <div className="hdx-presets" role="group" aria-label="Start from a preset">
        <span className="hdx-library-label">Start from a preset</span>
        {(Object.keys(HOME_PRESETS) as HomePreset[]).map((preset) => (
          <button key={preset} type="button" className="hdx-preset" onClick={() => props.onApplyPreset(preset)}>
            <strong>{HOME_PRESETS[preset].label}</strong>
            <small>{HOME_PRESETS[preset].description}</small>
          </button>
        ))}
      </div>

      <ul className="hdx-library-grid">
        {props.definitions.map((definition) => {
          const on = props.enabled.has(definition.id);
          return (
            <li key={definition.id}>
              <label className={`hdx-library-item${on ? " on" : ""}`}>
                <span className={`hdx-preview size-${definition.defaultSize}`} aria-hidden="true">
                  <span className="hdx-preview-icon">
                    <Icon name={definition.icon} />
                  </span>
                  <i />
                  <i />
                  <i />
                </span>
                <span className="hdx-row-copy">
                  <small className="hdx-library-cat">{definition.category}</small>
                  <strong>{definition.title}</strong>
                  <small>{definition.description}</small>
                </span>
                <input
                  type="checkbox"
                  className="hdx-switch"
                  checked={on}
                  onChange={() => props.onToggle(definition.id)}
                  aria-label={`Show ${definition.title}`}
                />
              </label>
            </li>
          );
        })}
      </ul>

      {props.external}
    </aside>
  );
}
