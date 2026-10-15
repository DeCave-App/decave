// Platform owner dashboard > Accounts: search, review and moderate accounts.

import type { Dispatch, SetStateAction } from "react";
import type { AccountUser, AdminAccountSummary, AdminAccountDetail } from "../../types";
import { readableAuditLabel } from "../../format";
import { adminValueLabel } from "./adminValues";
import { selectStyle } from "../../inline-styles";
import { useTranslation } from "react-i18next";
import { formatDate } from "../../../i18n/format";

type Props = {
  currentUser: AccountUser;
  ownerReauthToken: string;
  ownerReauthExpiresAt: number;
  adminAccounts: AdminAccountSummary[];
  adminAccountSearch: string;
  setAdminAccountSearch: Dispatch<SetStateAction<string>>;
  adminAccountRoleFilter: "all" | "owner" | "admin" | "user";
  setAdminAccountRoleFilter: Dispatch<SetStateAction<"all" | "owner" | "admin" | "user">>;
  adminAccountStateFilter: "all" | "active" | "suspended" | "reset" | "deletion" | "erased" | "unverified";
  setAdminAccountStateFilter: Dispatch<
    SetStateAction<"all" | "active" | "suspended" | "reset" | "deletion" | "erased" | "unverified">
  >;
  adminDashboardBusy: boolean;
  selectedAdminAccount: AdminAccountDetail | null;
  setSelectedAdminAccount: Dispatch<SetStateAction<AdminAccountDetail | null>>;
  adminActionReason: string;
  setAdminActionReason: Dispatch<SetStateAction<string>>;
  adminSuspendDuration: string;
  setAdminSuspendDuration: Dispatch<SetStateAction<string>>;
  adminEraseConfirmation: string;
  setAdminEraseConfirmation: Dispatch<SetStateAction<string>>;
  adminTransferTarget: string;
  setAdminTransferTarget: Dispatch<SetStateAction<string>>;
  adminPlatformRoleChoice: "owner" | "admin" | "user";
  setAdminPlatformRoleChoice: Dispatch<SetStateAction<"owner" | "admin" | "user">>;
  adminCorrectionBirthDate: string;
  setAdminCorrectionBirthDate: Dispatch<SetStateAction<string>>;
  loadAdminDashboard: (search?: string) => Promise<void>;
  revokeAdminAccountSessions: (targetUserId: string) => Promise<void>;
  loadAdminAccountDetail: (userId: string) => Promise<void>;
  suspendAdminAccount: () => Promise<void>;
  unsuspendAdminAccount: () => Promise<void>;
  correctAdminAccountAge: () => Promise<void>;
  forceAdminPasswordReset: () => Promise<void>;
  resendAdminVerificationEmail: () => Promise<void>;
  scheduleAdminAccountDeletion: () => Promise<void>;
  restoreAdminAccount: () => Promise<void>;
  eraseAdminAccount: () => Promise<void>;
  changeAdminPlatformRole: () => Promise<void>;
  transferAdminHubOwnership: (hubId: number) => Promise<void>;
};

export function AdminAccountsTab({
  currentUser,
  ownerReauthToken,
  ownerReauthExpiresAt,
  adminAccounts,
  adminAccountSearch,
  setAdminAccountSearch,
  adminAccountRoleFilter,
  setAdminAccountRoleFilter,
  adminAccountStateFilter,
  setAdminAccountStateFilter,
  adminDashboardBusy,
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
  loadAdminDashboard,
  revokeAdminAccountSessions,
  loadAdminAccountDetail,
  suspendAdminAccount,
  unsuspendAdminAccount,
  correctAdminAccountAge,
  forceAdminPasswordReset,
  resendAdminVerificationEmail,
  scheduleAdminAccountDeletion,
  restoreAdminAccount,
  eraseAdminAccount,
  changeAdminPlatformRole,
  transferAdminHubOwnership,
}: Props) {
  const { t } = useTranslation(["common", "hub", "chat"]);
  return (
    <div style={{ display: "grid", gap: "12px" }}>
      <div className="admin-filter-bar">
        <input
          type="text"
          value={adminAccountSearch}
          onChange={(event) => setAdminAccountSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void loadAdminDashboard(adminAccountSearch);
          }}
          placeholder={t("common.admin.accounts.search")}
        />
        <select
          value={adminAccountRoleFilter}
          onChange={(event) => setAdminAccountRoleFilter(event.target.value as typeof adminAccountRoleFilter)}
          aria-label={t("common.admin.accounts.roleFilter")}
        >
          <option value="all">{t("hub.sidebar.allRoles")}</option>
          <option value="owner">{t("hub.sidebar.owners")}</option>
          <option value="admin">{t("hub.sidebar.admins")}</option>
          <option value="user">{t("common.admin.accounts.users")}</option>
        </select>
        <select
          value={adminAccountStateFilter}
          onChange={(event) => setAdminAccountStateFilter(event.target.value as typeof adminAccountStateFilter)}
          aria-label={t("common.admin.accounts.stateFilter")}
        >
          <option value="all">{t("common.admin.accounts.allStates")}</option>
          <option value="active">{t("common.admin.accounts.stateActive")}</option>
          <option value="suspended">{t("common.admin.accounts.stateSuspended")}</option>
          <option value="reset">{t("common.admin.accounts.stateReset")}</option>
          <option value="deletion">{t("common.admin.accounts.stateDeletion")}</option>
          <option value="erased">{t("common.admin.accounts.stateErased")}</option>
          <option value="unverified">{t("common.admin.accounts.stateUnverified")}</option>
        </select>
        <button type="button" className="modal-secondary" onClick={() => void loadAdminDashboard(adminAccountSearch)}>
          {t("common.actions.search")}
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: selectedAdminAccount ? "minmax(360px, .9fr) minmax(430px, 1.1fr)" : "1fr",
          gap: "12px",
          alignItems: "start",
        }}
      >
        <div style={{ display: "grid", gap: "8px" }}>
          {adminAccounts
            .filter((account) => {
              if (adminAccountRoleFilter !== "all" && account.platformRole !== adminAccountRoleFilter) return false;
              if (adminAccountStateFilter === "all") return true;
              if (adminAccountStateFilter === "suspended") return account.suspended;
              if (adminAccountStateFilter === "reset") return account.passwordResetRequired;
              if (adminAccountStateFilter === "deletion") return Boolean(account.deletedAt) && !account.erasedAt;
              if (adminAccountStateFilter === "erased") return Boolean(account.erasedAt);
              if (adminAccountStateFilter === "unverified") return !account.emailVerified;
              return !account.suspended && !account.passwordResetRequired && !account.deletedAt && !account.erasedAt;
            })
            .map((account) => (
              <button
                type="button"
                key={account.id}
                onClick={() => void loadAdminAccountDetail(account.id)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(160px,1.2fr) minmax(170px,1fr) auto",
                  alignItems: "center",
                  gap: "10px",
                  padding: "11px",
                  textAlign: "left",
                  borderRadius: "10px",
                  background:
                    selectedAdminAccount?.id === account.id
                      ? "color-mix(in srgb, var(--ds-muted) 26%, transparent)"
                      : "var(--ds-surface-2)",
                  border:
                    selectedAdminAccount?.id === account.id
                      ? "1px solid color-mix(in srgb, var(--ds-accent) 48%, transparent)"
                      : "1px solid color-mix(in srgb, var(--ds-border) 14%, transparent)",
                  color: "inherit",
                  cursor: "pointer",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <strong>{account.username}</strong>
                  <div
                    style={{
                      color: "var(--ds-muted)",
                      fontSize: "9px",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {account.id}
                  </div>
                </div>
                <div
                  style={{
                    color: "var(--ds-muted)",
                    fontSize: "10px",
                    overflowWrap: "anywhere",
                  }}
                >
                  {t("common.admin.accounts.roleSessions", {
                    role: adminValueLabel("platformRole", account.platformRole),
                    count: account.activeSessions,
                  })}
                </div>
                <div
                  style={{
                    fontSize: "9px",
                    fontWeight: 800,
                    color: account.erasedAt
                      ? "var(--ds-muted)"
                      : account.deletedAt
                        ? "var(--ds-danger)"
                        : account.suspended
                          ? "var(--ds-warn)"
                          : account.passwordResetRequired
                            ? "var(--ds-accent-2)"
                            : "var(--ds-success)",
                  }}
                >
                  {account.erasedAt
                    ? t("common.admin.accounts.badgeErased")
                    : account.deletedAt
                      ? t("common.admin.accounts.badgeDeletion")
                      : account.suspended
                        ? t("common.admin.accounts.badgeSuspended")
                        : account.passwordResetRequired
                          ? t("common.admin.accounts.badgeReset")
                          : t("common.admin.accounts.badgeActive")}
                </div>
              </button>
            ))}
        </div>

        {selectedAdminAccount && (
          <div
            style={{
              display: "grid",
              gap: "12px",
              padding: "14px",
              borderRadius: "12px",
              background: "var(--ds-surface-2)",
              border: "1px solid color-mix(in srgb, var(--ds-accent-2) 16%, transparent)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "12px",
                alignItems: "flex-start",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div className="social-kicker">{t("common.admin.accounts.kicker")}</div>
                <h3 style={{ margin: "4px 0" }}>{selectedAdminAccount.username}</h3>
                <div
                  style={{
                    color: "var(--ds-muted)",
                    fontSize: "10px",
                    overflowWrap: "anywhere",
                  }}
                >
                  {selectedAdminAccount.id}
                </div>
              </div>
              <button type="button" className="modal-secondary" onClick={() => setSelectedAdminAccount(null)}>
                {t("common.actions.close")}
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2,minmax(0,1fr))",
                gap: "8px",
                color: "var(--ds-muted)",
                fontSize: "11px",
              }}
            >
              <div>
                <strong>{t("common.auth.email")}</strong>
                <div style={{ overflowWrap: "anywhere" }}>
                  {selectedAdminAccount.email || t("common.admin.accounts.noEmail")}
                </div>
              </div>
              <div>
                <strong>{t("common.admin.accounts.created")}</strong>
                <div>{formatDate(selectedAdminAccount.createdAt, "dateTime")}</div>
              </div>
              <div>
                <strong>{t("common.admin.accounts.sessions")}</strong>
                <div>{selectedAdminAccount.activeSessions}</div>
              </div>
              <div>
                <strong>{t("common.admin.accounts.hubsOwned")}</strong>
                <div>{selectedAdminAccount.hubsOwned.length}</div>
              </div>
              {selectedAdminAccount.platformRole === "owner" && (
                <>
                  <div>
                    <strong>{t("common.admin.accounts.ownerMfa")}</strong>
                    <div>
                      {selectedAdminAccount.ownerMfaEnabled
                        ? t("common.admin.accounts.enabled")
                        : t("common.admin.accounts.notEnabled")}
                    </div>
                  </div>
                  <div>
                    <strong>{t("common.admin.accounts.recoveryCodes")}</strong>
                    <div>
                      {t("common.admin.accounts.remaining", {
                        count: selectedAdminAccount.ownerRecoveryCodesRemaining,
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div
              style={{
                padding: "11px",
                borderRadius: "10px",
                background: "var(--ds-surface-2)",
                border: "1px solid color-mix(in srgb, var(--ds-border) 14%, transparent)",
                display: "grid",
                gap: "8px",
              }}
            >
              <strong>{t("common.admin.accounts.platformRole")}</strong>
              <div style={{ display: "flex", gap: "8px" }}>
                <select
                  value={adminPlatformRoleChoice}
                  onChange={(event) => setAdminPlatformRoleChoice(event.target.value as "user" | "admin" | "owner")}
                  style={selectStyle}
                >
                  <option value="user">{t("common.admin.accounts.roleUser")}</option>
                  <option value="admin">{t("common.roles.admin")}</option>
                  <option value="owner">{t("common.roles.owner")}</option>
                </select>
                <button
                  type="button"
                  className="modal-secondary"
                  disabled={
                    adminDashboardBusy ||
                    adminPlatformRoleChoice === selectedAdminAccount.platformRole ||
                    !ownerReauthToken ||
                    ownerReauthExpiresAt <= Date.now()
                  }
                  onClick={() => void changeAdminPlatformRole()}
                >
                  {t("common.admin.accounts.changeRole")}
                </button>
              </div>
              <span style={{ color: "var(--ds-muted)", fontSize: "10px" }}>{t("common.admin.accounts.roleHint")}</span>
            </div>

            <div
              style={{
                display: "grid",
                gap: "8px",
                padding: "11px",
                borderRadius: "10px",
                background: "var(--ds-surface-2)",
                border: "1px solid color-mix(in srgb, var(--ds-border) 14%, transparent)",
              }}
            >
              <strong>{t("common.admin.accounts.securityActions")}</strong>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="modal-secondary"
                  disabled={
                    adminDashboardBusy ||
                    selectedAdminAccount.activeSessions < 1 ||
                    !ownerReauthToken ||
                    ownerReauthExpiresAt <= Date.now()
                  }
                  onClick={() => void revokeAdminAccountSessions(selectedAdminAccount.id)}
                >
                  {t("common.admin.accounts.revokeSessions")}
                </button>
                <button
                  type="button"
                  className="modal-secondary"
                  disabled={
                    adminDashboardBusy ||
                    selectedAdminAccount.id === currentUser.id ||
                    !selectedAdminAccount.emailVerified ||
                    Boolean(selectedAdminAccount.deletedAt) ||
                    Boolean(selectedAdminAccount.erasedAt) ||
                    !ownerReauthToken ||
                    ownerReauthExpiresAt <= Date.now()
                  }
                  onClick={() => void forceAdminPasswordReset()}
                >
                  {t("common.admin.accounts.forceReset")}
                </button>
                {selectedAdminAccount.email && !selectedAdminAccount.emailVerified && (
                  <button
                    type="button"
                    className="modal-secondary"
                    disabled={
                      adminDashboardBusy ||
                      Boolean(selectedAdminAccount.deletedAt) ||
                      Boolean(selectedAdminAccount.erasedAt) ||
                      !ownerReauthToken ||
                      ownerReauthExpiresAt <= Date.now()
                    }
                    onClick={() => void resendAdminVerificationEmail()}
                  >
                    {t("common.admin.accounts.resendVerification")}
                  </button>
                )}
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gap: "8px",
                padding: "11px",
                borderRadius: "10px",
                background:
                  selectedAdminAccount.ageStatus === "ineligible"
                    ? "color-mix(in srgb, var(--ds-danger) 16%, transparent)"
                    : "var(--ds-surface-2)",
                border:
                  selectedAdminAccount.ageStatus === "ineligible"
                    ? "1px solid color-mix(in srgb, var(--ds-danger) 28%, transparent)"
                    : "1px solid color-mix(in srgb, var(--ds-border) 14%, transparent)",
              }}
            >
              <strong>{t("common.admin.accounts.ageTitle")}</strong>
              <span
                style={{
                  color: selectedAdminAccount.ageStatus === "ineligible" ? "var(--ds-danger)" : "var(--ds-muted)",
                  fontSize: "11px",
                }}
              >
                {selectedAdminAccount.ageStatus === "ineligible"
                  ? t("common.admin.accounts.ageRestricted")
                  : t("common.admin.accounts.ageSummary", {
                      status: adminValueLabel("ageStatus", selectedAdminAccount.ageStatus),
                      band: adminValueLabel("ageBand", selectedAdminAccount.ageBand),
                      method: adminValueLabel("ageAssuranceMethod", selectedAdminAccount.ageAssuranceMethod),
                    })}
              </span>
              {selectedAdminAccount.ageStatus === "ineligible" && (
                <>
                  <span style={{ color: "var(--ds-text-soft)", fontSize: "10px" }}>
                    {t("common.admin.accounts.ageHint")}
                  </span>
                  <input
                    type="date"
                    value={adminCorrectionBirthDate}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(event) => setAdminCorrectionBirthDate(event.target.value)}
                    aria-label={t("common.admin.accounts.correctedBirthDate")}
                  />
                  <button
                    type="button"
                    className="modal-secondary"
                    disabled={
                      adminDashboardBusy ||
                      !adminCorrectionBirthDate ||
                      !ownerReauthToken ||
                      ownerReauthExpiresAt <= Date.now()
                    }
                    onClick={() => void correctAdminAccountAge()}
                  >
                    {t("common.admin.accounts.correctAge")}
                  </button>
                </>
              )}
            </div>

            {!selectedAdminAccount.deletedAt && !selectedAdminAccount.erasedAt && (
              <div
                style={{
                  display: "grid",
                  gap: "8px",
                  padding: "11px",
                  borderRadius: "10px",
                  background: "color-mix(in srgb, var(--ds-warn) 12%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--ds-warn) 22%, transparent)",
                }}
              >
                <strong>{t("common.admin.accounts.suspension")}</strong>
                {selectedAdminAccount.suspended ? (
                  <>
                    <div style={{ color: "var(--ds-warn)", fontSize: "11px" }}>
                      {selectedAdminAccount.suspendedUntil
                        ? t(
                            selectedAdminAccount.suspensionReason
                              ? "common.admin.accounts.suspendedUntilReason"
                              : "common.admin.accounts.suspendedUntil",
                            {
                              date: formatDate(selectedAdminAccount.suspendedUntil, "dateTime"),
                              reason: selectedAdminAccount.suspensionReason ?? "",
                            },
                          )
                        : t(
                            selectedAdminAccount.suspensionReason
                              ? "common.admin.accounts.suspendedIndefinitelyReason"
                              : "common.admin.accounts.suspendedIndefinitely",
                            { reason: selectedAdminAccount.suspensionReason ?? "" },
                          )}
                    </div>
                    <button
                      type="button"
                      className="modal-secondary"
                      disabled={adminDashboardBusy || !ownerReauthToken || ownerReauthExpiresAt <= Date.now()}
                      onClick={() => void unsuspendAdminAccount()}
                    >
                      {t("common.admin.accounts.unsuspend")}
                    </button>
                  </>
                ) : (
                  <>
                    <input
                      type="text"
                      value={adminActionReason}
                      onChange={(event) => setAdminActionReason(event.target.value)}
                      placeholder={t("common.admin.accounts.suspendReason")}
                      maxLength={300}
                    />
                    <select
                      value={adminSuspendDuration}
                      onChange={(event) => setAdminSuspendDuration(event.target.value)}
                      style={selectStyle}
                    >
                      <option value="1">{t("common.admin.accounts.duration1")}</option>
                      <option value="7">{t("common.admin.accounts.duration7")}</option>
                      <option value="30">{t("common.admin.accounts.duration30")}</option>
                      <option value="90">{t("common.admin.accounts.duration90")}</option>
                      <option value="indefinite">{t("common.admin.accounts.durationIndefinite")}</option>
                    </select>
                    <button
                      type="button"
                      className="modal-secondary"
                      disabled={
                        adminDashboardBusy ||
                        selectedAdminAccount.platformRole === "owner" ||
                        selectedAdminAccount.id === currentUser.id ||
                        !adminActionReason.trim() ||
                        !ownerReauthToken ||
                        ownerReauthExpiresAt <= Date.now()
                      }
                      onClick={() => void suspendAdminAccount()}
                    >
                      {t("common.admin.accounts.suspend")}
                    </button>
                    {selectedAdminAccount.platformRole === "owner" && (
                      <span style={{ color: "var(--ds-muted)", fontSize: "10px" }}>
                        {t("common.admin.accounts.demoteFirst")}
                      </span>
                    )}
                  </>
                )}
              </div>
            )}

            {selectedAdminAccount.hubsOwned.length > 0 && (
              <div
                style={{
                  display: "grid",
                  gap: "8px",
                  padding: "11px",
                  borderRadius: "10px",
                  background: "var(--ds-surface-2)",
                  border: "1px solid color-mix(in srgb, var(--ds-border) 14%, transparent)",
                }}
              >
                <strong>{t("common.admin.accounts.ownedHubs")}</strong>
                <input
                  type="text"
                  value={adminTransferTarget}
                  onChange={(event) => setAdminTransferTarget(event.target.value)}
                  placeholder={t("common.admin.accounts.transferTarget")}
                />
                {selectedAdminAccount.hubsOwned.map((hub) => (
                  <div
                    key={hub.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "10px",
                      alignItems: "center",
                      padding: "9px",
                      borderRadius: "8px",
                      background: "var(--ds-surface-2)",
                    }}
                  >
                    <span>
                      <strong>{hub.name}</strong>
                      <small
                        style={{
                          display: "block",
                          color: "var(--ds-muted)",
                          marginTop: "2px",
                        }}
                      >
                        {t("common.admin.accounts.hubMeta", {
                          id: hub.id,
                          visibility: adminValueLabel("visibility", hub.visibility),
                        })}
                      </small>
                    </span>
                    <button
                      type="button"
                      className="modal-secondary"
                      disabled={
                        adminDashboardBusy ||
                        !adminTransferTarget.trim() ||
                        !ownerReauthToken ||
                        ownerReauthExpiresAt <= Date.now()
                      }
                      onClick={() => void transferAdminHubOwnership(hub.id)}
                    >
                      {t("common.admin.accounts.transfer")}
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div
              style={{
                display: "grid",
                gap: "8px",
                padding: "11px",
                borderRadius: "10px",
                background: "color-mix(in srgb, var(--ds-danger) 15%, transparent)",
                border: "1px solid color-mix(in srgb, var(--ds-danger) 28%, transparent)",
              }}
            >
              <strong style={{ color: "var(--ds-danger)" }}>{t("common.admin.accounts.dangerZone")}</strong>

              {selectedAdminAccount.erasedAt ? (
                <div style={{ color: "var(--ds-muted)", fontSize: "11px" }}>
                  {t("common.admin.accounts.erasedOn", { date: formatDate(selectedAdminAccount.erasedAt, "dateTime") })}
                </div>
              ) : selectedAdminAccount.deletedAt ? (
                <>
                  <div style={{ color: "var(--ds-danger)", fontSize: "11px" }}>
                    {selectedAdminAccount.deleteAfter
                      ? t("common.admin.accounts.deletionRecoveryEnds", {
                          date: formatDate(selectedAdminAccount.deleteAfter, "dateTime"),
                        })
                      : t("common.admin.accounts.deletionDisabled")}
                  </div>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="modal-secondary"
                      disabled={adminDashboardBusy || !ownerReauthToken || ownerReauthExpiresAt <= Date.now()}
                      onClick={() => void restoreAdminAccount()}
                    >
                      {t("common.admin.accounts.restore")}
                    </button>
                  </div>

                  <input
                    type="text"
                    value={adminEraseConfirmation}
                    onChange={(event) => setAdminEraseConfirmation(event.target.value)}
                    placeholder={t("common.admin.accounts.erasePlaceholder", { name: selectedAdminAccount.username })}
                  />
                  <button
                    type="button"
                    className="modal-secondary"
                    disabled={
                      adminDashboardBusy ||
                      !selectedAdminAccount.deleteAfter ||
                      selectedAdminAccount.deleteAfter > new Date().toISOString() ||
                      adminEraseConfirmation !== selectedAdminAccount.username ||
                      !ownerReauthToken ||
                      ownerReauthExpiresAt <= Date.now()
                    }
                    onClick={() => void eraseAdminAccount()}
                    style={{
                      color: "var(--ds-danger)",
                      borderColor: "color-mix(in srgb, var(--ds-danger) 48%, transparent)",
                    }}
                  >
                    {t("common.admin.accounts.erase")}
                  </button>
                </>
              ) : (
                <>
                  <input
                    type="text"
                    value={adminActionReason}
                    onChange={(event) => setAdminActionReason(event.target.value)}
                    placeholder={t("common.admin.accounts.deleteReason")}
                    maxLength={300}
                  />
                  <button
                    type="button"
                    className="modal-secondary"
                    disabled={
                      adminDashboardBusy ||
                      selectedAdminAccount.platformRole === "owner" ||
                      selectedAdminAccount.id === currentUser.id ||
                      selectedAdminAccount.hubsOwned.length > 0 ||
                      !adminActionReason.trim() ||
                      !ownerReauthToken ||
                      ownerReauthExpiresAt <= Date.now()
                    }
                    onClick={() => void scheduleAdminAccountDeletion()}
                    style={{
                      color: "var(--ds-danger)",
                      borderColor: "color-mix(in srgb, var(--ds-danger) 48%, transparent)",
                    }}
                  >
                    {t("common.admin.accounts.scheduleDeletion")}
                  </button>
                  <span style={{ color: "var(--ds-muted)", fontSize: "10px" }}>
                    {t("common.admin.accounts.deletionHint")}
                  </span>
                </>
              )}
            </div>

            <div
              style={{
                display: "grid",
                gap: "7px",
                padding: "11px",
                borderRadius: "10px",
                background: "var(--ds-surface-2)",
                border: "1px solid color-mix(in srgb, var(--ds-border) 12%, transparent)",
              }}
            >
              <strong>{t("common.admin.accounts.recentSecurity")}</strong>
              {selectedAdminAccount.recentSecurityEvents.length === 0 ? (
                <span style={{ color: "var(--ds-muted)", fontSize: "10px" }}>
                  {t("common.admin.accounts.noRecentSecurity")}
                </span>
              ) : (
                selectedAdminAccount.recentSecurityEvents.slice(0, 8).map((event) => (
                  <div
                    key={event.id}
                    style={{
                      fontSize: "10px",
                      color: "var(--ds-muted)",
                      paddingTop: "5px",
                      borderTop: "1px solid color-mix(in srgb, var(--ds-border) 8%, transparent)",
                    }}
                  >
                    <strong>{readableAuditLabel(event.event)}</strong> · {formatDate(event.createdAt, "dateTime")}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
