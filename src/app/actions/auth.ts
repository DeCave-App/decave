// Signing in or registering, logging out, and signing out of every session.

import type { Dispatch, SetStateAction, MutableRefObject } from "react";
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
import { clearAccountDataOnLogout, clearAccountScopedStorage } from "./clear-account-storage";
import { PRIVACY_VERSION, TERMS_VERSION } from "../../../shared/legal-consent";
import type { AuthFormState } from "../state/auth-form";
import type { OwnerSecurityState } from "../state/owner-security";
import type { HubPanelsState } from "../state/hub-panels";
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
    staySignedIn,
    acceptedTerms,
    setAcceptedTerms,
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
        setAuthError(data.message || data.error || "If that verified email exists, a reset link has been sent.");
      } catch {
        setAuthError("Could not connect to DeCave.");
      } finally {
        setAuthBusy(false);
        setTurnstileToken("");
        setTurnstileNonce((value) => value + 1);
      }
      return;
    }

    if (!identifier || !passwordInput || !turnstileToken) return;
    if (authMode === "login" && !/^\S+@\S+\.\S+$/.test(identifier)) {
      setAuthError("Enter your account email address.");
      return;
    }

    if (authMode === "register") {
      if (!email) {
        setAuthError("Enter a valid email address.");
        return;
      }
      if (!/^\S+@\S+\.\S+$/.test(email)) {
        setAuthError("Enter a valid email address.");
        return;
      }
      if (passwordInput !== confirmPasswordInput) {
        setAuthError("Passwords do not match.");
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDateInput)) {
        setAuthError("Enter your birth date to confirm you are 18 or older.");
        return;
      }
      if (!acceptedTerms) {
        setAuthError("Confirm that you are 18 or older and agree to the Terms of Service and Privacy Policy.");
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
                termsAccepted: true,
                termsVersion: TERMS_VERSION,
                privacyVersion: PRIVACY_VERSION,
              },
        ),
      });
      const data = (await response.json()) as AuthResponse & ApiError;

      if (!response.ok) {
        setAuthError(data.error || "Authentication failed.");
        return;
      }

      if (data.verificationRequired) {
        setAuthError(data.message || "Check your email to verify your account.");
        setAuthMode("login");
        setPasswordInput("");
        setConfirmPasswordInput("");
        return;
      }

      if (data.mfaRequired && data.challengeToken) {
        setLoginMfaKind(data.mfaKind === "user" ? "user" : "owner");
        setOwnerLoginChallengeToken(data.challengeToken);
        setOwnerLoginMfaCode("");
        setAuthError(data.mfaKind === "user" ? "" : "Enter your authenticator code or a one-time recovery code.");
        return;
      }

      if (!data.user || !data.wsToken) {
        setAuthError("Authentication failed.");
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
      setAcceptedTerms(false);
      setAuthReady(true);
    } catch (error) {
      console.error("Authentication error:", error);
      setAuthError(error instanceof Error ? error.message : "Could not connect to DeCave.");
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
    const localCleanup = signedOutElsewhere
      ? (clearAccountScopedStorage(), Promise.resolve())
      : clearAccountDataOnLogout();
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
    await dmE2ee.stop({ forget: !signedOutElsewhere }).catch(() => undefined);

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
    if (!window.confirm("Log out every active DeCave session, including this device?")) return;
    setSecurityBusy(true);
    setSecurityNotice("");
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/auth/logout-all`, {
        method: "POST",
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setSecurityNotice(data.error || "Could not log out all sessions.");
        return;
      }
      await logout();
      setAuthError("All active sessions were logged out. Sign in again to continue.");
    } catch {
      setSecurityNotice("Could not log out all sessions.");
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
