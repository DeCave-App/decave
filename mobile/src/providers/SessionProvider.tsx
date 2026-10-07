import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { clearPushMemory, drainPendingPushActions, queuePushSessionRevocation, revokePushSession } from "@/src/lib/push";
import { setDraftAccount } from "@/src/lib/drafts";
import { setLastVoiceRoomAccount } from "@/src/lib/last-voice-room";
import { apiFetch } from "@/src/lib/api";
import { AgeGate } from "@/src/components/AgeGate";
import {
  clearSessionToken,
  beginSessionTokenMutation,
  loadSessionToken,
  saveSessionToken,
} from "@/src/lib/session-token";
import { MobileAuthOperationCoordinator } from "@/src/lib/auth-operations";
import type { AccountUser, AuthResponse } from "@/src/types";
import { PRIVACY_VERSION, TERMS_VERSION } from "../../../shared/legal-consent";

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
  invalidate: (notice?: string) => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AccountUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [pendingChallenge, setPendingChallenge] = useState<{ token: string; kind: MfaKind } | null>(null);
  const [sessionNotice, setSessionNotice] = useState("");
  const authOperationsRef = useRef(new MobileAuthOperationCoordinator());
  const mfaFlightRef = useRef<{ generation: number; controller: AbortController } | null>(null);
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

  const invalidate = async (notice = "") => {
    beginAuthOperation();
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
  };

  const restore = async () => {
    const operation = beginAuthOperation();
    const tokenVersion = beginSessionTokenMutation();
    setLoading(true);
    try {
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
      if (!queued) return { ok: false, error: "Could not securely save this device's sign-out for retry. Please try again." };
    }
    if (!ownsAuthOperation(operation)) return { ok: false, error: "Sign in was superseded." };
    clearPushMemory();
    setDraftAccount(null);
    setLastVoiceRoomAccount(null);
    const tokenVersion = beginSessionTokenMutation();
    setToken(null);
    setUser(null);
    setPendingChallenge(null);
    setSessionNotice("");
    try {
      if (!ownsAuthOperation(operation)) return { ok: false, error: "Sign in was superseded." };
      await clearSessionToken(tokenVersion);
      if (!ownsAuthOperation(operation)) return { ok: false, error: "Sign in was superseded." };
      const response = await apiFetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password, staySignedIn, client: "mobile", turnstileToken }),
        signal: operation.controller.signal,
      });
      if (!ownsAuthOperation(operation)) return { ok: false, error: "Sign in was superseded." };
      const data = (await response.json().catch(() => ({}))) as AuthResponse;
      if (!response.ok) return { ok: false, error: data.error || "Invalid email or password." };
      if (data.mfaRequired && data.challengeToken) {
        setPendingChallenge({ token: data.challengeToken, kind: data.mfaKind === "user" ? "user" : "owner" });
        return { ok: true, mfaRequired: true };
      }
      if (!(await persistAuth(data, operation))) {
        return { ok: false, error: "DeCave did not return a mobile session." };
      }
      return { ok: true, mfaRequired: false };
    } catch {
      return { ok: false, error: "Could not connect to DeCave." };
    }
  };

  const completeMfa: SessionContextValue["completeMfa"] = async (code) => {
    if (!pendingChallenge) {
      return { ok: false, error: "The sign-in check expired. Sign in again." };
    }
    if (mfaFlightRef.current) return { ok: false, error: "MFA verification is already in progress." };
    const operation = authOperationsRef.current.current;
    if (!operation || !ownsAuthOperation(operation)) {
      return { ok: false, error: "The MFA challenge expired. Sign in again." };
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
      if (!ownsAuthOperation(operation)) return { ok: false, error: "MFA verification was superseded." };
      const data = (await response.json().catch(() => ({}))) as AuthResponse;
      if (!response.ok) {
        return {
          ok: false,
          error: data.error || "Authenticator verification failed.",
        };
      }

      if (!(await persistAuth(data, operation))) {
        return { ok: false, error: "DeCave did not return a mobile session." };
      }

      return { ok: true, mfaRequired: false };
    } catch {
      return { ok: false, error: "Could not connect to DeCave." };
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
          termsAccepted: true,
          termsVersion: TERMS_VERSION,
          privacyVersion: PRIVACY_VERSION,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as AuthResponse;
      return {
        ok: response.ok,
        message:
          data.message ||
          data.error ||
          (response.ok ? "Account created." : "Could not create account."),
      };
    } catch {
      return { ok: false, message: "Could not connect to DeCave." };
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
        error?: string;
      };
      return {
        ok: response.ok,
        message:
          data.message ||
          data.error ||
          "If that verified email exists, a reset link has been sent.",
      };
    } catch {
      return { ok: false, message: "Could not connect to DeCave." };
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
      await invalidate("Your DeCave session ended. Sign in again.");
    }
  };

  const logout = async () => {
    const operation = beginAuthOperation();
    settleRestoreLoading();
    const previousToken = token;
    const tokenVersion = beginSessionTokenMutation();
    clearPushMemory();
    setDraftAccount(null);
    setLastVoiceRoomAccount(null);
    setToken(null);
    setUser(null);
    setPendingChallenge(null);
    const queued = previousToken
      ? await queuePushSessionRevocation(previousToken).catch(() => false)
      : true;
    if (!ownsAuthOperation(operation)) return;
    if (queued) {
      await clearSessionToken(tokenVersion);
      if (previousToken) void drainPendingPushActions().catch(() => undefined);
    } else if (previousToken) {
      void revokePushSession(previousToken).then((acknowledged) => {
        if (acknowledged) return clearSessionToken(tokenVersion);
      }).catch(() => undefined);
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
