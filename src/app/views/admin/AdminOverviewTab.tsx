// Platform owner dashboard > Overview.

import { useTranslation } from "react-i18next";
import type { Dispatch, SetStateAction } from "react";
import type { AdminDashboardSummary } from "../../types";

type Props = {
  ownerReauthPassword: string;
  setOwnerReauthPassword: Dispatch<SetStateAction<string>>;
  ownerReauthCode: string;
  setOwnerReauthCode: Dispatch<SetStateAction<string>>;
  ownerReauthNotice: string;
  ownerManagementBusy: boolean;
  adminDashboardSummary: AdminDashboardSummary | null;
  adminDashboardBusy: boolean;
  adminUsageFrom: string;
  setAdminUsageFrom: Dispatch<SetStateAction<string>>;
  adminUsageTo: string;
  setAdminUsageTo: Dispatch<SetStateAction<string>>;
  ownerPrivilegedReauth: () => Promise<void>;
  loadAdminDashboard: (search?: string) => Promise<void>;
};

export function AdminOverviewTab({
  ownerReauthPassword,
  setOwnerReauthPassword,
  ownerReauthCode,
  setOwnerReauthCode,
  ownerReauthNotice,
  ownerManagementBusy,
  adminDashboardSummary,
  adminDashboardBusy,
  adminUsageFrom,
  setAdminUsageFrom,
  adminUsageTo,
  setAdminUsageTo,
  ownerPrivilegedReauth,
  loadAdminDashboard,
}: Props) {
  const { t } = useTranslation(["common", "hub", "chat"]);
  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: "16px",
          marginBottom: "10px",
        }}
      >
        <div>
          <div className="social-kicker">{t("common.admin.overview.kicker")}</div>
          <strong style={{ display: "block", marginTop: "4px", fontSize: "16px" }}>
            {adminDashboardSummary?.activityDate || t("common.admin.overview.selectedRange")}
          </strong>
        </div>
        <small style={{ color: "var(--ds-muted)", textAlign: "right", lineHeight: 1.45 }}>
          {t("common.admin.overview.countedOnce")}
          <br />
          {t("common.admin.overview.repeatSignIns")}
        </small>
      </div>
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "end",
          flexWrap: "wrap",
          marginBottom: 12,
          padding: 10,
          border: "1px solid color-mix(in srgb, var(--ds-accent-2) 14%, transparent)",
          borderRadius: 10,
          background: "var(--ds-surface-2)",
        }}
      >
        <label style={{ display: "grid", gap: 4, fontSize: 10, color: "var(--ds-muted)" }}>
          {t("common.admin.overview.from")}
          <input
            type="date"
            value={adminUsageFrom}
            max={adminUsageTo}
            onChange={(event) => setAdminUsageFrom(event.target.value)}
          />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 10, color: "var(--ds-muted)" }}>
          {t("common.admin.overview.to")}
          <input
            type="date"
            value={adminUsageTo}
            min={adminUsageFrom}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(event) => setAdminUsageTo(event.target.value)}
          />
        </label>
        <select
          aria-label={t("common.admin.overview.preset")}
          defaultValue="custom"
          onChange={(event) => {
            const days = Number(event.target.value);
            if (!days) return;
            const to = new Date();
            const from = new Date();
            from.setDate(to.getDate() - days + 1);
            setAdminUsageTo(to.toISOString().slice(0, 10));
            setAdminUsageFrom(from.toISOString().slice(0, 10));
          }}
        >
          <option value="custom">{t("common.admin.overview.custom")}</option>
          <option value="7">{t("common.admin.range.week")}</option>
          <option value="30">{t("common.admin.range.month")}</option>
          <option value="90">{t("common.admin.range.quarter")}</option>
        </select>
        <button
          type="button"
          className="modal-secondary"
          disabled={adminDashboardBusy || !adminUsageFrom || !adminUsageTo}
          onClick={() => void loadAdminDashboard()}
        >
          {t("common.admin.overview.apply")}
        </button>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(165px, 1fr))",
          gap: "10px",
        }}
      >
        {[
          {
            label: t("common.admin.overview.metrics.signedIn"),
            value: adminDashboardSummary?.signedInToday ?? 0,
            detail: t("common.admin.overview.metrics.signedInDetail"),
            color: "#6fe4ff",
            icon: "↗",
          },
          {
            label: t("common.admin.overview.metrics.onlineNow"),
            value: adminDashboardSummary?.onlineUsers ?? 0,
            detail: t("common.admin.overview.metrics.onlineNowDetail"),
            color: "#61e7a3",
            icon: "●",
          },
          {
            label: t("common.admin.overview.metrics.sharing"),
            value: adminDashboardSummary?.screenSharingUsers ?? 0,
            detail: t("common.admin.overview.metrics.sharingDetail"),
            color: "#a88bff",
            icon: "▣",
          },
          {
            label: t("common.admin.overview.metrics.voice"),
            value: adminDashboardSummary?.voiceUsers ?? 0,
            detail: t("common.admin.overview.metrics.voiceDetail"),
            color: "#ffbf69",
            icon: "◉",
          },
          {
            label: t("common.admin.overview.metrics.returning"),
            value: adminDashboardSummary?.returningUsers ?? 0,
            detail: t("common.admin.overview.metrics.returningDetail"),
            color: "#ff83b5",
            icon: "↻",
          },
          {
            label: t("common.admin.overview.metrics.squad"),
            value: adminDashboardSummary?.squadFinderUsers ?? 0,
            detail: t("common.admin.overview.metrics.squadDetail"),
            color: "#8fa8ff",
            icon: "⌕",
          },
        ].map((metric) => (
          <div
            key={metric.label}
            style={{
              minHeight: "126px",
              padding: "14px",
              borderRadius: "14px",
              background: `linear-gradient(145deg, ${metric.color}18, rgba(7,13,25,.82) 58%)`,
              border: `1px solid ${metric.color}35`,
              boxShadow: `inset 0 1px 0 ${metric.color}12`,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
              <span
                style={{
                  color: "var(--ds-muted)",
                  fontSize: "10px",
                  fontWeight: 900,
                  letterSpacing: ".08em",
                  textTransform: "uppercase",
                }}
              >
                {metric.label}
              </span>
              <span style={{ color: metric.color, fontSize: "17px" }}>{metric.icon}</span>
            </div>
            <strong
              style={{ display: "block", marginTop: "13px", color: "var(--ds-text)", fontSize: "30px", lineHeight: 1 }}
            >
              {metric.value}
            </strong>
            <small style={{ display: "block", marginTop: "9px", color: "var(--ds-muted)" }}>{metric.detail}</small>
          </div>
        ))}
      </div>

      <div className="social-kicker" style={{ marginTop: "20px", marginBottom: "10px" }}>
        {t("common.admin.overview.totals")}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: "10px",
        }}
      >
        {[
          [t("common.admin.overview.totalsLabels.accounts"), adminDashboardSummary?.accounts ?? 0],
          [t("common.admin.overview.totalsLabels.verified"), adminDashboardSummary?.verifiedAccounts ?? 0],
          [t("common.admin.overview.totalsLabels.owners"), adminDashboardSummary?.platformOwners ?? 0],
          [t("common.admin.overview.totalsLabels.ownersMfa"), adminDashboardSummary?.ownersWithMfa ?? 0],
          [t("common.admin.overview.totalsLabels.platformAdmins"), adminDashboardSummary?.platformAdmins ?? 0],
          [t("common.admin.overview.totalsLabels.hubs"), adminDashboardSummary?.hubs ?? 0],
          [t("common.admin.overview.totalsLabels.publicHubs"), adminDashboardSummary?.publicHubs ?? 0],
          [t("common.admin.overview.totalsLabels.activeSessions"), adminDashboardSummary?.activeSessions ?? 0],
          [t("common.admin.overview.totalsLabels.security24h"), adminDashboardSummary?.securityEvents24h ?? 0],
          [t("common.admin.overview.totalsLabels.audit24h"), adminDashboardSummary?.platformAuditEvents24h ?? 0],
          [t("common.admin.overview.totalsLabels.suspended"), adminDashboardSummary?.suspendedAccounts ?? 0],
          [
            t("common.admin.overview.totalsLabels.deletionScheduled"),
            adminDashboardSummary?.deletionScheduledAccounts ?? 0,
          ],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            style={{
              padding: "14px",
              borderRadius: "12px",
              background: "var(--ds-surface-2)",
              border: "1px solid color-mix(in srgb, var(--ds-accent-2) 14%, transparent)",
            }}
          >
            <div style={{ color: "var(--ds-muted)", fontSize: "10px", fontWeight: 900, letterSpacing: ".1em" }}>
              {label}
            </div>
            <strong style={{ display: "block", marginTop: "8px", fontSize: "25px" }}>{value}</strong>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: "16px",
          padding: "14px",
          borderRadius: "12px",
          border: "1px solid color-mix(in srgb, var(--ds-accent) 20%, transparent)",
          background: "var(--ds-sink)",
        }}
      >
        <strong>{t("common.admin.overview.unlockTitle")}</strong>
        <p style={{ color: "var(--ds-muted)", fontSize: "12px" }}>{t("common.admin.overview.unlockBody")}</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "8px" }}>
          <input
            type="password"
            value={ownerReauthPassword}
            onChange={(event) => setOwnerReauthPassword(event.target.value)}
            placeholder={t("common.account.currentPassword")}
            autoComplete="current-password"
          />
          <input
            type="text"
            value={ownerReauthCode}
            onChange={(event) => setOwnerReauthCode(event.target.value.toUpperCase().replace(/\s/g, "").slice(0, 19))}
            placeholder={t("common.account.mfaCodeLabel")}
            autoComplete="one-time-code"
          />
          <button
            type="button"
            className="modal-primary dc-owner-unlock-button"
            onClick={() => void ownerPrivilegedReauth()}
            disabled={ownerManagementBusy || !ownerReauthPassword || !ownerReauthCode.trim()}
          >
            {t("common.admin.overview.unlock")}
          </button>
        </div>
        {ownerReauthNotice && (
          <div style={{ marginTop: "8px", color: "var(--ds-text-soft)", fontSize: "11px" }}>{ownerReauthNotice}</div>
        )}
      </div>
    </>
  );
}
