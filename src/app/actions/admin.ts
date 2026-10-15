// Platform owner security (second factor, re-authentication, recovery codes,
// owner roles) and the owner dashboard's account and Hub administration.

import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import type {
  SquadGameSuggestion,
  AccountUser,
  ApiError,
  AuthResponse,
  PlatformOwnerSummary,
  AdminDashboardSummary,
  AdminAccountSummary,
  AdminAccountDetail,
  AdminSecurityEvent,
  AdminAuditEvent,
} from "../types";
import { HTTP_URL } from "../env";
import { i18next } from "../../i18n/index.ts";
import { apiErrorMessage } from "../../i18n/apiError.ts";
import { serverMessage } from "../../i18n/notice.ts";
import { formatDate } from "../../i18n/format.ts";
import { hasDesktopActivityBridge } from "../desktop";
import type { AdminDashboardState } from "../state/admin-dashboard";
import type { OwnerSecurityState } from "../state/owner-security";
import type { AuthFormState } from "../state/auth-form";

export type AdminActionsDeps = {
  currentUser: AccountUser | null;
  setCurrentUser: Dispatch<SetStateAction<AccountUser | null>>;
  setAuthReady: Dispatch<SetStateAction<boolean>>;
  setAuthMode: Dispatch<SetStateAction<"login" | "register" | "forgot">>;
  setTurnstileToken: Dispatch<SetStateAction<string>>;
  setTurnstileNonce: Dispatch<SetStateAction<number>>;
  setAuthError: Dispatch<SetStateAction<string>>;
  setShowSettings: Dispatch<SetStateAction<boolean>>;
  accountEditAccountIdRef: MutableRefObject<string | null>;
  ownerSecurityRoleRef: MutableRefObject<boolean>;
  ownerSecurityOperationRef: MutableRefObject<{
    accountId: string;
    kind: "setup" | "reauth";
    controller: AbortController;
    mutationStarted: boolean;
  } | null>;
  ownerLoginChallengeToken: string;
  setOwnerLoginChallengeToken: Dispatch<SetStateAction<string>>;
  ownerLoginMfaCode: string;
  setOwnerLoginMfaCode: Dispatch<SetStateAction<string>>;
  setOwnerLoginMfaBusy: Dispatch<SetStateAction<boolean>>;
  setShowAdminDashboard: Dispatch<SetStateAction<boolean>>;
  setAdminDashboardTab: Dispatch<
    SetStateAction<"overview" | "accounts" | "games" | "security" | "audit" | "trust-safety">
  >;
  setShowHome: Dispatch<SetStateAction<boolean>>;
  setShowServerBrowser: Dispatch<SetStateAction<boolean>>;
  setShowSocial: Dispatch<SetStateAction<boolean>>;
  ownerPrivilegedContextRef: MutableRefObject<{ accountId: string } | null>;
  storeToken: (token: string) => void;
  authorizedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  closePrimaryTransientOverlays: () => void;
  adminDashboard: AdminDashboardState;
  ownerSecurity: OwnerSecurityState;
  authForm: AuthFormState;
};

/** Called once per render with that render's values. */
export function createAdminActions(deps: AdminActionsDeps) {
  const {
    currentUser,
    setCurrentUser,
    setAuthReady,
    setAuthMode,
    setTurnstileToken,
    setTurnstileNonce,
    setAuthError,
    setShowSettings,
    accountEditAccountIdRef,
    ownerSecurityRoleRef,
    ownerSecurityOperationRef,
    ownerLoginChallengeToken,
    setOwnerLoginChallengeToken,
    ownerLoginMfaCode,
    setOwnerLoginMfaCode,
    setOwnerLoginMfaBusy,
    setShowAdminDashboard,
    setAdminDashboardTab,
    setShowHome,
    setShowServerBrowser,
    setShowSocial,
    ownerPrivilegedContextRef,
    storeToken,
    authorizedFetch,
    closePrimaryTransientOverlays,
    adminDashboard,
    ownerSecurity,
    authForm,
  } = deps;
  const {
    setUsernameInput,
    setEmailInput,
    setPasswordInput,
    setConfirmPasswordInput,
    setBirthDateInput,
    loginMfaKind,
  } = authForm;
  const {
    setOwnerMfaEnabledState,
    ownerMfaEnabledState,
    ownerMfaCode,
    setOwnerMfaCode,
    setOwnerMfaNotice,
    setOwnerRecoveryCodes,
    setPlatformOwners,
    ownerTargetIdentifier,
    setOwnerTargetIdentifier,
    setOwnerManagementNotice,
    setPlatformOwnerActive,
    platformOwnerActive,
    ownerMfaPassword,
    setOwnerMfaPassword,
    setOwnerMfaSecret,
    setOwnerMfaOtpAuth,
    setOwnerMfaBusy,
    ownerReauthPassword,
    setOwnerReauthPassword,
    ownerReauthCode,
    setOwnerReauthCode,
    setOwnerReauthToken,
    ownerReauthToken,
    setOwnerReauthExpiresAt,
    ownerReauthExpiresAt,
    setOwnerReauthNotice,
    setOwnerManagementBusy,
  } = ownerSecurity;
  const {
    setAdminDashboardSummary,
    setAdminAccounts,
    setAdminSecurityEvents,
    setAdminAuditEvents,
    setAdminGameSuggestions,
    adminAccountSearch,
    setAdminDashboardBusy,
    setAdminDashboardNotice,
    adminUsageFrom,
    adminUsageTo,
    setSelectedAdminAccount,
    selectedAdminAccount,
    setAdminActionReason,
    adminActionReason,
    adminSuspendDuration,
    setAdminEraseConfirmation,
    adminEraseConfirmation,
    setAdminTransferTarget,
    adminTransferTarget,
    setAdminPlatformRoleChoice,
    adminPlatformRoleChoice,
    setAdminCorrectionBirthDate,
    adminCorrectionBirthDate,
  } = adminDashboard;

  const loadOwnerSecurityStatus = async () => {
    try {
      const [statusResponse, ownersResponse] = await Promise.all([
        fetch(`${HTTP_URL}/api/admin/platform-status`, {
          credentials: "include",
          cache: "no-store",
        }),
        fetch(`${HTTP_URL}/api/admin/platform-owners`, {
          credentials: "include",
          cache: "no-store",
        }),
      ]);

      if (!statusResponse.ok) {
        setPlatformOwnerActive(false);
        setPlatformOwners([]);
        return;
      }

      const statusData = (await statusResponse.json()) as {
        platformRole?: string;
        mfaEnabled?: boolean;
      };
      setPlatformOwnerActive(statusData.platformRole === "owner");
      setOwnerMfaEnabledState(statusData.mfaEnabled === true);

      if (ownersResponse.ok) {
        const ownersData = (await ownersResponse.json()) as {
          owners?: PlatformOwnerSummary[];
        };
        setPlatformOwners(Array.isArray(ownersData.owners) ? ownersData.owners : []);
      }
    } catch {
      setPlatformOwnerActive(false);
      setPlatformOwners([]);
    }
  };

  const startOwnerMfaSetup = async () => {
    const replacingEnabledFactor = ownerMfaEnabledState;
    let password = replacingEnabledFactor ? ownerReauthPassword : ownerMfaPassword;
    let mfaCode = replacingEnabledFactor ? ownerReauthCode.trim() : "";
    const reauthHeaders = replacingEnabledFactor ? ownerReauthHeader() : {};
    if (
      !currentUser ||
      !platformOwnerActive ||
      !password ||
      (replacingEnabledFactor && !mfaCode && !reauthHeaders["X-DeCave-Owner-Reauth"]) ||
      ownerSecurityOperationRef.current
    )
      return;
    const operation: NonNullable<(typeof ownerSecurityOperationRef)["current"]> = {
      accountId: currentUser.id,
      kind: "setup",
      controller: new AbortController(),
      mutationStarted: false,
    };
    ownerSecurityOperationRef.current = operation;
    const sameContext = () => accountEditAccountIdRef.current === operation.accountId && ownerSecurityRoleRef.current;
    const assertCurrent = () => {
      if (ownerSecurityOperationRef.current !== operation || !sameContext() || operation.controller.signal.aborted)
        throw new Error("Owner action cancelled.");
    };
    const ownerFetch: typeof fetch = async (url, init = {}) => {
      assertCurrent();
      const response = await authorizedFetch(String(url), { ...init, signal: operation.controller.signal });
      assertCurrent();
      return response;
    };
    const timeout = window.setTimeout(() => operation.controller.abort(), 120_000);
    setOwnerMfaPassword("");
    setOwnerReauthPassword("");
    setOwnerReauthCode("");
    setOwnerMfaSecret("");
    setOwnerMfaOtpAuth("");
    setOwnerReauthToken("");
    setOwnerReauthExpiresAt(0);
    ownerPrivilegedContextRef.current = null;
    setOwnerMfaBusy(true);
    setOwnerMfaNotice("");
    try {
      assertCurrent();
      operation.mutationStarted = true;
      const response = await ownerFetch(`${HTTP_URL}/api/admin/security/mfa/setup`, {
        method: "POST",
        credentials: "include",
        redirect: "error",
        cache: "no-store",
        headers: { "Content-Type": "application/json", ...reauthHeaders },
        body: JSON.stringify({ currentPassword: password, ...(mfaCode ? { mfaCode } : {}) }),
      });
      const data = (await response.json()) as { secret?: string; otpauth?: string; error?: string };
      assertCurrent();
      if (!response.ok) {
        if (response.status === 428) setOwnerMfaEnabledState(true);
        setOwnerMfaNotice(apiErrorMessage(data, "client.owner.mfaSetupStart"));
        return;
      }
      if (
        typeof data.secret !== "string" ||
        !/^[A-Z2-7]{16,128}$/.test(data.secret) ||
        typeof data.otpauth !== "string" ||
        data.otpauth.length > 2048 ||
        !data.otpauth.startsWith("otpauth://totp/")
      )
        throw new Error("Unconfirmed owner setup.");
      setOwnerMfaSecret(data.secret);
      setOwnerMfaOtpAuth(data.otpauth);
      if (replacingEnabledFactor) {
        setOwnerMfaEnabledState(false);
        setOwnerRecoveryCodes([]);
        setOwnerMfaCode("");
      }
      setOwnerMfaNotice(i18next.t("chat.actions.owner.mfaAddSecret"));
    } catch {
      if (ownerSecurityOperationRef.current === operation && sameContext())
        setOwnerMfaNotice(
          operation.mutationStarted
            ? i18next.t("chat.actions.owner.mfaSetupUnconfirmed")
            : i18next.t("chat.actions.owner.mfaSetupCancelled"),
        );
    } finally {
      password = "";
      mfaCode = "";
      window.clearTimeout(timeout);
      if (ownerSecurityOperationRef.current === operation) {
        ownerSecurityOperationRef.current = null;
        if (sameContext()) {
          setOwnerMfaPassword("");
          setOwnerMfaBusy(false);
        }
      }
    }
  };

  const enableOwnerMfa = async () => {
    setOwnerMfaBusy(true);
    setOwnerMfaNotice("");
    try {
      const response = await fetch(`${HTTP_URL}/api/admin/security/mfa/enable`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: ownerMfaCode }),
      });
      const data = (await response.json()) as { success?: boolean; recoveryCodes?: string[]; error?: string };
      if (!response.ok || !data.success || !Array.isArray(data.recoveryCodes)) {
        setOwnerMfaNotice(apiErrorMessage(data, "client.owner.mfaEnable"));
        return;
      }
      setOwnerMfaEnabledState(true);
      setOwnerRecoveryCodes(data.recoveryCodes);
      setOwnerMfaSecret("");
      setOwnerMfaOtpAuth("");
      setOwnerMfaCode("");
      setOwnerMfaPassword("");
      setOwnerMfaNotice(i18next.t("chat.actions.owner.mfaEnabled"));
    } catch {
      setOwnerMfaNotice(i18next.t("errors.client.connect"));
    } finally {
      setOwnerMfaBusy(false);
    }
  };

  const submitOwnerMfaLogin = async () => {
    const mfaCode = ownerLoginMfaCode.trim();
    if (!mfaCode) return;

    if (!ownerLoginChallengeToken) return;

    setOwnerLoginMfaBusy(true);
    setAuthError("");
    try {
      const response = await fetch(
        `${HTTP_URL}/api/auth/${loginMfaKind === "user" ? "mfa-login" : "owner-mfa-login"}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            challengeToken: ownerLoginChallengeToken,
            mfaCode,
            client: hasDesktopActivityBridge() ? "desktop" : "web", // DECAVE_PARITY_WEB_MFA_CLIENT
          }),
        },
      );
      const data = (await response.json()) as AuthResponse & ApiError;

      if (!response.ok || !data.user || !data.wsToken) {
        setAuthError(
          apiErrorMessage(data, loginMfaKind === "user" ? "client.owner.codeRejected" : "client.owner.mfaVerifyFailed"),
        );
        if (response.status === 401) {
          setOwnerLoginChallengeToken("");
          setOwnerLoginMfaCode("");
          setTurnstileToken("");
          setTurnstileNonce((value) => value + 1);
        }
        return;
      }

      storeToken(data.wsToken);
      setCurrentUser({ ...data.user, safety: data.safety ?? data.user.safety });
      setOwnerLoginChallengeToken("");
      setOwnerLoginMfaCode("");
      setUsernameInput("");
      setEmailInput("");
      setPasswordInput("");
      setConfirmPasswordInput("");
      setBirthDateInput("");
      setAuthReady(true);
    } catch {
      setAuthError(i18next.t("errors.client.connect"));
    } finally {
      setOwnerLoginMfaBusy(false);
    }
  };

  const ownerPrivilegedReauth = async () => {
    if (
      !currentUser ||
      !platformOwnerActive ||
      !ownerReauthPassword ||
      !ownerMfaEnabledState ||
      ownerSecurityOperationRef.current
    )
      return;
    if (!ownerReauthCode.trim()) return;
    let password = ownerReauthPassword;
    const legacyCode = ownerReauthCode.trim();
    const operation: NonNullable<(typeof ownerSecurityOperationRef)["current"]> = {
      accountId: currentUser.id,
      kind: "reauth",
      controller: new AbortController(),
      mutationStarted: false,
    };
    ownerSecurityOperationRef.current = operation;
    const sameContext = () => accountEditAccountIdRef.current === operation.accountId && ownerSecurityRoleRef.current;
    const assertCurrent = () => {
      if (ownerSecurityOperationRef.current !== operation || !sameContext() || operation.controller.signal.aborted)
        throw new Error("Owner action cancelled.");
    };
    const ownerFetch: typeof fetch = async (url, init = {}) => {
      assertCurrent();
      const response = await authorizedFetch(String(url), { ...init, signal: operation.controller.signal });
      assertCurrent();
      return response;
    };
    const timeout = window.setTimeout(() => operation.controller.abort(), 120_000);
    setOwnerReauthPassword("");
    setOwnerReauthCode("");
    setOwnerReauthToken("");
    setOwnerReauthExpiresAt(0);
    ownerPrivilegedContextRef.current = null;
    setOwnerManagementBusy(true);
    setOwnerReauthNotice("");
    try {
      assertCurrent();
      operation.mutationStarted = true;
      const response = await ownerFetch(`${HTTP_URL}/api/admin/security/reauth`, {
        method: "POST",
        credentials: "include",
        redirect: "error",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: password, mfaCode: legacyCode }),
      });
      const data = (await response.json()) as {
        reauthToken?: string;
        expiresInSeconds?: number;
        error?: string;
      };
      assertCurrent();
      if (
        !response.ok ||
        typeof data.reauthToken !== "string" ||
        !data.reauthToken ||
        data.reauthToken.length > 2048 ||
        data.expiresInSeconds !== 600
      )
        throw new Error("Unconfirmed privileged authentication.");
      const ttl = data.expiresInSeconds;
      ownerPrivilegedContextRef.current = { accountId: operation.accountId };
      setOwnerReauthToken(data.reauthToken);
      setOwnerReauthExpiresAt(Date.now() + ttl * 1000);
      setOwnerReauthPassword("");
      setOwnerReauthCode("");
      setOwnerReauthNotice(i18next.t("chat.actions.owner.reauthUnlocked"));
    } catch {
      if (ownerSecurityOperationRef.current === operation && sameContext())
        setOwnerReauthNotice(
          operation.mutationStarted
            ? i18next.t("chat.actions.owner.reauthUnconfirmed")
            : i18next.t("chat.actions.owner.reauthCancelled"),
        );
    } finally {
      password = "";
      window.clearTimeout(timeout);
      if (ownerSecurityOperationRef.current === operation) {
        ownerSecurityOperationRef.current = null;
        if (sameContext()) {
          setOwnerReauthPassword("");
          setOwnerReauthCode("");
          setOwnerManagementBusy(false);
        }
      }
    }
  };

  const cancelOwnerSecurityOperation = () => {
    const operation = ownerSecurityOperationRef.current;
    operation?.controller.abort();
    setOwnerMfaPassword("");
    setOwnerReauthPassword("");
    setOwnerReauthCode("");
    setOwnerReauthToken("");
    setOwnerReauthExpiresAt(0);
    ownerPrivilegedContextRef.current = null;
    if (operation?.mutationStarted) {
      const notice = i18next.t("chat.actions.owner.actionUnconfirmed");
      if (operation.kind === "setup") setOwnerMfaNotice(notice);
      else setOwnerReauthNotice(notice);
    }
  };

  const ownerReauthHeader = (): Record<string, string> => {
    const context = ownerPrivilegedContextRef.current;
    if (
      !ownerReauthToken ||
      ownerReauthExpiresAt <= Date.now() ||
      !ownerSecurityRoleRef.current ||
      !context ||
      context.accountId !== accountEditAccountIdRef.current
    )
      return {};
    return { "X-DeCave-Owner-Reauth": ownerReauthToken };
  };

  const promotePlatformOwner = async () => {
    if (!ownerTargetIdentifier.trim()) return;
    if (!ownerReauthToken || ownerReauthExpiresAt <= Date.now()) {
      setOwnerManagementNotice(i18next.t("chat.actions.owner.unlockFirst"));
      return;
    }

    setOwnerManagementBusy(true);
    setOwnerManagementNotice("");
    try {
      const response = await fetch(`${HTTP_URL}/api/admin/platform-owners/promote`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...ownerReauthHeader(),
        },
        body: JSON.stringify({
          targetIdentifier: ownerTargetIdentifier.trim(),
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setOwnerManagementNotice(apiErrorMessage(data, "client.owner.promote"));
        return;
      }
      setOwnerTargetIdentifier("");
      setOwnerManagementNotice(i18next.t("chat.actions.owner.promoted"));
      await loadOwnerSecurityStatus();
    } catch {
      setOwnerManagementNotice(i18next.t("errors.client.connect"));
    } finally {
      setOwnerManagementBusy(false);
    }
  };

  const demotePlatformOwner = async (targetUserId: string) => {
    if (!ownerReauthToken || ownerReauthExpiresAt <= Date.now()) {
      setOwnerManagementNotice(i18next.t("chat.actions.owner.unlockFirst"));
      return;
    }

    setOwnerManagementBusy(true);
    setOwnerManagementNotice("");
    try {
      const response = await fetch(`${HTTP_URL}/api/admin/platform-owners/demote`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...ownerReauthHeader(),
        },
        body: JSON.stringify({ targetUserId }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setOwnerManagementNotice(apiErrorMessage(data, "client.owner.demote"));
        return;
      }
      setOwnerManagementNotice(i18next.t("chat.actions.owner.demoted"));
      await loadOwnerSecurityStatus();
    } catch {
      setOwnerManagementNotice(i18next.t("errors.client.connect"));
    } finally {
      setOwnerManagementBusy(false);
    }
  };

  const regenerateOwnerRecoveryCodes = async () => {
    if (!ownerReauthToken || ownerReauthExpiresAt <= Date.now()) {
      setOwnerManagementNotice(i18next.t("chat.actions.owner.unlockFirst"));
      return;
    }

    setOwnerManagementBusy(true);
    setOwnerManagementNotice("");
    try {
      const response = await fetch(`${HTTP_URL}/api/admin/security/recovery/regenerate`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...ownerReauthHeader(),
        },
      });
      const data = (await response.json()) as {
        recoveryCodes?: string[];
        error?: string;
      };
      if (!response.ok || !Array.isArray(data.recoveryCodes)) {
        setOwnerManagementNotice(apiErrorMessage(data, "client.owner.recoveryCodes"));
        return;
      }
      setOwnerRecoveryCodes(data.recoveryCodes);
      setOwnerManagementNotice(i18next.t("chat.actions.owner.recoveryCodesCreated"));
    } catch {
      setOwnerManagementNotice(i18next.t("errors.client.connect"));
    } finally {
      setOwnerManagementBusy(false);
    }
  };

  const loadAdminDashboard = async (search = adminAccountSearch) => {
    if (!platformOwnerActive) return;
    setAdminDashboardBusy(true);
    setAdminDashboardNotice("");
    try {
      const searchParam = encodeURIComponent(search.trim());
      const [summaryResponse, accountsResponse, securityResponse, auditResponse, gamesResponse] = await Promise.all([
        fetch(
          `${HTTP_URL}/api/admin/dashboard?timezoneOffsetMinutes=${new Date().getTimezoneOffset()}&from=${encodeURIComponent(adminUsageFrom)}&to=${encodeURIComponent(adminUsageTo)}`,
          {
            credentials: "include",
            cache: "no-store",
          },
        ),
        fetch(`${HTTP_URL}/api/admin/accounts?limit=100&search=${searchParam}`, {
          credentials: "include",
          cache: "no-store",
        }),
        fetch(`${HTTP_URL}/api/admin/security-events?limit=100`, {
          credentials: "include",
          cache: "no-store",
        }),
        fetch(`${HTTP_URL}/api/admin/platform-audit?limit=100`, {
          credentials: "include",
          cache: "no-store",
        }),
        fetch(`${HTTP_URL}/api/admin/squad-game-suggestions`, {
          credentials: "include",
          cache: "no-store",
        }),
      ]);

      if (!summaryResponse.ok) {
        setAdminDashboardNotice(i18next.t("chat.actions.admin.ownerRequired"));
        setShowAdminDashboard(false);
        return;
      }

      const summary = (await summaryResponse.json()) as AdminDashboardSummary;
      setAdminDashboardSummary(summary);

      if (accountsResponse.ok) {
        const data = (await accountsResponse.json()) as { accounts?: AdminAccountSummary[] };
        setAdminAccounts(Array.isArray(data.accounts) ? data.accounts : []);
      }
      if (securityResponse.ok) {
        const data = (await securityResponse.json()) as { events?: AdminSecurityEvent[] };
        setAdminSecurityEvents(Array.isArray(data.events) ? data.events : []);
      }
      if (auditResponse.ok) {
        const data = (await auditResponse.json()) as { events?: AdminAuditEvent[] };
        setAdminAuditEvents(Array.isArray(data.events) ? data.events : []);
      }
      if (gamesResponse.ok) {
        const data = (await gamesResponse.json()) as { suggestions?: SquadGameSuggestion[] };
        setAdminGameSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
      }
    } catch {
      setAdminDashboardNotice(i18next.t("chat.actions.admin.loadFailed"));
    } finally {
      setAdminDashboardBusy(false);
    }
  };

  const reviewSquadGameSuggestion = async (suggestionId: string, action: "approve" | "reject") => {
    setAdminDashboardBusy(true);
    setAdminDashboardNotice("");
    try {
      const response = await fetch(
        `${HTTP_URL}/api/admin/squad-game-suggestions/${encodeURIComponent(suggestionId)}/${action}`,
        {
          method: "POST",
          credentials: "include",
        },
      );
      const data = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !data.success) {
        setAdminDashboardNotice(apiErrorMessage(data, "client.admin.reviewGame"));
        return;
      }
      setAdminGameSuggestions((items) =>
        items.map((item) =>
          item.id === suggestionId
            ? { ...item, status: action === "approve" ? "approved" : "rejected", reviewedAt: new Date().toISOString() }
            : item,
        ),
      );
      setAdminDashboardNotice(
        action === "approve"
          ? i18next.t("chat.actions.admin.gameApproved")
          : i18next.t("chat.actions.admin.gameRejected"),
      );
    } catch {
      setAdminDashboardNotice(i18next.t("errors.client.connect"));
    } finally {
      setAdminDashboardBusy(false);
    }
  };

  const openAdminDashboard = () => {
    closePrimaryTransientOverlays();
    setShowHome(false);
    setShowSocial(false);
    setShowSettings(false);
    setShowServerBrowser(false);
    setAdminDashboardTab("overview");
    setAdminDashboardNotice("");
    setSelectedAdminAccount(null);
    setShowAdminDashboard(true);
    void loadAdminDashboard();
  };

  const revokeAdminAccountSessions = async (targetUserId: string) => {
    if (!ownerReauthToken || ownerReauthExpiresAt <= Date.now()) {
      setAdminDashboardNotice(i18next.t("chat.actions.admin.unlockFirst"));
      return;
    }

    setAdminDashboardBusy(true);
    setAdminDashboardNotice("");
    try {
      const response = await fetch(`${HTTP_URL}/api/admin/sessions/revoke-user`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-DeCave-Owner-Reauth": ownerReauthToken,
        },
        body: JSON.stringify({ targetUserId }),
      });
      const data = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !data.success) {
        setAdminDashboardNotice(apiErrorMessage(data, "client.admin.revokeSessions"));
        return;
      }

      if (targetUserId === currentUser?.id) {
        setShowAdminDashboard(false);
        setOwnerReauthToken("");
        setOwnerReauthExpiresAt(0);
        storeToken("");
        setCurrentUser(null);
        setAuthMode("login");
        setAuthError(i18next.t("chat.actions.admin.ownSessionsRevoked"));
        return;
      }

      setAdminDashboardNotice(i18next.t("chat.actions.admin.sessionsRevoked"));
      await loadAdminDashboard();
      if (selectedAdminAccount?.id === targetUserId) {
        await loadAdminAccountDetail(targetUserId);
      }
    } catch {
      setAdminDashboardNotice(i18next.t("errors.client.connect"));
    } finally {
      setAdminDashboardBusy(false);
    }
  };

  const loadAdminAccountDetail = async (userId: string) => {
    setAdminDashboardBusy(true);
    setAdminDashboardNotice("");
    try {
      const response = await fetch(`${HTTP_URL}/api/admin/accounts/${encodeURIComponent(userId)}`, {
        credentials: "include",
        cache: "no-store",
      });
      const data = (await response.json()) as {
        account?: AdminAccountDetail;
        error?: string;
      };
      if (!response.ok || !data.account) {
        setAdminDashboardNotice(apiErrorMessage(data, "client.admin.accountDetails"));
        return;
      }
      setSelectedAdminAccount(data.account);
      setAdminPlatformRoleChoice(data.account.platformRole);
      setAdminActionReason("");
      setAdminEraseConfirmation("");
      setAdminTransferTarget("");
      setAdminCorrectionBirthDate("");
    } catch {
      setAdminDashboardNotice(i18next.t("errors.client.connect"));
    } finally {
      setAdminDashboardBusy(false);
    }
  };

  const adminReauthHeaders = (): Record<string, string> => {
    if (!ownerReauthToken || ownerReauthExpiresAt <= Date.now()) return {};
    return { "X-DeCave-Owner-Reauth": ownerReauthToken };
  };

  const requireAdminPrivilegedUnlock = (): boolean => {
    if (!ownerReauthToken || ownerReauthExpiresAt <= Date.now()) {
      setAdminDashboardNotice(i18next.t("chat.actions.admin.unlockFirst"));
      return false;
    }
    return true;
  };

  const refreshSelectedAdminAccount = async () => {
    const userId = selectedAdminAccount?.id;
    await loadAdminDashboard();
    if (userId) await loadAdminAccountDetail(userId);
  };

  const suspendAdminAccount = async () => {
    if (!selectedAdminAccount || !requireAdminPrivilegedUnlock()) return;
    if (!adminActionReason.trim()) {
      setAdminDashboardNotice(i18next.t("chat.actions.admin.suspendReasonMissing"));
      return;
    }

    setAdminDashboardBusy(true);
    setAdminDashboardNotice("");
    try {
      const durationDays = adminSuspendDuration === "indefinite" ? null : Number(adminSuspendDuration);

      const response = await fetch(
        `${HTTP_URL}/api/admin/accounts/${encodeURIComponent(selectedAdminAccount.id)}/suspend`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...adminReauthHeaders(),
          },
          body: JSON.stringify({
            reason: adminActionReason.trim(),
            durationDays,
          }),
        },
      );
      const data = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !data.success) {
        setAdminDashboardNotice(apiErrorMessage(data, "client.admin.suspend"));
        return;
      }
      setAdminDashboardNotice(i18next.t("chat.actions.admin.suspended"));
      setAdminActionReason("");
      await refreshSelectedAdminAccount();
    } catch {
      setAdminDashboardNotice(i18next.t("errors.client.connect"));
    } finally {
      setAdminDashboardBusy(false);
    }
  };

  const unsuspendAdminAccount = async () => {
    if (!selectedAdminAccount || !requireAdminPrivilegedUnlock()) return;

    setAdminDashboardBusy(true);
    setAdminDashboardNotice("");
    try {
      const response = await fetch(
        `${HTTP_URL}/api/admin/accounts/${encodeURIComponent(selectedAdminAccount.id)}/unsuspend`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...adminReauthHeaders(),
          },
        },
      );
      const data = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !data.success) {
        setAdminDashboardNotice(apiErrorMessage(data, "client.admin.unsuspend"));
        return;
      }
      setAdminDashboardNotice(i18next.t("chat.actions.admin.unsuspended"));
      await refreshSelectedAdminAccount();
    } catch {
      setAdminDashboardNotice(i18next.t("errors.client.connect"));
    } finally {
      setAdminDashboardBusy(false);
    }
  };

  const correctAdminAccountAge = async () => {
    if (!selectedAdminAccount || !requireAdminPrivilegedUnlock()) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(adminCorrectionBirthDate)) {
      setAdminDashboardNotice(i18next.t("chat.actions.admin.birthDateMissing"));
      return;
    }

    setAdminDashboardBusy(true);
    setAdminDashboardNotice("");
    try {
      const response = await fetch(
        `${HTTP_URL}/api/admin/accounts/${encodeURIComponent(selectedAdminAccount.id)}/age-recovery`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...adminReauthHeaders(),
          },
          body: JSON.stringify({ birthDate: adminCorrectionBirthDate }),
        },
      );
      const data = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !data.success) {
        setAdminDashboardNotice(apiErrorMessage(data, "client.admin.correctAge"));
        return;
      }
      setAdminCorrectionBirthDate("");
      setAdminDashboardNotice(i18next.t("chat.actions.admin.ageCorrected"));
      await refreshSelectedAdminAccount();
    } catch {
      setAdminDashboardNotice(i18next.t("errors.client.connect"));
    } finally {
      setAdminDashboardBusy(false);
    }
  };

  const resendAdminVerificationEmail = async () => {
    if (!selectedAdminAccount || !requireAdminPrivilegedUnlock()) return;

    setAdminDashboardBusy(true);
    setAdminDashboardNotice("");
    try {
      const response = await fetch(
        `${HTTP_URL}/api/admin/accounts/${encodeURIComponent(selectedAdminAccount.id)}/resend-verification`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...adminReauthHeaders(),
          },
        },
      );
      const data = (await response.json()) as { success?: boolean; message?: string; error?: string };
      if (!response.ok || !data.success) {
        setAdminDashboardNotice(apiErrorMessage(data, "client.admin.resendVerification"));
        return;
      }
      setAdminDashboardNotice(serverMessage(data, i18next.t("chat.actions.admin.verificationResent")));
    } catch {
      setAdminDashboardNotice(i18next.t("errors.client.connect"));
    } finally {
      setAdminDashboardBusy(false);
    }
  };

  const forceAdminPasswordReset = async () => {
    if (!selectedAdminAccount || !requireAdminPrivilegedUnlock()) return;

    setAdminDashboardBusy(true);
    setAdminDashboardNotice("");
    try {
      const response = await fetch(
        `${HTTP_URL}/api/admin/accounts/${encodeURIComponent(selectedAdminAccount.id)}/force-password-reset`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...adminReauthHeaders(),
          },
        },
      );
      const data = (await response.json()) as {
        success?: boolean;
        message?: string;
        error?: string;
      };
      if (!response.ok || !data.success) {
        setAdminDashboardNotice(apiErrorMessage(data, "client.admin.forceReset"));
        return;
      }
      setAdminDashboardNotice(serverMessage(data, i18next.t("chat.actions.admin.resetForced")));
      await refreshSelectedAdminAccount();
    } catch {
      setAdminDashboardNotice(i18next.t("errors.client.connect"));
    } finally {
      setAdminDashboardBusy(false);
    }
  };

  const scheduleAdminAccountDeletion = async () => {
    if (!selectedAdminAccount || !requireAdminPrivilegedUnlock()) return;
    if (!adminActionReason.trim()) {
      setAdminDashboardNotice(i18next.t("chat.actions.admin.deleteReasonMissing"));
      return;
    }

    setAdminDashboardBusy(true);
    setAdminDashboardNotice("");
    try {
      const response = await fetch(
        `${HTTP_URL}/api/admin/accounts/${encodeURIComponent(selectedAdminAccount.id)}/schedule-deletion`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...adminReauthHeaders(),
          },
          body: JSON.stringify({ reason: adminActionReason.trim() }),
        },
      );
      const data = (await response.json()) as {
        success?: boolean;
        deleteAfter?: string;
        error?: string;
      };
      if (!response.ok || !data.success) {
        setAdminDashboardNotice(apiErrorMessage(data, "client.admin.scheduleDeletion"));
        return;
      }
      setAdminDashboardNotice(
        data.deleteAfter
          ? i18next.t("chat.actions.admin.erasureAvailableAfter", { date: formatDate(data.deleteAfter, "dateTime") })
          : i18next.t("chat.actions.admin.deletionScheduled"),
      );
      setAdminActionReason("");
      await refreshSelectedAdminAccount();
    } catch {
      setAdminDashboardNotice(i18next.t("errors.client.connect"));
    } finally {
      setAdminDashboardBusy(false);
    }
  };

  const restoreAdminAccount = async () => {
    if (!selectedAdminAccount || !requireAdminPrivilegedUnlock()) return;

    setAdminDashboardBusy(true);
    setAdminDashboardNotice("");
    try {
      const response = await fetch(
        `${HTTP_URL}/api/admin/accounts/${encodeURIComponent(selectedAdminAccount.id)}/restore`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...adminReauthHeaders(),
          },
        },
      );
      const data = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !data.success) {
        setAdminDashboardNotice(apiErrorMessage(data, "client.admin.restore"));
        return;
      }
      setAdminDashboardNotice(i18next.t("chat.actions.admin.restored"));
      await refreshSelectedAdminAccount();
    } catch {
      setAdminDashboardNotice(i18next.t("errors.client.connect"));
    } finally {
      setAdminDashboardBusy(false);
    }
  };

  const eraseAdminAccount = async () => {
    if (!selectedAdminAccount || !requireAdminPrivilegedUnlock()) return;

    setAdminDashboardBusy(true);
    setAdminDashboardNotice("");
    try {
      const response = await fetch(
        `${HTTP_URL}/api/admin/accounts/${encodeURIComponent(selectedAdminAccount.id)}/erase`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...adminReauthHeaders(),
          },
          body: JSON.stringify({ confirmation: adminEraseConfirmation }),
        },
      );
      const data = (await response.json()) as {
        success?: boolean;
        message?: string;
        error?: string;
      };
      if (!response.ok || !data.success) {
        setAdminDashboardNotice(apiErrorMessage(data, "client.admin.erase"));
        return;
      }

      setAdminDashboardNotice(serverMessage(data, i18next.t("chat.actions.admin.erased")));
      setAdminEraseConfirmation("");
      await refreshSelectedAdminAccount();
    } catch {
      setAdminDashboardNotice(i18next.t("errors.client.connect"));
    } finally {
      setAdminDashboardBusy(false);
    }
  };

  const changeAdminPlatformRole = async () => {
    if (!selectedAdminAccount || !requireAdminPrivilegedUnlock()) return;

    setAdminDashboardBusy(true);
    setAdminDashboardNotice("");
    try {
      const response = await fetch(
        `${HTTP_URL}/api/admin/accounts/${encodeURIComponent(selectedAdminAccount.id)}/platform-role`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...adminReauthHeaders(),
          },
          body: JSON.stringify({ role: adminPlatformRoleChoice }),
        },
      );
      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
      };
      if (!response.ok || !data.success) {
        setAdminDashboardNotice(apiErrorMessage(data, "client.admin.changeRole"));
        return;
      }
      setAdminDashboardNotice(i18next.t("chat.actions.admin.roleChanged"));
      await refreshSelectedAdminAccount();
    } catch {
      setAdminDashboardNotice(i18next.t("errors.client.connect"));
    } finally {
      setAdminDashboardBusy(false);
    }
  };

  const transferAdminHubOwnership = async (hubId: number) => {
    if (!requireAdminPrivilegedUnlock()) return;
    if (!adminTransferTarget.trim()) {
      setAdminDashboardNotice(i18next.t("chat.actions.admin.transferTargetMissing"));
      return;
    }

    setAdminDashboardBusy(true);
    setAdminDashboardNotice("");
    try {
      const response = await fetch(`${HTTP_URL}/api/admin/hubs/${hubId}/transfer-owner`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...adminReauthHeaders(),
        },
        body: JSON.stringify({
          targetIdentifier: adminTransferTarget.trim(),
        }),
      });
      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
      };
      if (!response.ok || !data.success) {
        setAdminDashboardNotice(apiErrorMessage(data, "client.admin.transferHub"));
        return;
      }
      setAdminDashboardNotice(i18next.t("chat.actions.admin.hubTransferred"));
      setAdminTransferTarget("");
      await refreshSelectedAdminAccount();
    } catch {
      setAdminDashboardNotice(i18next.t("errors.client.connect"));
    } finally {
      setAdminDashboardBusy(false);
    }
  };

  return {
    loadOwnerSecurityStatus,
    startOwnerMfaSetup,
    enableOwnerMfa,
    submitOwnerMfaLogin,
    ownerPrivilegedReauth,
    cancelOwnerSecurityOperation,
    promotePlatformOwner,
    demotePlatformOwner,
    regenerateOwnerRecoveryCodes,
    loadAdminDashboard,
    reviewSquadGameSuggestion,
    openAdminDashboard,
    revokeAdminAccountSessions,
    loadAdminAccountDetail,
    suspendAdminAccount,
    unsuspendAdminAccount,
    correctAdminAccountAge,
    forceAdminPasswordReset,
    resendAdminVerificationEmail,
    scheduleAdminAccountDeletion,
    restoreAdminAccount,
    eraseAdminAccount,
    changeAdminPlatformRole,
    transferAdminHubOwnership,
  };
}

export type AdminActions = ReturnType<typeof createAdminActions>;
