// Building blocks every Settings tab uses: a titled section that search can
// jump to, an ON/OFF row bound to a setting field, and the inline
// "Couldn't save · Retry" message.

import type { CSSProperties, ReactNode } from "react";
import { useSettingsT } from "./useSettingsT";
import { settingsSectionStyle, settingsSectionTitleStyle } from "../../app/inline-styles";
import type { SettingField } from "./useSettingField";

const sectionTitleStyle: CSSProperties = { ...settingsSectionTitleStyle, textTransform: "uppercase" };

type SectionProps = {
  /** Search target id (see SETTINGS_ANCHORS). */
  anchor?: string;
  title?: ReactNode;
  danger?: boolean;
  children: ReactNode;
};

export function SettingsSection({ anchor, title, danger, children }: SectionProps) {
  return (
    <div style={settingsSectionStyle} data-settings-anchor={anchor}>
      {title && (
        <div style={danger ? { ...sectionTitleStyle, color: "var(--ds-danger)" } : sectionTitleStyle}>{title}</div>
      )}
      {children}
    </div>
  );
}

/** "Couldn't save · Retry" after a failed save; nothing otherwise. */
export function FieldError({ field }: { field: Pick<SettingField<unknown>, "status" | "retry"> }) {
  const { t } = useSettingsT();
  if (field.status !== "error") return null;
  return (
    <span className="dcs-field-error" role="alert">
      {t("settings.field.couldntSave")} ·{" "}
      <button type="button" className="dcs-link-button" onClick={() => field.retry()}>
        {t("settings.field.retry")}
      </button>
    </span>
  );
}

type ToggleRowProps = {
  field: SettingField<boolean>;
  label: ReactNode;
  description?: ReactNode;
  anchor?: string;
  disabled?: boolean;
  style?: CSSProperties;
  ariaLabel?: string;
};

/** The standard settings switch row: label, description and an ON/OFF checkbox. */
export function ToggleRow({ field, label, description, anchor, disabled, style, ariaLabel }: ToggleRowProps) {
  const { t } = useSettingsT();
  return (
    <label
      className={`settings-toggle-row${field.value ? " enabled" : " disabled"}`}
      style={disabled ? { opacity: 0.62, ...style } : style}
      data-settings-anchor={anchor}
    >
      <span>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
        <FieldError field={field} />
      </span>
      <span className="settings-toggle-control">
        <em>{field.value ? t("settings.field.on") : t("settings.field.off")}</em>
        <input
          type="checkbox"
          aria-label={ariaLabel}
          disabled={disabled}
          checked={field.value}
          onChange={(event) => field.set(event.target.checked)}
        />
      </span>
    </label>
  );
}
