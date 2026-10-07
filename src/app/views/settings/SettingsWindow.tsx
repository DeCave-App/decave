// The Settings window: navigation, the open section and the save bar.

import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import {
  SettingsHeader,
  SettingsNav,
  SettingsSectionIntro,
  SettingsSaveBar,
  SAVEABLE_SETTINGS_SECTIONS,
} from "../../../features/settings";
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
import { requestDesktopNotifications } from "../../desktop";
import type { StudioSettingSection } from "../../../components/studio";
import { AccountSettingsSection } from "./AccountSettingsSection";
import { AppearanceSettingsSection } from "./AppearanceSettingsSection";
import { ProfileSettingsSection } from "./ProfileSettingsSection";
import { ActivitySettingsSection } from "./ActivitySettingsSection";
import { PrivacySettingsSection } from "./PrivacySettingsSection";
import { VoiceSettingsSection } from "./VoiceSettingsSection";
import { SystemSettingsSection } from "./SystemSettingsSection";
import { KeybindsSettingsSection } from "./KeybindsSettingsSection";
import { DatesSettingsSection } from "./DatesSettingsSection";
import { NotificationsSettingsSection } from "./NotificationsSettingsSection";
import { SoundsSettingsSection } from "./SoundsSettingsSection";
import { SupportSettingsSection } from "./SupportSettingsSection";
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

const studioSettingsSections: StudioSettingSection[] = [
  { id: "profile", label: "Profile", description: "Photo, banner, display name, pronouns and status" },
  {
    id: "account",
    label: "Account & security",
    description: "Email, password, two-factor sign-in, sign-in alerts, devices and your data",
  },
  { id: "voice", label: "Voice & video", description: "Microphone, speakers, camera and per-person volume" },
  { id: "activity", label: "Activity status", description: "Show the game you're playing, and who can see it" },
  { id: "appearance", label: "Appearance", description: "Skin, light and dark, text size, motion and readability" },
  {
    id: "notifications",
    label: "Notifications",
    description: "Alerts, quiet hours, and how loud each Hub and room is",
  },
  { id: "sounds", label: "Sounds", description: "Interface and voice event sounds" },
  { id: "system", label: "System", description: "Desktop app startup and updates" },
  { id: "keybinds", label: "Keybinds", description: "Global shortcuts and every keyboard shortcut" },
  { id: "language", label: "Dates & times", description: "How dates and times are written" },
  {
    id: "privacy",
    label: "Privacy & safety",
    description: "Friend requests, messages, blocked accounts and streaming",
  },
  { id: "support", label: "Support & about", description: "Report a bug, contact support, what's new" },
];

type Props = {
  currentUser: AccountUser;
  preferences: PreferencesState;
  prefersDark: boolean;
  systemReducedMotion: boolean;
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
  saveSettingsChanges: () => Promise<void>;
  closeSettings: () => void;
  resetVoiceUserVolumes: (userId?: string) => void;
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
};

export function SettingsWindow({
  currentUser,
  preferences,
  prefersDark,
  systemReducedMotion,
  settingsWindow,
  profileMedia,
  profileAvatarError,
  securityNotice,
  accountSessions,
  securityBusy,
  keybindCapture,
  setKeybindCapture,
  ownerSecurity,
  setShowMyReports,
  setBlockedUserIds,
  profileFields,
  gameActivity,
  captureApps,
  autoStreamerActive,
  effectiveStreamerMode,
  servers,
  hubMembers,
  friends,
  setShowHubHome,
  voiceParticipants,
  audioSettings,
  voiceUserVolumes,
  audioSetup,
  voiceChannelRef,
  playUiSound,
  audioSettingsRef,
  localScreenStreamRef,
  desktopUpdates,
  desktopInstalledVersion,
  chooseAppSkin,
  currentServer,
  copyMyDecaveId,
  sendSocket,
  applyOutputDevice,
  changeInputVolume,
  saveSettingsChanges,
  closeSettings,
  resetVoiceUserVolumes,
  saveAudioSettings,
  rebuildMicrophoneIfActive,
  startMicTest,
  stopMicTest,
  logoutAllSessions,
  changeServer,
  changeChannel,
  sendTypingState,
  automaticActivityElapsed,
  currentGameIcon,
  adminActions,
  accountActions,
  settingsActions,
  profileMediaActions,
  activityActions,
}: Props) {
  const { runAutomaticActivityScan, connectSteam, disconnectSteam } = activityActions;
  const { uploadProfileBanner, removeProfileBanner, uploadProfileAvatar, removeProfileAvatar } = profileMediaActions;
  const { finishCloseSettings, resetCurrentSettingsSection } = settingsActions;
  const { openAccountEditor, loadAccountSessions, revokeDeviceSession, beginAccountDangerAction } = accountActions;
  const {
    startOwnerMfaSetup,
    enableOwnerMfa,
    ownerPrivilegedReauth,
    promotePlatformOwner,
    demotePlatformOwner,
    regenerateOwnerRecoveryCodes,
  } = adminActions;
  return (
    <section
      className="dc-workspace-page dc-settings-page"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dcs-settings-title"
    >
      <div className="dc-settings-shell vadrion-settings-modal">
        <SettingsHeader username={currentUser.username} onClose={closeSettings} />
        <SettingsNav
          sections={studioSettingsSections}
          activeId={settingsWindow.settingsTab}
          query={settingsWindow.settingsSearch}
          onQueryChange={settingsWindow.setSettingsSearch}
          onSelect={(id) => settingsWindow.setSettingsTab(id as typeof settingsWindow.settingsTab)}
          dirty={settingsWindow.settingsDirty}
        />
        <SettingsSectionIntro
          section={studioSettingsSections.find((section) => section.id === settingsWindow.settingsTab)}
        />

        {settingsWindow.settingsTab === "account" && (
          <AccountSettingsSection
            currentUser={currentUser}
            securityNotice={securityNotice}
            securityBusy={securityBusy}
            effectiveStreamerMode={effectiveStreamerMode}
            openAccountEditor={openAccountEditor}
            startOwnerMfaSetup={startOwnerMfaSetup}
            enableOwnerMfa={enableOwnerMfa}
            ownerPrivilegedReauth={ownerPrivilegedReauth}
            promotePlatformOwner={promotePlatformOwner}
            demotePlatformOwner={demotePlatformOwner}
            regenerateOwnerRecoveryCodes={regenerateOwnerRecoveryCodes}
            loadAccountSessions={loadAccountSessions}
            revokeDeviceSession={revokeDeviceSession}
            beginAccountDangerAction={beginAccountDangerAction}
            logoutAllSessions={logoutAllSessions}
            copyMyDecaveId={copyMyDecaveId}
            ownerSecurity={ownerSecurity}
            accountSessions={accountSessions}
            preferences={preferences}
          />
        )}

        {settingsWindow.settingsTab === "appearance" && (
          <AppearanceSettingsSection
            prefersDark={prefersDark}
            systemReducedMotion={systemReducedMotion}
            chooseAppSkin={chooseAppSkin}
            preferences={preferences}
          />
        )}

        {settingsWindow.settingsTab === "profile" && (
          <ProfileSettingsSection
            currentUser={currentUser}
            profileAvatarError={profileAvatarError}
            openAccountEditor={openAccountEditor}
            uploadProfileBanner={uploadProfileBanner}
            removeProfileBanner={removeProfileBanner}
            uploadProfileAvatar={uploadProfileAvatar}
            removeProfileAvatar={removeProfileAvatar}
            profileMedia={profileMedia}
            profileFields={profileFields}
            preferences={preferences}
          />
        )}

        {settingsWindow.settingsTab === "activity" && (
          <ActivitySettingsSection
            currentUser={currentUser}
            runAutomaticActivityScan={runAutomaticActivityScan}
            connectSteam={connectSteam}
            disconnectSteam={disconnectSteam}
            automaticActivityElapsed={automaticActivityElapsed}
            currentGameIcon={currentGameIcon}
            preferences={preferences}
            gameActivity={gameActivity}
          />
        )}

        {settingsWindow.settingsTab === "system" && (
          <SystemSettingsSection desktopUpdates={desktopUpdates} preferences={preferences} />
        )}

        {settingsWindow.settingsTab === "keybinds" && (
          <KeybindsSettingsSection
            keybindCapture={keybindCapture}
            setKeybindCapture={setKeybindCapture}
            audioSettings={audioSettings}
            preferences={preferences}
          />
        )}

        {settingsWindow.settingsTab === "language" && <DatesSettingsSection preferences={preferences} />}

        {settingsWindow.settingsTab === "notifications" && (
          <NotificationsSettingsSection
            servers={servers}
            requestDesktopNotifications={requestDesktopNotifications}
            currentServer={currentServer}
            preferences={preferences}
          />
        )}

        {settingsWindow.settingsTab === "sounds" && (
          <SoundsSettingsSection playUiSound={playUiSound} preferences={preferences} />
        )}

        {settingsWindow.settingsTab === "privacy" && (
          <PrivacySettingsSection
            currentUser={currentUser}
            setShowMyReports={setShowMyReports}
            setBlockedUserIds={setBlockedUserIds}
            captureApps={captureApps}
            autoStreamerActive={autoStreamerActive}
            voiceChannelRef={voiceChannelRef}
            localScreenStreamRef={localScreenStreamRef}
            sendSocket={sendSocket}
            sendTypingState={sendTypingState}
            preferences={preferences}
          />
        )}

        {settingsWindow.settingsTab === "support" && (
          <SupportSettingsSection
            currentUser={currentUser}
            settingsDirty={settingsWindow.settingsDirty}
            setSettingsCloseConfirm={settingsWindow.setSettingsCloseConfirm}
            servers={servers}
            setShowHubHome={setShowHubHome}
            finishCloseSettings={finishCloseSettings}
            changeServer={changeServer}
            changeChannel={changeChannel}
            desktopInstalledVersion={desktopInstalledVersion}
          />
        )}

        {settingsWindow.settingsTab === "voice" && (
          <VoiceSettingsSection
            hubMembers={hubMembers}
            friends={friends}
            voiceParticipants={voiceParticipants}
            audioSettings={audioSettings}
            voiceUserVolumes={voiceUserVolumes}
            audioSettingsRef={audioSettingsRef}
            resetVoiceUserVolumes={resetVoiceUserVolumes}
            saveAudioSettings={saveAudioSettings}
            applyOutputDevice={applyOutputDevice}
            rebuildMicrophoneIfActive={rebuildMicrophoneIfActive}
            changeInputVolume={changeInputVolume}
            startMicTest={startMicTest}
            stopMicTest={stopMicTest}
            preferences={preferences}
            audioSetup={audioSetup}
          />
        )}

        <SettingsSaveBar
          dirty={settingsWindow.settingsDirty}
          saving={settingsWindow.settingsSaving}
          canReset={SAVEABLE_SETTINGS_SECTIONS.includes(settingsWindow.settingsTab)}
          onReset={resetCurrentSettingsSection}
          onSave={() => void saveSettingsChanges()}
          onClose={closeSettings}
        />
      </div>
    </section>
  );
}
