// Platform owner dashboard > Overview.

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
          <div className="social-kicker">USAGE DASHBOARD</div>
          <strong style={{ display: "block", marginTop: "4px", fontSize: "16px" }}>
            {adminDashboardSummary?.activityDate || "Selected range"}
          </strong>
        </div>
        <small style={{ color: "var(--ds-muted)", textAlign: "right", lineHeight: 1.45 }}>
          People are counted once per metric.
          <br />
          Repeat sign-ins do not increase today&apos;s total.
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
          From
          <input
            type="date"
            value={adminUsageFrom}
            max={adminUsageTo}
            onChange={(event) => setAdminUsageFrom(event.target.value)}
          />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 10, color: "var(--ds-muted)" }}>
          To
          <input
            type="date"
            value={adminUsageTo}
            min={adminUsageFrom}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(event) => setAdminUsageTo(event.target.value)}
          />
        </label>
        <select
          aria-label="Usage range preset"
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
          <option value="custom">Custom range</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
        <button
          type="button"
          className="modal-secondary"
          disabled={adminDashboardBusy || !adminUsageFrom || !adminUsageTo}
          onClick={() => void loadAdminDashboard()}
        >
          Apply range
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
            label: "Signed in",
            value: adminDashboardSummary?.signedInToday ?? 0,
            detail: "Unique accounts in range",
            color: "#6fe4ff",
            icon: "↗",
          },
          {
            label: "Online now",
            value: adminDashboardSummary?.onlineUsers ?? 0,
            detail: "Connected users",
            color: "#61e7a3",
            icon: "●",
          },
          {
            label: "Sharing screen",
            value: adminDashboardSummary?.screenSharingUsers ?? 0,
            detail: "Live now",
            color: "#a88bff",
            icon: "▣",
          },
          {
            label: "On voice",
            value: adminDashboardSummary?.voiceUsers ?? 0,
            detail: "Rooms & calls",
            color: "#ffbf69",
            icon: "◉",
          },
          {
            label: "Returning users",
            value: adminDashboardSummary?.returningUsers ?? 0,
            detail: "Signed in before range",
            color: "#ff83b5",
            icon: "↻",
          },
          {
            label: "Find My Squad",
            value: adminDashboardSummary?.squadFinderUsers ?? 0,
            detail: "Active searches",
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
        PLATFORM TOTALS
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: "10px",
        }}
      >
        {[
          ["Accounts", adminDashboardSummary?.accounts ?? 0],
          ["Verified", adminDashboardSummary?.verifiedAccounts ?? 0],
          ["Owners", adminDashboardSummary?.platformOwners ?? 0],
          ["Owners + MFA", adminDashboardSummary?.ownersWithMfa ?? 0],
          ["Platform Admins", adminDashboardSummary?.platformAdmins ?? 0],
          ["Hubs", adminDashboardSummary?.hubs ?? 0],
          ["Public Hubs", adminDashboardSummary?.publicHubs ?? 0],
          ["Active Sessions", adminDashboardSummary?.activeSessions ?? 0],
          ["Security / 24h", adminDashboardSummary?.securityEvents24h ?? 0],
          ["Owner Audit / 24h", adminDashboardSummary?.platformAuditEvents24h ?? 0],
          ["Suspended", adminDashboardSummary?.suspendedAccounts ?? 0],
          ["Deletion Scheduled", adminDashboardSummary?.deletionScheduledAccounts ?? 0],
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
        <strong>Privileged action unlock</strong>
        <p style={{ color: "var(--ds-muted)", fontSize: "12px" }}>
          Session revocation and other high-impact owner actions require your current password plus MFA. The unlock
          lasts 10 minutes in memory only.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "8px" }}>
          <input
            type="password"
            value={ownerReauthPassword}
            onChange={(event) => setOwnerReauthPassword(event.target.value)}
            placeholder="Current password"
            autoComplete="current-password"
          />
          <input
            type="text"
            value={ownerReauthCode}
            onChange={(event) => setOwnerReauthCode(event.target.value.toUpperCase().replace(/\s/g, "").slice(0, 19))}
            placeholder="Authenticator or recovery code"
            autoComplete="one-time-code"
          />
          <button
            type="button"
            className="modal-primary dc-owner-unlock-button"
            onClick={() => void ownerPrivilegedReauth()}
            disabled={ownerManagementBusy || !ownerReauthPassword || !ownerReauthCode.trim()}
          >
            Unlock
          </button>
        </div>
        {ownerReauthNotice && (
          <div style={{ marginTop: "8px", color: "var(--ds-text-soft)", fontSize: "11px" }}>{ownerReauthNotice}</div>
        )}
      </div>
    </>
  );
}
