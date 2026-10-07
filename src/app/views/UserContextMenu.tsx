// Menu for a person (right-click, or your own profile button): profile details,
// status, message and friend actions, volume, mute/block/report, voice moderation.

import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import { Icon } from "../../components/Icon";
import type { SafetyReportTarget } from "../../safety/types";
import type {
  ServerRole,
  PresenceStatus,
  AccountUser,
  OnlineUser,
  ServerMemberView,
  VoiceParticipant,
  SocialUser,
  UserContextTarget,
  UserContextMenuState,
  PeerSession,
} from "../types";
import { formatProfileDate } from "../locale";
import { resolveAvatarUrl, presenceLabel, presenceColor, presenceGlow } from "../user-display";
import { UserAvatar } from "../components/UserAvatar";
import { ProfileMenuSelfSection } from "./ProfileMenuSelfSection";
import type { VoiceCallState } from "../state/voice-call";
import type { VoiceControlActions } from "../actions/voice-controls";
import type { FriendActions } from "../actions/friends";
import type { SettingsActions } from "../actions/settings";

type Props = {
  currentUser: AccountUser;
  setShowLogoutConfirm: Dispatch<SetStateAction<boolean>>;
  blockedUserIds: string[];
  customStatusEditing: boolean;
  setCustomStatusEditing: Dispatch<SetStateAction<boolean>>;
  customStatusDraft: string;
  setCustomStatusDraft: Dispatch<SetStateAction<string>>;
  customStatusSaving: boolean;
  customStatusError: string;
  setCustomStatusError: Dispatch<SetStateAction<string>>;
  mutedUserIds: string[];
  onlineUsers: OnlineUser[];
  hubMembers: ServerMemberView[];
  profileStatusMenuOpen: boolean;
  setProfileStatusMenuOpen: Dispatch<SetStateAction<boolean>>;
  friends: SocialUser[];
  incomingFriendRequests: SocialUser[];
  outgoingFriendRequests: SocialUser[];
  userContextMenu: UserContextMenuState;
  setUserContextMenu: Dispatch<SetStateAction<UserContextMenuState | null>>;
  profileDetails: Record<string, SocialUser>;
  voiceChannelId: number | null;
  voiceUserVolumes: Record<string, number>;
  selfConnectionIdRef: MutableRefObject<string>;
  peerSessionsRef: MutableRefObject<Map<string, PeerSession>>;
  locallyMutedUsersRef: MutableRefObject<Set<string>>;
  changePresenceStatus: (status: PresenceStatus) => Promise<void>;
  openSafetyReport: (target: SafetyReportTarget) => void;
  toggleBlockedUser: (target: UserContextTarget) => Promise<void>;
  askToRemoveFriend: (user: SocialUser) => void;
  openDirectMessage: (user: SocialUser) => Promise<void>;
  canModerateTarget: (targetRole?: ServerRole | null) => boolean;
  toggleLocalMuteUser: (participant: VoiceParticipant) => void;
  openSettings: () => void;
  beginCustomStatusEdit: () => void;
  changeVoiceUserVolume: (participant: VoiceParticipant, volume: number) => void;
  moderateVoiceUser: (
    participant: VoiceParticipant,
    action: "kick" | "mute" | "unmute" | "deafen" | "undeafen",
  ) => void;
  ownVoiceRttMs: number | null;
  voiceCall: VoiceCallState;
  voiceControls: VoiceControlActions;
  friendActions: FriendActions;
  settingsActions: SettingsActions;
};

export function UserContextMenu({
  currentUser,
  setShowLogoutConfirm,
  blockedUserIds,
  customStatusEditing,
  setCustomStatusEditing,
  customStatusDraft,
  setCustomStatusDraft,
  customStatusSaving,
  customStatusError,
  setCustomStatusError,
  mutedUserIds,
  onlineUsers,
  hubMembers,
  profileStatusMenuOpen,
  setProfileStatusMenuOpen,
  friends,
  incomingFriendRequests,
  outgoingFriendRequests,
  userContextMenu,
  setUserContextMenu,
  profileDetails,
  voiceChannelId,
  voiceUserVolumes,
  selfConnectionIdRef,
  peerSessionsRef,
  locallyMutedUsersRef,
  changePresenceStatus,
  openSafetyReport,
  toggleBlockedUser,
  askToRemoveFriend,
  openDirectMessage,
  canModerateTarget,
  toggleLocalMuteUser,
  openSettings,
  beginCustomStatusEdit,
  changeVoiceUserVolume,
  moderateVoiceUser,
  ownVoiceRttMs,
  voiceCall,
  voiceControls,
  friendActions,
  settingsActions,
}: Props) {
  const { saveCustomStatus, toggleMutedUser } = settingsActions;
  const { friendStatusFor, socialAction, copyMyDecaveId } = friendActions;
  const { toggleMute, toggleDeafen } = voiceControls;
  const { isMuted, isDeafened, isServerMuted, isServerDeafened } = voiceCall;
  const target = userContextMenu.target;
  const friendStatus = friendStatusFor(target.userId);
  const participant = target.voiceParticipant;
  const canModerate = !!participant && canModerateTarget(target.role);
  const friendUser: SocialUser = { id: target.userId, username: target.username, avatarUrl: target.avatarUrl ?? null };
  const memberRecord = hubMembers.find((member) => member.userId === target.userId);
  const socialRecord = [...friends, ...incomingFriendRequests, ...outgoingFriendRequests].find(
    (user) => user.id === target.userId,
  );
  const onlineRecord = onlineUsers.find((user) => user.userId === target.userId);
  const detailRecord = profileDetails[target.userId];
  const isSelf = target.userId === currentUser.id;
  const isTopProfileMenu = isSelf && target.source === "top-profile";
  const resolvedStatus = isSelf
    ? currentUser.status
    : detailRecord?.status || memberRecord?.status || socialRecord?.status || onlineRecord?.status;
  const isOnline =
    resolvedStatus !== "invisible" &&
    (isSelf ||
      memberRecord?.online === true ||
      socialRecord?.online === true ||
      detailRecord?.online === true ||
      Boolean(onlineRecord));
  const joinedDeCaveAt = isSelf
    ? currentUser.createdAt
    : detailRecord?.createdAt || memberRecord?.createdAt || socialRecord?.createdAt || onlineRecord?.createdAt;
  const lastOnlineAt = isSelf
    ? currentUser.lastOnlineAt
    : detailRecord?.lastOnlineAt ||
      memberRecord?.lastOnlineAt ||
      socialRecord?.lastOnlineAt ||
      onlineRecord?.lastOnlineAt;
  const resolvedActivity = isSelf
    ? currentUser.activityText
    : detailRecord?.activityText ||
      memberRecord?.activityText ||
      socialRecord?.activityText ||
      onlineRecord?.activityText;
  const userNotificationsMuted = mutedUserIds.includes(target.userId);
  const userBlocked = blockedUserIds.includes(target.userId);
  if (isTopProfileMenu) {
    const ownStatus = (currentUser.status ?? "online") as PresenceStatus;
    return (
      <div
        className="user-context-menu dcp-menu"
        style={{ left: userContextMenu.x, top: userContextMenu.y, zIndex: 20050 }}
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
        role="dialog"
        aria-label="Your profile"
      >
        <div
          className="dcp-banner"
          style={
            currentUser.bannerUrl ? { backgroundImage: `url("${resolveAvatarUrl(currentUser.bannerUrl)}")` } : undefined
          }
        />
        <div className="dcp-body">
          <span className="dcp-avatar">
            <UserAvatar username={target.username} avatarUrl={target.avatarUrl} />
            <span
              className="dcp-presence"
              title={presenceLabel(ownStatus, true)}
              style={{ background: presenceColor(ownStatus, true) }}
            />
          </span>
          <div className="dcp-identity">
            <strong>{target.username}</strong>
            <small>Member since {formatProfileDate(joinedDeCaveAt)}</small>
          </div>
          {customStatusEditing ? (
            <div className="dcp-custom-status is-editing">
              <input
                value={customStatusDraft}
                onChange={(event) => setCustomStatusDraft(event.target.value.slice(0, 80))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void saveCustomStatus();
                  }
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    setCustomStatusEditing(false);
                    setCustomStatusError("");
                  }
                }}
                placeholder="What are you up to?"
                maxLength={80}
                autoFocus
                aria-label="Custom status"
              />
              <button
                type="button"
                onClick={() => void saveCustomStatus()}
                disabled={customStatusSaving}
                aria-label="Save custom status"
              >
                {customStatusSaving ? "…" : <Icon name="check" size="sm" />}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={`dcp-custom-status${currentUser.statusText ? " has-value" : ""}`}
              onClick={beginCustomStatusEdit}
            >
              {currentUser.statusText || "Set a custom status…"}
            </button>
          )}
          {customStatusError && <small className="dcp-error">{customStatusError}</small>}
          {resolvedActivity && <div className="dcp-activity">{resolvedActivity}</div>}
          <div className="dcp-id">
            <span title={target.userId}>{target.userId}</span>
            <button
              type="button"
              onClick={() => void copyMyDecaveId()}
              title="Copy DeCave ID"
              aria-label="Copy DeCave ID"
            >
              <Icon name="copy" size="sm" />
            </button>
          </div>
          <div className="dcp-sep" />
          <button
            type="button"
            className="dcp-item"
            aria-expanded={profileStatusMenuOpen}
            onClick={() => setProfileStatusMenuOpen((open) => !open)}
          >
            <span className="dcp-dot" style={{ background: presenceColor(ownStatus, true) }} />
            <span className="dcp-grow">{presenceLabel(ownStatus, true)}</span>
            <Icon name={profileStatusMenuOpen ? "chevron-down" : "chevron-right"} size="sm" />
          </button>
          {profileStatusMenuOpen && (
            <div className="dcp-status-list" role="group" aria-label="Set your status">
              {(["online", "idle", "dnd", "invisible"] as PresenceStatus[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`dcp-item dcp-sub${option === ownStatus ? " is-active" : ""}`}
                  aria-pressed={option === ownStatus}
                  onClick={() => {
                    setProfileStatusMenuOpen(false);
                    void changePresenceStatus(option);
                  }}
                >
                  <span className="dcp-dot" style={{ background: presenceColor(option, true) }} />
                  <span className="dcp-grow">
                    {option === "dnd" ? "Do Not Disturb" : option[0].toUpperCase() + option.slice(1)}
                  </span>
                  {option === ownStatus && <Icon name="check" size="sm" />}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="dcp-item"
            onClick={() => {
              setUserContextMenu(null);
              openSettings();
            }}
          >
            <Icon name="settings" size="sm" />
            <span className="dcp-grow">Settings</span>
          </button>
          <button
            type="button"
            className="dcp-item is-danger"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setShowLogoutConfirm(true);
              setUserContextMenu(null);
            }}
          >
            <Icon name="log-out" size="sm" />
            <span className="dcp-grow">Log out</span>
          </button>
        </div>
      </div>
    );
  }
  return (
    <div
      className="user-context-menu"
      style={{ left: userContextMenu.x, top: userContextMenu.y, zIndex: 20050 }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="user-context-profile">
        <span className="dc-profile-summary-avatar">
          <UserAvatar username={target.username} avatarUrl={target.avatarUrl} />
          <span
            className="dc-profile-summary-presence"
            title={presenceLabel(resolvedStatus, isOnline)}
            style={{
              background: presenceColor(resolvedStatus, isOnline),
              boxShadow: presenceGlow(resolvedStatus, isOnline),
            }}
          />
        </span>
        <div className="user-context-identity">
          <div className="dc-profile-summary-name-row">
            <strong>{target.username}</strong>
          </div>
          <span className="dc-profile-summary-presence-label">{presenceLabel(resolvedStatus, isOnline)}</span>
          {isSelf ? (
            <div className="user-context-custom-status">
              {customStatusEditing ? (
                <div className="user-context-custom-status-editor">
                  <input
                    value={customStatusDraft}
                    onChange={(event) => setCustomStatusDraft(event.target.value.slice(0, 80))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void saveCustomStatus();
                      }
                      if (event.key === "Escape") {
                        event.stopPropagation();
                        setCustomStatusEditing(false);
                        setCustomStatusError("");
                      }
                    }}
                    onClick={(event) => event.stopPropagation()}
                    placeholder="Write a custom status"
                    maxLength={80}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => void saveCustomStatus()}
                    disabled={customStatusSaving}
                    aria-label="Save custom status"
                    title="Save custom status"
                  >
                    {customStatusSaving ? "…" : <Icon name="check" size="sm" />}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="user-context-custom-status-value"
                  onDoubleClick={beginCustomStatusEdit}
                  title="Double-click to edit your custom status"
                >
                  {currentUser.statusText || "Double-click to set a custom status"}
                </button>
              )}
              {customStatusError && <small className="user-context-custom-status-error">{customStatusError}</small>}
            </div>
          ) : (
            <small>{target.role ? target.role.toUpperCase() : "USER"}</small>
          )}
        </div>
      </div>

      <div className="user-context-details">
        <div>
          <span>Member since</span>
          <strong>{formatProfileDate(joinedDeCaveAt)}</strong>
        </div>
        <div>
          <span>Last active</span>
          <strong>{isOnline ? "Online now" : formatProfileDate(lastOnlineAt)}</strong>
        </div>
        <div>
          <span>Status</span>
          <strong>{presenceLabel(resolvedStatus, isOnline)}</strong>
        </div>
        {resolvedActivity && (
          <div className="wide">
            <span>Activity</span>
            <strong>{resolvedActivity}</strong>
          </div>
        )}
        {isSelf && (
          <div className="wide dc-profile-id-fact">
            <span>DeCave ID</span>
            <strong title={target.userId}>{target.userId}</strong>
            <button
              type="button"
              onClick={() => void copyMyDecaveId()}
              title="Copy DeCave ID"
              aria-label="Copy DeCave ID"
            >
              ⧉
            </button>
          </div>
        )}
      </div>

      {!isSelf && (
        <>
          <button
            type="button"
            onClick={() =>
              openSafetyReport({
                targetType: "user",
                targetId: target.userId,
                subjectUserId: target.userId,
                subjectUsername: target.username,
                evidenceType: "profile",
                evidenceLabel: target.username,
              })
            }
          >
            Report User
          </button>
          <button
            type="button"
            className={userBlocked ? "active-state" : ""}
            onClick={() => void toggleBlockedUser(target)}
          >
            {userBlocked ? "Unblock User" : "Block User"}
          </button>
          <button
            type="button"
            className={userNotificationsMuted ? "active-state" : ""}
            onClick={() => toggleMutedUser(target.userId)}
          >
            {userNotificationsMuted ? "Unmute User Notifications" : "Mute User Notifications"}
          </button>
        </>
      )}

      {participant && participant.connectionId !== selfConnectionIdRef.current && (
        <div className="user-context-volume">
          <div>
            <span>User Volume</span>
            <strong>{Math.round(voiceUserVolumes[target.userId] ?? 100)}%</strong>
          </div>
          <input
            type="range"
            min="0"
            max="200"
            step="1"
            value={voiceUserVolumes[target.userId] ?? 100}
            onChange={(event) => changeVoiceUserVolume(participant, Number(event.target.value))}
            aria-label={`${target.username} volume`}
          />
        </div>
      )}
      {participant && participant.connectionId !== selfConnectionIdRef.current && (
        <button type="button" onClick={() => toggleLocalMuteUser(participant)}>
          {locallyMutedUsersRef.current.has(participant.userId) ? "Unmute User Locally" : "Mute User Locally"}
        </button>
      )}
      {target.userId === currentUser.id && voiceChannelId !== null && (
        <div className="user-context-self-latency">
          <span>Voice RTT</span>
          <strong>
            {ownVoiceRttMs !== null
              ? `${ownVoiceRttMs} ms`
              : peerSessionsRef.current.size === 0
                ? "Waiting for peer"
                : "Measuring..."}
          </strong>
        </div>
      )}

      {target.userId === currentUser.id && (
        <ProfileMenuSelfSection
          currentUser={currentUser}
          setUserContextMenu={setUserContextMenu}
          isMuted={isMuted}
          isDeafened={isDeafened}
          isServerMuted={isServerMuted}
          isServerDeafened={isServerDeafened}
          changePresenceStatus={changePresenceStatus}
          openSettings={openSettings}
          toggleMute={toggleMute}
          toggleDeafen={toggleDeafen}
        />
      )}

      {target.userId !== currentUser.id && (
        <>
          <div className="user-context-divider" />
          {friendStatus === "friend" ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setUserContextMenu(null);
                  void openDirectMessage(friendUser);
                }}
              >
                Message
              </button>
              <button type="button" onClick={() => askToRemoveFriend(friendUser)}>
                Remove Friend
              </button>
            </>
          ) : friendStatus === "incoming" ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setUserContextMenu(null);
                  void socialAction(target.userId, "accept");
                }}
              >
                Accept Friend Request
              </button>
              <button
                type="button"
                onClick={() => {
                  setUserContextMenu(null);
                  void socialAction(target.userId, "reject");
                }}
              >
                Decline Request
              </button>
            </>
          ) : friendStatus === "outgoing" ? (
            <button
              type="button"
              onClick={() => {
                setUserContextMenu(null);
                void socialAction(target.userId, "remove");
              }}
            >
              Cancel Friend Request
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setUserContextMenu(null);
                void socialAction(target.userId, "request");
              }}
            >
              Add Friend
            </button>
          )}
        </>
      )}

      {canModerate && participant && target.userId !== currentUser.id && (
        <>
          <div className="user-context-divider" />
          <div className="user-context-section-title">VOICE MODERATION</div>
          <button
            type="button"
            onClick={() => moderateVoiceUser(participant, participant.serverMuted ? "unmute" : "mute")}
          >
            {participant.serverMuted ? "Remove Server Mute" : "Server Mute"}
          </button>
          <button
            type="button"
            onClick={() => moderateVoiceUser(participant, participant.serverDeafened ? "undeafen" : "deafen")}
          >
            {participant.serverDeafened ? "Remove Server Deafen" : "Server Deafen"}
          </button>
          <button type="button" className="danger" onClick={() => moderateVoiceUser(participant, "kick")}>
            Disconnect from Voice
          </button>
        </>
      )}
    </div>
  );
}
