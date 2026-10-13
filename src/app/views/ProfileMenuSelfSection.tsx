// Your own entry in the profile menu: status, mute and deafen, Settings and Log out.

import { useTranslation } from "react-i18next";
import type { Dispatch, SetStateAction } from "react";
import { Icon } from "../../components/Icon";
import type { PresenceStatus, AccountUser, UserContextMenuState } from "../types";
import { presenceColor, presenceGlow } from "../user-display";

type Props = {
  currentUser: AccountUser;
  setUserContextMenu: Dispatch<SetStateAction<UserContextMenuState | null>>;
  isMuted: boolean;
  isDeafened: boolean;
  isServerMuted: boolean;
  isServerDeafened: boolean;
  changePresenceStatus: (status: PresenceStatus) => Promise<void>;
  openSettings: () => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
};

export function ProfileMenuSelfSection({
  currentUser,
  setUserContextMenu,
  isMuted,
  isDeafened,
  isServerMuted,
  isServerDeafened,
  changePresenceStatus,
  openSettings,
  toggleMute,
  toggleDeafen,
}: Props) {
  const { t } = useTranslation(["common", "hub", "chat"]);
  return (
    <div className="user-context-self-section">
      <div className="user-context-section-title">{t("common.profileMenu.statusTitle")}</div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "18px minmax(0, 1fr)",
          alignItems: "center",
          gap: "9px",
          marginBottom: "12px",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: "10px",
            height: "10px",
            borderRadius: "50%",
            background: presenceColor(currentUser.status, true),
            boxShadow: presenceGlow(currentUser.status, true),
          }}
        />
        <select
          value={currentUser.status ?? "online"}
          onChange={(event) => void changePresenceStatus(event.target.value as PresenceStatus)}
          onClick={(event) => event.stopPropagation()}
          style={{
            width: "100%",
            minWidth: 0,
            borderRadius: "9px",
            border: "1px solid color-mix(in srgb, var(--ds-border) 22%, transparent)",
            background: "var(--ds-surface-2)",
            color: "var(--ds-text)",
            padding: "8px 10px",
            fontWeight: 700,
          }}
          aria-label={t("common.profileMenu.setStatus")}
        >
          <option value="online">{t("common.presence.online")}</option>
          <option value="idle">{t("common.presence.idle")}</option>
          <option value="dnd">{t("common.presence.dnd")}</option>
          <option value="invisible">{t("common.presence.invisible")}</option>
        </select>
      </div>

      <div className="user-context-section-title dc-controls-heading">
        <span>{t("common.profileMenu.controlsTitle")}</span>
        <small>{t("common.profileMenu.controlsHint")}</small>
      </div>
      <div className="dc-profile-controls">
        <button
          type="button"
          className={`dc-profile-control${isMuted || isServerMuted ? " is-active" : ""}${isServerMuted ? " is-locked" : ""}`}
          onClick={toggleMute}
          disabled={isServerMuted}
          aria-pressed={isMuted || isServerMuted}
          aria-label={
            isServerMuted
              ? t("common.profileMenu.micLockedLabel")
              : isMuted
                ? t("common.profileMenu.unmuteMic")
                : t("common.profileMenu.muteMic")
          }
        >
          <span className="dc-profile-control-icon" aria-hidden="true">
            <Icon name={isMuted || isServerMuted ? "mic-off" : "mic"} />
          </span>
          <span className="dc-profile-control-copy">
            <strong>
              {isServerMuted
                ? t("common.profileMenu.micLocked")
                : isMuted
                  ? t("common.profileMenu.micMuted")
                  : t("common.profileMenu.micOn")}
            </strong>
            <small>
              {isServerMuted
                ? t("common.profileMenu.micLockedHint")
                : isMuted
                  ? t("common.profileMenu.micMutedHint")
                  : t("common.profileMenu.micOnHint")}
            </small>
          </span>
          <span className="dc-profile-control-state">
            {isServerMuted
              ? t("common.profileMenu.locked")
              : isMuted
                ? t("common.profileMenu.off")
                : t("common.profileMenu.on")}
          </span>
        </button>
        <button
          type="button"
          className={`dc-profile-control${isDeafened || isServerDeafened ? " is-active" : ""}${isServerDeafened ? " is-locked" : ""}`}
          onClick={toggleDeafen}
          disabled={isServerDeafened}
          aria-pressed={isDeafened || isServerDeafened}
          aria-label={
            isServerDeafened
              ? t("common.profileMenu.audioLockedLabel")
              : isDeafened
                ? t("common.profileMenu.undeafen")
                : t("common.profileMenu.deafen")
          }
        >
          <span className="dc-profile-control-icon" aria-hidden="true">
            <Icon name={isDeafened || isServerDeafened ? "headphones-off" : "headphones"} />
          </span>
          <span className="dc-profile-control-copy">
            <strong>
              {isServerDeafened
                ? t("common.profileMenu.audioLocked")
                : isDeafened
                  ? t("common.profileMenu.audioMuted")
                  : t("common.profileMenu.audioOn")}
            </strong>
            <small>
              {isServerDeafened
                ? t("common.profileMenu.audioLockedHint")
                : isDeafened
                  ? t("common.profileMenu.audioMutedHint")
                  : t("common.profileMenu.audioOnHint")}
            </small>
          </span>
          <span className="dc-profile-control-state">
            {isServerDeafened
              ? t("common.profileMenu.locked")
              : isDeafened
                ? t("common.profileMenu.off")
                : t("common.profileMenu.on")}
          </span>
        </button>
      </div>

      <div className="dc-profile-account-actions">
        <button
          type="button"
          className="user-context-settings-button dc-profile-action-button"
          onClick={() => {
            setUserContextMenu(null);
            openSettings();
          }}
        >
          <span className="user-context-settings-icon dc-profile-action-icon" aria-hidden="true">
            <Icon name="settings" />
          </span>
          <span className="user-context-settings-copy">
            <strong>{t("common.rail.settings")}</strong>
            <small>{t("common.profileMenu.settingsHint")}</small>
          </span>
          <span className="dc-profile-action-chevron" aria-hidden="true">
            <Icon name="chevron-right" size="sm" />
          </span>
        </button>
      </div>
    </div>
  );
}
