// Settings → Your setup: what needs attention, each with a one-click fix and
// a dismiss action (remembered on the account).

import type { CheckupItem } from "./checks";
import { useSettingsT } from "../useSettingsT";
import "./checkup.css";

type Props = {
  items: CheckupItem[];
  busyFix: string | null;
  onFix: (item: CheckupItem) => void;
  onDismiss: (item: CheckupItem) => void;
};

export function YourSetupTab({ items, busyFix, onFix, onDismiss }: Props) {
  const { t, tk } = useSettingsT();
  if (!items.length) {
    return (
      <div className="dcs-card dcs-checkup-done" role="status">
        <strong>{t("settings.checkup.allSet")}</strong>
        <small>{t("settings.checkup.allSetHelp")}</small>
      </div>
    );
  }
  return (
    <ul className="dcs-checkup-list">
      {items.map((item) => (
        <li key={item.id} className={`dcs-card dcs-checkup-item is-${item.severity}`} data-checkup-item={item.id}>
          <div className="dcs-card-copy">
            <span className="dcs-checkup-severity">{tk(`settings.checkup.severity.${item.severity}`)}</span>
            <strong>{tk(`settings.checkup.items.${item.id}.title`)}</strong>
            <small>{tk(`settings.checkup.items.${item.id}.description`)}</small>
          </div>
          <div className="dcs-card-actions">
            <button type="button" className="modal-primary" disabled={busyFix === item.id} onClick={() => onFix(item)}>
              {tk(`settings.checkup.items.${item.id}.fix`)}
            </button>
            <button type="button" className="modal-secondary" onClick={() => onDismiss(item)}>
              {t("settings.checkup.dismiss")}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
