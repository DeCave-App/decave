import { useEffect, useRef, type KeyboardEvent } from "react";
import { Icon, type IconName } from "../../components/Icon";

export type ComposerPlusAction = {
  id: string;
  icon: IconName;
  label: string;
  hint: string;
  disabled?: boolean;
  onSelect: () => void;
};

/* Composer "+" menu: icon + label + hint rows, roving focus with arrow keys,
   Home/End, Esc closes (outside click / global Esc handled by App via
   data-composer-popover). Skins through --ds-* tokens. */
export function ComposerPlusMenu({
  actions,
  onClose,
  label = "Add to message",
}: {
  actions: ComposerPlusAction[];
  onClose: () => void;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (event.key === "ArrowDown") next = (index + 1) % items.length;
    else if (event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (next >= 0) {
      event.preventDefault();
      items[next].focus();
    }
  };

  return (
    <div
      ref={ref}
      className="gc-plus-menu"
      role="menu"
      aria-label={label}
      data-composer-popover="true"
      onKeyDown={onKeyDown}
    >
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          role="menuitem"
          className="gc-plus-menu-item"
          disabled={action.disabled}
          onClick={() => {
            onClose();
            action.onSelect();
          }}
        >
          <span className="gc-plus-menu-icon">
            <Icon name={action.icon} />
          </span>
          <span className="gc-plus-menu-text">
            <b>{action.label}</b>
            <small>{action.hint}</small>
          </span>
        </button>
      ))}
    </div>
  );
}
