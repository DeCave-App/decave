// Settings → Profile & status: photo, banner, name, pronouns, status, bio,
// accent with a live preview, and Quiet Presence.

import type { SettingsWindowProps } from "../../../app/views/settings/SettingsWindow";
import type { PresenceStatus } from "../../../app/types";
import { resolveAvatarUrl } from "../../../app/user-display";
import { UserAvatar } from "../../../app/components/UserAvatar";
import {
  profileSettingsRowStyle,
  profileSettingsAvatarStyle,
  profileButtonRowStyle,
  profileUploadButtonStyle,
  profileRemoveButtonStyle,
  selectStyle,
  memberMutedStyle,
  settingsLabelStyle,
  audioErrorStyle,
} from "../../../app/inline-styles";
import { QuietPresenceSettings } from "../../../components/session/QuietPresenceSettings";
import { BannerField, ProfileDetailsFields, ProfilePreviewCard } from "../ProfilePanels";
import { FieldError, SettingsSection } from "../SettingsControls";
import { useSettingsPersist } from "../persist";
import { useSettingsToast } from "../SettingsToast";
import { SLIDER_DEBOUNCE_MS, useStateField, useTextDraft } from "../useSettingField";
import { useSettingsT } from "../useSettingsT";

const STATUSES: PresenceStatus[] = ["online", "idle", "dnd", "invisible"];

export function ProfileStatusTab(props: SettingsWindowProps) {
  const { t, tk } = useSettingsT();
  const persist = useSettingsPersist();
  const toast = useSettingsToast();
  const {
    currentUser,
    profileAvatarError,
    profileMedia,
    profileFields,
    profileMediaActions,
    quietPresence,
    updateQuietPresence,
  } = props;
  const { uploadProfileBanner, removeProfileBanner, uploadProfileAvatar, removeProfileAvatar } = profileMediaActions;
  const { profileAvatarBusy, profileBannerBusy, profileBannerError } = profileMedia;

  const displayName = useTextDraft(
    useStateField("profile.displayName", profileFields.profileDisplayName, profileFields.setProfileDisplayName, [
      "profile",
    ]),
  );
  const pronouns = useTextDraft(
    useStateField("profile.pronouns", profileFields.profilePronouns, profileFields.setProfilePronouns, ["profile"]),
  );
  const statusText = useTextDraft(
    useStateField("profile.statusText", profileFields.profileStatusText, profileFields.setProfileStatusText, [
      "profile",
    ]),
  );
  const bio = useTextDraft(
    useStateField("profile.bio", profileFields.profileBio, profileFields.setProfileBio, ["profile"]),
  );
  const status = useStateField("profile.status", profileFields.profileStatus, profileFields.setProfileStatus, [
    "profile",
  ]);
  const accent = useStateField(
    "profile.accent",
    profileFields.profileAccent,
    profileFields.setProfileAccent,
    ["profile"],
    {
      debounceMs: SLIDER_DEBOUNCE_MS,
    },
  );
  const accentColor = accent.value;
  const bannerUrl = currentUser.bannerUrl ? resolveAvatarUrl(currentUser.bannerUrl) : null;

  return (
    <div className="dcs-profile-layout">
      <div>
        <SettingsSection anchor="avatar" title={t("settings.profile.photoTitle")}>
          <div style={profileSettingsRowStyle}>
            <UserAvatar
              username={currentUser.username}
              avatarUrl={currentUser.avatarUrl}
              style={{
                ...profileSettingsAvatarStyle,
                border: `2px solid ${accentColor}`,
                boxShadow: `0 0 0 3px ${accentColor}22, 0 0 18px ${accentColor}55`,
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: "var(--ds-text)", fontWeight: 800, marginBottom: "4px" }}>
                {currentUser.username}
              </div>
              <div style={memberMutedStyle}>{t("settings.profile.photoHelp")}</div>
              <div style={profileButtonRowStyle}>
                <label style={profileUploadButtonStyle}>
                  {profileAvatarBusy ? t("settings.profile.savingDots") : t("settings.profile.changePhoto")}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={profileAvatarBusy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.currentTarget.value = "";
                      if (file) void uploadProfileAvatar(file);
                    }}
                    style={{ display: "none" }}
                  />
                </label>
                {currentUser.avatarUrl && (
                  <button
                    type="button"
                    className="modal-secondary"
                    disabled={profileAvatarBusy}
                    onClick={() => void removeProfileAvatar()}
                    style={profileRemoveButtonStyle}
                  >
                    {t("settings.profile.remove")}
                  </button>
                )}
              </div>
              {profileAvatarError && <div style={audioErrorStyle}>{profileAvatarError}</div>}
            </div>
          </div>
        </SettingsSection>

        <SettingsSection title={t("settings.profile.bannerTitle")}>
          <BannerField
            bannerUrl={bannerUrl}
            accent={accentColor}
            busy={profileBannerBusy}
            error={profileBannerError}
            onUpload={(file) => void uploadProfileBanner(file)}
            onRemove={() => void removeProfileBanner()}
          />
          <ProfileDetailsFields username={currentUser.username} displayName={displayName} pronouns={pronouns} />
        </SettingsSection>

        <SettingsSection anchor="status" title={t("settings.profile.presenceTitle")}>
          <label style={settingsLabelStyle}>
            {t("settings.profile.status")}
            <select
              value={status.value}
              onChange={(event) => status.set(event.target.value as PresenceStatus)}
              style={selectStyle}
            >
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {tk(`settings.profile.statuses.${value}`)}
                </option>
              ))}
            </select>
            <FieldError field={status} />
          </label>
          <label style={settingsLabelStyle}>
            {t("settings.profile.customStatus")}
            <input
              maxLength={80}
              placeholder={t("settings.profile.customStatusPlaceholder")}
              {...statusText.inputProps}
            />
            <FieldError field={statusText.field} />
          </label>
          <label style={settingsLabelStyle} data-settings-anchor="bio">
            {t("settings.profile.bio")}
            <textarea maxLength={190} rows={3} {...bio.inputProps} />
            <FieldError field={bio.field} />
          </label>
          <label style={settingsLabelStyle} data-settings-anchor="accent">
            {t("settings.profile.accent")}
            <input type="color" value={accentColor} onChange={(event) => accent.set(event.target.value)} />
            <FieldError field={accent} />
          </label>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "10px 12px",
              borderRadius: "10px",
              border: `1px solid ${accentColor}66`,
              background: `${accentColor}12`,
              color: "var(--ds-text-soft)",
              fontSize: "12px",
              lineHeight: 1.45,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: "11px",
                height: "11px",
                borderRadius: "50%",
                background: accentColor,
                boxShadow: `0 0 12px ${accentColor}`,
                flex: "0 0 auto",
              }}
            />
            <span>{t("settings.profile.accentHelp")}</span>
          </div>
        </SettingsSection>

        <SettingsSection anchor="quiet-presence">
          <QuietPresenceSettings
            settings={quietPresence}
            onChange={(next) => {
              updateQuietPresence(next);
              void persist(["profile", "account"]).then(
                () => toast.show("settings.toast.saved"),
                () => toast.show("settings.field.couldntSave"),
              );
            }}
          />
        </SettingsSection>
      </div>
      <ProfilePreviewCard
        avatar={<UserAvatar username={currentUser.username} avatarUrl={currentUser.avatarUrl} />}
        username={currentUser.username}
        displayName={displayName.value}
        pronouns={pronouns.value}
        statusText={statusText.value}
        bio={bio.value}
        accent={accentColor}
        bannerUrl={bannerUrl}
      />
    </div>
  );
}
