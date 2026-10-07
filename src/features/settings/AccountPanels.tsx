import { useState } from "react";
import { accountExportStatus } from "../../../shared/account-export";
import { Icon } from "../../components/Icon";
import { describeLastActive } from "./sessionFormat";

export type SessionInfo = {
  id: string;
  client: "mobile" | "web" | "desktop" | "legacy";
  deviceLabel: string;
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

/** Settings → Account: where you're signed in, current device first. */
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
  const ordered = [...sessions].sort(
    (a, b) => Number(b.current) - Number(a.current) || Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
  const others = ordered.filter((session) => !session.current).length;
  return (
    <div className="dcs-card">
      {ordered.length === 0 ? (
        <p className="dcs-muted">No active sessions were returned. Refresh to try again.</p>
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
                  {session.deviceLabel || "Unknown device"}
                  {session.current && <em className="dcs-pill">This device</em>}
                </strong>
                <small>
                  {session.current
                    ? "Active now"
                    : describeLastActive(session.lastActiveAt, Date.now(), formatDate) ||
                      "Last activity not recorded yet"}
                  {" · "}Signed in {formatDateTime(session.createdAt)} · Stays signed in until{" "}
                  {formatDate(session.expiresAt)}
                </small>
              </span>
              {!session.current && (
                <button
                  type="button"
                  className="modal-secondary dcs-danger-text"
                  disabled={busyId === session.id}
                  onClick={() => onRevoke(session)}
                >
                  {busyId === session.id ? "Signing out…" : "Sign out"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="dcs-card-actions dcs-card-actions-split">
        <button type="button" className="modal-secondary" onClick={onRefresh}>
          Refresh
        </button>
        <button
          type="button"
          className="modal-secondary dcs-danger-text"
          disabled={busyAll || ordered.length === 0}
          onClick={onLogoutAll}
        >
          {busyAll ? "Signing out…" : others > 0 ? `Sign out all ${ordered.length} devices` : "Sign out"}
        </button>
      </div>
      <p className="dcs-muted">
        Signing out all devices includes this one. Don't recognise a device? Sign it out, then change your password and
        turn on two-factor sign-in.
      </p>
    </div>
  );
}

/** Settings → Account: download a JSON copy of your account data. */
export function DataExportPanel({ apiBase }: { apiBase: string }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const download = async () => {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`${apiBase}/api/account/export`, { credentials: "include" });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Could not prepare your data. Try again.");
      }
      const blob = await response.blob();
      const exportStatus = accountExportStatus(await blob.slice(-512).text());
      if (!exportStatus.complete) throw new Error(exportStatus.error);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `decave-data-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setNotice("Your data was downloaded.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not prepare your data.");
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
          <strong>Download my data</strong>
          <small>
            Your profile, settings, friends, Hubs, blocks, sign-ins and the messages you wrote, as a JSON file.
          </small>
        </div>
        <button type="button" className="modal-secondary" disabled={busy} onClick={() => void download()}>
          {busy ? "Preparing…" : "Download"}
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
