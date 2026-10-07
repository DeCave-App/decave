export type StudioSettingSection = {
  id: string;
  label: string;
  description?: string;
};

type SettingsIndexProps = {
  sections: readonly StudioSettingSection[];
  activeId: string;
  onSelect: (id: string) => void;
  saveState?: "saved" | "unsaved" | "saving" | "error";
};

/** Staged settings index that keeps save state visible while sections change. */
export function SettingsIndex({ sections, activeId, onSelect, saveState = "saved" }: SettingsIndexProps) {
  const saveLabel =
    saveState === "unsaved"
      ? "Unsaved changes"
      : saveState === "saving"
        ? "Saving…"
        : saveState === "error"
          ? "Couldn’t save"
          : "Saved locally";
  return (
    <aside className="dc-studio-settings-index" aria-label="Settings sections">
      <div className="dc-studio-settings-index-head">
        <span>SETTINGS</span>
        <strong>Studio preferences</strong>
      </div>
      <nav>
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            className={section.id === activeId ? "is-active" : undefined}
            aria-current={section.id === activeId ? "page" : undefined}
            onClick={() => onSelect(section.id)}
          >
            <span>{section.label}</span>
            {section.description && <small>{section.description}</small>}
          </button>
        ))}
      </nav>
      <p className={`dc-studio-settings-save dc-studio-settings-save-${saveState}`} role="status" aria-live="polite">
        <i aria-hidden="true" />
        {saveLabel}
      </p>
    </aside>
  );
}
