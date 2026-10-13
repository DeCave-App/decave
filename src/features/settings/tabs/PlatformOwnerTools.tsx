// Settings → Account & devices → Platform owner (collapsed, owners only):
// owner MFA, the privileged-action unlock, promoting and demoting owners,
// and owner recovery codes.

import type { SettingsWindowProps } from "../../../app/views/settings/SettingsWindow";
import { settingsSectionStyle, settingsSectionTitleStyle } from "../../../app/inline-styles";
import { useSettingsT } from "../useSettingsT";

export function PlatformOwnerTools({ currentUser, ownerSecurity, adminActions }: SettingsWindowProps) {
  const { t } = useSettingsT();
  const {
    startOwnerMfaSetup,
    enableOwnerMfa,
    ownerPrivilegedReauth,
    promotePlatformOwner,
    demotePlatformOwner,
    regenerateOwnerRecoveryCodes,
  } = adminActions;
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
  const unlocked = Boolean(ownerReauthToken) && ownerReauthExpiresAt > Date.now();
  const pleaseWait = t("settings.owner.pleaseWait");

  return (
    <details style={settingsSectionStyle} className="dcs-owner-tools">
      <summary style={{ ...settingsSectionTitleStyle, marginBottom: 0, cursor: "pointer", textTransform: "uppercase" }}>
        {t("settings.owner.title")}
      </summary>
      <div
        style={{
          display: "grid",
          gap: "12px",
          marginTop: "14px",
          padding: "14px",
          border: "1px solid color-mix(in srgb, var(--ds-accent-2) 22%, transparent)",
          borderRadius: "12px",
          background: "linear-gradient(145deg, rgba(18, 42, 62, .36), rgba(31, 20, 61, .30))",
        }}
      >
        <div style={{ color: "var(--ds-muted)", fontSize: "12px", lineHeight: 1.5 }}>{t("settings.owner.intro")}</div>

        {ownerMfaEnabledState ? (
          <div style={{ color: "var(--ds-success)", fontSize: "12px", fontWeight: 800 }}>
            {t("settings.owner.mfaEnabled")}
          </div>
        ) : (
          <>
            {!ownerMfaSecret && (
              <>
                <input
                  type="password"
                  value={ownerMfaPassword}
                  onChange={(event) => setOwnerMfaPassword(event.target.value)}
                  placeholder={t("settings.owner.currentPassword")}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="modal-secondary"
                  onClick={() => void startOwnerMfaSetup()}
                  disabled={ownerMfaBusy || !ownerMfaPassword}
                >
                  {ownerMfaBusy ? pleaseWait : t("settings.owner.setUpMfa")}
                </button>
              </>
            )}

            {ownerMfaSecret && (
              <>
                <div style={{ color: "var(--ds-text)", fontSize: "12px" }}>{t("settings.owner.addSecret")}</div>
                <code style={{ overflowWrap: "anywhere" }}>{ownerMfaSecret}</code>
                <div style={{ color: "var(--ds-muted)", fontSize: "12px", overflowWrap: "anywhere" }}>
                  {ownerMfaOtpAuth}
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  value={ownerMfaCode}
                  onChange={(event) => setOwnerMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder={t("settings.owner.sixDigit")}
                  maxLength={6}
                />
                <button
                  type="button"
                  className="modal-primary"
                  onClick={() => void enableOwnerMfa()}
                  disabled={ownerMfaBusy || ownerMfaCode.length !== 6}
                >
                  {t("settings.owner.enableMfa")}
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
            <strong>{t("settings.owner.unlockTitle")}</strong>
            <input
              type="password"
              value={ownerReauthPassword}
              onChange={(event) => setOwnerReauthPassword(event.target.value)}
              placeholder={t("settings.owner.currentPassword")}
              autoComplete="current-password"
            />
            <input
              type="text"
              value={ownerReauthCode}
              onChange={(event) => setOwnerReauthCode(event.target.value.toUpperCase().replace(/\s/g, "").slice(0, 19))}
              placeholder={t("settings.owner.codePlaceholder")}
              autoComplete="one-time-code"
            />
            <button
              type="button"
              className="modal-primary dc-owner-unlock-button"
              onClick={() => void ownerPrivilegedReauth()}
              disabled={ownerManagementBusy || ownerMfaBusy || !ownerReauthPassword || !ownerReauthCode.trim()}
            >
              {t("settings.owner.unlock")}
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
              {ownerMfaBusy ? pleaseWait : t("settings.owner.replaceMfa")}
            </button>
            <div style={{ color: "var(--ds-muted)", fontSize: "12px", lineHeight: 1.5 }}>
              {t("settings.owner.replaceHelp")}
            </div>
            {ownerReauthNotice && (
              <div style={{ color: "var(--ds-text-soft)", fontSize: "12px" }}>{ownerReauthNotice}</div>
            )}
          </div>
        )}

        <div style={{ display: "grid", gap: "8px", opacity: unlocked ? 1 : 0.58 }}>
          <strong>{t("settings.owner.ownersTitle")}</strong>
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
                <div style={{ color: "var(--ds-muted)", fontSize: "12px", overflowWrap: "anywhere" }}>
                  {owner.email || owner.id}
                </div>
              </div>
              {owner.id !== currentUser.id && (
                <button
                  type="button"
                  className="modal-secondary"
                  onClick={() => void demotePlatformOwner(owner.id)}
                  disabled={ownerManagementBusy || platformOwners.length <= 2 || !unlocked}
                >
                  {t("settings.owner.demote")}
                </button>
              )}
            </div>
          ))}

          <input
            type="text"
            value={ownerTargetIdentifier}
            onChange={(event) => setOwnerTargetIdentifier(event.target.value)}
            placeholder={t("settings.owner.promotePlaceholder")}
          />
          <button
            type="button"
            className="modal-secondary"
            onClick={() => void promotePlatformOwner()}
            disabled={ownerManagementBusy || !ownerTargetIdentifier.trim() || !unlocked}
          >
            {t("settings.owner.promote")}
          </button>

          <button
            type="button"
            className="modal-secondary"
            onClick={() => void regenerateOwnerRecoveryCodes()}
            disabled={ownerManagementBusy || !unlocked}
          >
            {t("settings.owner.regenerate")}
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
            <strong>{t("settings.owner.saveCodes")}</strong>
            {ownerRecoveryCodes.map((code) => (
              <code key={code}>{code}</code>
            ))}
            <span style={{ color: "var(--ds-muted)", fontSize: "12px" }}>{t("settings.owner.codesHelp")}</span>
          </div>
        )}
      </div>
    </details>
  );
}
