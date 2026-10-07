import { Icon } from "../../../components/Icon";
import { TwoFactorPanel, SessionsPanel, DataExportPanel } from "../../../features/settings";
import type { AccountUser, DeviceSession } from "../../types";
import { HTTP_URL } from "../../env";
import { localeForLanguage } from "../../locale";
import { settingsSectionStyle, settingsSectionTitleStyle } from "../../inline-styles";
import type { OwnerSecurityState } from "../../state/owner-security";
import type { AccountSessionsState } from "../../state/account-sessions";
import type { PreferencesState } from "../../state/preferences";

type Props = {
  currentUser: AccountUser;
  securityNotice: string;
  securityBusy: boolean;
  effectiveStreamerMode: boolean;
  openAccountEditor: (field: "username" | "email" | "phone" | "password") => void;
  startOwnerMfaSetup: () => Promise<void>;
  enableOwnerMfa: () => Promise<void>;
  ownerPrivilegedReauth: () => Promise<void>;
  promotePlatformOwner: () => Promise<void>;
  demotePlatformOwner: (targetUserId: string) => Promise<void>;
  regenerateOwnerRecoveryCodes: () => Promise<void>;
  loadAccountSessions: () => Promise<void>;
  revokeDeviceSession: (session: DeviceSession) => Promise<void>;
  beginAccountDangerAction: (action: "disable" | "delete") => void;
  logoutAllSessions: () => Promise<void>;
  copyMyDecaveId: () => Promise<void>;
  ownerSecurity: OwnerSecurityState;
  accountSessions: AccountSessionsState;
  preferences: PreferencesState;
};

export function AccountSettingsSection({
  currentUser,
  securityNotice,
  securityBusy,
  effectiveStreamerMode,
  openAccountEditor,
  startOwnerMfaSetup,
  enableOwnerMfa,
  ownerPrivilegedReauth,
  promotePlatformOwner,
  demotePlatformOwner,
  regenerateOwnerRecoveryCodes,
  loadAccountSessions,
  revokeDeviceSession,
  beginAccountDangerAction,
  logoutAllSessions,
  copyMyDecaveId,
  ownerSecurity,
  accountSessions,
  preferences,
}: Props) {
  const { accountPreferences, setAccountPreferences } = preferences;
  const { securityVerificationUrl, deviceSessions, sessionBusyId } = accountSessions;
  const {
    ownerMfaEnabledState,
    ownerMfaCode,
    setOwnerMfaCode,
    ownerMfaNotice,
    ownerRecoveryCodes,
    platformOwners,
    ownerTargetIdentifier,
    setOwnerTargetIdentifier,
    ownerManagementNotice,
    platformOwnerActive,
    ownerMfaPassword,
    setOwnerMfaPassword,
    ownerMfaSecret,
    ownerMfaOtpAuth,
    ownerMfaBusy,
    ownerReauthPassword,
    setOwnerReauthPassword,
    ownerReauthCode,
    setOwnerReauthCode,
    ownerReauthToken,
    ownerReauthExpiresAt,
    ownerReauthNotice,
    ownerManagementBusy,
  } = ownerSecurity;
  return (
    <>
      <div style={settingsSectionStyle}>
        <div style={settingsSectionTitleStyle}>ACCOUNT DETAILS</div>
        <div className="dc-account-details-card">
          <div className="dc-account-detail-row">
            <span>
              <strong>Username</strong>
              <small>
                {accountPreferences.usernameChangeAvailableAt &&
                Date.parse(accountPreferences.usernameChangeAvailableAt) > Date.now()
                  ? `Can be changed again ${new Date(accountPreferences.usernameChangeAvailableAt).toLocaleDateString(localeForLanguage())}`
                  : "Can be changed once every 30 days"}
              </small>
            </span>
            <b>{currentUser.username}</b>
            <button
              type="button"
              className="modal-secondary"
              disabled={Boolean(
                accountPreferences.usernameChangeAvailableAt &&
                Date.parse(accountPreferences.usernameChangeAvailableAt) > Date.now(),
              )}
              onClick={() => openAccountEditor("username")}
            >
              Edit
            </button>
          </div>
          <div className="dc-account-detail-row">
            <span>
              <strong>Email</strong>
              <small>
                {currentUser.emailVerified
                  ? "Verified"
                  : currentUser.email
                    ? "Verification required"
                    : "No email added"}
              </small>
            </span>
            <b>{effectiveStreamerMode ? "Hidden by Streamer Mode" : currentUser.email || "Not added"}</b>
            <button type="button" className="modal-secondary" onClick={() => openAccountEditor("email")}>
              Edit
            </button>
          </div>
          <div className="dc-account-detail-row">
            <span>
              <strong>Phone number</strong>
              <small>Used for account information. SMS verification is not enabled yet.</small>
            </span>
            <b>{effectiveStreamerMode ? "Hidden by Streamer Mode" : accountPreferences.phoneNumber || "Not added"}</b>
            <button type="button" className="modal-secondary" onClick={() => openAccountEditor("phone")}>
              Edit
            </button>
          </div>
          <div className="dc-account-detail-row">
            <span>
              <strong>Password</strong>
              <small>Changing your password signs out every active session.</small>
            </span>
            <b>••••••••••••</b>
            <button type="button" className="modal-secondary" onClick={() => openAccountEditor("password")}>
              Edit
            </button>
          </div>
        </div>
        {securityNotice && (
          <div className="settings-audio-notice" style={{ marginTop: 10 }}>
            {securityNotice}
          </div>
        )}
        {securityVerificationUrl && (
          <a className="dc-local-verification-link" href={securityVerificationUrl}>
            Open local email verification link
          </a>
        )}
      </div>

      <div style={settingsSectionStyle}>
        <div style={settingsSectionTitleStyle}>YOUR DECAVE ID</div>
        <div
          style={{
            display: "grid",
            gap: "10px",
            padding: "14px",
            border: "1px solid color-mix(in srgb, var(--ds-accent-2) 20%, transparent)",
            borderRadius: "12px",
            background: "linear-gradient(145deg, rgba(18, 42, 62, .42), rgba(31, 20, 61, .28))",
          }}
        >
          <div style={{ color: "var(--ds-muted)", fontSize: "12px", lineHeight: 1.5 }}>
            Share this unique ID with someone you trust so they can send you a friend request. Your online/offline
            presence is visible to them only after you become friends.
          </div>
          <div
            style={{
              padding: "10px 11px",
              borderRadius: "9px",
              border: "1px solid color-mix(in srgb, var(--ds-border) 22%, transparent)",
              background: "var(--ds-surface-2)",
              color: "var(--ds-text)",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
              fontSize: "12px",
              overflowWrap: "anywhere",
            }}
          >
            {currentUser.id}
          </div>
          <button
            type="button"
            className="modal-secondary"
            onClick={() => void copyMyDecaveId()}
            style={{ justifySelf: "start" }}
          >
            Copy DeCave ID
          </button>
        </div>
      </div>

      {platformOwnerActive && (
        <div style={settingsSectionStyle}>
          <div style={settingsSectionTitleStyle}>PLATFORM OWNER SECURITY</div>
          <div
            style={{
              display: "grid",
              gap: "12px",
              padding: "14px",
              border: "1px solid color-mix(in srgb, var(--ds-accent-2) 22%, transparent)",
              borderRadius: "12px",
              background: "linear-gradient(145deg, rgba(18, 42, 62, .36), rgba(31, 20, 61, .30))",
            }}
          >
            <div style={{ color: "var(--ds-muted)", fontSize: "12px", lineHeight: 1.5 }}>
              MFA is required when an enrolled platform owner signs in. Privileged owner-management actions also require
              a fresh password + MFA check.
            </div>

            {ownerMfaEnabledState ? (
              <div style={{ color: "var(--ds-success)", fontSize: "12px", fontWeight: 800 }}>✓ Owner MFA enabled</div>
            ) : (
              <>
                {!ownerMfaSecret && (
                  <>
                    <input
                      type="password"
                      value={ownerMfaPassword}
                      onChange={(event) => setOwnerMfaPassword(event.target.value)}
                      placeholder="Current password"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      className="modal-secondary"
                      onClick={() => void startOwnerMfaSetup()}
                      disabled={ownerMfaBusy || !ownerMfaPassword}
                    >
                      {ownerMfaBusy ? "Please wait..." : "Set up owner MFA"}
                    </button>
                  </>
                )}

                {ownerMfaSecret && (
                  <>
                    <div style={{ color: "var(--ds-text)", fontSize: "12px" }}>
                      Add this secret to your authenticator app:
                    </div>
                    <code style={{ overflowWrap: "anywhere" }}>{ownerMfaSecret}</code>
                    <div style={{ color: "var(--ds-muted)", fontSize: "12px", overflowWrap: "anywhere" }}>
                      {ownerMfaOtpAuth}
                    </div>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={ownerMfaCode}
                      onChange={(event) => setOwnerMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="6-digit authenticator code"
                      maxLength={6}
                    />
                    <button
                      type="button"
                      className="modal-primary"
                      onClick={() => void enableOwnerMfa()}
                      disabled={ownerMfaBusy || ownerMfaCode.length !== 6}
                    >
                      Enable owner MFA
                    </button>
                  </>
                )}
              </>
            )}

            {ownerMfaNotice && <div style={{ color: "var(--ds-text-soft)", fontSize: "12px" }}>{ownerMfaNotice}</div>}

            {ownerMfaEnabledState && (
              <div
                style={{
                  display: "grid",
                  gap: "9px",
                  padding: "12px",
                  borderRadius: "10px",
                  border: "1px solid color-mix(in srgb, var(--ds-accent) 24%, transparent)",
                  background: "var(--ds-sink)",
                }}
              >
                <strong>Unlock privileged owner actions</strong>
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
                  onChange={(event) =>
                    setOwnerReauthCode(event.target.value.toUpperCase().replace(/\s/g, "").slice(0, 19))
                  }
                  placeholder="Authenticator or recovery code"
                  autoComplete="one-time-code"
                />
                <button
                  type="button"
                  className="modal-primary dc-owner-unlock-button"
                  onClick={() => void ownerPrivilegedReauth()}
                  disabled={ownerManagementBusy || ownerMfaBusy || !ownerReauthPassword || !ownerReauthCode.trim()}
                >
                  Unlock for 10 minutes
                </button>
                <button
                  type="button"
                  className="modal-secondary"
                  onClick={() => void startOwnerMfaSetup()}
                  disabled={
                    ownerManagementBusy ||
                    ownerMfaBusy ||
                    !ownerReauthPassword ||
                    (!ownerReauthCode.trim() && (!ownerReauthToken || ownerReauthExpiresAt <= Date.now()))
                  }
                >
                  {ownerMfaBusy ? "Please wait..." : "Replace owner MFA"}
                </button>
                <div style={{ color: "var(--ds-muted)", fontSize: "12px", lineHeight: 1.5 }}>
                  Replacing MFA requires your current password and authenticator or recovery code. An active owner
                  unlock can provide the factor proof.
                </div>
                {ownerReauthNotice && (
                  <div style={{ color: "var(--ds-text-soft)", fontSize: "12px" }}>{ownerReauthNotice}</div>
                )}
              </div>
            )}

            <div
              style={{
                display: "grid",
                gap: "8px",
                opacity: ownerReauthToken && ownerReauthExpiresAt > Date.now() ? 1 : 0.58,
              }}
            >
              <strong>Platform owners</strong>
              {platformOwners.map((owner) => (
                <div
                  key={owner.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "10px",
                    padding: "10px",
                    borderRadius: "9px",
                    background: "var(--ds-surface-2)",
                    border: "1px solid color-mix(in srgb, var(--ds-border) 16%, transparent)",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800 }}>{owner.username}</div>
                    <div
                      style={{
                        color: "var(--ds-muted)",
                        fontSize: "12px",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {owner.email || owner.id}
                    </div>
                  </div>
                  {owner.id !== currentUser.id && (
                    <button
                      type="button"
                      className="modal-secondary"
                      onClick={() => void demotePlatformOwner(owner.id)}
                      disabled={
                        ownerManagementBusy ||
                        platformOwners.length <= 2 ||
                        !ownerReauthToken ||
                        ownerReauthExpiresAt <= Date.now()
                      }
                    >
                      Demote
                    </button>
                  )}
                </div>
              ))}

              <input
                type="text"
                value={ownerTargetIdentifier}
                onChange={(event) => setOwnerTargetIdentifier(event.target.value)}
                placeholder="Promote by DeCave ID, username, or verified email"
              />
              <button
                type="button"
                className="modal-secondary"
                onClick={() => void promotePlatformOwner()}
                disabled={
                  ownerManagementBusy ||
                  !ownerTargetIdentifier.trim() ||
                  !ownerReauthToken ||
                  ownerReauthExpiresAt <= Date.now()
                }
              >
                Promote platform owner
              </button>

              <button
                type="button"
                className="modal-secondary"
                onClick={() => void regenerateOwnerRecoveryCodes()}
                disabled={ownerManagementBusy || !ownerReauthToken || ownerReauthExpiresAt <= Date.now()}
              >
                Regenerate my recovery codes
              </button>

              {ownerManagementNotice && (
                <div style={{ color: "var(--ds-text-soft)", fontSize: "12px" }}>{ownerManagementNotice}</div>
              )}
            </div>

            {ownerRecoveryCodes.length > 0 && (
              <div
                style={{
                  display: "grid",
                  gap: "7px",
                  padding: "12px",
                  borderRadius: "10px",
                  border: "1px solid color-mix(in srgb, var(--ds-warn) 28%, transparent)",
                  background: "color-mix(in srgb, var(--ds-warn) 14%, transparent)",
                }}
              >
                <strong>Save these recovery codes offline now.</strong>
                {ownerRecoveryCodes.map((code) => (
                  <code key={code}>{code}</code>
                ))}
                <span style={{ color: "var(--ds-muted)", fontSize: "12px" }}>
                  Each code works once. Generating a new set invalidates the old set.
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      <div style={settingsSectionStyle}>
        <div style={settingsSectionTitleStyle}>TWO-FACTOR SIGN-IN</div>
        <TwoFactorPanel apiBase={HTTP_URL} />
        <label
          className={`settings-toggle-row${accountPreferences.loginAlerts ? " enabled" : " disabled"}`}
          style={{ marginTop: 10 }}
        >
          <span>
            <strong>Email me about new sign-ins</strong>
            <small>
              {currentUser.email && currentUser.emailVerified
                ? `When a new device, app or country signs in to your account, we email ${effectiveStreamerMode ? "your verified address" : currentUser.email} with a "This wasn't me" button.`
                : "Add and verify an email address to get sign-in alerts."}
            </small>
          </span>
          <span className="settings-toggle-control">
            <em>{accountPreferences.loginAlerts ? "ON" : "OFF"}</em>
            <input
              type="checkbox"
              checked={accountPreferences.loginAlerts}
              onChange={(event) =>
                setAccountPreferences((current) => ({ ...current, loginAlerts: event.target.checked }))
              }
            />
          </span>
        </label>
      </div>

      <div style={settingsSectionStyle}>
        <div style={settingsSectionTitleStyle}>WHERE YOU'RE SIGNED IN</div>
        <SessionsPanel
          sessions={deviceSessions}
          busyId={sessionBusyId}
          busyAll={securityBusy}
          onRevoke={(session) => void revokeDeviceSession(session as DeviceSession)}
          onRefresh={() => void loadAccountSessions()}
          onLogoutAll={() => void logoutAllSessions()}
          formatDateTime={(iso) =>
            new Date(iso).toLocaleString(localeForLanguage(), { dateStyle: "medium", timeStyle: "short" })
          }
          formatDate={(iso) => new Date(iso).toLocaleDateString(localeForLanguage(), { dateStyle: "medium" })}
        />
      </div>

      <div style={settingsSectionStyle}>
        <div style={settingsSectionTitleStyle}>YOUR DATA</div>
        <DataExportPanel apiBase={HTTP_URL} />
      </div>

      <div style={settingsSectionStyle}>
        <div style={{ ...settingsSectionTitleStyle, color: "var(--ds-danger)" }}>DISABLE OR DELETE ACCOUNT</div>
        <div className="dc-account-danger-actions">
          <button
            type="button"
            className="dc-account-danger-row disable"
            onClick={() => beginAccountDangerAction("disable")}
          >
            <span>⏻</span>
            <strong>Disable account</strong>
          </button>
          <button
            type="button"
            className="dc-account-danger-row delete"
            onClick={() => beginAccountDangerAction("delete")}
          >
            <span>
              <Icon name="trash" />
            </span>
            <strong>Delete account</strong>
          </button>
        </div>
      </div>
    </>
  );
}
