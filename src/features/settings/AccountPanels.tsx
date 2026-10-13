import { useState } from "react";
import { accountExportStatus } from "../../../shared/account-export";
import { Icon } from "../../components/Icon";
import { deviceName } from "../../i18n/sessionDevice";
import { apiErrorOr, type ApiErrorBody } from "../../i18n/apiError";
import { describeLastActive, type LastActiveWords } from "./sessionFormat";
import { useSettingsT } from "./useSettingsT";

export type SessionInfo = {
  id: string;
  client: "mobile" | "web" | "desktop" | "legacy";
  deviceLabel: string;
  /** Parts of the label for showing it in the UI language (shared/session-device.ts). */
  device?: unknown;
  createdAt: string;
  expiresAt: string;
  /** Last request from this device, recorded at most every 5 minutes. */
  lastActiveAt?: string | null;
  current: boolean;
};

type SessionsProps = {
  sessions: readonly SessionInfo[];
  busyId: string | null;
  busyAll: boolean;
  onRevoke: (session: SessionInfo) => void;
  onRefresh: () => void;
  onLogoutAll: () => void;
  formatDateTime: (iso: string) => string;
  formatDate: (iso: string) => string;
};

/** Settings → Account & devices: where you're signed in, current device first. */
export function SessionsPanel({
  sessions,
  busyId,
  busyAll,
  onRevoke,
  onRefresh,
  onLogoutAll,
  formatDateTime,
  formatDate,
}: SessionsProps) {
  const { t, i18n } = useSettingsT();
  const words: LastActiveWords = {
    locale: i18n.language,
    activeNow: t("settings.sessions.activeNow"),
    active: (when) => t("settings.sessions.active", { when }),
    notUsedSince: (date) => t("settings.sessions.notUsedSince", { date }),
  };
  const ordered = [...sessions].sort(
    (a, b) => Number(b.current) - Number(a.current) || Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
  const others = ordered.filter((session) => !session.current).length;
  return (
    <div className="dcs-card">
      {ordered.length === 0 ? (
        <p className="dcs-muted">{t("settings.sessions.none")}</p>
      ) : (
        <ul className="dcs-list">
          {ordered.map((session) => (
            <li key={session.id} className={`dcs-list-row${session.current ? " is-current" : ""}`}>
              <span className="dcs-device-icon" aria-hidden="true">
                <Icon
                  name={session.client === "mobile" ? "phone" : session.client === "desktop" ? "screen" : "globe"}
                  size="sm"
                />
              </span>
              <span className="dcs-list-copy">
                <strong>
                  {deviceName(session.deviceLabel, session.device) || t("settings.sessions.unknownDevice")}
                  {session.current && <em className="dcs-pill">{t("settings.sessions.thisDevice")}</em>}
                </strong>
                <small>
                  {session.current
                    ? t("settings.sessions.activeNow")
                    : describeLastActive(session.lastActiveAt, Date.now(), formatDate, words) ||
                      t("settings.sessions.notRecorded")}
                  {" · "}
                  {t("settings.sessions.signedIn", {
                    signedIn: formatDateTime(session.createdAt),
                    until: formatDate(session.expiresAt),
                  })}
                </small>
              </span>
              {!session.current && (
                <button
                  type="button"
                  className="modal-secondary dcs-danger-text"
                  disabled={busyId === session.id}
                  onClick={() => onRevoke(session)}
                >
                  {busyId === session.id ? t("settings.sessions.signingOut") : t("settings.sessions.signOut")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="dcs-card-actions dcs-card-actions-split">
        <button type="button" className="modal-secondary" onClick={onRefresh}>
          {t("settings.sessions.refresh")}
        </button>
        <button
          type="button"
          className="modal-secondary dcs-danger-text"
          disabled={busyAll || ordered.length === 0}
          onClick={onLogoutAll}
        >
          {busyAll
            ? t("settings.sessions.signingOut")
            : others > 0
              ? t("settings.sessions.signOutAll", { count: ordered.length })
              : t("settings.sessions.signOut")}
        </button>
      </div>
      <p className="dcs-muted">{t("settings.sessions.help")}</p>
    </div>
  );
}

/** Settings → Account & devices: download a JSON copy of your account data. */
export function DataExportPanel({ apiBase }: { apiBase: string }) {
  const { t } = useSettingsT();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const download = async () => {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`${apiBase}/api/account/export`, { credentials: "include" });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as ApiErrorBody;
        throw new Error(apiErrorOr(data, t("settings.yourData.prepareRetry")));
      }
      const blob = await response.blob();
      // The server writes "complete":true last; anything else is a truncated export.
      const exportStatus = accountExportStatus(await blob.slice(-512).text());
      if (!exportStatus.complete)
        throw new Error(
          exportStatus.errorKey === "settings.accountExport.failed"
            ? t("settings.accountExport.failed")
            : exportStatus.errorKey === "settings.accountExport.unfinished"
              ? t("settings.accountExport.unfinished")
              : exportStatus.error,
        );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `decave-data-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setNotice(t("settings.yourData.downloaded"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t("settings.yourData.prepareFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="dcs-card">
      <div className="dcs-card-row">
        <span className="dcs-badge" aria-hidden="true">
          <Icon name="download" size="sm" />
        </span>
        <div className="dcs-card-copy">
          <strong>{t("settings.yourData.title")}</strong>
          <small>{t("settings.yourData.description")}</small>
        </div>
        <button type="button" className="modal-secondary" disabled={busy} onClick={() => void download()}>
          {busy ? t("settings.yourData.preparing") : t("settings.yourData.download")}
        </button>
      </div>
      {notice && (
        <p className="dcs-muted" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
