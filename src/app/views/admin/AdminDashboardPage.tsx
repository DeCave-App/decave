// Platform owner dashboard: header, tabs and the active tab.

import type { Dispatch, SetStateAction } from "react";
import TrustSafetyDashboard from "../../../components/TrustSafetyDashboard";
import type { AccountUser, AdminDashboardTab } from "../../types";
import { AdminOverviewTab } from "./AdminOverviewTab";
import { AdminAccountsTab } from "./AdminAccountsTab";
import { AdminSecurityTab } from "./AdminSecurityTab";
import { AdminGamesTab } from "./AdminGamesTab";
import { AdminAuditTab } from "./AdminAuditTab";
import type { AdminDashboardState } from "../../state/admin-dashboard";
import type { OwnerSecurityState } from "../../state/owner-security";
import type { AdminActions } from "../../actions/admin";

type Props = {
  currentUser: AccountUser;
  setShowAdminDashboard: Dispatch<SetStateAction<boolean>>;
  adminDashboardTab: AdminDashboardTab;
  setAdminDashboardTab: Dispatch<SetStateAction<AdminDashboardTab>>;
  authorizedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  adminDashboard: AdminDashboardState;
  ownerSecurity: OwnerSecurityState;
  adminActions: AdminActions;
};

export function AdminDashboardPage({
  currentUser,
  setShowAdminDashboard,
  adminDashboardTab,
  setAdminDashboardTab,
  authorizedFetch,
  adminDashboard,
  ownerSecurity,
  adminActions,
}: Props) {
  const {
    ownerPrivilegedReauth,
    loadAdminDashboard,
    reviewSquadGameSuggestion,
    revokeAdminAccountSessions,
    loadAdminAccountDetail,
    suspendAdminAccount,
    unsuspendAdminAccount,
    correctAdminAccountAge,
    forceAdminPasswordReset,
    scheduleAdminAccountDeletion,
    restoreAdminAccount,
    eraseAdminAccount,
    changeAdminPlatformRole,
    transferAdminHubOwnership,
  } = adminActions;
  const {
    ownerReauthPassword,
    setOwnerReauthPassword,
    ownerReauthCode,
    setOwnerReauthCode,
    ownerReauthToken,
    ownerReauthExpiresAt,
    ownerReauthNotice,
    setOwnerReauthNotice,
    ownerManagementBusy,
  } = ownerSecurity;
  const {
    adminDashboardSummary,
    adminAccounts,
    adminSecurityEvents,
    adminAuditEvents,
    adminGameSuggestions,
    adminAccountSearch,
    setAdminAccountSearch,
    adminAccountRoleFilter,
    setAdminAccountRoleFilter,
    adminAccountStateFilter,
    setAdminAccountStateFilter,
    adminSecurityFilter,
    setAdminSecurityFilter,
    adminAuditFilter,
    setAdminAuditFilter,
    adminSecuritySeverity,
    setAdminSecuritySeverity,
    adminEventRange,
    setAdminEventRange,
    adminDashboardBusy,
    adminDashboardNotice,
    adminUsageFrom,
    setAdminUsageFrom,
    adminUsageTo,
    setAdminUsageTo,
    selectedAdminAccount,
    setSelectedAdminAccount,
    adminActionReason,
    setAdminActionReason,
    adminSuspendDuration,
    setAdminSuspendDuration,
    adminEraseConfirmation,
    setAdminEraseConfirmation,
    adminTransferTarget,
    setAdminTransferTarget,
    adminPlatformRoleChoice,
    setAdminPlatformRoleChoice,
    adminCorrectionBirthDate,
    setAdminCorrectionBirthDate,
  } = adminDashboard;
  return (
    <section
      className="dc-workspace-page dc-admin-page"
      role="dialog"
      aria-modal="true"
      aria-label="Admin and security"
    >
      <div
        className="dc-admin-shell"
        style={{
          width: "min(1180px, 96vw)",
          maxWidth: "1180px",
          height: "min(820px, 92vh)",
          maxHeight: "92vh",
          display: "grid",
          gridTemplateRows: "auto auto minmax(0, 1fr)",
          overflow: "hidden",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "18px",
          }}
        >
          <div>
            <div className="social-kicker">OWNER ONLY</div>
            <h2 style={{ marginBottom: "4px" }}>Admin & Security</h2>
            <p style={{ margin: 0, color: "var(--ds-muted)" }}>
              Platform health, accounts, security events and audit history.
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              className="modal-secondary"
              onClick={() => void loadAdminDashboard()}
              disabled={adminDashboardBusy}
            >
              {adminDashboardBusy ? "Refreshing..." : "Refresh"}
            </button>
            <button type="button" className="modal-secondary" onClick={() => setShowAdminDashboard(false)}>
              Close
            </button>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: "8px",
            flexWrap: "wrap",
            marginTop: "16px",
            paddingBottom: "12px",
            borderBottom: "1px solid color-mix(in srgb, var(--ds-border) 16%, transparent)",
          }}
        >
          {(["overview", "accounts", "games", "security", "audit", "trust-safety"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className={adminDashboardTab === tab ? "modal-primary" : "modal-secondary"}
              onClick={() => {
                setAdminDashboardTab(tab);
                if (tab !== "accounts") setSelectedAdminAccount(null);
              }}
            >
              {tab === "overview"
                ? "Overview"
                : tab === "accounts"
                  ? "Accounts"
                  : tab === "games"
                    ? "Squad Games"
                    : tab === "security"
                      ? "Security Events"
                      : tab === "audit"
                        ? "Owner Audit"
                        : "Trust & Safety"}
            </button>
          ))}
        </div>

        <div style={{ minHeight: 0, overflowY: "auto", paddingTop: "16px" }}>
          {adminDashboardNotice && (
            <div
              style={{
                marginBottom: "12px",
                padding: "10px 12px",
                borderRadius: "9px",
                background: "color-mix(in srgb, var(--ds-accent) 12%, transparent)",
                color: "var(--ds-text-soft)",
              }}
            >
              {adminDashboardNotice}
            </div>
          )}

          {adminDashboardTab === "overview" && (
            <AdminOverviewTab
              ownerReauthPassword={ownerReauthPassword}
              setOwnerReauthPassword={setOwnerReauthPassword}
              ownerReauthCode={ownerReauthCode}
              setOwnerReauthCode={setOwnerReauthCode}
              ownerReauthNotice={ownerReauthNotice}
              ownerManagementBusy={ownerManagementBusy}
              adminDashboardSummary={adminDashboardSummary}
              adminDashboardBusy={adminDashboardBusy}
              adminUsageFrom={adminUsageFrom}
              setAdminUsageFrom={setAdminUsageFrom}
              adminUsageTo={adminUsageTo}
              setAdminUsageTo={setAdminUsageTo}
              ownerPrivilegedReauth={ownerPrivilegedReauth}
              loadAdminDashboard={loadAdminDashboard}
            />
          )}

          {adminDashboardTab === "accounts" && (
            <AdminAccountsTab
              currentUser={currentUser}
              ownerReauthToken={ownerReauthToken}
              ownerReauthExpiresAt={ownerReauthExpiresAt}
              adminAccounts={adminAccounts}
              adminAccountSearch={adminAccountSearch}
              setAdminAccountSearch={setAdminAccountSearch}
              adminAccountRoleFilter={adminAccountRoleFilter}
              setAdminAccountRoleFilter={setAdminAccountRoleFilter}
              adminAccountStateFilter={adminAccountStateFilter}
              setAdminAccountStateFilter={setAdminAccountStateFilter}
              adminDashboardBusy={adminDashboardBusy}
              selectedAdminAccount={selectedAdminAccount}
              setSelectedAdminAccount={setSelectedAdminAccount}
              adminActionReason={adminActionReason}
              setAdminActionReason={setAdminActionReason}
              adminSuspendDuration={adminSuspendDuration}
              setAdminSuspendDuration={setAdminSuspendDuration}
              adminEraseConfirmation={adminEraseConfirmation}
              setAdminEraseConfirmation={setAdminEraseConfirmation}
              adminTransferTarget={adminTransferTarget}
              setAdminTransferTarget={setAdminTransferTarget}
              adminPlatformRoleChoice={adminPlatformRoleChoice}
              setAdminPlatformRoleChoice={setAdminPlatformRoleChoice}
              adminCorrectionBirthDate={adminCorrectionBirthDate}
              setAdminCorrectionBirthDate={setAdminCorrectionBirthDate}
              loadAdminDashboard={loadAdminDashboard}
              revokeAdminAccountSessions={revokeAdminAccountSessions}
              loadAdminAccountDetail={loadAdminAccountDetail}
              suspendAdminAccount={suspendAdminAccount}
              unsuspendAdminAccount={unsuspendAdminAccount}
              correctAdminAccountAge={correctAdminAccountAge}
              forceAdminPasswordReset={forceAdminPasswordReset}
              scheduleAdminAccountDeletion={scheduleAdminAccountDeletion}
              restoreAdminAccount={restoreAdminAccount}
              eraseAdminAccount={eraseAdminAccount}
              changeAdminPlatformRole={changeAdminPlatformRole}
              transferAdminHubOwnership={transferAdminHubOwnership}
            />
          )}

          {adminDashboardTab === "trust-safety" && (
            <TrustSafetyDashboard
              request={authorizedFetch}
              ownerReauthToken={ownerReauthToken}
              ownerReauthExpiresAt={ownerReauthExpiresAt}
              onOpenPrivilegedUnlock={() => {
                setAdminDashboardTab("overview");
                setOwnerReauthNotice("Use the privileged action unlock above, then return to Trust & Safety.");
              }}
            />
          )}

          {adminDashboardTab === "security" && (
            <AdminSecurityTab
              adminSecurityEvents={adminSecurityEvents}
              adminSecurityFilter={adminSecurityFilter}
              setAdminSecurityFilter={setAdminSecurityFilter}
              adminSecuritySeverity={adminSecuritySeverity}
              setAdminSecuritySeverity={setAdminSecuritySeverity}
              adminEventRange={adminEventRange}
              setAdminEventRange={setAdminEventRange}
            />
          )}

          {adminDashboardTab === "games" && (
            <AdminGamesTab
              adminGameSuggestions={adminGameSuggestions}
              adminDashboardBusy={adminDashboardBusy}
              reviewSquadGameSuggestion={reviewSquadGameSuggestion}
            />
          )}

          {adminDashboardTab === "audit" && (
            <AdminAuditTab
              adminAuditEvents={adminAuditEvents}
              adminAuditFilter={adminAuditFilter}
              setAdminAuditFilter={setAdminAuditFilter}
              adminEventRange={adminEventRange}
              setAdminEventRange={setAdminEventRange}
            />
          )}
        </div>
      </div>
    </section>
  );
}
