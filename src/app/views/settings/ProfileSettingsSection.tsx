import { ProfileDetailsFields, BannerField, ProfilePreviewCard } from "../../../features/settings";
import type { PresenceStatus, AccountUser } from "../../types";
import { localeForLanguage } from "../../locale";
import { resolveAvatarUrl } from "../../user-display";
import { UserAvatar } from "../../components/UserAvatar";
import {
  profileSettingsRowStyle,
  profileSettingsAvatarStyle,
  profileButtonRowStyle,
  profileUploadButtonStyle,
  profileRemoveButtonStyle,
  selectStyle,
  memberMutedStyle,
  settingsSectionStyle,
  settingsSectionTitleStyle,
  settingsLabelStyle,
  audioErrorStyle,
} from "../../inline-styles";
import type { ProfileMediaState } from "../../state/profile-media";
import type { ProfileFieldsState } from "../../state/profile-fields";
import type { PreferencesState } from "../../state/preferences";

type Props = {
  currentUser: AccountUser;
  profileAvatarError: string;
  openAccountEditor: (field: "username" | "email" | "phone" | "password") => void;
  uploadProfileBanner: (file: File) => Promise<void>;
  removeProfileBanner: () => Promise<void>;
  uploadProfileAvatar: (file: File) => Promise<void>;
  removeProfileAvatar: () => Promise<void>;
  profileMedia: ProfileMediaState;
  profileFields: ProfileFieldsState;
  preferences: PreferencesState;
};

export function ProfileSettingsSection({
  currentUser,
  profileAvatarError,
  openAccountEditor,
  uploadProfileBanner,
  removeProfileBanner,
  uploadProfileAvatar,
  removeProfileAvatar,
  profileMedia,
  profileFields,
  preferences,
}: Props) {
  const { accountPreferences } = preferences;
  const {
    profileBio,
    setProfileBio,
    profileStatus,
    setProfileStatus,
    profileStatusText,
    setProfileStatusText,
    profileAccent,
    setProfileAccent,
    profileDisplayName,
    setProfileDisplayName,
    profilePronouns,
    setProfilePronouns,
  } = profileFields;
  const { profileAvatarBusy, profileBannerBusy, profileBannerError } = profileMedia;
  return (
    <>
      <div className="dcs-profile-layout">
        <div>
          <div style={settingsSectionStyle}>
            <div style={settingsSectionTitleStyle}>PROFILE</div>
            <div style={profileSettingsRowStyle}>
              <UserAvatar
                username={currentUser.username}
                avatarUrl={currentUser.avatarUrl}
                style={{
                  ...profileSettingsAvatarStyle,
                  border: `2px solid ${profileAccent}`,
                  boxShadow: `0 0 0 3px ${profileAccent}22, 0 0 18px ${profileAccent}55`,
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: "var(--ds-text)", fontWeight: 800, marginBottom: "4px" }}>
                  {currentUser.username}
                </div>
                <div style={memberMutedStyle}>PNG, JPEG or WebP · maximum 2 MB</div>
                <div style={profileButtonRowStyle}>
                  <label style={profileUploadButtonStyle}>
                    {profileAvatarBusy ? "Saving..." : "Change Photo"}
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
                      Remove
                    </button>
                  )}
                </div>
                {profileAvatarError && <div style={audioErrorStyle}>{profileAvatarError}</div>}
              </div>
            </div>
          </div>

          <div style={settingsSectionStyle}>
            <div style={settingsSectionTitleStyle}>USERNAME</div>
            <div className="dc-profile-username-card">
              <div>
                <strong>{currentUser.username}</strong>
                <small>
                  {accountPreferences.usernameChangeAvailableAt &&
                  Date.parse(accountPreferences.usernameChangeAvailableAt) > Date.now()
                    ? `Next change available ${new Date(accountPreferences.usernameChangeAvailableAt).toLocaleDateString(localeForLanguage())}`
                    : "Your username can be changed once every 30 days."}
                </small>
              </div>
              <button
                type="button"
                className="modal-secondary"
                disabled={Boolean(
                  accountPreferences.usernameChangeAvailableAt &&
                  Date.parse(accountPreferences.usernameChangeAvailableAt) > Date.now(),
                )}
                onClick={() => openAccountEditor("username")}
              >
                Edit Username
              </button>
            </div>
          </div>

          <div style={settingsSectionStyle}>
            <div style={settingsSectionTitleStyle}>BANNER & NAME</div>
            <BannerField
              bannerUrl={currentUser.bannerUrl ? resolveAvatarUrl(currentUser.bannerUrl) : null}
              accent={profileAccent}
              busy={profileBannerBusy}
              error={profileBannerError}
              onUpload={(file) => void uploadProfileBanner(file)}
              onRemove={() => void removeProfileBanner()}
            />
            <ProfileDetailsFields
              username={currentUser.username}
              displayName={profileDisplayName}
              pronouns={profilePronouns}
              onDisplayName={setProfileDisplayName}
              onPronouns={setProfilePronouns}
            />
          </div>

          <div style={settingsSectionStyle}>
            <div style={settingsSectionTitleStyle}>PROFILE & PRESENCE</div>
            <label style={settingsLabelStyle}>
              Status
              <select
                value={profileStatus}
                onChange={(event) => setProfileStatus(event.target.value as PresenceStatus)}
                style={selectStyle}
              >
                <option value="online">Online</option>
                <option value="idle">Idle</option>
                <option value="dnd">Do Not Disturb</option>
                <option value="invisible">Invisible</option>
              </select>
            </label>
            <label style={settingsLabelStyle}>
              Custom status
              <input
                value={profileStatusText}
                onChange={(event) => setProfileStatusText(event.target.value)}
                maxLength={80}
                placeholder="Grinding ranked tonight"
              />
            </label>
            <label style={settingsLabelStyle}>
              Bio
              <textarea
                value={profileBio}
                onChange={(event) => setProfileBio(event.target.value)}
                maxLength={190}
                rows={3}
              />
            </label>
            <label style={settingsLabelStyle}>
              Profile accent
              <input type="color" value={profileAccent} onChange={(event) => setProfileAccent(event.target.value)} />
            </label>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "10px 12px",
                borderRadius: "10px",
                border: `1px solid ${profileAccent}66`,
                background: `${profileAccent}12`,
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
                  background: profileAccent,
                  boxShadow: `0 0 12px ${profileAccent}`,
                  flex: "0 0 auto",
                }}
              />
              <span>
                Profile accent colors your personal avatar ring and profile highlights. Changes preview immediately and
                are saved with the Settings Save button.
              </span>
            </div>
          </div>
        </div>
        <ProfilePreviewCard
          avatar={<UserAvatar username={currentUser.username} avatarUrl={currentUser.avatarUrl} />}
          username={currentUser.username}
          displayName={profileDisplayName}
          pronouns={profilePronouns}
          statusText={profileStatusText}
          bio={profileBio}
          accent={profileAccent}
          bannerUrl={currentUser.bannerUrl ? resolveAvatarUrl(currentUser.bannerUrl) : null}
        />
      </div>
    </>
  );
}
