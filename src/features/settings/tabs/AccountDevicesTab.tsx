// Settings → Account & devices: username, email, password, DeCave ID,
// two-factor sign-in and sign-in alerts, where you're signed in, your data,
// disable or delete; platform-owner tools tucked away for owners only.

import type { SettingsWindowProps } from "../../../app/views/settings/SettingsWindow";
import type { DeviceSession } from "../../../app/types";
import { HTTP_URL } from "../../../app/env";
import { localeForLanguage } from "../../../app/locale";
import { Icon } from "../../../components/Icon";
import { DataExportPanel, SessionsPanel } from "../AccountPanels";
import { TwoFactorPanel, type MfaStatus } from "../TwoFactorPanel";
import { SettingsSection, ToggleRow } from "../SettingsControls";
import { useStateField } from "../useSettingField";
import { useSettingsT } from "../useSettingsT";
import { PlatformOwnerTools } from "./PlatformOwnerTools";

type Props = SettingsWindowProps & { onMfaStatus?: (status: MfaStatus) => void };

export function AccountDevicesTab(props: Props) {
  const { t } = useSettingsT();
  const {
    currentUser,
    securityNotice,
    securityBusy,
    effectiveStreamerMode,
    accountActions,
    logoutAllSessions,
    copyMyDecaveId,
    ownerSecurity,
    accountSessions,
    preferences,
    onMfaStatus,
  } = props;
  const { openAccountEditor, loadAccountSessions, revokeDeviceSession, beginAccountDangerAction } = accountActions;
  const { accountPreferences, setAccountPreferences } = preferences;
  const { securityVerificationUrl, deviceSessions, sessionBusyId } = accountSessions;
  const loginAlerts = useStateField(
    "account.loginAlerts",
    accountPreferences.loginAlerts,
    (next: boolean) => setAccountPreferences((current) => ({ ...current, loginAlerts: next })),
    ["account"],
  );
  const usernameLocked = Boolean(
    accountPreferences.usernameChangeAvailableAt &&
    Date.parse(accountPreferences.usernameChangeAvailableAt) > Date.now(),
  );

  return (
    <>
      <SettingsSection title={t("settings.account.detailsTitle")}>
        <div className="dc-account-details-card">
          <div className="dc-account-detail-row" data-settings-anchor="username">
            <span>
              <strong>{t("settings.account.username")}</strong>
              <small>
                {usernameLocked && accountPreferences.usernameChangeAvailableAt
                  ? t("settings.account.usernameAgain", {
                      date: new Date(accountPreferences.usernameChangeAvailableAt).toLocaleDateString(
                        localeForLanguage(),
                      ),
                    })
                  : t("settings.account.usernameRule")}
              </small>
            </span>
            <b>{currentUser.username}</b>
            <button
              type="button"
              className="modal-secondary"
              disabled={usernameLocked}
              onClick={() => openAccountEditor("username")}
            >
              {t("settings.account.edit")}
            </button>
          </div>
          <div className="dc-account-detail-row" data-settings-anchor="email">
            <span>
              <strong>{t("settings.account.email")}</strong>
              <small>
                {currentUser.emailVerified
                  ? t("settings.account.verified")
                  : currentUser.email
                    ? t("settings.account.verificationRequired")
                    : t("settings.account.noEmail")}
              </small>
            </span>
            <b>
              {effectiveStreamerMode
                ? t("settings.account.hiddenByStreamerMode")
                : currentUser.email || t("settings.account.notAdded")}
            </b>
            <button type="button" className="modal-secondary" onClick={() => openAccountEditor("email")}>
              {t("settings.account.edit")}
            </button>
          </div>
          <div className="dc-account-detail-row" data-settings-anchor="password">
            <span>
              <strong>{t("settings.account.password")}</strong>
              <small>{t("settings.account.passwordHelp")}</small>
            </span>
            <b>••••••••••••</b>
            <button type="button" className="modal-secondary" onClick={() => openAccountEditor("password")}>
              {t("settings.account.edit")}
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
            {t("settings.account.localVerification")}
          </a>
        )}
      </SettingsSection>

      <SettingsSection anchor="decave-id" title={t("settings.account.decaveIdTitle")}>
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
            {t("settings.account.decaveIdHelp")}
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
            {t("settings.account.copyDecaveId")}
          </button>
        </div>
      </SettingsSection>

      <SettingsSection anchor="two-factor" title={t("settings.account.twoFactorTitle")}>
        <TwoFactorPanel apiBase={HTTP_URL} onStatus={onMfaStatus} />
        <ToggleRow
          anchor="sign-in-alerts"
          field={loginAlerts}
          style={{ marginTop: 10 }}
          label={t("settings.account.loginAlerts")}
          description={
            currentUser.email && currentUser.emailVerified
              ? t("settings.account.loginAlertsHelp", {
                  email: effectiveStreamerMode ? t("settings.account.yourVerifiedAddress") : currentUser.email,
                })
              : t("settings.account.loginAlertsNeedEmail")
          }
        />
      </SettingsSection>

      <SettingsSection anchor="sessions" title={t("settings.account.sessionsTitle")}>
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
      </SettingsSection>

      <SettingsSection anchor="your-data" title={t("settings.account.yourDataTitle")}>
        <DataExportPanel apiBase={HTTP_URL} />
      </SettingsSection>

      <SettingsSection anchor="delete-account" title={t("settings.account.dangerTitle")} danger>
        <div className="dc-account-danger-actions">
          <button
            type="button"
            className="dc-account-danger-row disable"
            onClick={() => beginAccountDangerAction("disable")}
          >
            <span>⏻</span>
            <strong>{t("settings.account.disable")}</strong>
          </button>
          <button
            type="button"
            className="dc-account-danger-row delete"
            onClick={() => beginAccountDangerAction("delete")}
          >
            <span>
              <Icon name="trash" />
            </span>
            <strong>{t("settings.account.delete")}</strong>
          </button>
        </div>
      </SettingsSection>

      {ownerSecurity.platformOwnerActive && <PlatformOwnerTools {...props} />}
    </>
  );
}
