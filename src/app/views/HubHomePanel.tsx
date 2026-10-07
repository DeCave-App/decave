// A Hub's home page, wired to rooms, voice, events, the setup checklist and unread state.

import type { Dispatch, SetStateAction, MutableRefObject, JSX } from "react";
import { HubSetupChecklist } from "../../features/hub-home/HubOwnerTools";
import { hubSetupSteps } from "../../features/hub-home/hubSetup";
import { HubHome, type HubHomeCatchUp, type HubHomeEvent, type HubHomeLiveRoom } from "../../features/hub-home/HubHome";
import type { HubHomeConfig } from "../../../shared/hub-home";
import type { CalendarItem } from "../../features/events";
import type { Server, ServerMemberView, VoiceJoinAttempt } from "../types";
import { HTTP_URL } from "../env";
import type { PreferencesState } from "../state/preferences";
import type { VoiceCallState } from "../state/voice-call";
import type { HubPanelsState } from "../state/hub-panels";
import type { SettingsActions } from "../actions/settings";
import type { ContextMenuActions } from "../actions/context-menus";
import type { HubChatActions } from "../actions/hub-chat";

type Props = {
  preferences: PreferencesState;
  voiceCall: VoiceCallState;
  hubPanels: HubPanelsState;
  setRoomUnread: Dispatch<SetStateAction<Record<number, number>>>;
  setRoomMentions: Dispatch<SetStateAction<Record<number, number>>>;
  hubMembers: ServerMemberView[];
  lobbyPendingJoinRef: MutableRefObject<{ channelId: number; muted: boolean; camera: boolean } | null>;
  voiceChannelId: number | null;
  voiceJoinAttemptRef: MutableRefObject<VoiceJoinAttempt | null>;
  currentServer: Server;
  canManageCurrentServer: boolean;
  isCurrentServerOwner: boolean;
  saveHubHome: (hubId: number, config: HubHomeConfig) => Promise<void>;
  joinVoiceChannel: (channelId: number, recoveryRetry?: boolean) => Promise<void>;
  settingsActions: SettingsActions;
  changeChannel: (channelId: number) => void;
  openManageServer: () => void;
  openCreateRoomOfType: (type: "text" | "voice" | "forum") => void;
  contextMenus: ContextMenuActions;
  hubChat: HubChatActions;
  canCreateEventsIn: (hubId: number) => boolean;
  openCalendarItem: (item: CalendarItem) => void;
  openHubCalendar: (forceOpen?: boolean) => void;
  currentHubHome: HubHomeConfig;
  hubHomeLive: HubHomeLiveRoom[];
  hubHomeEventItems: CalendarItem[];
  hubHomeEvents: HubHomeEvent[];
  hubHomeCatchUp: HubHomeCatchUp[];
  hubHomeMembers: { id: string; name: string; avatar: JSX.Element }[];
};

export function HubHomePanel({
  preferences,
  voiceCall,
  hubPanels,
  setRoomUnread,
  setRoomMentions,
  hubMembers,
  lobbyPendingJoinRef,
  voiceChannelId,
  voiceJoinAttemptRef,
  currentServer,
  canManageCurrentServer,
  isCurrentServerOwner,
  saveHubHome,
  joinVoiceChannel,
  settingsActions,
  changeChannel,
  openManageServer,
  openCreateRoomOfType,
  contextMenus,
  hubChat,
  canCreateEventsIn,
  openCalendarItem,
  openHubCalendar,
  currentHubHome,
  hubHomeLive,
  hubHomeEventItems,
  hubHomeEvents,
  hubHomeCatchUp,
  hubHomeMembers,
}: Props) {
  return (
    <HubHome
      name={currentServer.name}
      icon={currentServer.iconUrl ? <img src={`${HTTP_URL}${currentServer.iconUrl}`} alt="" /> : currentServer.icon}
      bannerUrl={currentServer.bannerUrl ? `${HTTP_URL}${currentServer.bannerUrl}` : null}
      accent={currentServer.accent}
      description={currentServer.description}
      category={currentServer.category}
      tags={currentServer.tags ?? []}
      visibility={currentServer.visibility}
      memberCount={currentServer.memberCount ?? null}
      onlineCount={currentServer.onlineCount ?? null}
      membershipPrivate={Boolean(currentServer.membershipPrivate) && !isCurrentServerOwner}
      roleLabel={currentServer.myRole ? `You are ${currentServer.myRole}` : undefined}
      home={currentHubHome}
      canCustomize={currentServer.myRole === "owner" || currentServer.myRole === "admin"}
      onSaveHome={(config) => saveHubHome(currentServer.id, config)}
      live={hubHomeLive}
      events={hubHomeEvents}
      catchUp={hubHomeCatchUp}
      members={hubHomeMembers}
      friendsHere={hubMembers.filter((member) => member.isFriend).length}
      muted={preferences.mutedHubIds.includes(currentServer.id)}
      canManage={canManageCurrentServer}
      canCreateEvents={canCreateEventsIn(currentServer.id)}
      onOpenRoom={(roomId) => changeChannel(roomId)}
      onJoinVoice={(roomId) => {
        changeChannel(roomId);
        if (voiceChannelId === roomId || voiceJoinAttemptRef.current !== null) return;
        lobbyPendingJoinRef.current = {
          channelId: roomId,
          muted: voiceCall.lobbyJoinMuted,
          camera: false,
        };
        void joinVoiceChannel(roomId);
      }}
      onOpenEvent={(key) => {
        const item = hubHomeEventItems.find((candidate) => candidate.key === key);
        if (item) openCalendarItem(item);
      }}
      onOpenCalendar={() => openHubCalendar(true)}
      onCreateEvent={hubChat.openEventComposer}
      onInvite={() => void contextMenus.copyHubShareLink(currentServer)}
      onManage={openManageServer}
      onToggleMute={() => settingsActions.toggleMutedHub(currentServer.id)}
      onMarkAllRead={() => {
        const ids = currentServer.channels.map((channel) => channel.id);
        setRoomUnread((current) => {
          const next = { ...current };
          for (const id of ids) next[id] = 0;
          return next;
        });
        setRoomMentions((current) => {
          const next = { ...current };
          for (const id of ids) next[id] = 0;
          return next;
        });
      }}
      onOpenMembers={() => hubPanels.setShowHubMembersPanel(true)}
      onOpenInsights={() => hubPanels.setShowHubInsights(true)}
      ownerTools={({ customize }) => (
        <HubSetupChecklist
          hubId={currentServer.id}
          steps={hubSetupSteps({
            description: currentServer.description ?? "",
            hasArtwork: Boolean(currentServer.iconUrl || currentServer.bannerUrl),
            welcome: currentHubHome.welcome,
            rules: currentHubHome.rules,
            textRooms: currentServer.channels.filter((channel) => channel.type !== "voice").length,
            events: hubHomeEventItems.length,
            members: currentServer.memberCount ?? hubMembers.length,
          })}
          onAction={(action) => {
            if (action === "manage") openManageServer();
            else if (action === "customize") customize();
            else if (action === "createRoom") openCreateRoomOfType("text");
            else if (action === "createEvent") hubChat.openEventComposer();
            else void contextMenus.copyHubShareLink(currentServer);
          }}
        />
      )}
    />
  );
}
