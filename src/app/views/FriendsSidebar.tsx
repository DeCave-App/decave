// Right-hand friends sidebar shown next to Hub rooms.

import { hubRoleName } from "./roleLabels";
import { useTranslation } from "react-i18next";
import type { MouseEvent as ReactMouseEvent, Dispatch, SetStateAction, MutableRefObject } from "react";
import { Icon } from "../../components/Icon";
import type {
  Channel,
  Server,
  AccountUser,
  ServerMemberView,
  VoiceParticipant,
  SocialUser,
  UserContextTarget,
  VoiceJoinAttempt,
} from "../types";
import { UserAvatar } from "../components/UserAvatar";

type Props = {
  currentUser: AccountUser;
  setShowHome: Dispatch<SetStateAction<boolean>>;
  hubMembers: ServerMemberView[];
  friends: SocialUser[];
  setFriendIdNotice: Dispatch<SetStateAction<string>>;
  setShowSocial: Dispatch<SetStateAction<boolean>>;
  setSocialView: Dispatch<SetStateAction<"dm" | "friends">>;
  rightFriendSearch: string;
  setRightFriendSearch: Dispatch<SetStateAction<string>>;
  rightFriendsCollapsed: boolean;
  setRightFriendsCollapsed: Dispatch<SetStateAction<boolean>>;
  voiceParticipants: VoiceParticipant[];
  voiceChannelId: number | null;
  voiceJoinAttemptRef: MutableRefObject<VoiceJoinAttempt | null>;
  openDirectMessage: (user: SocialUser) => Promise<void>;
  openUserContextMenu: (event: ReactMouseEvent, target: UserContextTarget) => void;
  accessibleVoiceFriends: { friend: SocialUser; participant: VoiceParticipant; server: Server; channel: Channel }[];
  openFriendVoiceRoom: (server: Server, channel: Channel) => void;
};

export function FriendsSidebar({
  currentUser,
  setShowHome,
  hubMembers,
  friends,
  setFriendIdNotice,
  setShowSocial,
  setSocialView,
  rightFriendSearch,
  setRightFriendSearch,
  rightFriendsCollapsed,
  setRightFriendsCollapsed,
  voiceParticipants,
  voiceChannelId,
  voiceJoinAttemptRef,
  openDirectMessage,
  openUserContextMenu,
  accessibleVoiceFriends,
  openFriendVoiceRoom,
}: Props) {
  const { t } = useTranslation(["common", "hub", "chat"]);
  return (
    <aside className={`members dc-global-friends-sidebar${rightFriendsCollapsed ? " collapsed" : ""}`}>
      <button
        type="button"
        className="dc-friends-rail-fold"
        title={rightFriendsCollapsed ? t("common.friendsSidebar.show") : t("common.friendsSidebar.hide")}
        onClick={() =>
          setRightFriendsCollapsed((current) => {
            const next = !current;
            try {
              localStorage.setItem("decave-right-friends-collapsed-v1", next ? "1" : "0");
            } catch {}
            return next;
          })
        }
      >
        <Icon name={rightFriendsCollapsed ? "chevron-left" : "chevron-right"} size="sm" />
      </button>
      {!rightFriendsCollapsed &&
        (() => {
          const friendQuery = rightFriendSearch.trim().toLowerCase();
          const visibleMembers = friends
            .filter(
              (friend) =>
                friend.id !== currentUser.id && (!friendQuery || friend.username.toLowerCase().includes(friendQuery)),
            )
            .map((friend) => {
              const hubMember = hubMembers.find((member) => member.userId === friend.id);
              return {
                ...friend,
                userId: friend.id,
                role: hubMember?.role ?? null,
                customRoles: hubMember?.customRoles ?? [],
                online: friend.online === true,
              };
            });
          const onlineMembers = visibleMembers.filter((member) => member.online);
          const offlineMembers = visibleMembers.filter((member) => !member.online);
          const visibleVoiceFriends = accessibleVoiceFriends.filter(
            ({ friend }) => !friendQuery || friend.username.toLowerCase().includes(friendQuery),
          );
          const friendVoiceGroups = visibleVoiceFriends.reduce(
            (groups, entry) => {
              const existing = groups.find(
                (group) => group.server.id === entry.server.id && group.channel.id === entry.channel.id,
              );
              if (existing) {
                existing.members.push(entry);
              } else {
                groups.push({ server: entry.server, channel: entry.channel, members: [entry] });
              }
              return groups;
            },
            [] as Array<{ server: Server; channel: Channel; members: typeof accessibleVoiceFriends }>,
          );
          return (
            <>
              <div className="dc-right-friends-tools">
                <input
                  type="search"
                  value={rightFriendSearch}
                  onChange={(event) => setRightFriendSearch(event.target.value)}
                  placeholder={t("common.friendsSidebar.search")}
                  aria-label={t("common.friendsSidebar.search")}
                />
                <button
                  type="button"
                  title={t("common.friendsSidebar.addFriend")}
                  aria-label={t("common.friendsSidebar.addFriend")}
                  onClick={() => {
                    setShowHome(false);
                    setShowSocial(true);
                    setSocialView("friends");
                    setFriendIdNotice("");
                  }}
                >
                  <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4.1 0-7.5 2.25-7.5 5v1h10.2a6.5 6.5 0 0 1-.2-1.5c0-1.7.65-4.4 1.7-4.4A12.4 12.4 0 0 0 9.5 13ZM19 12a1 1 0 0 0-2 0v2h-2a1 1 0 1 0 0 2h2v2a1 1 0 0 0 2 0v-2h2a1 1 0 1 0 0-2h-2v-2Z"
                    />
                  </svg>
                </button>
              </div>

              {friendVoiceGroups.length > 0 && (
                <section className="dc-friends-voice-panel" aria-label={t("common.friendsSidebar.voiceLabel")}>
                  <div className="dc-friends-panel-title">
                    <span>
                      <small>{t("common.friendsSidebar.voiceKicker")}</small>
                      <strong>{t("common.friendsSidebar.voiceTitle")}</strong>
                    </span>
                    <b>{visibleVoiceFriends.length}</b>
                  </div>
                  {friendVoiceGroups.map((group) => {
                    const inThisVoiceRoom =
                      voiceChannelId === group.channel.id ||
                      voiceJoinAttemptRef.current?.channelId === group.channel.id;
                    return (
                      <button
                        type="button"
                        className="dc-friends-voice-card"
                        key={`voice-group-${group.server.id}-${group.channel.id}`}
                        title={
                          inThisVoiceRoom
                            ? t("common.friendsSidebar.alreadyIn", { room: group.channel.name })
                            : t("common.friendsSidebar.joinRoom", { room: group.channel.name, hub: group.server.name })
                        }
                        aria-label={t(
                          inThisVoiceRoom
                            ? "common.friendsSidebar.alreadyInLabel"
                            : "common.friendsSidebar.joinRoomLabel",
                          {
                            room: group.channel.name,
                            hub: group.server.name,
                            names: group.members.map(({ friend }) => friend.username).join(", "),
                          },
                        )}
                        onClick={() => {
                          if (!inThisVoiceRoom) openFriendVoiceRoom(group.server, group.channel);
                        }}
                      >
                        <span className="dc-friends-voice-card-head">
                          <span>
                            <strong>{group.channel.name}</strong>
                            <small>{group.server.name}</small>
                          </span>
                          <b>
                            {inThisVoiceRoom ? t("common.friendsSidebar.inVoice") : t("common.friendsSidebar.join")}
                          </b>
                        </span>
                        <span className="dc-friends-voice-avatars">
                          {group.members.slice(0, 4).map(({ friend }) => (
                            <UserAvatar key={friend.id} username={friend.username} avatarUrl={friend.avatarUrl} />
                          ))}
                          {group.members.length > 4 && <i>+{group.members.length - 4}</i>}
                        </span>
                        <span className="dc-friends-voice-names">
                          {group.members.map(({ friend }) => friend.username).join(", ")}
                        </span>
                      </button>
                    );
                  })}
                </section>
              )}
              {onlineMembers.length > 0 && (
                <section className="dc-active-now-panel" aria-label={t("common.friendsSidebar.activeLabel")}>
                  <div className="dc-active-now-title">
                    <span className="dc-active-now-heading">
                      <small>
                        <i aria-hidden="true" /> {t("common.friendsSidebar.activeKicker")}
                      </small>
                      <strong>{t("common.friendsSidebar.activeTitle")}</strong>
                    </span>
                    <span className="dc-active-now-count">{onlineMembers.length}</span>
                  </div>
                  {onlineMembers.map((member) => (
                    <button
                      type="button"
                      className="dc-active-now-row"
                      key={`active-row-${member.userId}`}
                      onClick={() => {
                        const friend = friends.find((item) => item.id === member.userId);
                        if (friend) void openDirectMessage(friend);
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        const voiceParticipant = voiceParticipants.find((item) => item.userId === member.userId);
                        openUserContextMenu(event, {
                          userId: member.userId,
                          username: member.username,
                          avatarUrl: member.avatarUrl,
                          role: member.role,
                          connectionId: voiceParticipant?.connectionId,
                          voiceParticipant,
                        });
                      }}
                    >
                      <UserAvatar username={member.username} avatarUrl={member.avatarUrl} />
                      <span>
                        <strong>{member.username}</strong>
                        <small>{member.activityText || member.statusText || t("common.presence.online")}</small>
                      </span>
                      <i className="online" />
                    </button>
                  ))}
                </section>
              )}
              {offlineMembers.length > 0 && (
                <section className="dc-friends-status-panel" aria-label={t("common.friendsSidebar.offlineLabel")}>
                  <div className="dc-friends-status-group">
                    <div className="dc-friends-panel-title">
                      <span>
                        <small>{t("common.friendsSidebar.offlineKicker")}</small>
                        <strong>{t("common.friendsSidebar.offlineTitle")}</strong>
                      </span>
                      <b>{offlineMembers.length}</b>
                    </div>
                    {offlineMembers.map((member) => {
                      const friend = friends.find((item) => item.id === member.userId);
                      return (
                        <button
                          type="button"
                          className="dc-active-now-row dc-offline-friend-row"
                          key={`offline-row-${member.userId}`}
                          onClick={() => {
                            if (friend) void openDirectMessage(friend);
                          }}
                          onContextMenu={(event) =>
                            openUserContextMenu(event, {
                              userId: member.userId,
                              username: member.username,
                              avatarUrl: member.avatarUrl,
                              role: member.role,
                            })
                          }
                        >
                          <UserAvatar username={member.username} avatarUrl={member.avatarUrl} />
                          <span>
                            <strong>{member.username}</strong>
                            <small>
                              {t("common.friendsSidebar.offlineRole", {
                                role: member.role ? hubRoleName(member.role) : null,
                              })}
                            </small>
                          </span>
                          <i className="offline" />
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}
            </>
          );
        })()}
    </aside>
  );
}
