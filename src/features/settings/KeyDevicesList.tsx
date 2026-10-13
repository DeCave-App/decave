// Settings → Privacy & encryption → Devices with your key. The account has one
// shared key, so removing a device signs it out and switches to a new key that
// the removed device never gets.

import { useCallback, useEffect, useState } from "react";
import { apiErrorMessage } from "../../i18n/apiError";
import { deviceName } from "../../i18n/sessionDevice";
import { DmKeyDeviceError, listKeyDevices, removeKeyDevice, type DmKeyDevice } from "../../e2ee/dm-e2ee-client";
import { useSettingsT } from "./useSettingsT";

type Props = {
  formatDate: (iso: string) => string;
  /** Refresh after the account's devices change (sign-outs elsewhere). */
  refreshKey?: unknown;
};

export function KeyDevicesList({ formatDate, refreshKey }: Props) {
  const { t } = useSettingsT();
  const [devices, setDevices] = useState<DmKeyDevice[] | null>(null);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const failure = (caught: unknown) =>
    caught instanceof DmKeyDeviceError
      ? apiErrorMessage(caught.body, "common.unknown")
      : t("settings.keyDevices.failed");

  const load = useCallback(async () => {
    try {
      setDevices(await listKeyDevices());
      setError("");
    } catch (caught) {
      setDevices([]);
      setError(failure(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const remove = async (device: DmKeyDevice) => {
    const label = deviceName(device.label, device.device) || t("settings.keyDevices.unknownDevice");
    if (!window.confirm(t("settings.keyDevices.confirm", { device: label }))) return;
    setBusyId(device.sessionId);
    setError("");
    setNotice("");
    try {
      await removeKeyDevice(device.sessionId);
      setNotice(t("settings.keyDevices.removed", { device: label }));
      await load();
    } catch (caught) {
      setError(failure(caught));
    } finally {
      setBusyId("");
    }
  };

  return (
    <div className="dcs-card" data-settings-anchor="key-devices">
      <div className="dcs-card-copy">
        <strong>{t("settings.keyDevices.title")}</strong>
        <small>{t("settings.keyDevices.help")}</small>
      </div>
      {devices === null && <p className="dcs-muted">{t("settings.keyDevices.loading")}</p>}
      {devices && devices.length === 0 && !error && <p className="dcs-muted">{t("settings.keyDevices.none")}</p>}
      {devices && devices.length > 0 && (
        <ul className="dcs-list">
          {devices.map((device) => (
            <li key={device.sessionId} className={`dcs-list-row${device.current ? " is-current" : ""}`}>
              <span className="dcs-list-copy">
                <strong>
                  {deviceName(device.label, device.device) || t("settings.keyDevices.unknownDevice")}
                  {device.current && <em className="dcs-pill">{t("settings.keyDevices.thisDevice")}</em>}
                </strong>
                <small>
                  {t("settings.keyDevices.added", { date: formatDate(device.addedAt) })}
                  {" · "}
                  {device.lastUsedAt
                    ? t("settings.keyDevices.lastUsed", { date: formatDate(device.lastUsedAt) })
                    : t("settings.keyDevices.lastUsedUnknown")}
                </small>
              </span>
              {!device.current && (
                <button
                  type="button"
                  className="modal-secondary dcs-danger-text"
                  disabled={busyId === device.sessionId}
                  onClick={() => void remove(device)}
                >
                  {busyId === device.sessionId ? t("settings.keyDevices.removing") : t("settings.keyDevices.remove")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {notice && (
        <p className="dcs-muted" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="dcs-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
