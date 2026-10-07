// Platform owner dashboard > Games: Squad Finder game suggestions.

import type { SquadGameSuggestion } from "../../types";
import { localeForLanguage, preferredTimeOptions } from "../../locale";

type Props = {
  adminGameSuggestions: SquadGameSuggestion[];
  adminDashboardBusy: boolean;
  reviewSquadGameSuggestion: (suggestionId: string, action: "approve" | "reject") => Promise<void>;
};

export function AdminGamesTab({ adminGameSuggestions, adminDashboardBusy, reviewSquadGameSuggestion }: Props) {
  return (
    <div style={{ display: "grid", gap: "10px" }}>
      <div>
        <h3 style={{ margin: 0 }}>Squad Finder game review</h3>
        <p style={{ color: "var(--ds-muted)", fontSize: "12px" }}>
          Approved suggestions immediately become selectable on web and mobile.
        </p>
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
          No games are waiting for review.
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
                Suggested by {item.submittedBy} ·{" "}
                {new Date(item.createdAt).toLocaleString(localeForLanguage(), preferredTimeOptions())}
              </div>
            </div>
            <button
              type="button"
              className="modal-primary"
              disabled={adminDashboardBusy}
              onClick={() => void reviewSquadGameSuggestion(item.id, "approve")}
            >
              Approve
            </button>
            <button
              type="button"
              className="modal-secondary"
              disabled={adminDashboardBusy}
              onClick={() => void reviewSquadGameSuggestion(item.id, "reject")}
            >
              Reject
            </button>
          </div>
        ))}
    </div>
  );
}
