// Platform owner dashboard > Security: recent security events.

import type { Dispatch, SetStateAction } from "react";
import type { AdminSecurityEvent } from "../../types";
import { readableAuditLabel, readableDevice, securityEventSeverity } from "../../format";
import { localeForLanguage, preferredTimeOptions } from "../../locale";

type Props = {
  adminSecurityEvents: AdminSecurityEvent[];
  adminSecurityFilter: string;
  setAdminSecurityFilter: Dispatch<SetStateAction<string>>;
  adminSecuritySeverity: "all" | "high" | "medium" | "info";
  setAdminSecuritySeverity: Dispatch<SetStateAction<"all" | "high" | "medium" | "info">>;
  adminEventRange: "all" | "24h" | "7d" | "30d";
  setAdminEventRange: Dispatch<SetStateAction<"all" | "24h" | "7d" | "30d">>;
};

export function AdminSecurityTab({
  adminSecurityEvents,
  adminSecurityFilter,
  setAdminSecurityFilter,
  adminSecuritySeverity,
  setAdminSecuritySeverity,
  adminEventRange,
  setAdminEventRange,
}: Props) {
  return (
    <div style={{ display: "grid", gap: "8px" }}>
      <div className="admin-filter-bar single-search">
        <input
          type="search"
          value={adminSecurityFilter}
          onChange={(event) => setAdminSecurityFilter(event.target.value)}
          placeholder="Filter by event, account, detail or device"
        />
        <select
          value={adminSecuritySeverity}
          onChange={(event) => setAdminSecuritySeverity(event.target.value as typeof adminSecuritySeverity)}
          aria-label="Security severity"
        >
          <option value="all">All severities</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="info">Info</option>
        </select>
        <select
          value={adminEventRange}
          onChange={(event) => setAdminEventRange(event.target.value as typeof adminEventRange)}
          aria-label="Security date range"
        >
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="all">All time</option>
        </select>
        {adminSecurityFilter && (
          <button type="button" className="modal-secondary" onClick={() => setAdminSecurityFilter("")}>
            Clear
          </button>
        )}
      </div>
      {adminSecurityEvents
        .filter((event) => {
          const query = adminSecurityFilter.trim().toLowerCase();
          const rangeMs =
            adminEventRange === "24h"
              ? 86400000
              : adminEventRange === "7d"
                ? 604800000
                : adminEventRange === "30d"
                  ? 2592000000
                  : null;
          if (rangeMs && Date.parse(event.createdAt) < Date.now() - rangeMs) return false;
          if (adminSecuritySeverity !== "all" && securityEventSeverity(event.event) !== adminSecuritySeverity)
            return false;
          return (
            !query ||
            [event.event, event.username ?? "", event.detail, event.userAgent, event.userId ?? ""].some((value) =>
              value.toLowerCase().includes(query),
            )
          );
        })
        .map((event) => (
          <div
            key={event.id}
            style={{
              padding: "11px",
              borderRadius: "10px",
              background: "var(--ds-surface-2)",
              border: "1px solid color-mix(in srgb, var(--ds-border) 14%, transparent)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
              <strong>
                {readableAuditLabel(event.event)}{" "}
                <span className={`dc-security-severity ${securityEventSeverity(event.event)}`}>
                  {securityEventSeverity(event.event)}
                </span>
              </strong>
              <span style={{ color: "var(--ds-muted)", fontSize: "10px" }}>
                {new Date(event.createdAt).toLocaleString(localeForLanguage(), preferredTimeOptions())}
              </span>
            </div>
            <div style={{ color: "var(--ds-muted)", fontSize: "11px", marginTop: "4px" }}>
              {event.username || "Unknown account"}
              {event.detail ? ` · ${event.detail}` : ""}
            </div>
            <div style={{ color: "var(--ds-muted)", fontSize: "9px", marginTop: "4px" }}>
              {readableDevice(event.userAgent)}
            </div>
            <details className="dc-admin-technical">
              <summary>Technical details</summary>
              <code>{event.event}</code>
              <code>{event.userAgent || "No user-agent recorded"}</code>
            </details>
          </div>
        ))}
    </div>
  );
}
