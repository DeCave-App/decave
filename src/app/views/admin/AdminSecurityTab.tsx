// Platform owner dashboard > Security: recent security events.

import type { Dispatch, SetStateAction } from "react";
import type { AdminSecurityEvent } from "../../types";
import { readableAuditLabel, readableDevice, securityEventSeverity } from "../../format";
import { useTranslation } from "react-i18next";
import { formatDate } from "../../../i18n/format";

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
  const { t } = useTranslation(["common", "hub", "chat"]);
  return (
    <div style={{ display: "grid", gap: "8px" }}>
      <div className="admin-filter-bar single-search">
        <input
          type="search"
          value={adminSecurityFilter}
          onChange={(event) => setAdminSecurityFilter(event.target.value)}
          placeholder={t("common.admin.security.filter")}
        />
        <select
          value={adminSecuritySeverity}
          onChange={(event) => setAdminSecuritySeverity(event.target.value as typeof adminSecuritySeverity)}
          aria-label={t("common.admin.security.severity")}
        >
          <option value="all">{t("common.admin.security.allSeverities")}</option>
          <option value="high">{t("common.admin.security.high")}</option>
          <option value="medium">{t("common.admin.security.medium")}</option>
          <option value="info">{t("common.admin.security.info")}</option>
        </select>
        <select
          value={adminEventRange}
          onChange={(event) => setAdminEventRange(event.target.value as typeof adminEventRange)}
          aria-label={t("common.admin.security.range")}
        >
          <option value="24h">{t("common.admin.range.day")}</option>
          <option value="7d">{t("common.admin.range.week")}</option>
          <option value="30d">{t("common.admin.range.month")}</option>
          <option value="all">{t("common.admin.range.all")}</option>
        </select>
        {adminSecurityFilter && (
          <button type="button" className="modal-secondary" onClick={() => setAdminSecurityFilter("")}>
            {t("common.actions.clear")}
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
                  {securityEventSeverity(event.event) === "high"
                    ? t("common.admin.security.badgeHigh")
                    : securityEventSeverity(event.event) === "medium"
                      ? t("common.admin.security.badgeMedium")
                      : t("common.admin.security.badgeInfo")}
                </span>
              </strong>
              <span style={{ color: "var(--ds-muted)", fontSize: "10px" }}>
                {formatDate(event.createdAt, "dateTime")}
              </span>
            </div>
            <div style={{ color: "var(--ds-muted)", fontSize: "11px", marginTop: "4px" }}>
              {event.detail
                ? t("common.admin.security.accountDetail", {
                    account: event.username || t("common.admin.security.unknownAccount"),
                    detail: event.detail,
                  })
                : event.username || t("common.admin.security.unknownAccount")}
            </div>
            <div style={{ color: "var(--ds-muted)", fontSize: "9px", marginTop: "4px" }}>
              {readableDevice(event.userAgent)}
            </div>
            <details className="dc-admin-technical">
              <summary>{t("common.admin.technicalDetails")}</summary>
              <code>{event.event}</code>
              <code>{event.userAgent || t("common.admin.security.noUserAgent")}</code>
            </details>
          </div>
        ))}
    </div>
  );
}
