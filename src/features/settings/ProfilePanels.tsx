import type { ReactNode } from "react";
import { FieldError } from "./SettingsControls";
import type { TextDraft } from "./useSettingField";
import { useSettingsT } from "./useSettingsT";

export const DISPLAY_NAME_MAX = 32;
export const PRONOUNS_MAX = 24;

type DetailsProps = {
  username: string;
  displayName: TextDraft;
  pronouns: TextDraft;
};

/** Settings → Profile & status: display name and pronouns (save on blur or Enter). */
export function ProfileDetailsFields({ username, displayName, pronouns }: DetailsProps) {
  const { t } = useSettingsT();
  return (
    <div className="dcs-inline-fields" data-settings-anchor="display-name">
      <label className="dcs-field">
        <span>{t("settings.profile.displayName")}</span>
        <input className="dcx-input" maxLength={DISPLAY_NAME_MAX} placeholder={username} {...displayName.inputProps} />
        <small>{t("settings.profile.displayNameHelp", { username })}</small>
        <FieldError field={displayName.field} />
      </label>
      <label className="dcs-field">
        <span>{t("settings.profile.pronouns")}</span>
        <input
          className="dcx-input"
          maxLength={PRONOUNS_MAX}
          placeholder={t("settings.profile.pronounsPlaceholder")}
          {...pronouns.inputProps}
        />
        <small>{t("settings.profile.pronounsHelp")}</small>
        <FieldError field={pronouns.field} />
      </label>
    </div>
  );
}

type BannerProps = {
  bannerUrl: string | null;
  accent: string;
  busy: boolean;
  error: string;
  onUpload: (file: File) => void;
  onRemove: () => void;
};

/** Settings → Profile & status: wide image across the top of your profile card. */
export function BannerField({ bannerUrl, accent, busy, error, onUpload, onRemove }: BannerProps) {
  const { t } = useSettingsT();
  return (
    <div className="dcs-banner-field" data-settings-anchor="banner">
      <div
        className="dcs-banner-preview"
        style={
          bannerUrl
            ? { backgroundImage: `url("${bannerUrl}")` }
            : { background: `linear-gradient(135deg, ${accent}, color-mix(in srgb, ${accent} 30%, #0b1020))` }
        }
        aria-hidden="true"
      />
      <div className="dcs-card-actions">
        <label className={`modal-secondary dcs-file-button${busy ? " is-busy" : ""}`}>
          {busy
            ? t("settings.profile.saving")
            : bannerUrl
              ? t("settings.profile.changeBanner")
              : t("settings.profile.addBanner")}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.currentTarget.value = "";
              if (file) onUpload(file);
            }}
          />
        </label>
        {bannerUrl && (
          <button type="button" className="modal-secondary" disabled={busy} onClick={onRemove}>
            {t("settings.profile.remove")}
          </button>
        )}
        <small className="dcs-muted">{t("settings.profile.bannerHelp")}</small>
      </div>
      {error && (
        <p className="dcs-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

type PreviewProps = {
  avatar: ReactNode;
  username: string;
  displayName: string;
  pronouns: string;
  statusText: string;
  bio: string;
  accent: string;
  bannerUrl: string | null;
};

/** How other people see your profile card. */
export function ProfilePreviewCard({
  avatar,
  username,
  displayName,
  pronouns,
  statusText,
  bio,
  accent,
  bannerUrl,
}: PreviewProps) {
  const { t } = useSettingsT();
  const name = displayName.trim() || username;
  return (
    <figure className="dcs-profile-preview" style={{ ["--dcs-accent" as string]: accent }}>
      <div
        className="dcs-profile-preview-banner"
        style={bannerUrl ? { backgroundImage: `url("${bannerUrl}")` } : undefined}
      />
      <div className="dcs-profile-preview-avatar">{avatar}</div>
      <div className="dcs-profile-preview-body">
        <strong>{name}</strong>
        <span>
          {displayName.trim() ? `@${username}` : ""}
          {displayName.trim() && pronouns.trim() ? " · " : ""}
          {pronouns.trim()}
        </span>
        {statusText.trim() && <p className="dcs-profile-preview-status">{statusText}</p>}
        {bio.trim() && <p>{bio}</p>}
      </div>
      <figcaption>{t("settings.profile.previewCaption")}</figcaption>
    </figure>
  );
}
