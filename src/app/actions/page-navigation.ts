// Opening the main pages: Settings, Home, Hubs, Messages, Friends, Squad Finder.

import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import type { SocialUser, GroupChatMessage, GroupChat, DmNotice, SteamIntegrationState, ActivityState } from "../types";
import type { AudioSetupState } from "../state/audio-setup";
import type { HubPanelsState } from "../state/hub-panels";

export type PageNavigationDeps = {
  setShowSettings: Dispatch<SetStateAction<boolean>>;
  setShowAdminDashboard: Dispatch<SetStateAction<boolean>>;
  setShowHome: Dispatch<SetStateAction<boolean>>;
  setShowServerBrowser: Dispatch<SetStateAction<boolean>>;
  setShowSquadFinder: Dispatch<SetStateAction<boolean>>;
  setSquadNotice: Dispatch<SetStateAction<string>>;
  setShowSocial: Dispatch<SetStateAction<boolean>>;
  setSocialView: Dispatch<SetStateAction<"dm" | "friends">>;
  setActiveDmUser: Dispatch<SetStateAction<SocialUser | null>>;
  setActiveGroupChat: Dispatch<SetStateAction<GroupChat | null>>;
  setGroupMessages: Dispatch<SetStateAction<GroupChatMessage[]>>;
  setFriendRequestNotice: Dispatch<SetStateAction<SocialUser | null>>;
  setDmNotice: Dispatch<SetStateAction<DmNotice | null>>;
  activeDmUserRef: MutableRefObject<SocialUser | null>;
  activeGroupChatRef: MutableRefObject<GroupChat | null>;
  refreshActivityState: () => Promise<ActivityState | null>;
  refreshSteamIntegration: () => Promise<SteamIntegrationState | null>;
  loadSquadMatches: () => Promise<void>;
  loadSquadGames: () => Promise<void>;
  loadSocialState: () => Promise<void>;
  loadDmConversations: () => Promise<void>;
  loadGroupChats: () => Promise<void>;
  closePrimaryTransientOverlays: () => void;
  refreshAudioDevices: () => Promise<void>;
  loadAccountPreferences: () => Promise<void>;
  loadDesktopIntegrationSettings: () => Promise<void>;
  audioSetup: AudioSetupState;
  hubPanels: HubPanelsState;
};

/** Called once per render with that render's values. */
export function createPageNavigation(deps: PageNavigationDeps) {
  const {
    setShowSettings,
    setShowAdminDashboard,
    setShowHome,
    setShowServerBrowser,
    setShowSquadFinder,
    setSquadNotice,
    setShowSocial,
    setSocialView,
    setActiveDmUser,
    setActiveGroupChat,
    setGroupMessages,
    setFriendRequestNotice,
    setDmNotice,
    activeDmUserRef,
    activeGroupChatRef,
    refreshActivityState,
    refreshSteamIntegration,
    loadSquadMatches,
    loadSquadGames,
    loadSocialState,
    loadDmConversations,
    loadGroupChats,
    closePrimaryTransientOverlays,
    refreshAudioDevices,
    loadAccountPreferences,
    loadDesktopIntegrationSettings,
    audioSetup,
    hubPanels,
  } = deps;
  const { setShowHubMembersPanel, setShowHubHome, setShowHubCalendarPanel } = hubPanels;
  const { setAudioSettingsError, setAudioSettingsNotice } = audioSetup;

  const openSettings = () => {
    closePrimaryTransientOverlays();
    setShowHome(false);
    setShowSocial(false);
    setShowServerBrowser(false);
    setShowAdminDashboard(false);
    setAudioSettingsError("");
    setAudioSettingsNotice("");
    setShowSettings(true);
    void Promise.allSettled([loadAccountPreferences(), loadDesktopIntegrationSettings()]);
    void refreshAudioDevices();
    void refreshActivityState();
    void refreshSteamIntegration();
  };

  const openHomeWorkspace = () => {
    closePrimaryTransientOverlays();
    setShowSocial(false);
    setShowSettings(false);
    setShowServerBrowser(false);
    setShowAdminDashboard(false);
    setActiveDmUser(null);
    activeDmUserRef.current = null;
    setActiveGroupChat(null);
    activeGroupChatRef.current = null;
    setGroupMessages([]);
    setShowHome(true);
    void loadDmConversations();
    void loadSocialState();
  };

  const openHubsWorkspace = () => {
    closePrimaryTransientOverlays();
    setShowHome(false);
    setShowSocial(false);
    setShowSettings(false);
    setShowServerBrowser(false);
    setShowAdminDashboard(false);
    setShowHubHome(false);
    setShowHubMembersPanel(false);
    setShowHubCalendarPanel(false);
  };

  const openDirectMessagesWorkspace = () => {
    closePrimaryTransientOverlays();
    setDmNotice(null);
    setShowHome(false);
    setShowSettings(false);
    setShowServerBrowser(false);
    setShowAdminDashboard(false);
    setShowSocial(true);
    setSocialView("dm");
    setActiveDmUser(null);
    activeDmUserRef.current = null;
    setActiveGroupChat(null);
    activeGroupChatRef.current = null;
    setGroupMessages([]);
    void loadSocialState();
    void loadDmConversations();
    void loadGroupChats();
  };

  const openFriendsWorkspace = () => {
    closePrimaryTransientOverlays();
    setFriendRequestNotice(null);
    setShowHome(false);
    setShowSettings(false);
    setShowServerBrowser(false);
    setShowAdminDashboard(false);
    setShowSocial(true);
    setSocialView("friends");
    setActiveDmUser(null);
    activeDmUserRef.current = null;
    setActiveGroupChat(null);
    activeGroupChatRef.current = null;
    setGroupMessages([]);
    void loadSocialState();
  };

  const openSquadFinderWorkspace = () => {
    closePrimaryTransientOverlays();
    setShowHome(false);
    setShowSocial(false);
    setShowSettings(false);
    setShowServerBrowser(false);
    setShowAdminDashboard(false);
    setShowSquadFinder(true);
    setSquadNotice("");
    void loadSquadMatches();
    void loadSquadGames();
  };

  return {
    openSettings,
    openHomeWorkspace,
    openHubsWorkspace,
    openDirectMessagesWorkspace,
    openFriendsWorkspace,
    openSquadFinderWorkspace,
  };
}

export type PageNavigation = ReturnType<typeof createPageNavigation>;
