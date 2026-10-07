// Your own entry in the profile menu: status, mute and deafen, Settings and Log out.

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
  return (
    <div className="user-context-self-section">
      <div className="user-context-section-title">STATUS</div>
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
          aria-label="Set your status"
        >
          <option value="online">Online</option>
          <option value="idle">Idle</option>
          <option value="dnd">Do Not Disturb</option>
          <option value="invisible">Invisible</option>
        </select>
      </div>

      <div className="user-context-section-title dc-controls-heading">
        <span>YOUR CONTROLS</span>
        <small>Quick voice and account actions</small>
      </div>
      <div className="dc-profile-controls">
        <button
          type="button"
          className={`dc-profile-control${isMuted || isServerMuted ? " is-active" : ""}${isServerMuted ? " is-locked" : ""}`}
          onClick={toggleMute}
          disabled={isServerMuted}
          aria-pressed={isMuted || isServerMuted}
          aria-label={
            isServerMuted ? "Microphone muted by a hub moderator" : isMuted ? "Unmute microphone" : "Mute microphone"
          }
        >
          <span className="dc-profile-control-icon" aria-hidden="true">
            <Icon name={isMuted || isServerMuted ? "mic-off" : "mic"} />
          </span>
          <span className="dc-profile-control-copy">
            <strong>{isServerMuted ? "Mic locked" : isMuted ? "Mic muted" : "Mic on"}</strong>
            <small>
              {isServerMuted ? "Muted by a hub moderator" : isMuted ? "You are not being heard" : "Your voice is ready"}
            </small>
          </span>
          <span className="dc-profile-control-state">{isServerMuted ? "LOCKED" : isMuted ? "OFF" : "ON"}</span>
        </button>
        <button
          type="button"
          className={`dc-profile-control${isDeafened || isServerDeafened ? " is-active" : ""}${isServerDeafened ? " is-locked" : ""}`}
          onClick={toggleDeafen}
          disabled={isServerDeafened}
          aria-pressed={isDeafened || isServerDeafened}
          aria-label={isServerDeafened ? "Audio deafened by a hub moderator" : isDeafened ? "Undeafen" : "Deafen"}
        >
          <span className="dc-profile-control-icon" aria-hidden="true">
            <Icon name={isDeafened || isServerDeafened ? "headphones-off" : "headphones"} />
          </span>
          <span className="dc-profile-control-copy">
            <strong>{isServerDeafened ? "Audio locked" : isDeafened ? "Audio muted" : "Audio on"}</strong>
            <small>
              {isServerDeafened
                ? "Deafened by a hub moderator"
                : isDeafened
                  ? "Voice audio is silenced"
                  : "You can hear the room"}
            </small>
          </span>
          <span className="dc-profile-control-state">{isServerDeafened ? "LOCKED" : isDeafened ? "OFF" : "ON"}</span>
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
            <strong>Settings</strong>
            <small>Profile, appearance, voice &amp; audio</small>
          </span>
          <span className="dc-profile-action-chevron" aria-hidden="true">
            <Icon name="chevron-right" size="sm" />
          </span>
        </button>
      </div>
    </div>
  );
}
