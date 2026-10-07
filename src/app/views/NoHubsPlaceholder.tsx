// Main area for accounts without a Hub yet: discover or create one, or use Friends and DMs.

import type { Dispatch, SetStateAction } from "react";
import type { HubTemplateId } from "../../../shared/hub-templates";
import type { ServerVisibility, SocialUser } from "../types";

type Props = {
  setShowCreateServer: Dispatch<SetStateAction<boolean>>;
  setNewServerName: Dispatch<SetStateAction<string>>;
  setNewServerVisibility: Dispatch<SetStateAction<ServerVisibility>>;
  setNewServerTemplate: Dispatch<SetStateAction<HubTemplateId>>;
  setServerCreateError: Dispatch<SetStateAction<string>>;
  setShowSocial: Dispatch<SetStateAction<boolean>>;
  setSocialView: Dispatch<SetStateAction<"friends" | "dm">>;
  setActiveDmUser: Dispatch<SetStateAction<SocialUser | null>>;
  openServerBrowser: () => void;
  loadSocialState: () => Promise<void>;
};

export function NoHubsPlaceholder({
  setShowCreateServer,
  setNewServerName,
  setNewServerVisibility,
  setNewServerTemplate,
  setServerCreateError,
  setShowSocial,
  setSocialView,
  setActiveDmUser,
  openServerBrowser,
  loadSocialState,
}: Props) {
  return (
    <div
      style={{
        minHeight: "100%",
        display: "grid",
        placeItems: "center",
        padding: "36px",
        background: "radial-gradient(circle at 50% 30%, rgba(107,87,255,.15), transparent 42%), rgba(5,9,18,.34)",
      }}
    >
      <div
        style={{
          width: "min(720px, 92%)",
          padding: "30px",
          borderRadius: "18px",
          border: "1px solid color-mix(in srgb, var(--ds-accent-2) 18%, transparent)",
          background: "var(--ds-surface-2)",
          boxShadow: "0 24px 80px rgba(0,0,0,.28)",
          textAlign: "center",
        }}
      >
        <div style={{ color: "var(--ds-accent-2)", fontSize: "11px", fontWeight: 900, letterSpacing: ".16em" }}>
          DECAVE HOME
        </div>
        <h2 style={{ margin: "10px 0 8px", fontSize: "28px" }}>You can join a Hub whenever you're ready</h2>
        <p style={{ color: "var(--ds-muted)", lineHeight: 1.6, margin: "0 auto 22px", maxWidth: "560px" }}>
          Your account is ready. You can use Home, Friends and DMs without joining a Hub. Create one or discover public
          Hubs at any time.
        </p>
        <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            className="modal-primary"
            onClick={() => {
              setNewServerName("");
              setNewServerVisibility("private");
              setNewServerTemplate("blank");
              setServerCreateError("");
              setShowCreateServer(true);
            }}
          >
            + Create Hub
          </button>
          <button type="button" className="modal-secondary" onClick={openServerBrowser}>
            Discover Public Hubs
          </button>
          <button
            type="button"
            className="modal-secondary"
            onClick={() => {
              setShowSocial(true);
              setSocialView("friends");
              setActiveDmUser(null);
              void loadSocialState();
            }}
          >
            Friends
          </button>
        </div>
      </div>
    </div>
  );
}
