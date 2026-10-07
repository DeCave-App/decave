// Settings > Privacy & safety.

import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import { Icon } from "../../../components/Icon";
import { BlockedAccountsPanel } from "../../../features/settings";
import type { AccountUser, FriendRequestPolicy } from "../../types";
import { HTTP_URL } from "../../env";
import { localeForLanguage } from "../../locale";
import { hasDesktopActivityBridge } from "../../desktop";
import { selectStyle, settingsSectionStyle, settingsSectionTitleStyle, settingsLabelStyle } from "../../inline-styles";
import type { PreferencesState } from "../../state/preferences";
import { DmEncryptionSettings } from "../../../e2ee/DmEncryptionUi";
import { useDmE2ee } from "../../../e2ee/dm-e2ee-client";

type Props = {
  currentUser: AccountUser;
  setShowMyReports: Dispatch<SetStateAction<boolean>>;
  setBlockedUserIds: Dispatch<SetStateAction<string[]>>;
  captureApps: string[];
  autoStreamerActive: boolean;
  voiceChannelRef: MutableRefObject<number | null>;
  localScreenStreamRef: MutableRefObject<MediaStream | null>;
  sendSocket: (payload: unknown) => boolean;
  sendTypingState: (active: boolean) => void;
  preferences: PreferencesState;
};

export function PrivacySettingsSection({
  currentUser,
  setShowMyReports,
  setBlockedUserIds,
  captureApps,
  autoStreamerActive,
  voiceChannelRef,
  localScreenStreamRef,
  sendSocket,
  sendTypingState,
  preferences,
}: Props) {
  const dmE2eeAvailable = useDmE2ee().available;
  const { privacySettings, setPrivacySettings } = preferences;
  return (
    <>
      {dmE2eeAvailable && (
        <div style={settingsSectionStyle}>
          <div style={settingsSectionTitleStyle}>ENCRYPTED MESSAGES</div>
          <DmEncryptionSettings />
        </div>
      )}

      <div style={settingsSectionStyle}>
        <div style={settingsSectionTitleStyle}>NOTIFICATION PRIVACY</div>
        <div style={{ color: "var(--ds-muted)", fontSize: "12px", lineHeight: 1.55, marginBottom: "12px" }}>
          Choose how much private message content DeCave exposes in desktop and in-app notifications.
        </div>
        <div style={{ display: "grid", gap: "8px" }}>
          {(
            [
              ["full", "Full preview", "Show sender and message text."],
              ["sender", "Sender only", "Show who sent it, but hide the message text."],
              ["hidden", "Hidden", "Show only a generic DeCave notification."],
            ] as const
          ).map(([value, label, detail]) => {
            const active = privacySettings.notificationPreview === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setPrivacySettings((current) => ({ ...current, notificationPreview: value }))}
                style={{
                  textAlign: "left",
                  padding: "12px 14px",
                  borderRadius: "11px",
                  border: active
                    ? "1px solid color-mix(in srgb, var(--ds-accent-2) 50%, transparent)"
                    : "1px solid color-mix(in srgb, var(--ds-border) 18%, transparent)",
                  background: active
                    ? "color-mix(in srgb, var(--ds-accent-2) 12%, transparent)"
                    : "var(--ds-surface-2)",
                  color: active ? "var(--ds-text)" : "var(--ds-text-soft)",
                  cursor: "pointer",
                }}
              >
                <strong style={{ display: "block", fontSize: "12px" }}>{label}</strong>
                <span style={{ display: "block", color: "var(--ds-muted)", fontSize: "12px", marginTop: "3px" }}>
                  {detail}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={settingsSectionStyle}>
        <div style={settingsSectionTitleStyle}>TRUST &amp; SAFETY</div>
        <div className="dc-safety-settings-card">
          <div>
            <strong>Your reports</strong>
            <span>See the reports you have sent to the DeCave safety team and what happened.</span>
          </div>
          <button type="button" className="modal-secondary" onClick={() => setShowMyReports(true)}>
            Open My Reports
          </button>
        </div>
        <div className="dc-safety-age-status">
          <span>Age setting</span>
          <strong>
            {currentUser.safety?.ageBand === "adult"
              ? "Adult experience"
              : currentUser.safety?.ageBand === "teen"
                ? "Teen safety mode"
                : "Not confirmed"}
          </strong>
        </div>
      </div>

      <div style={settingsSectionStyle}>
        <div style={settingsSectionTitleStyle}>FRIEND REQUESTS</div>
        <label style={settingsLabelStyle}>
          Who is allowed to send you a friend request
          <select
            value={privacySettings.friendRequestPolicy}
            onChange={(event) =>
              setPrivacySettings((current) => ({
                ...current,
                friendRequestPolicy: event.target.value as FriendRequestPolicy,
              }))
            }
            style={selectStyle}
          >
            <option value="everyone">Everyone</option>
            <option value="friends_of_friends">Friends of friends</option>
            <option value="none">None</option>
          </select>
        </label>
        <div className="dc-settings-copy">
          This is enforced by DeCave when a request is sent, not only hidden in the interface.
        </div>
      </div>

      <div style={settingsSectionStyle}>
        <div style={settingsSectionTitleStyle}>DIRECT MESSAGES</div>
        <div className="dcs-card">
          <div className="dcs-card-row">
            <span className="dcs-badge is-on" aria-hidden="true">
              <Icon name="lock" size="sm" />
            </span>
            <div className="dcs-card-copy">
              <strong>Only friends can message you</strong>
              <small>
                DeCave doesn't deliver private messages or group invites from people who aren't your friends, and never
                from people you've blocked. Control who can become your friend with Friend requests above.
              </small>
            </div>
          </div>
        </div>
      </div>

      <div style={settingsSectionStyle}>
        <div style={settingsSectionTitleStyle}>BLOCKED ACCOUNTS</div>
        <BlockedAccountsPanel
          apiBase={HTTP_URL}
          onUnblocked={(userId) => setBlockedUserIds((current) => current.filter((id) => id !== userId))}
          formatDate={(iso) => new Date(iso).toLocaleDateString(localeForLanguage(), { dateStyle: "medium" })}
        />
      </div>

      <div style={settingsSectionStyle}>
        <div style={settingsSectionTitleStyle}>STREAM PRIVACY</div>
        <div className="dc-settings-stack">
          <label className={`settings-toggle-row${privacySettings.allowStreamPreviews ? " enabled" : " disabled"}`}>
            <span>
              <strong>Allow Stream Previews</strong>
              <small>People in the voice room may see a small preview before they click Start Watching.</small>
            </span>
            <span className="settings-toggle-control">
              <em>{privacySettings.allowStreamPreviews ? "ON" : "OFF"}</em>
              <input
                type="checkbox"
                checked={privacySettings.allowStreamPreviews}
                onChange={(event) => {
                  const allowStreamPreviews = event.target.checked;
                  setPrivacySettings((current) => ({ ...current, allowStreamPreviews }));
                  if (localScreenStreamRef.current && voiceChannelRef.current !== null) {
                    sendSocket({
                      type: "VOICE_SCREEN_STATE",
                      screenSharing: true,
                      allowStreamPreview: allowStreamPreviews,
                    });
                  }
                }}
              />
            </span>
          </label>
          <label className={`settings-toggle-row${privacySettings.streamerMode ? " enabled" : " disabled"}`}>
            <span>
              <strong>Streamer Mode</strong>
              <small>Mask personal account details and protect DeCave desktop windows from normal capture APIs.</small>
            </span>
            <span className="settings-toggle-control">
              <em>{privacySettings.streamerMode ? "ON" : "OFF"}</em>
              <input
                type="checkbox"
                checked={privacySettings.streamerMode}
                onChange={(event) =>
                  setPrivacySettings((current) => ({ ...current, streamerMode: event.target.checked }))
                }
              />
            </span>
          </label>
          <label
            className={`settings-toggle-row${privacySettings.autoStreamerMode ? " enabled" : " disabled"}`}
            style={typeof window.decaveDesktop?.getCaptureApps !== "function" ? { opacity: 0.62 } : undefined}
          >
            <span>
              <strong>Turn on Streamer Mode while I stream</strong>
              <small>
                {typeof window.decaveDesktop?.getCaptureApps === "function"
                  ? "Switches on by itself while a broadcast app is open, and off again when you close it."
                  : hasDesktopActivityBridge()
                    ? "Update the DeCave desktop app to use this. It needs the newest version."
                    : "Available in the DeCave desktop app for Windows and macOS."}
              </small>
            </span>
            <span className="settings-toggle-control">
              <em>{privacySettings.autoStreamerMode ? "ON" : "OFF"}</em>
              <input
                type="checkbox"
                disabled={typeof window.decaveDesktop?.getCaptureApps !== "function"}
                checked={privacySettings.autoStreamerMode}
                onChange={(event) =>
                  setPrivacySettings((current) => ({ ...current, autoStreamerMode: event.target.checked }))
                }
              />
            </span>
          </label>
        </div>
        {autoStreamerActive && !privacySettings.streamerMode && (
          <p className="dcs-live-note">Streamer Mode is on right now because {captureApps.join(", ")} is running.</p>
        )}
        {!hasDesktopActivityBridge() && (
          <div className="dc-settings-copy" style={{ marginTop: 8 }}>
            Window capture protection is available in the Windows desktop app. Sensitive values are still masked in this
            UI.
          </div>
        )}
      </div>

      <div style={settingsSectionStyle}>
        <div style={settingsSectionTitleStyle}>PRESENCE PRIVACY</div>
        <label className="v19-check">
          <input
            type="checkbox"
            checked={privacySettings.sendTypingIndicators}
            onChange={(event) => {
              const enabled = event.target.checked;
              setPrivacySettings((current) => ({ ...current, sendTypingIndicators: enabled }));
              if (!enabled) sendTypingState(false);
            }}
          />
          Send typing indicators
        </label>
        <div style={{ color: "var(--ds-muted)", fontSize: "12px", lineHeight: 1.5, marginTop: "6px" }}>
          When disabled, people in Hub text rooms will not see that you are typing.
        </div>
      </div>
    </>
  );
}
