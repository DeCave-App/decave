// Platform owner dashboard > Accounts: search, review and moderate accounts.

import type { Dispatch, SetStateAction } from "react";
import type { AccountUser, AdminAccountSummary, AdminAccountDetail } from "../../types";
import { readableAuditLabel } from "../../format";
import { selectStyle } from "../../inline-styles";
import { localeForLanguage, preferredTimeOptions } from "../../locale";

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
  scheduleAdminAccountDeletion,
  restoreAdminAccount,
  eraseAdminAccount,
  changeAdminPlatformRole,
  transferAdminHubOwnership,
}: Props) {
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
          placeholder="Search username, email or DeCave ID"
        />
        <select
          value={adminAccountRoleFilter}
          onChange={(event) => setAdminAccountRoleFilter(event.target.value as typeof adminAccountRoleFilter)}
          aria-label="Filter accounts by role"
        >
          <option value="all">All roles</option>
          <option value="owner">Owners</option>
          <option value="admin">Admins</option>
          <option value="user">Users</option>
        </select>
        <select
          value={adminAccountStateFilter}
          onChange={(event) => setAdminAccountStateFilter(event.target.value as typeof adminAccountStateFilter)}
          aria-label="Filter accounts by status"
        >
          <option value="all">All states</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="reset">Password reset required</option>
          <option value="deletion">Deletion scheduled</option>
          <option value="erased">Erased</option>
          <option value="unverified">Email unverified</option>
        </select>
        <button type="button" className="modal-secondary" onClick={() => void loadAdminDashboard(adminAccountSearch)}>
          Search
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
                  {account.platformRole} · {account.activeSessions} session(s)
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
                    ? "ERASED"
                    : account.deletedAt
                      ? "DELETION"
                      : account.suspended
                        ? "SUSPENDED"
                        : account.passwordResetRequired
                          ? "RESET REQUIRED"
                          : "ACTIVE"}
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
                <div className="social-kicker">ACCOUNT CONTROL</div>
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
                Close
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
                <strong>Email</strong>
                <div style={{ overflowWrap: "anywhere" }}>{selectedAdminAccount.email || "No email"}</div>
              </div>
              <div>
                <strong>Created</strong>
                <div>
                  {new Date(selectedAdminAccount.createdAt).toLocaleString(localeForLanguage(), preferredTimeOptions())}
                </div>
              </div>
              <div>
                <strong>Sessions</strong>
                <div>{selectedAdminAccount.activeSessions}</div>
              </div>
              <div>
                <strong>Hubs owned</strong>
                <div>{selectedAdminAccount.hubsOwned.length}</div>
              </div>
              {selectedAdminAccount.platformRole === "owner" && (
                <>
                  <div>
                    <strong>Owner MFA</strong>
                    <div>{selectedAdminAccount.ownerMfaEnabled ? "Enabled" : "Not enabled"}</div>
                  </div>
                  <div>
                    <strong>Recovery codes</strong>
                    <div>{selectedAdminAccount.ownerRecoveryCodesRemaining} remaining</div>
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
              <strong>Platform role</strong>
              <div style={{ display: "flex", gap: "8px" }}>
                <select
                  value={adminPlatformRoleChoice}
                  onChange={(event) => setAdminPlatformRoleChoice(event.target.value as "user" | "admin" | "owner")}
                  style={selectStyle}
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                  <option value="owner">Owner</option>
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
                  Change Role
                </button>
              </div>
              <span style={{ color: "var(--ds-muted)", fontSize: "10px" }}>
                Owner changes obey the two-owner safety floor and verified-email requirement.
              </span>
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
              <strong>Security actions</strong>
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
                  Revoke Sessions
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
                  Force Password Reset
                </button>
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
              <strong>Age eligibility</strong>
              <span
                style={{
                  color: selectedAdminAccount.ageStatus === "ineligible" ? "var(--ds-danger)" : "var(--ds-muted)",
                  fontSize: "11px",
                }}
              >
                {selectedAdminAccount.ageStatus === "ineligible"
                  ? "Age restricted — the account cannot use DeCave."
                  : `${selectedAdminAccount.ageStatus} · ${selectedAdminAccount.ageBand} · ${selectedAdminAccount.ageAssuranceMethod}`}
              </span>
              {selectedAdminAccount.ageStatus === "ineligible" && (
                <>
                  <span style={{ color: "var(--ds-text-soft)", fontSize: "10px" }}>
                    If the birth date was entered incorrectly, an owner can review the corrected date. It must show the
                    account holder is at least 18.
                  </span>
                  <input
                    type="date"
                    value={adminCorrectionBirthDate}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(event) => setAdminCorrectionBirthDate(event.target.value)}
                    aria-label="Corrected birth date"
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
                    Correct age and unblock
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
                <strong>Suspension</strong>
                {selectedAdminAccount.suspended ? (
                  <>
                    <div style={{ color: "var(--ds-warn)", fontSize: "11px" }}>
                      Suspended
                      {selectedAdminAccount.suspendedUntil
                        ? ` until ${new Date(selectedAdminAccount.suspendedUntil).toLocaleString(localeForLanguage(), preferredTimeOptions())}`
                        : " indefinitely"}
                      {selectedAdminAccount.suspensionReason ? ` · ${selectedAdminAccount.suspensionReason}` : ""}
                    </div>
                    <button
                      type="button"
                      className="modal-secondary"
                      disabled={adminDashboardBusy || !ownerReauthToken || ownerReauthExpiresAt <= Date.now()}
                      onClick={() => void unsuspendAdminAccount()}
                    >
                      Unsuspend Account
                    </button>
                  </>
                ) : (
                  <>
                    <input
                      type="text"
                      value={adminActionReason}
                      onChange={(event) => setAdminActionReason(event.target.value)}
                      placeholder="Reason for suspension"
                      maxLength={300}
                    />
                    <select
                      value={adminSuspendDuration}
                      onChange={(event) => setAdminSuspendDuration(event.target.value)}
                      style={selectStyle}
                    >
                      <option value="1">1 day</option>
                      <option value="7">7 days</option>
                      <option value="30">30 days</option>
                      <option value="90">90 days</option>
                      <option value="indefinite">Indefinite</option>
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
                      Suspend Account
                    </button>
                    {selectedAdminAccount.platformRole === "owner" && (
                      <span style={{ color: "var(--ds-muted)", fontSize: "10px" }}>
                        Demote the owner before suspension.
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
                <strong>Owned Hubs</strong>
                <input
                  type="text"
                  value={adminTransferTarget}
                  onChange={(event) => setAdminTransferTarget(event.target.value)}
                  placeholder="New owner ID, username or verified email"
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
                        #{hub.id} · {hub.visibility}
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
                      Transfer
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
              <strong style={{ color: "var(--ds-danger)" }}>Danger Zone</strong>

              {selectedAdminAccount.erasedAt ? (
                <div style={{ color: "var(--ds-muted)", fontSize: "11px" }}>
                  Personal/authentication data was permanently erased on{" "}
                  {new Date(selectedAdminAccount.erasedAt).toLocaleString(localeForLanguage(), preferredTimeOptions())}.
                  The immutable ID remains as an anonymized audit tombstone.
                </div>
              ) : selectedAdminAccount.deletedAt ? (
                <>
                  <div style={{ color: "var(--ds-danger)", fontSize: "11px" }}>
                    Account disabled for deletion.
                    {selectedAdminAccount.deleteAfter
                      ? ` Recovery period ends ${new Date(selectedAdminAccount.deleteAfter).toLocaleString(localeForLanguage(), preferredTimeOptions())}.`
                      : ""}
                  </div>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="modal-secondary"
                      disabled={adminDashboardBusy || !ownerReauthToken || ownerReauthExpiresAt <= Date.now()}
                      onClick={() => void restoreAdminAccount()}
                    >
                      Restore Account
                    </button>
                  </div>

                  <input
                    type="text"
                    value={adminEraseConfirmation}
                    onChange={(event) => setAdminEraseConfirmation(event.target.value)}
                    placeholder={`Type ${selectedAdminAccount.username} after the 30-day recovery period`}
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
                    Permanently Erase Personal Data
                  </button>
                </>
              ) : (
                <>
                  <input
                    type="text"
                    value={adminActionReason}
                    onChange={(event) => setAdminActionReason(event.target.value)}
                    placeholder="Reason for account deletion"
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
                    Schedule Account Deletion
                  </button>
                  <span style={{ color: "var(--ds-muted)", fontSize: "10px" }}>
                    Deletion disables access immediately and gives a 30-day restore window. Transfer owned Hubs and
                    demote platform owners first.
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
              <strong>Recent account security</strong>
              {selectedAdminAccount.recentSecurityEvents.length === 0 ? (
                <span style={{ color: "var(--ds-muted)", fontSize: "10px" }}>No recent security events.</span>
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
                    <strong>{readableAuditLabel(event.event)}</strong> ·{" "}
                    {new Date(event.createdAt).toLocaleString(localeForLanguage(), preferredTimeOptions())}
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
