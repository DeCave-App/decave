// Your account: preferences synced with the server, username/email/birth date
// edits, password, signed-in sessions, and disabling or deleting the account.

import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import { buildSyncedSettings, SETTINGS_SYNC_STAMP_KEY, mutedHubsForSync } from "../../features/settings";
import type {
  Server,
  AccountUser,
  OnlineUser,
  ChatMessage,
  SocialUser,
  DirectMessage,
  DmConversation,
  DmNotice,
  FriendRequestPolicy,
  TimeFormatPreference,
  LanguagePreference,
  VoiceMiniPlayerPosition,
  AccountPreferences,
  DeviceSession,
} from "../types";
import { HTTP_URL } from "../env";
import {
  LANGUAGE_TIME_KEY,
  setActiveLanguagePreference,
  setActiveTimeFormatPreference,
  localeForLanguage,
} from "../locale";
import { hasDesktopActivityBridge, getDesktopSystemSettings, setDesktopStreamerMode } from "../desktop";
import type { AccountEditState } from "../state/account-edit";
import type { AccountSessionsState } from "../state/account-sessions";
import type { SettingsWindowState } from "../state/settings-window";
import type { PreferencesState } from "../state/preferences";
import type { OwnerSecurityState } from "../state/owner-security";

export type AccountActionsDeps = {
  currentUser: AccountUser | null;
  setCurrentUser: Dispatch<SetStateAction<AccountUser | null>>;
  setServersReady: Dispatch<SetStateAction<boolean>>;
  setAuthMode: Dispatch<SetStateAction<"login" | "register" | "forgot">>;
  setAuthError: Dispatch<SetStateAction<string>>;
  setShowSettings: Dispatch<SetStateAction<boolean>>;
  setProfileAvatarError: Dispatch<SetStateAction<string>>;
  setSecurityNotice: Dispatch<SetStateAction<string>>;
  setSecurityBusy: Dispatch<SetStateAction<boolean>>;
  setAccountEditField: Dispatch<SetStateAction<"username" | "email" | "phone" | "password" | null>>;
  accountEditField: "username" | "email" | "phone" | "password" | null;
  accountEditOperationRef: MutableRefObject<{ accountId: string; controller: AbortController } | null>;
  accountEditAccountIdRef: MutableRefObject<string | null>;
  setDangerPassword: Dispatch<SetStateAction<string>>;
  dangerPassword: string;
  setAccountDangerAction: Dispatch<SetStateAction<"disable" | "delete" | null>>;
  accountDangerAction: "disable" | "delete" | null;
  accountDangerOperationRef: MutableRefObject<{
    accountId: string;
    controller: AbortController;
    mutationStarted: boolean;
  } | null>;
  setDeleteOwnershipBlock: Dispatch<SetStateAction<string[] | null>>;
  setOwnerLoginChallengeToken: Dispatch<SetStateAction<string>>;
  setOwnerLoginMfaCode: Dispatch<SetStateAction<string>>;
  autoStreamerActive: boolean;
  setServers: Dispatch<SetStateAction<Server[]>>;
  servers: Server[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setOnlineUsers: Dispatch<SetStateAction<OnlineUser[]>>;
  setFriends: Dispatch<SetStateAction<SocialUser[]>>;
  setIncomingFriendRequests: Dispatch<SetStateAction<SocialUser[]>>;
  setOutgoingFriendRequests: Dispatch<SetStateAction<SocialUser[]>>;
  setShowSocial: Dispatch<SetStateAction<boolean>>;
  setActiveDmUser: Dispatch<SetStateAction<SocialUser | null>>;
  setDmConversations: Dispatch<SetStateAction<DmConversation[]>>;
  setDmMessages: Dispatch<SetStateAction<DirectMessage[]>>;
  setDmUnread: Dispatch<SetStateAction<Record<string, number>>>;
  setFriendRequestNotice: Dispatch<SetStateAction<SocialUser | null>>;
  setDmNotice: Dispatch<SetStateAction<DmNotice | null>>;
  setFriendRemovalConfirm: Dispatch<SetStateAction<SocialUser | null>>;
  socketRef: MutableRefObject<WebSocket | null>;
  realtimeReconnectEnabledRef: MutableRefObject<boolean>;
  voiceReconnectChannelRef: MutableRefObject<number | null>;
  voiceChannelRef: MutableRefObject<number | null>;
  applyRemoteSettings: (raw: unknown, updatedAt: string | null) => void;
  storeToken: (token: string) => void;
  authorizedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  setCurrentUserFromResponse: (nextUser: AccountUser) => void;
  logout: () => Promise<void>;
  sendSocket: (payload: unknown) => boolean;
  cleanupVoiceLocal: (clearPresence: boolean, preserveMicrophone?: boolean, preserveRecoveryCounter?: boolean) => void;
  accountEdit: AccountEditState;
  accountSessions: AccountSessionsState;
  settingsWindow: SettingsWindowState;
  preferences: PreferencesState;
  ownerSecurity: OwnerSecurityState;
};

/** Called once per render with that render's values. */
export function createAccountActions(deps: AccountActionsDeps) {
  const {
    currentUser,
    setCurrentUser,
    setServersReady,
    setAuthMode,
    setAuthError,
    setShowSettings,
    setProfileAvatarError,
    setSecurityNotice,
    setSecurityBusy,
    setAccountEditField,
    accountEditField,
    accountEditOperationRef,
    accountEditAccountIdRef,
    setDangerPassword,
    dangerPassword,
    setAccountDangerAction,
    accountDangerAction,
    accountDangerOperationRef,
    setDeleteOwnershipBlock,
    setOwnerLoginChallengeToken,
    setOwnerLoginMfaCode,
    autoStreamerActive,
    setServers,
    servers,
    setMessages,
    setOnlineUsers,
    setFriends,
    setIncomingFriendRequests,
    setOutgoingFriendRequests,
    setShowSocial,
    setActiveDmUser,
    setDmConversations,
    setDmMessages,
    setDmUnread,
    setFriendRequestNotice,
    setDmNotice,
    setFriendRemovalConfirm,
    socketRef,
    realtimeReconnectEnabledRef,
    voiceReconnectChannelRef,
    voiceChannelRef,
    applyRemoteSettings,
    storeToken,
    authorizedFetch,
    setCurrentUserFromResponse,
    logout,
    sendSocket,
    cleanupVoiceLocal,
    accountEdit,
    accountSessions,
    settingsWindow,
    preferences,
    ownerSecurity,
  } = deps;
  const { setOwnerReauthToken, setOwnerReauthExpiresAt } = ownerSecurity;
  const {
    appSkin,
    extraSettings,
    setAccountPreferences,
    accountPreferences,
    setDesktopSystemSettingsState,
    setDesktopKeybindsState,
    notificationSettings,
    soundSettings,
    setPrivacySettings,
    privacySettings,
    notifyLevels,
    accessibilityTextScale,
    mutedHubIds,
    notificationPreset,
    hubMuteSchedule,
  } = preferences;
  const { setSettingsTab } = settingsWindow;
  const { setSecurityVerificationUrl, setDeviceSessions, setSessionBusyId } = accountSessions;
  const {
    setChangePasswordCurrentInput,
    changePasswordCurrentInput,
    setChangePasswordNewInput,
    changePasswordNewInput,
    setChangePasswordConfirmInput,
    changePasswordConfirmInput,
    setChangePasswordNotice,
    setChangePasswordBusy,
    setAccountEditValue,
    accountEditValue,
    setAccountEditPassword,
    accountEditPassword,
    setAccountEditMfaCode,
    accountEditMfaCode,
    setAccountEditBusy,
    setAccountEditNotice,
  } = accountEdit;

  const loadAccountPreferences = async () => {
    if (!currentUser) return;
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/account/preferences`, {
        cache: "no-store",
      });
      const data = (await response.json().catch(() => ({}))) as Partial<AccountPreferences> & {
        error?: string;
        clientSettings?: unknown;
        clientSettingsUpdatedAt?: string | null;
      };
      if (!response.ok) {
        setSecurityNotice(data.error || "Could not load account preferences.");
        return;
      }
      applyRemoteSettings(data.clientSettings, data.clientSettingsUpdatedAt ?? null);

      const language: LanguagePreference =
        data.language === "pl" ||
        data.language === "el" ||
        data.language === "de" ||
        data.language === "fr" ||
        data.language === "es" ||
        data.language === "it" ||
        data.language === "pt"
          ? data.language
          : "en";
      const timeFormat: TimeFormatPreference =
        data.timeFormat === "12h" || data.timeFormat === "24h" ? data.timeFormat : "system";
      const voiceMiniPlayerPosition: VoiceMiniPlayerPosition | null =
        data.voiceMiniPlayerPosition &&
        Number.isFinite(Number(data.voiceMiniPlayerPosition.x)) &&
        Number.isFinite(Number(data.voiceMiniPlayerPosition.y))
          ? { x: Number(data.voiceMiniPlayerPosition.x), y: Number(data.voiceMiniPlayerPosition.y) }
          : null;
      const friendRequestPolicy: FriendRequestPolicy =
        data.friendRequestPolicy === "friends_of_friends" || data.friendRequestPolicy === "none"
          ? data.friendRequestPolicy
          : "everyone";

      setAccountPreferences((current) => ({
        ...current,
        phoneNumber: typeof data.phoneNumber === "string" ? data.phoneNumber : "",
        usernameChangedAt: typeof data.usernameChangedAt === "string" ? data.usernameChangedAt : null,
        usernameChangeAvailableAt:
          typeof data.usernameChangeAvailableAt === "string" ? data.usernameChangeAvailableAt : null,
        friendRequestPolicy,
        allowStreamPreviews: data.allowStreamPreviews !== false,
        streamerMode: data.streamerMode === true,
        language,
        timeFormat,
        voiceMiniPlayerPosition,
        loginAlerts: data.loginAlerts !== false,
        activityVisibility:
          data.activityVisibility === "friends" || data.activityVisibility === "nobody"
            ? data.activityVisibility
            : "everyone",
      }));
      setPrivacySettings((current) => ({
        ...current,
        friendRequestPolicy,
        allowStreamPreviews: data.allowStreamPreviews !== false,
        streamerMode: data.streamerMode === true,
      }));

      setActiveLanguagePreference(language);
      setActiveTimeFormatPreference(timeFormat);
      document.documentElement.lang = language;
      try {
        localStorage.setItem(LANGUAGE_TIME_KEY, JSON.stringify({ language, timeFormat }));
      } catch {}
      if (hasDesktopActivityBridge()) {
        void setDesktopStreamerMode(data.streamerMode === true).catch(() => undefined);
      }
    } catch {
      setSecurityNotice("Could not load account preferences.");
    }
  };

  const saveRemoteAccountPreferences = async (): Promise<boolean> => {
    if (!currentUser) return false;
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/account/preferences`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          friendRequestPolicy: privacySettings.friendRequestPolicy,
          allowStreamPreviews: privacySettings.allowStreamPreviews,
          streamerMode: privacySettings.streamerMode,
          language: accountPreferences.language,
          timeFormat: accountPreferences.timeFormat,
          loginAlerts: accountPreferences.loginAlerts,
          activityVisibility: accountPreferences.activityVisibility,
          // Settings that follow you to every device (see settingsSync.ts).
          clientSettings: buildSyncedSettings({
            appSkin,
            textScale: accessibilityTextScale,
            extra: extraSettings,
            notifications: notificationSettings,
            notificationPreset,
            sounds: soundSettings,
            privacy: {
              notificationPreview: privacySettings.notificationPreview,
              sendTypingIndicators: privacySettings.sendTypingIndicators,
            },
            notifyLevels,
            mutedHubs: mutedHubsForSync(mutedHubIds, hubMuteSchedule),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          }),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as Partial<AccountPreferences> & {
        error?: string;
        clientSettings?: unknown;
        clientSettingsUpdatedAt?: string | null;
      };
      if (!response.ok) {
        setProfileAvatarError(data.error || "Could not save privacy settings.");
        return false;
      }
      if (data.clientSettingsUpdatedAt) {
        try {
          localStorage.setItem(SETTINGS_SYNC_STAMP_KEY, data.clientSettingsUpdatedAt);
        } catch {}
      }
      const { clientSettings: _synced, clientSettingsUpdatedAt: _syncedAt, ...savedPreferences } = data;
      setAccountPreferences((current) => ({ ...current, ...savedPreferences }));
      setActiveLanguagePreference(accountPreferences.language);
      setActiveTimeFormatPreference(accountPreferences.timeFormat);
      document.documentElement.lang = accountPreferences.language;
      try {
        localStorage.setItem(
          LANGUAGE_TIME_KEY,
          JSON.stringify({
            language: accountPreferences.language,
            timeFormat: accountPreferences.timeFormat,
          }),
        );
      } catch {}
      if (hasDesktopActivityBridge()) {
        await setDesktopStreamerMode(privacySettings.streamerMode || autoStreamerActive).catch(() => false);
      }
      return true;
    } catch {
      setProfileAvatarError("Could not save privacy settings.");
      return false;
    }
  };

  const loadDesktopIntegrationSettings = async () => {
    if (!hasDesktopActivityBridge()) return;
    try {
      const settings = await getDesktopSystemSettings();
      setDesktopSystemSettingsState({
        openAtLogin: settings.openAtLogin === true,
        closeToTray: settings.closeToTray === true,
        voiceOverlayEnabled: settings.voiceOverlayEnabled !== false,
        voiceOverlayScale:
          typeof settings.voiceOverlayScale === "number"
            ? Math.max(60, Math.min(150, Math.round(settings.voiceOverlayScale)))
            : undefined,
      });
      setDesktopKeybindsState({
        toggleMute: settings.keybinds?.toggleMute || "CommandOrControl+Shift+M",
        toggleDeafen: settings.keybinds?.toggleDeafen || "CommandOrControl+Shift+D",
      });
    } catch (error) {
      console.warn("Could not load DeCave desktop system settings:", error);
    }
  };

  const closeAccountEditor = () => {
    accountEditOperationRef.current?.controller.abort();
    setAccountEditPassword("");
    setAccountEditField(null);
  };

  const openAccountEditor = (field: "username" | "email" | "phone" | "password") => {
    accountEditOperationRef.current?.controller.abort();
    setAccountEditField(field);
    setAccountEditBusy(false);
    setAccountEditNotice("");
    setAccountEditPassword("");
    if (field === "username") setAccountEditValue(currentUser?.username ?? "");
    if (field === "email") setAccountEditValue(currentUser?.email ?? "");
    if (field === "phone") setAccountEditValue(accountPreferences.phoneNumber);
    if (field === "password") {
      setChangePasswordCurrentInput("");
      setChangePasswordNewInput("");
      setChangePasswordConfirmInput("");
      setChangePasswordNotice("");
    }
  };

  const submitAccountIdentityEdit = async () => {
    if (!currentUser || !accountEditField || accountEditField === "password" || accountEditOperationRef.current) return;
    const field = accountEditField;
    const password = accountEditPassword;
    const value = accountEditValue.trim();
    const mutation = {
      action: `account.${field}.update`,
      method: field === "email" ? "POST" : "PUT",
      path: field === "email" ? "/api/auth/add-email" : `/api/account/${field}`,
      body: { [field]: value },
    };
    const operation = { accountId: currentUser.id, controller: new AbortController() };
    accountEditOperationRef.current = operation;
    const isCurrent = () =>
      accountEditOperationRef.current === operation &&
      accountEditAccountIdRef.current === operation.accountId &&
      !operation.controller.signal.aborted;
    const assertCurrent = () => {
      if (!isCurrent()) throw new Error("Account edit cancelled.");
    };
    const editFetch: typeof fetch = async (url, init = {}) => {
      assertCurrent();
      const response = await authorizedFetch(String(url), { ...init, signal: operation.controller.signal });
      assertCurrent();
      return response;
    };
    const timeout = window.setTimeout(() => operation.controller.abort(), 120_000);
    setAccountEditBusy(true);
    setAccountEditNotice("");
    setSecurityNotice("");
    try {
      if (field === "username") {
        const response = await editFetch(`${HTTP_URL}/api/account/username`, {
          method: "PUT",
          redirect: "error",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: value, currentPassword: password }),
        });
        const data = (await response.json().catch(() => ({}))) as Partial<AccountPreferences> & {
          user?: AccountUser;
          error?: string;
          usernameChangeAvailableAt?: string;
        };
        assertCurrent();
        if (!response.ok || !data.user) {
          setAccountEditNotice(
            data.error ||
              (data.usernameChangeAvailableAt
                ? `You can change your username again on ${new Date(data.usernameChangeAvailableAt).toLocaleDateString(localeForLanguage())}.`
                : "Could not change username."),
          );
          if (data.usernameChangeAvailableAt) {
            setAccountPreferences((current) => ({
              ...current,
              usernameChangeAvailableAt: data.usernameChangeAvailableAt ?? current.usernameChangeAvailableAt,
            }));
          }
          return;
        }
        if (data.user.id !== operation.accountId) throw new Error("Account response did not match.");
        setCurrentUserFromResponse(data.user);
        setAccountPreferences((current) => ({
          ...current,
          usernameChangedAt:
            typeof data.usernameChangedAt === "string" ? data.usernameChangedAt : current.usernameChangedAt,
          usernameChangeAvailableAt:
            typeof data.usernameChangeAvailableAt === "string"
              ? data.usernameChangeAvailableAt
              : current.usernameChangeAvailableAt,
        }));
        setSecurityNotice("Username updated.");
        setAccountEditField(null);
        return;
      }

      if (field === "email") {
        const response = await editFetch(`${HTTP_URL}${mutation.path}`, {
          method: mutation.method,
          redirect: "error",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: value,
            password,
            ...(accountEditMfaCode.trim() ? { mfaCode: accountEditMfaCode.trim() } : {}),
          }),
        });
        const data = (await response.json().catch(() => ({}))) as {
          user?: AccountUser;
          message?: string;
          error?: string;
          localVerificationUrl?: string;
          emailChangeCommitted?: boolean;
          verificationEmailSent?: boolean;
        };
        assertCurrent();
        if (!response.ok || !data.user) {
          setAccountEditNotice(data.error || "Could not update email.");
          return;
        }
        if (data.user.id !== operation.accountId) throw new Error("Account response did not match.");
        setCurrentUserFromResponse(data.user);
        setSecurityVerificationUrl(data.localVerificationUrl || "");
        setSecurityNotice(data.message || "Verification email sent.");
        setAccountEditField(null);
        return;
      }

      const response = await editFetch(`${HTTP_URL}/api/account/phone`, {
        method: "PUT",
        redirect: "error",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: value, currentPassword: password }),
      });
      const data = (await response.json().catch(() => ({}))) as Partial<AccountPreferences> & {
        error?: string;
      };
      assertCurrent();
      if (!response.ok) {
        setAccountEditNotice(data.error || "Could not update phone number. Verify your account and try again.");
        return;
      }
      setAccountPreferences((current) => ({
        ...current,
        phoneNumber: typeof data.phoneNumber === "string" ? data.phoneNumber : value,
      }));
      setSecurityNotice("Phone number updated.");
      setAccountEditField(null);
    } catch {
      if (isCurrent()) setAccountEditNotice("Could not confirm the account update. Verify your account and try again.");
    } finally {
      window.clearTimeout(timeout);
      if (accountEditOperationRef.current === operation) {
        accountEditOperationRef.current = null;
        setAccountEditPassword("");
        setAccountEditMfaCode("");
        setAccountEditBusy(false);
      }
    }
  };

  const changePassword = async () => {
    const user = currentUser;
    if (!user) {
      setChangePasswordNotice("Your session is not ready yet.");
      return;
    }

    const currentPassword = changePasswordCurrentInput;
    const newPassword = changePasswordNewInput;
    const confirmPassword = changePasswordConfirmInput;

    setChangePasswordNotice("");

    if (!currentPassword || !newPassword || !confirmPassword) {
      setChangePasswordNotice("Fill in all password fields.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setChangePasswordNotice("The new passwords do not match.");
      return;
    }

    if (newPassword === currentPassword) {
      setChangePasswordNotice("Your new password must be different from your current password.");
      return;
    }

    if (newPassword.length < 10 || newPassword.length > 128) {
      setChangePasswordNotice("Use 10-128 characters for the new password.");
      return;
    }

    setChangePasswordBusy(true);
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/auth/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };

      if (!response.ok) {
        setChangePasswordNotice(data.error || "Could not change password.");
        return;
      }

      setChangePasswordCurrentInput("");
      setChangePasswordNewInput("");
      setChangePasswordConfirmInput("");
      setShowSettings(false);

      // The backend has already revoked every session and cleared the cookie.
      // Clean up this client immediately so it does not wait for the heartbeat
      // and display the unrelated "signed in elsewhere" notice.
      if (voiceChannelRef.current !== null) {
        sendSocket({ type: "VOICE_LEAVE" });
      }
      cleanupVoiceLocal(true);
      realtimeReconnectEnabledRef.current = false;
      voiceReconnectChannelRef.current = null;
      socketRef.current?.close();

      storeToken("");
      setCurrentUser(null);
      setServersReady(false);
      setServers([]);
      setMessages([]);
      setOnlineUsers([]);
      setFriends([]);
      setIncomingFriendRequests([]);
      setOutgoingFriendRequests([]);
      setShowSocial(false);
      setActiveDmUser(null);
      setDmConversations([]);
      setDmMessages([]);
      setDmUnread({});
      setFriendRequestNotice(null);
      setDmNotice(null);
      setFriendRemovalConfirm(null);
      setOwnerLoginChallengeToken("");
      setOwnerLoginMfaCode("");
      setOwnerReauthToken("");
      setOwnerReauthExpiresAt(0);
      setAuthMode("login");
      setAuthError(data.message || "Password changed successfully. Sign in again with your new password.");
    } catch (error) {
      console.error("Password change failed:", error);
      setChangePasswordNotice("Could not change password.");
    } finally {
      setChangePasswordBusy(false);
    }
  };

  const loadAccountSessions = async () => {
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/auth/sessions`, { cache: "no-store" });
      const data = (await response.json()) as { sessions?: DeviceSession[]; error?: string };
      if (!response.ok) {
        setSecurityNotice(data.error || "Could not load active sessions.");
        return;
      }
      setDeviceSessions(Array.isArray(data.sessions) ? data.sessions : []);
    } catch {
      setSecurityNotice("Could not load active sessions.");
    }
  };

  const revokeDeviceSession = async (session: DeviceSession) => {
    if (!window.confirm(`Log out ${session.deviceLabel || session.client}?`)) return;
    setSessionBusyId(session.id);
    setSecurityNotice("");
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/auth/sessions/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: session.id }),
      });
      const data = (await response.json()) as { current?: boolean; error?: string };
      if (!response.ok) {
        setSecurityNotice(data.error || "Could not log out that session.");
        return;
      }
      if (data.current) {
        await logout();
        return;
      }
      setDeviceSessions((current) => current.filter((item) => item.id !== session.id));
      setSecurityNotice("Session logged out.");
    } catch {
      setSecurityNotice("Could not log out that session.");
    } finally {
      setSessionBusyId("");
    }
  };

  const closeAccountDangerDialog = () => {
    const operation = accountDangerOperationRef.current;
    operation?.controller.abort();
    setDangerPassword("");
    setAccountDangerAction(null);
    if (operation?.mutationStarted) {
      setSecurityNotice(
        "Could not confirm the account action. It may already have taken effect; check account status before trying again.",
      );
    }
  };

  const beginAccountDangerAction = (action: "disable" | "delete") => {
    if (accountDangerOperationRef.current) return;
    if (action === "delete") {
      const ownedHubs = servers.filter((server) => server.myRole === "owner");
      if (ownedHubs.length) {
        setSecurityNotice("");
        setSettingsTab("account");
        setDeleteOwnershipBlock(ownedHubs.map((server) => server.name));
        return;
      }
    }
    setDangerPassword("");
    setSecurityNotice("");
    setAccountDangerAction(action);
  };

  const runAccountDangerAction = async (action: "disable" | "delete") => {
    if (!currentUser || accountDangerOperationRef.current || action !== accountDangerAction) return;
    if (!dangerPassword) {
      setSecurityNotice("Enter your current password first.");
      return;
    }
    const password = dangerPassword;
    const operation = { accountId: currentUser.id, controller: new AbortController(), mutationStarted: false };
    accountDangerOperationRef.current = operation;
    const sameAccountSession = () => accountEditAccountIdRef.current === operation.accountId;
    const assertCurrent = () => {
      if (
        accountDangerOperationRef.current !== operation ||
        !sameAccountSession() ||
        operation.controller.signal.aborted
      ) {
        throw new Error("Account action cancelled.");
      }
    };
    const dangerFetch: typeof fetch = async (url, init = {}) => {
      assertCurrent();
      const response = await authorizedFetch(String(url), { ...init, signal: operation.controller.signal });
      assertCurrent();
      return response;
    };
    const timeout = window.setTimeout(() => operation.controller.abort(), 120_000);
    setDangerPassword("");
    setSecurityBusy(true);
    setSecurityNotice("");
    try {
      assertCurrent();
      operation.mutationStarted = true;
      const response = await dangerFetch(`${HTTP_URL}/api/account/${action}`, {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: password, confirmUsername: currentUser.username }),
      });
      const data = (await response.json()) as { success?: boolean; error?: string; deleteAfter?: string };
      assertCurrent();
      if (!response.ok) {
        if (
          response.status === 409 &&
          action === "delete" &&
          typeof data.error === "string" &&
          data.error.includes("Transfer ownership")
        ) {
          const ownedHubs = servers.filter((server) => server.myRole === "owner");
          setAccountDangerAction(null);
          setDeleteOwnershipBlock(ownedHubs.map((server) => server.name));
          return;
        }
        setSecurityNotice(data.error || `Could not ${action} account.`);
        return;
      }
      // Only an acknowledged, still-current response may end this account session.
      setAccountDangerAction(null);
      setSecurityBusy(false);
      accountDangerOperationRef.current = null;
      await logout();
      if (accountEditAccountIdRef.current === null || accountEditAccountIdRef.current === operation.accountId) {
        setAuthError(
          action === "disable"
            ? "Account disabled. Sign in again whenever you want to reactivate it."
            : `Account deletion scheduled${data.deleteAfter ? ` for ${new Date(data.deleteAfter).toLocaleDateString(localeForLanguage())}` : " in 30 days"}. Sign in before then to cancel.`,
        );
      }
    } catch {
      if (accountDangerOperationRef.current === operation && sameAccountSession()) {
        setSecurityNotice(
          operation.mutationStarted
            ? "Could not confirm the account action. It may already have taken effect; check account status before trying again."
            : `Could not ${action} account. Authentication was not completed.`,
        );
      }
    } finally {
      window.clearTimeout(timeout);
      if (accountDangerOperationRef.current === operation) {
        accountDangerOperationRef.current = null;
        setDangerPassword("");
        setSecurityBusy(false);
      }
    }
  };

  return {
    loadAccountPreferences,
    saveRemoteAccountPreferences,
    loadDesktopIntegrationSettings,
    closeAccountEditor,
    openAccountEditor,
    submitAccountIdentityEdit,
    changePassword,
    loadAccountSessions,
    revokeDeviceSession,
    closeAccountDangerDialog,
    beginAccountDangerAction,
    runAccountDangerAction,
  };
}

export type AccountActions = ReturnType<typeof createAccountActions>;
