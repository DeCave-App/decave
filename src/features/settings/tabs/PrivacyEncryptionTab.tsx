// Settings → Privacy & encryption: encrypted messages and the devices holding
// your key, friend requests, direct messages, blocked accounts, stream
// privacy, typing indicators, your reports and age setting.

import type { SettingsWindowProps } from "../../../app/views/settings/SettingsWindow";
import type { FriendRequestPolicy } from "../../../app/types";
import { HTTP_URL } from "../../../app/env";
import { localeForLanguage } from "../../../app/locale";
import { hasDesktopActivityBridge } from "../../../app/desktop";
import { selectStyle, settingsLabelStyle } from "../../../app/inline-styles";
import { Icon } from "../../../components/Icon";
import { DmEncryptionSettings } from "../../../e2ee/DmEncryptionUi";
import { useDmE2ee } from "../../../e2ee/dm-e2ee-client";
import { BlockedAccountsPanel } from "../BlockedAccountsPanel";
import { KeyDevicesList } from "../KeyDevicesList";
import { FieldError, SettingsSection, ToggleRow } from "../SettingsControls";
import { useStateField } from "../useSettingField";
import { useSettingsT } from "../useSettingsT";
import type { PrivacySettings } from "../../../app/types";
import type { PreferencesState } from "../../../app/state/preferences";
import type { SettingsPart } from "../persist";
import { DesktopOnlyNote } from "../SettingsChrome";

const FRIEND_REQUEST_POLICIES: FriendRequestPolicy[] = ["everyone", "friends_of_friends", "none"];

/** One privacy setting as an instant-save field. */
function usePrivacyField<K extends keyof PrivacySettings>(
  preferences: PreferencesState,
  key: K,
  parts: readonly SettingsPart[],
  after?: (next: PrivacySettings[K]) => void,
) {
  return useStateField(
    `privacy.${key}`,
    preferences.privacySettings[key],
    (next: PrivacySettings[K]) => {
      preferences.setPrivacySettings((current) => ({ ...current, [key]: next }));
      after?.(next);
    },
    parts,
  );
}

export function PrivacyEncryptionTab(props: SettingsWindowProps) {
  const { t, tk } = useSettingsT();
  const dmE2ee = useDmE2ee();
  const dmE2eeAvailable = dmE2ee.available;
  const {
    currentUser,
    preferences,
    setShowMyReports,
    setBlockedUserIds,
    captureApps,
    autoStreamerActive,
    voiceChannelRef,
    localScreenStreamRef,
    sendSocket,
    sendTypingState,
  } = props;
  const { privacySettings } = preferences;

  const friendRequests = usePrivacyField(preferences, "friendRequestPolicy", ["account"]);
  const streamPreviews = usePrivacyField(preferences, "allowStreamPreviews", ["account"], (allowStreamPreview) => {
    if (localScreenStreamRef.current && voiceChannelRef.current !== null) {
      sendSocket({
        type: "VOICE_SCREEN_STATE",
        screenSharing: true,
        screenStreamId: localScreenStreamRef.current.id,
        allowStreamPreview,
      });
    }
  });
  const streamerMode = usePrivacyField(preferences, "streamerMode", ["account"]);
  const autoStreamer = usePrivacyField(preferences, "autoStreamerMode", ["device"]);
  const typing = usePrivacyField(preferences, "sendTypingIndicators", ["account", "device"], (enabled) => {
    if (!enabled) sendTypingState(false);
  });
  const canDetectCapture = typeof window.decaveDesktop?.getCaptureApps === "function";

  return (
    <>
      {dmE2eeAvailable && (
        <SettingsSection anchor="encryption" title={t("settings.privacy.encryptionTitle")}>
          <DmEncryptionSettings />
          {(dmE2ee.status === "ready" || dmE2ee.status === "locked") && (
            <div style={{ marginTop: 12 }}>
              <KeyDevicesList
                refreshKey={dmE2ee.keyId}
                formatDate={(iso) => new Date(iso).toLocaleDateString(localeForLanguage(), { dateStyle: "medium" })}
              />
            </div>
          )}
        </SettingsSection>
      )}

      <SettingsSection anchor="friend-requests" title={t("settings.privacy.friendRequestsTitle")}>
        <label style={settingsLabelStyle}>
          {t("settings.privacy.friendRequestsLabel")}
          <select
            value={friendRequests.value}
            onChange={(event) => friendRequests.set(event.target.value as FriendRequestPolicy)}
            style={selectStyle}
          >
            {FRIEND_REQUEST_POLICIES.map((value) => (
              <option key={value} value={value}>
                {tk(`settings.privacy.friendRequestPolicy.${value}`)}
              </option>
            ))}
          </select>
          <FieldError field={friendRequests} />
        </label>
        <div className="dc-settings-copy">{t("settings.privacy.friendRequestsHelp")}</div>
      </SettingsSection>

      <SettingsSection anchor="direct-messages" title={t("settings.privacy.dmTitle")}>
        <div className="dcs-card">
          <div className="dcs-card-row">
            <span className="dcs-badge is-on" aria-hidden="true">
              <Icon name="lock" size="sm" />
            </span>
            <div className="dcs-card-copy">
              <strong>{t("settings.privacy.dmOnlyFriends")}</strong>
              <small>{t("settings.privacy.dmHelp")}</small>
            </div>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection anchor="blocked" title={t("settings.privacy.blockedTitle")}>
        <BlockedAccountsPanel
          apiBase={HTTP_URL}
          onUnblocked={(userId) => setBlockedUserIds((current) => current.filter((id) => id !== userId))}
          formatDate={(iso) => new Date(iso).toLocaleDateString(localeForLanguage(), { dateStyle: "medium" })}
        />
      </SettingsSection>

      <SettingsSection anchor="stream-privacy" title={t("settings.privacy.streamTitle")}>
        <div className="dc-settings-stack">
          <ToggleRow
            field={streamPreviews}
            label={t("settings.privacy.streamPreviews")}
            description={t("settings.privacy.streamPreviewsHelp")}
          />
          <ToggleRow
            field={streamerMode}
            label={t("settings.privacy.streamerMode")}
            description={t("settings.privacy.streamerModeHelp")}
          />
          {hasDesktopActivityBridge() && (
            <ToggleRow
              field={autoStreamer}
              disabled={!canDetectCapture}
              label={t("settings.privacy.autoStreamer")}
              description={
                canDetectCapture ? t("settings.privacy.autoStreamerHelp") : t("settings.privacy.autoStreamerUpdate")
              }
            />
          )}
        </div>
        {autoStreamerActive && !privacySettings.streamerMode && (
          <p className="dcs-live-note">{t("settings.privacy.autoStreamerLive", { apps: captureApps.join(", ") })}</p>
        )}
        {!hasDesktopActivityBridge() && (
          <>
            <div className="dc-settings-copy" style={{ marginTop: 8 }}>
              {t("settings.privacy.captureWeb")}
            </div>
            <DesktopOnlyNote />
          </>
        )}
      </SettingsSection>

      <SettingsSection anchor="typing" title={t("settings.privacy.presenceTitle")}>
        <ToggleRow field={typing} label={t("settings.privacy.typing")} description={t("settings.privacy.typingHelp")} />
      </SettingsSection>

      <SettingsSection anchor="reports" title={t("settings.privacy.safetyTitle")}>
        <div className="dc-safety-settings-card">
          <div>
            <strong>{t("settings.privacy.reportsTitle")}</strong>
            <span>{t("settings.privacy.reportsHelp")}</span>
          </div>
          <button type="button" className="modal-secondary" onClick={() => setShowMyReports(true)}>
            {t("settings.privacy.openReports")}
          </button>
        </div>
        <div className="dc-safety-age-status">
          <span>{t("settings.privacy.ageSetting")}</span>
          <strong>
            {currentUser.safety?.ageBand === "adult"
              ? t("settings.privacy.age.adult")
              : currentUser.safety?.ageBand === "teen"
                ? t("settings.privacy.age.teen")
                : t("settings.privacy.age.unknown")}
          </strong>
        </div>
      </SettingsSection>
    </>
  );
}
