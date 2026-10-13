import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { clearPushMemory, drainPendingPushActions, queuePushSessionRevocation, revokePushSession } from "@/src/lib/push";
import { createPushRevocationRetryLifecycle, type PushRevocationRetryLifecycle } from "@/src/lib/push-revocation-retry";
import { setDraftAccount } from "@/src/lib/drafts";
import { setLastVoiceRoomAccount } from "@/src/lib/last-voice-room";
import { claimAccountLocalData, forgetSignedOutAccount } from "@/src/lib/account-local-data";
import { t } from "i18next";
import { apiErrorText, apiFetch } from "@/src/lib/api";
import { serverMessageText } from "@/src/lib/server-text";
import { currentLegalConsent } from "@/src/lib/legal-consent";
import { AgeGate } from "@/src/components/AgeGate";
import {
  clearSessionToken,
  beginSessionTokenMutation,
  loadSessionToken,
  saveSessionToken,
} from "@/src/lib/session-token";
import { MobileAuthOperationCoordinator } from "@/src/lib/auth-operations";
import type { AccountUser, AuthResponse } from "@/src/types";
import { dmE2ee } from "@/src/lib/e2ee/client";
import { clearKeychainLeftoversAfterReinstall } from "@/src/lib/fresh-install";

type LoginResult =
  | { ok: true; mfaRequired: false }
  | { ok: true; mfaRequired: true }
  | { ok: false; error: string };

export type MfaKind = "user" | "owner";

type SessionContextValue = {
  loading: boolean;
  user: AccountUser | null;
  token: string | null;
  pendingMfa: boolean;
  /** "user" for a member's own two-factor check, "owner" for platform owner access. */
  pendingMfaKind: MfaKind | null;
  sessionNotice: string;
  login: (
    identifier: string,
    password: string,
    staySignedIn: boolean,
    turnstileToken: string,
  ) => Promise<LoginResult>;
  completeMfa: (code: string) => Promise<LoginResult>;
  register: (
    email: string,
    username: string,
    password: string,
    birthDate: string,
    turnstileToken: string,
  ) => Promise<{ ok: boolean; message: string }>;
  forgotPassword: (
    email: string,
    turnstileToken: string,
  ) => Promise<{ ok: boolean; message: string }>;
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
  invalidate: (notice?: string, expectedToken?: string) => Promise<boolean>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AccountUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const [pendingChallenge, setPendingChallenge] = useState<{ token: string; kind: MfaKind } | null>(null);
  const [sessionNotice, setSessionNotice] = useState("");
  const authOperationsRef = useRef(new MobileAuthOperationCoordinator());
  const mfaFlightRef = useRef<{ generation: number; controller: AbortController } | null>(null);
  const pushRetryLifecycleRef = useRef<PushRevocationRetryLifecycle | null>(null);
  const beginAuthOperation = () => {
    const operation = authOperationsRef.current.begin();
    mfaFlightRef.current = null;
    return operation;
  };
  const ownsAuthOperation = (operation: { generation: number; controller: AbortController }) =>
    authOperationsRef.current.owns(operation);
  const settleRestoreLoading = () => setLoading(false);

  useEffect(() => () => {
    authOperationsRef.current.invalidate();
    mfaFlightRef.current = null;
  }, []);

  useEffect(() => {
    const lifecycle = createPushRevocationRetryLifecycle({
      drain: drainPendingPushActions,
      active: AppState.currentState === "active",
    });
    pushRetryLifecycleRef.current = lifecycle;
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      lifecycle.setActive(state === "active");
    });
    lifecycle.start();
    return () => {
      appStateSubscription.remove();
      lifecycle.stop();
      if (pushRetryLifecycleRef.current === lifecycle) pushRetryLifecycleRef.current = null;
    };
  }, []);

  const invalidate = async (notice = "", expectedToken?: string) => {
    if (expectedToken && tokenRef.current !== expectedToken) return false;
    const operation = beginAuthOperation();
    settleRestoreLoading();
    const tokenVersion = beginSessionTokenMutation();
    clearPushMemory();
    setDraftAccount(null);
    setLastVoiceRoomAccount(null);
    setToken(null);
    setUser(null);
    setPendingChallenge(null);
    setSessionNotice(notice);
    await clearSessionToken(tokenVersion);
    return ownsAuthOperation(operation);
  };

  const restore = async () => {
    const operation = beginAuthOperation();
    const tokenVersion = beginSessionTokenMutation();
    setLoading(true);
    try {
      await clearKeychainLeftoversAfterReinstall(() => clearSessionToken(tokenVersion));
      const saved = await loadSessionToken();
      if (!ownsAuthOperation(operation)) return;
      if (!saved) return;

      const response = await apiFetch("/api/auth/me", { signal: operation.controller.signal }, saved);
      if (!ownsAuthOperation(operation)) return;
      const data = (await response.json().catch(() => ({}))) as {
        user?: AccountUser;
        safety?: AccountUser["safety"];
      };
      if (!ownsAuthOperation(operation)) return;
      if (!response.ok || !data.user) {
        setDraftAccount(null);
        setLastVoiceRoomAccount(null);
        await clearSessionToken(tokenVersion);
        return;
      }
      setDraftAccount(data.user.id);
      setLastVoiceRoomAccount(data.user.id);
      void claimAccountLocalData(data.user.id);
      setToken(saved);
      setUser({ ...data.user, safety: data.safety ?? data.user.safety });
    } finally {
      if (ownsAuthOperation(operation)) setLoading(false);
    }
  };

  useEffect(() => {
    void restore();
  }, []);

  const persistAuth = async (data: AuthResponse, operation: { generation: number; controller: AbortController }): Promise<boolean> => {
    if (!data.user || !data.sessionToken) return false;
    if (!ownsAuthOperation(operation)) return false;
    const sessionToken = data.sessionToken;
    const tokenVersion = beginSessionTokenMutation();
    const persisted = await authOperationsRef.current.commitIfCurrent(operation, async () => {
      await saveSessionToken(sessionToken, tokenVersion);
    });
    if (!persisted) return false;
    setDraftAccount(data.user.id);
    setLastVoiceRoomAccount(data.user.id);
    void claimAccountLocalData(data.user.id);
    setToken(sessionToken);
    setUser({ ...data.user, safety: data.safety ?? data.user.safety });
    setPendingChallenge(null);
    setSessionNotice("");
    return true;
  };

  const login: SessionContextValue["login"] = async (
    identifier,
    password,
    staySignedIn,
    turnstileToken,
  ) => {
    const operation = beginAuthOperation();
    settleRestoreLoading();
    const previousToken = token;
    if (previousToken) {
      const queued = await queuePushSessionRevocation(previousToken).catch(() => false);
      if (queued) pushRetryLifecycleRef.current?.retryNow();
      if (!queued) return { ok: false, error: t("auth.mobile.session.saveSignOutFailed") };
    }
    if (!ownsAuthOperation(operation)) return { ok: false, error: t("auth.mobile.session.superseded") };
    clearPushMemory();
    setDraftAccount(null);
    setLastVoiceRoomAccount(null);
    const tokenVersion = beginSessionTokenMutation();
    setToken(null);
    setUser(null);
    setPendingChallenge(null);
    setSessionNotice("");
    try {
      if (!ownsAuthOperation(operation)) return { ok: false, error: t("auth.mobile.session.superseded") };
      await clearSessionToken(tokenVersion);
      if (!ownsAuthOperation(operation)) return { ok: false, error: t("auth.mobile.session.superseded") };
      const response = await apiFetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password, staySignedIn, client: "mobile", turnstileToken }),
        signal: operation.controller.signal,
      });
      if (!ownsAuthOperation(operation)) return { ok: false, error: t("auth.mobile.session.superseded") };
      const data = (await response.json().catch(() => ({}))) as AuthResponse;
      if (!response.ok) return { ok: false, error: apiErrorText(data, t("auth.mobile.session.invalidCredentials")) };
      if (data.mfaRequired && data.challengeToken) {
        setPendingChallenge({ token: data.challengeToken, kind: data.mfaKind === "user" ? "user" : "owner" });
        return { ok: true, mfaRequired: true };
      }
      if (!(await persistAuth(data, operation))) {
        return { ok: false, error: t("auth.mobile.session.noMobileSession") };
      }
      return { ok: true, mfaRequired: false };
    } catch {
      return { ok: false, error: t("errors.client.connect") };
    }
  };

  const completeMfa: SessionContextValue["completeMfa"] = async (code) => {
    if (!pendingChallenge) {
      return { ok: false, error: t("auth.mobile.session.checkExpired") };
    }
    if (mfaFlightRef.current) return { ok: false, error: t("auth.mobile.session.mfaInProgress") };
    const operation = authOperationsRef.current.current;
    if (!operation || !ownsAuthOperation(operation)) {
      return { ok: false, error: t("auth.mobile.session.mfaExpired") };
    }
    mfaFlightRef.current = operation;
    try {
      const endpoint = pendingChallenge.kind === "user" ? "/api/auth/mfa-login" : "/api/auth/owner-mfa-login";
      const response = await apiFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeToken: pendingChallenge.token,
          mfaCode: code,
          client: "mobile",
        }),
        signal: operation.controller.signal,
      });
      if (!ownsAuthOperation(operation)) return { ok: false, error: t("auth.mobile.session.mfaSuperseded") };
      const data = (await response.json().catch(() => ({}))) as AuthResponse;
      if (!response.ok) {
        return {
          ok: false,
          error: apiErrorText(data, t("auth.mobile.session.mfaFailed")),
        };
      }

      if (!(await persistAuth(data, operation))) {
        return { ok: false, error: t("auth.mobile.session.noMobileSession") };
      }

      return { ok: true, mfaRequired: false };
    } catch {
      return { ok: false, error: t("errors.client.connect") };
    } finally {
      if (mfaFlightRef.current === operation) mfaFlightRef.current = null;
    }
  };

  const register: SessionContextValue["register"] = async (
    email,
    username,
    password,
    birthDate,
    turnstileToken,
  ) => {
    try {
      const response = await apiFetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          username,
          password,
          birthDate,
          turnstileToken,
          ...currentLegalConsent(),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as AuthResponse;
      return {
        ok: response.ok,
        message:
          serverMessageText(data) ||
          apiErrorText(
            data,
            response.ok ? t("auth.mobile.session.accountCreated") : t("auth.mobile.session.createFailed"),
          ),
      };
    } catch {
      return { ok: false, message: t("errors.client.connect") };
    }
  };

  const forgotPassword: SessionContextValue["forgotPassword"] = async (
    email,
    turnstileToken,
  ) => {
    try {
      const response = await apiFetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, turnstileToken }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        message?: string;
        notice?: unknown;
        code?: string;
        params?: Record<string, string | number>;
        error?: string;
      };
      return {
        ok: response.ok,
        message: serverMessageText(data) || apiErrorText(data, t("errors.client.auth.resetLinkSent")),
      };
    } catch {
      return { ok: false, message: t("errors.client.connect") };
    }
  };

  const refreshUser = async () => {
    if (!token) return;
    const operation = authOperationsRef.current.current;
    if (!operation || !ownsAuthOperation(operation)) return;
    const sessionToken = token;
    const ownsRefresh = () => ownsAuthOperation(operation) && token === sessionToken;
    const response = await apiFetch("/api/auth/me", { signal: operation.controller.signal }, sessionToken);
    if (!ownsRefresh()) return;
    const data = (await response.json().catch(() => ({}))) as {
      user?: AccountUser;
      safety?: AccountUser["safety"];
    };
    if (!ownsRefresh()) return;
    if (response.ok && data.user) {
      setUser({ ...data.user, safety: data.safety ?? data.user.safety });
    } else if (response.status === 401 || response.status === 403) {
      if (!ownsRefresh()) return;
      await invalidate(t("auth.mobile.session.ended"));
    }
  };

  const logout = async () => {
    // Choosing to sign out removes the DM encryption key from this phone.
    void dmE2ee.stop({ forget: true });
    const operation = beginAuthOperation();
    settleRestoreLoading();
    const previousToken = token;
    const previousUserId = user?.id ?? null;
    const tokenVersion = beginSessionTokenMutation();
    clearPushMemory();
    setDraftAccount(null);
    setLastVoiceRoomAccount(null);
    // ...and this account's drafts, last voice room and notification settings.
    if (previousUserId) void forgetSignedOutAccount(previousUserId);
    setToken(null);
    setUser(null);
    setPendingChallenge(null);
    // Clear this device's saved credential independently from push-session
    // revocation. If SecureStore is briefly unavailable, retry after the
    // revocation attempt settles; a newer login's mutation version wins.
    const clearLocalCredential = () => clearSessionToken(tokenVersion).catch(() => undefined);
    void clearLocalCredential();
    const queued = previousToken
      ? await queuePushSessionRevocation(previousToken).catch(() => false)
      : true;
    await clearLocalCredential();
    if (queued && previousToken) pushRetryLifecycleRef.current?.retryNow();
    if (!ownsAuthOperation(operation)) return;
    if (!queued && previousToken) {
      void revokePushSession(previousToken).then(
        () => clearLocalCredential(),
        () => clearLocalCredential(),
      );
    }
    if (ownsAuthOperation(operation)) setSessionNotice("");
  };

  const value = useMemo<SessionContextValue>(
    () => ({
      loading,
      user,
      token,
      pendingMfa: Boolean(pendingChallenge),
      pendingMfaKind: pendingChallenge?.kind ?? null,
      sessionNotice,
      login,
      completeMfa,
      register,
      forgotPassword,
      refreshUser,
      logout,
      invalidate,
    }),
    [loading, user, token, pendingChallenge, sessionNotice],
  );

  return (
    <SessionContext.Provider value={value}>
      {children}
      {user && token && user.safety?.ageGateRequired && (() => {
        const sessionToken = token;
        const sessionUserId = user.id;
        const operation = authOperationsRef.current.current;
        return (
        <AgeGate
          token={sessionToken}
          onComplete={(safety) => {
            if (!operation || !ownsAuthOperation(operation) || token !== sessionToken || user?.id !== sessionUserId) return;
            setUser((current) => current?.id === sessionUserId ? { ...current, safety } : current);
          }}
        />
        );
      })()}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
