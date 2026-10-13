// Platform owner dashboard > Games: Squad Finder game suggestions.

import type { SquadGameSuggestion } from "../../types";
import { useTranslation } from "react-i18next";
import { formatDate } from "../../../i18n/format";

type Props = {
  adminGameSuggestions: SquadGameSuggestion[];
  adminDashboardBusy: boolean;
  reviewSquadGameSuggestion: (suggestionId: string, action: "approve" | "reject") => Promise<void>;
};

export function AdminGamesTab({ adminGameSuggestions, adminDashboardBusy, reviewSquadGameSuggestion }: Props) {
  const { t } = useTranslation(["common", "hub", "chat"]);
  return (
    <div style={{ display: "grid", gap: "10px" }}>
      <div>
        <h3 style={{ margin: 0 }}>{t("common.admin.games.title")}</h3>
        <p style={{ color: "var(--ds-muted)", fontSize: "12px" }}>{t("common.admin.games.lead")}</p>
      </div>
      {adminGameSuggestions.filter((item) => item.status === "pending").length === 0 && (
        <div
          style={{
            padding: "18px",
            border: "1px dashed color-mix(in srgb, var(--ds-border) 24%, transparent)",
            borderRadius: "10px",
            color: "var(--ds-muted)",
          }}
        >
          {t("common.admin.games.empty")}
        </div>
      )}
      {adminGameSuggestions
        .filter((item) => item.status === "pending")
        .map((item) => (
          <div
            key={item.id}
            style={{
              padding: "12px",
              borderRadius: "10px",
              background: "var(--ds-surface-2)",
              border: "1px solid color-mix(in srgb, var(--ds-border) 14%, transparent)",
              display: "flex",
              alignItems: "center",
              gap: "12px",
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: 1, minWidth: "180px" }}>
              <strong>{item.gameName}</strong>
              <div style={{ color: "var(--ds-muted)", fontSize: "11px", marginTop: "4px" }}>
                {t("common.admin.games.suggestedBy", {
                  name: item.submittedBy,
                  date: formatDate(item.createdAt, "dateTime"),
                })}
              </div>
            </div>
            <button
              type="button"
              className="modal-primary"
              disabled={adminDashboardBusy}
              onClick={() => void reviewSquadGameSuggestion(item.id, "approve")}
            >
              {t("common.admin.games.approve")}
            </button>
            <button
              type="button"
              className="modal-secondary"
              disabled={adminDashboardBusy}
              onClick={() => void reviewSquadGameSuggestion(item.id, "reject")}
            >
              {t("common.admin.games.reject")}
            </button>
          </div>
        ))}
    </div>
  );
}
