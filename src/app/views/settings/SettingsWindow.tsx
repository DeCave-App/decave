// The Settings window: sidebar (groups, search, "Your setup"), the open tab,
// the "Saved · Undo" toast and saving. Every change saves at once.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction, MutableRefObject, RefObject } from "react";
import { SettingsHeader, SettingsNav, SettingsSectionIntro } from "../../../features/settings";
import { SettingsToastProvider, useSettingsToast } from "../../../features/settings/SettingsToast";
import { useNextCommit } from "../../../features/settings/useSettingField";
import { SettingsPersistContext, useSettingsPersist, type PersistSettings } from "../../../features/settings/persist";
import type { SettingsTabId } from "../../../features/settings/settingsMap";
import type { MfaStatus } from "../../../features/settings/TwoFactorPanel";
import type { CheckupItem } from "../../../features/settings/checkup/checks";
import type { GlassEnvironment } from "../../../features/settings/extraSettings";
import { setCheckupDismissed } from "../../../features/settings/checkup/dismissed";
import { useCheckup } from "../../../features/settings/checkup/useCheckup";
import { YourSetupTab } from "../../../features/settings/checkup/YourSetupTab";
import type {
  Server,
  AccountUser,
  ServerMemberView,
  VoiceParticipant,
  SocialUser,
  AppSkin,
  DesktopKeybindSettings,
  AudioSettings,
  UiSoundEvent,
} from "../../types";
import { hasDesktopActivityBridge, requestDesktopNotifications } from "../../desktop";
import { AppearanceTab } from "../../../features/settings/tabs/AppearanceTab";
import { ProfileStatusTab } from "../../../features/settings/tabs/ProfileStatusTab";
import { AccountDevicesTab } from "../../../features/settings/tabs/AccountDevicesTab";
import { PrivacyEncryptionTab } from "../../../features/settings/tabs/PrivacyEncryptionTab";
import { ConnectionsTab } from "../../../features/settings/tabs/ConnectionsTab";
import { ChatTab } from "../../../features/settings/tabs/ChatTab";
import { GamingOverlayTab } from "../../../features/settings/tabs/GamingOverlayTab";
import { VoiceVideoTab } from "../../../features/settings/tabs/VoiceVideoTab";
import { AppAboutTab } from "../../../features/settings/tabs/AppAboutTab";
import { LanguageRegionTab } from "../../../features/settings/tabs/LanguageRegionTab";
import { NotificationsSoundsTab } from "../../../features/settings/tabs/NotificationsSoundsTab";
import type { PreferencesState } from "../../state/preferences";
import type { SettingsWindowState } from "../../state/settings-window";
import type { ProfileMediaState } from "../../state/profile-media";
import type { AccountSessionsState } from "../../state/account-sessions";
import type { OwnerSecurityState } from "../../state/owner-security";
import type { ProfileFieldsState } from "../../state/profile-fields";
import type { GameActivityState } from "../../state/game-activity";
import type { AudioSetupState } from "../../state/audio-setup";
import type { DesktopUpdates } from "../../hooks/useDesktopUpdates";
import type { AdminActions } from "../../actions/admin";
import type { AccountActions } from "../../actions/account";
import type { SettingsActions } from "../../actions/settings";
import type { ProfileMediaActions } from "../../actions/profile-media";
import type { ActivityActions } from "../../actions/activity";
import type { QuietPresenceSettings as QuietPresenceModel } from "../../../session/quiet-presence";

export type SettingsWindowProps = {
  currentUser: AccountUser;
  preferences: PreferencesState;
  prefersDark: boolean;
  systemReducedMotion: boolean;
  /** Why Liquid Glass may be switched off automatically on this device. */
  glassEnvironment: GlassEnvironment;
  settingsWindow: SettingsWindowState;
  profileMedia: ProfileMediaState;
  profileAvatarError: string;
  securityNotice: string;
  accountSessions: AccountSessionsState;
  securityBusy: boolean;
  keybindCapture: keyof DesktopKeybindSettings | null;
  setKeybindCapture: Dispatch<SetStateAction<keyof DesktopKeybindSettings | null>>;
  ownerSecurity: OwnerSecurityState;
  setShowMyReports: Dispatch<SetStateAction<boolean>>;
  setBlockedUserIds: Dispatch<SetStateAction<string[]>>;
  profileFields: ProfileFieldsState;
  gameActivity: GameActivityState;
  captureApps: string[];
  autoStreamerActive: boolean;
  effectiveStreamerMode: boolean;
  servers: Server[];
  hubMembers: ServerMemberView[];
  friends: SocialUser[];
  setShowHubHome: Dispatch<SetStateAction<boolean>>;
  voiceParticipants: VoiceParticipant[];
  audioSettings: AudioSettings;
  voiceUserVolumes: Record<string, number>;
  audioSetup: AudioSetupState;
  voiceChannelRef: MutableRefObject<number | null>;
  playUiSound: (event: UiSoundEvent, preview?: boolean, quietChecked?: boolean) => void;
  audioSettingsRef: MutableRefObject<AudioSettings>;
  localScreenStreamRef: MutableRefObject<MediaStream | null>;
  desktopUpdates: DesktopUpdates;
  desktopInstalledVersion: string;
  chooseAppSkin: (skin: AppSkin) => void;
  currentServer: Server;
  copyMyDecaveId: () => Promise<void>;
  sendSocket: (payload: unknown) => boolean;
  applyOutputDevice: (outputDeviceId: string) => Promise<void>;
  changeInputVolume: (value: number) => void;
  closeSettings: () => void;
  resetVoiceUserVolumes: (userId?: string) => void;
  changeVoiceUserVolume: (participant: VoiceParticipant, volume: number) => void;
  saveAudioSettings: (next: AudioSettings) => void;
  rebuildMicrophoneIfActive: (next: AudioSettings) => Promise<void>;
  startMicTest: () => Promise<void>;
  stopMicTest: () => void;
  logoutAllSessions: () => Promise<void>;
  changeServer: (serverId: number, availableServers?: Server[]) => void;
  changeChannel: (channelId: number) => void;
  sendTypingState: (active: boolean) => void;
  automaticActivityElapsed: string;
  currentGameIcon: string;
  adminActions: AdminActions;
  accountActions: AccountActions;
  settingsActions: SettingsActions;
  profileMediaActions: ProfileMediaActions;
  activityActions: ActivityActions;
  quietPresence: QuietPresenceModel;
  updateQuietPresence: (next: QuietPresenceModel) => void;
};

/** Scrolls a setting found by search into view and flashes it. */
function flashAnchor(root: HTMLElement | null, anchor: string) {
  const target = root?.querySelector<HTMLElement>(`[data-settings-anchor="${CSS.escape(anchor)}"]`);
  if (!target) return;
  target.scrollIntoView({ block: "center", behavior: "smooth" });
  target.classList.remove("dcs-anchor-flash");
  void target.offsetWidth; // restart the animation
  target.classList.add("dcs-anchor-flash");
  window.setTimeout(() => target.classList.remove("dcs-anchor-flash"), 1700);
}

export function SettingsWindow(props: SettingsWindowProps) {
  const { settingsActions } = props;
  const rootRef = useRef<HTMLElement | null>(null);

  const nextCommit = useNextCommit();
  const persistRef = useRef(settingsActions.persistSettings);
  persistRef.current = settingsActions.persistSettings;
  const persist = useCallback<PersistSettings>(
    async (parts) => {
      await nextCommit();
      if (!(await persistRef.current(parts))) throw new Error("Settings were not saved");
    },
    [nextCommit],
  );

  return (
    <section
      ref={rootRef}
      className="dc-workspace-page dc-settings-page"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dcs-settings-title"
    >
      <SettingsPersistContext.Provider value={persist}>
        <SettingsToastProvider>
          <SettingsWindowBody {...props} rootRef={rootRef} />
        </SettingsToastProvider>
      </SettingsPersistContext.Provider>
    </section>
  );
}

function SettingsWindowBody({ rootRef, ...props }: SettingsWindowProps & { rootRef: RefObject<HTMLElement | null> }) {
  const { currentUser, settingsWindow, closeSettings, preferences, audioSettings, desktopUpdates } = props;
  const persist = useSettingsPersist();
  const toast = useSettingsToast();
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);
  const [busyFix, setBusyFix] = useState<string | null>(null);
  const tab = settingsWindow.settingsTab;
  const checkup = useCheckup({
    currentUser,
    audioSettings,
    notificationSettings: preferences.notificationSettings,
    desktopUpdates,
  });

  // Search results and entry points can name a setting inside the tab.
  useEffect(() => {
    if (!pendingAnchor) return;
    flashAnchor(rootRef.current, pendingAnchor);
    setPendingAnchor(null);
  }, [pendingAnchor, tab]);

  const select = (next: SettingsTabId, anchor?: string) => {
    settingsWindow.setSettingsTab(next);
    if (anchor) setPendingAnchor(anchor);
    else rootRef.current?.querySelector(".dc-settings-shell")?.scrollTo?.({ top: 0 });
  };

  // Settings opens on Your setup when something needs attention, unless an
  // entry point asked for a tab (voice controls, Inbox, account actions).
  const decided = useRef(false);
  useEffect(() => {
    if (!decided.current) {
      decided.current = true;
      if (!settingsWindow.settingsTabRequestedRef.current && checkup.items.length > 0)
        settingsWindow.setSettingsTab("setup");
    }
    settingsWindow.settingsTabRequestedRef.current = false;
    return () => {
      settingsWindow.settingsTabRequestedRef.current = false;
    };
  }, []);

  const fix = async (item: CheckupItem) => {
    if ("tab" in item.fix) {
      select(item.fix.tab, item.fix.anchor);
      return;
    }
    setBusyFix(item.id);
    try {
      if (item.fix.action === "requestNotifications") await requestDesktopNotifications();
      else desktopUpdates.handleRestartDesktopToUpdate();
    } finally {
      setBusyFix(null);
      checkup.refresh();
    }
  };

  const dismiss = (item: CheckupItem) => {
    const before = checkup.dismissed;
    const save = (next: string[]) => {
      setCheckupDismissed(next);
      void persist(["account"]).catch(() => undefined);
    };
    save([...before, item.id]);
    toast.show("settings.checkup.dismissed", () => save(before));
  };

  return (
    <div className="dc-settings-shell vadrion-settings-modal">
      <SettingsHeader username={currentUser.username} onClose={closeSettings} />
      <SettingsNav
        activeId={tab}
        query={settingsWindow.settingsSearch}
        onQueryChange={settingsWindow.setSettingsSearch}
        onSelect={select}
        setupCount={checkup.items.length}
        isDesktop={hasDesktopActivityBridge()}
      />
      <SettingsSectionIntro tab={tab} />
      {tab === "setup" ? (
        <YourSetupTab items={checkup.items} busyFix={busyFix} onFix={(item) => void fix(item)} onDismiss={dismiss} />
      ) : (
        <SettingsTabBody {...props} onJump={select} onMfaStatus={(status) => checkup.reportTwoFactor(status.enabled)} />
      )}
    </div>
  );
}

type TabBodyProps = SettingsWindowProps & {
  onJump: (tab: SettingsTabId, anchor?: string) => void;
  onMfaStatus: (status: MfaStatus) => void;
};

function SettingsTabBody({ onJump, onMfaStatus, ...p }: TabBodyProps) {
  switch (p.settingsWindow.settingsTab) {
    case "profile":
      return <ProfileStatusTab {...p} />;
    case "account":
      return <AccountDevicesTab {...p} onMfaStatus={onMfaStatus} />;
    case "appearance":
      return <AppearanceTab {...p} />;
    case "gaming":
      return <GamingOverlayTab {...p} />;
    case "language":
      return <LanguageRegionTab {...p} />;
    case "notifications":
      return <NotificationsSoundsTab {...p} />;
    case "privacy":
      return <PrivacyEncryptionTab {...p} />;
    case "connections":
      return <ConnectionsTab {...p} />;
    case "chat":
      return <ChatTab {...p} />;
    case "app":
      return <AppAboutTab {...p} />;
    case "voice":
      return <VoiceVideoTab {...p} onJump={onJump} />;
    default:
      return null;
  }
}
