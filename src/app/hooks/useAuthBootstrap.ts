// On load: reads the sign-in configuration (Turnstile, streamer Hubs) and restores the
// signed-in user from the session cookie.

import { type Dispatch, type SetStateAction, useEffect } from "react";
import type { SafetyProfile } from "../../safety/types";
import type { AccountUser } from "../types";
import { HTTP_URL } from "../env";

export type AuthBootstrapDeps = {
  resetPrivateAccountState: () => void;
  setCurrentUser: Dispatch<SetStateAction<AccountUser | null>>;
  setAuthReady: Dispatch<SetStateAction<boolean>>;
  setTurnstileSiteKey: Dispatch<SetStateAction<string>>;
  setTurnstileTestMode: Dispatch<SetStateAction<boolean>>;
  setStreamerHubsCapability: Dispatch<SetStateAction<boolean>>;
  storeToken: (token: string) => void;
  fetchWsToken: () => Promise<string>;
};

export function useAuthBootstrap(deps: AuthBootstrapDeps): void {
  const {
    resetPrivateAccountState,
    setCurrentUser,
    setAuthReady,
    setTurnstileSiteKey,
    setTurnstileTestMode,
    setStreamerHubsCapability,
    storeToken,
    fetchWsToken,
  } = deps;

  useEffect(() => {
    let cancelled = false;

    const checkSession = async () => {
      try {
        try {
          sessionStorage.removeItem("gamerchat_auth_token");
        } catch {}
        const [configResponse, meResponse] = await Promise.all([
          fetch(`${HTTP_URL}/api/auth/config`, { credentials: "include" }),
          fetch(`${HTTP_URL}/api/auth/me`, { credentials: "include" }),
        ]);

        if (configResponse.ok) {
          const config = (await configResponse.json()) as {
            turnstileSiteKey?: string;
            turnstileTestMode?: boolean;
            streamerHubsEnabled?: boolean;
          };
          if (!cancelled) {
            setTurnstileSiteKey(config.turnstileSiteKey ?? "");
            setStreamerHubsCapability(config.streamerHubsEnabled === true);
            const localOrigin = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
            setTurnstileTestMode(config.turnstileTestMode === true && localOrigin);
          }
        }

        if (!meResponse.ok) {
          if (!cancelled) {
            resetPrivateAccountState();
            storeToken("");
            setCurrentUser(null);
          }
          return;
        }
        const data = (await meResponse.json()) as { user?: AccountUser; safety?: SafetyProfile };
        const token = data.user ? await fetchWsToken() : "";
        if (cancelled) return;
        if (!data.user || !token) {
          resetPrivateAccountState();
          storeToken("");
          setCurrentUser(null);
          return;
        }
        resetPrivateAccountState();
        setCurrentUser({ ...data.user, safety: data.safety ?? data.user.safety });
        storeToken(token);
      } catch (error) {
        console.error("Could not validate session:", error);
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    };

    void checkSession();
    return () => {
      cancelled = true;
    };
  }, []);
}
