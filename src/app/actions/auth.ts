// Signing in or registering, logging out, and signing out of every session.

import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import { currentLegalConsent, MINIMUM_SIGNUP_AGE } from "../../../shared/legal-consent";
import type {
  Server,
  AccountUser,
  OnlineUser,
  ChatMessage,
  SocialUser,
  DirectMessage,
  DmConversation,
  DmNotice,
  ApiError,
  AuthResponse,
} from "../types";
import { HTTP_URL } from "../env";
import { hasDesktopActivityBridge } from "../desktop";
import { clearAccountDataOnSignOut } from "./clear-account-storage";
import type { AuthFormState } from "../state/auth-form";
import type { OwnerSecurityState } from "../state/owner-security";
import type { HubPanelsState } from "../state/hub-panels";
import { i18next } from "../../i18n/index.ts";
import { apiErrorMessage } from "../../i18n/apiError.ts";
import { noticeText, serverMessage } from "../../i18n/notice.ts";
import { dmE2ee } from "../../e2ee/dm-e2ee-client";

export type AuthActionsDeps = {
  resetPrivateAccountState: () => void;
  setCurrentUser: Dispatch<SetStateAction<AccountUser | null>>;
  setAuthReady: Dispatch<SetStateAction<boolean>>;
  setServersReady: Dispatch<SetStateAction<boolean>>;
  authMode: "login" | "register" | "forgot";
  setAuthMode: Dispatch<SetStateAction<"login" | "register" | "forgot">>;
  turnstileToken: string;
  setTurnstileToken: Dispatch<SetStateAction<string>>;
  setTurnstileNonce: Dispatch<SetStateAction<number>>;
  setAuthError: Dispatch<SetStateAction<string>>;
  setShowLogoutConfirm: Dispatch<SetStateAction<boolean>>;
  setSecurityNotice: Dispatch<SetStateAction<string>>;
  setSecurityBusy: Dispatch<SetStateAction<boolean>>;
  setDangerPassword: Dispatch<SetStateAction<string>>;
  setAccountDangerAction: Dispatch<SetStateAction<"disable" | "delete" | null>>;
  accountDangerOperationRef: MutableRefObject<{
    accountId: string;
    controller: AbortController;
    mutationStarted: boolean;
  } | null>;
  setOwnerLoginChallengeToken: Dispatch<SetStateAction<string>>;
  setOwnerLoginMfaCode: Dispatch<SetStateAction<string>>;
  setOwnerLoginMfaBusy: Dispatch<SetStateAction<boolean>>;
  setServers: Dispatch<SetStateAction<Server[]>>;
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
  storeToken: (token: string) => void;
  authorizedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  sendSocket: (payload: unknown) => boolean;
  cancelOwnerSecurityOperation: () => void;
  cleanupVoiceLocal: (clearPresence: boolean, preserveMicrophone?: boolean, preserveRecoveryCounter?: boolean) => void;
  authForm: AuthFormState;
  ownerSecurity: OwnerSecurityState;
  hubPanels: HubPanelsState;
};

/** Called once per render with that render's values. */
export function createAuthActions(deps: AuthActionsDeps) {
  const {
    resetPrivateAccountState,
    setCurrentUser,
    setAuthReady,
    setServersReady,
    authMode,
    setAuthMode,
    turnstileToken,
    setTurnstileToken,
    setTurnstileNonce,
    setAuthError,
    setShowLogoutConfirm,
    setSecurityNotice,
    setSecurityBusy,
    setDangerPassword,
    setAccountDangerAction,
    accountDangerOperationRef,
    setOwnerLoginChallengeToken,
    setOwnerLoginMfaCode,
    setOwnerLoginMfaBusy,
    setServers,
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
    storeToken,
    authorizedFetch,
    sendSocket,
    cancelOwnerSecurityOperation,
    cleanupVoiceLocal,
    authForm,
    ownerSecurity,
    hubPanels,
  } = deps;
  const { setShowHubHome, setShowStreamerOverview } = hubPanels;
  const { setOwnerReauthToken, setOwnerReauthExpiresAt } = ownerSecurity;
  const {
    usernameInput,
    setUsernameInput,
    emailInput,
    setEmailInput,
    passwordInput,
    setPasswordInput,
    confirmPasswordInput,
    setConfirmPasswordInput,
    birthDateInput,
    setBirthDateInput,
    termsAccepted,
    setTermsAccepted,
    staySignedIn,
    setAuthBusy,
    setLoginMfaKind,
  } = authForm;

  const submitAuth = async () => {
    const identifier = usernameInput.trim();
    const email = emailInput.trim();

    if (authMode === "forgot") {
      if (!email || !turnstileToken) return;
      setAuthBusy(true);
      setAuthError("");
      try {
        const response = await fetch(`${HTTP_URL}/api/auth/forgot-password`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, turnstileToken }),
        });
        const data = (await response.json()) as { message?: string; error?: string };
        setAuthError(
          noticeText((data as { notice?: unknown }).notice) ??
            (data.message || apiErrorMessage(data, "client.auth.resetLinkSent")),
        );
      } catch {
        setAuthError(i18next.t("errors.client.connect"));
      } finally {
        setAuthBusy(false);
        setTurnstileToken("");
        setTurnstileNonce((value) => value + 1);
      }
      return;
    }

    if (!identifier || !passwordInput || !turnstileToken) return;
    if (authMode === "login" && !/^\S+@\S+\.\S+$/.test(identifier)) {
      setAuthError(i18next.t("chat.actions.auth.enterEmail"));
      return;
    }

    if (authMode === "register") {
      if (!termsAccepted) {
        setAuthError(i18next.t("chat.actions.auth.acceptTerms"));
        return;
      }
      if (!email) {
        setAuthError(i18next.t("chat.actions.auth.invalidEmail"));
        return;
      }
      if (!/^\S+@\S+\.\S+$/.test(email)) {
        setAuthError(i18next.t("chat.actions.auth.invalidEmail"));
        return;
      }
      if (passwordInput !== confirmPasswordInput) {
        setAuthError(i18next.t("chat.actions.auth.passwordsMismatch"));
        return;
      }
      if (passwordInput.length < 10) {
        setAuthError(i18next.t("chat.actions.auth.passwordTooShort"));
        return;
      }
      const birthDate = new Date(`${birthDateInput}T00:00:00Z`);
      const ageDate = new Date();
      ageDate.setUTCFullYear(ageDate.getUTCFullYear() - MINIMUM_SIGNUP_AGE);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(birthDateInput) ||
        Number.isNaN(birthDate.getTime()) ||
        birthDate.toISOString().slice(0, 10) !== birthDateInput ||
        birthDate > ageDate
      ) {
        setAuthError(i18next.t("chat.actions.auth.birthDateRequired", { age: MINIMUM_SIGNUP_AGE }));
        return;
      }
    }

    setAuthBusy(true);
    setAuthError("");

    try {
      const response = await fetch(`${HTTP_URL}/api/auth/${authMode === "login" ? "login" : "register"}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          authMode === "login"
            ? {
                identifier,
                password: passwordInput,
                staySignedIn,
                client: hasDesktopActivityBridge() ? "desktop" : "web",
                turnstileToken,
              }
            : {
                email,
                username: identifier,
                password: passwordInput,
                turnstileToken,
                birthDate: birthDateInput,
                ...currentLegalConsent(),
              },
        ),
      });
      const data = (await response.json()) as AuthResponse & ApiError;

      if (!response.ok) {
        setAuthError(apiErrorMessage(data, "client.auth.failed"));
        return;
      }

      if (data.verificationRequired) {
        setAuthError(serverMessage(data, i18next.t("chat.actions.auth.checkEmail")));
        setAuthMode("login");
        setPasswordInput("");
        setConfirmPasswordInput("");
        return;
      }

      if (data.mfaRequired && data.challengeToken) {
        setLoginMfaKind(data.mfaKind === "user" ? "user" : "owner");
        setOwnerLoginChallengeToken(data.challengeToken);
        setOwnerLoginMfaCode("");
        setAuthError(data.mfaKind === "user" ? "" : i18next.t("chat.actions.auth.enterMfaCode"));
        return;
      }

      if (!data.user || !data.wsToken) {
        setAuthError(i18next.t("errors.client.auth.failed"));
        return;
      }

      resetPrivateAccountState();
      storeToken(data.wsToken);
      setCurrentUser({ ...data.user, safety: data.safety ?? data.user.safety });
      setUsernameInput("");
      setEmailInput("");
      setPasswordInput("");
      setConfirmPasswordInput("");
      setBirthDateInput("");
      setTermsAccepted(false);
      setAuthReady(true);
    } catch (error) {
      console.error("Authentication error:", error);
      setAuthError(error instanceof Error ? error.message : i18next.t("errors.client.connect"));
    } finally {
      setAuthBusy(false);
      setOwnerLoginMfaBusy(false);
      setTurnstileToken("");
      setTurnstileNonce((value) => value + 1);
    }
  };

  /**
   * `signedOutElsewhere`: the server ended this session (another sign-in, or a
   * revoked session), so the person didn't choose to leave this device and it
   * keeps its DM encryption key for when they sign back in.
   */
  const logout = async ({ signedOutElsewhere = false }: { signedOutElsewhere?: boolean } = {}) => {
    resetPrivateAccountState();
    storeToken("");
    setCurrentUser(null);
    setAuthReady(true);
    accountDangerOperationRef.current?.controller.abort();
    setDangerPassword("");
    setAccountDangerAction(null);
    cancelOwnerSecurityOperation();
    setShowLogoutConfirm(false);
    realtimeReconnectEnabledRef.current = false;
    voiceReconnectChannelRef.current = null;
    if (voiceChannelRef.current !== null) sendSocket({ type: "VOICE_LEAVE" });
    cleanupVoiceLocal(true);
    socketRef.current?.close();
    // Choosing to sign out removes the DM encryption key from this device.
    void dmE2ee.stop({ forget: !signedOutElsewhere });
    // ...and the account's other local data (drafts, notes, settings, the desktop
    // in-app browser profile). Signed out elsewhere, it stays like the key does;
    // a different account signing in clears it then (useAccountStorageOwner).
    const localCleanup = signedOutElsewhere ? Promise.resolve() : clearAccountDataOnSignOut();

    try {
      await fetch(`${HTTP_URL}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Local logout still proceeds.
    }
    await localCleanup;

    setServersReady(false);
    setServers([]);
    setShowHubHome(false);
    setShowStreamerOverview(false);
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
    setAuthMode("login");
    setOwnerLoginChallengeToken("");
    setOwnerLoginMfaCode("");
    setOwnerReauthToken("");
    setOwnerReauthExpiresAt(0);
    setAuthError("");
  };

  const logoutAllSessions = async () => {
    if (!window.confirm(i18next.t("chat.actions.auth.confirmLogoutAll"))) return;
    setSecurityBusy(true);
    setSecurityNotice("");
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/auth/logout-all`, {
        method: "POST",
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setSecurityNotice(apiErrorMessage(data, "client.auth.logoutAll"));
        return;
      }
      await logout();
      setAuthError(i18next.t("chat.actions.auth.loggedOutAll"));
    } catch {
      setSecurityNotice(i18next.t("errors.client.auth.logoutAll"));
    } finally {
      setSecurityBusy(false);
    }
  };

  return {
    submitAuth,
    logout,
    logoutAllSessions,
  };
}
