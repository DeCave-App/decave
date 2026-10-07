// Platform owner dashboard > Audit log.

import type { Dispatch, SetStateAction } from "react";
import type { AdminAuditEvent } from "../../types";
import { readableAuditLabel } from "../../format";
import { localeForLanguage, preferredTimeOptions } from "../../locale";

type Props = {
  adminAuditEvents: AdminAuditEvent[];
  adminAuditFilter: string;
  setAdminAuditFilter: Dispatch<SetStateAction<string>>;
  adminEventRange: "all" | "24h" | "7d" | "30d";
  setAdminEventRange: Dispatch<SetStateAction<"all" | "24h" | "7d" | "30d">>;
};

export function AdminAuditTab({
  adminAuditEvents,
  adminAuditFilter,
  setAdminAuditFilter,
  adminEventRange,
  setAdminEventRange,
}: Props) {
  return (
    <div style={{ display: "grid", gap: "8px" }}>
      <div className="admin-filter-bar single-search">
        <input
          type="search"
          value={adminAuditFilter}
          onChange={(event) => setAdminAuditFilter(event.target.value)}
          placeholder="Filter action, actor, target or country"
        />
        <select
          value={adminEventRange}
          onChange={(event) => setAdminEventRange(event.target.value as typeof adminEventRange)}
          aria-label="Audit date range"
        >
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="all">All time</option>
        </select>
        <button
          type="button"
          className="modal-secondary"
          onClick={() => {
            const blob = new Blob([JSON.stringify(adminAuditEvents, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `decave-audit-${new Date().toISOString().slice(0, 10)}.json`;
            anchor.click();
            URL.revokeObjectURL(url);
          }}
        >
          Export JSON
        </button>
        {adminAuditFilter && (
          <button type="button" className="modal-secondary" onClick={() => setAdminAuditFilter("")}>
            Clear
          </button>
        )}
      </div>
      {adminAuditEvents
        .filter((event) => {
          const query = adminAuditFilter.trim().toLowerCase();
          const rangeMs =
            adminEventRange === "24h"
              ? 86400000
              : adminEventRange === "7d"
                ? 604800000
                : adminEventRange === "30d"
                  ? 2592000000
                  : null;
          if (rangeMs && Date.parse(event.createdAt) < Date.now() - rangeMs) return false;
          return (
            !query ||
            [
              event.action,
              event.actorUsername ?? "",
              event.actorUserId,
              event.targetUsername ?? "",
              event.targetUserId ?? "",
              event.requestCountry ?? "",
              JSON.stringify(event.detail),
            ].some((value) => value.toLowerCase().includes(query))
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
              <strong>{readableAuditLabel(event.action)}</strong>
              <span style={{ color: "var(--ds-muted)", fontSize: "10px" }}>
                {new Date(event.createdAt).toLocaleString(localeForLanguage(), preferredTimeOptions())}
              </span>
            </div>
            <div style={{ color: "var(--ds-muted)", fontSize: "11px", marginTop: "4px" }}>
              Actor: {event.actorUsername || event.actorUserId}
              {event.targetUsername || event.targetUserId
                ? ` · Target: ${event.targetUsername || event.targetUserId}`
                : ""}
              {event.requestCountry ? ` · ${event.requestCountry}` : ""}
            </div>
            <details className="dc-admin-technical">
              <summary>Technical details</summary>
              <code>{event.action}</code>
              <pre>{JSON.stringify(event.detail ?? {}, null, 2)}</pre>
            </details>
          </div>
        ))}
    </div>
  );
}
