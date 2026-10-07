import type { ReactNode } from "react";

export const DISPLAY_NAME_MAX = 32;
export const PRONOUNS_MAX = 24;

type DetailsProps = {
  username: string;
  displayName: string;
  pronouns: string;
  onDisplayName: (value: string) => void;
  onPronouns: (value: string) => void;
};

/** Settings → Profile: display name and pronouns (saved with the Save button). */
export function ProfileDetailsFields({ username, displayName, pronouns, onDisplayName, onPronouns }: DetailsProps) {
  return (
    <div className="dcs-inline-fields">
      <label className="dcs-field">
        <span>Display name</span>
        <input
          className="dcx-input"
          value={displayName}
          maxLength={DISPLAY_NAME_MAX}
          placeholder={username}
          onChange={(event) => onDisplayName(event.target.value)}
        />
        <small>Shown on your profile instead of your username. Leave empty to use {username}.</small>
      </label>
      <label className="dcs-field">
        <span>Pronouns</span>
        <input
          className="dcx-input"
          value={pronouns}
          maxLength={PRONOUNS_MAX}
          placeholder="e.g. she/her, he/him, they/them"
          onChange={(event) => onPronouns(event.target.value)}
        />
        <small>Optional. Shown next to your name on your profile.</small>
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

/** Settings → Profile: wide image across the top of your profile card. */
export function BannerField({ bannerUrl, accent, busy, error, onUpload, onRemove }: BannerProps) {
  return (
    <div className="dcs-banner-field">
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
          {busy ? "Saving…" : bannerUrl ? "Change banner" : "Add banner"}
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
            Remove
          </button>
        )}
        <small className="dcs-muted">PNG, JPEG or WebP · up to 3 MB · 3:1 looks best</small>
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
      <figcaption>Preview · how others see your profile</figcaption>
    </figure>
  );
}
