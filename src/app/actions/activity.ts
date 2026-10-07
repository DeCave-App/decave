// Game activity: detecting the game you are playing (desktop scan and Steam),
// publishing it to your profile, and linking or unlinking Steam.

import type { MutableRefObject } from "react";
import type {
  AccountUser,
  AutomaticActivitySource,
  DetectedDesktopGame,
  ActivitySettings,
  SteamIntegrationState,
  ActivityState,
} from "../types";
import { HTTP_URL } from "../env";
import { hasDesktopActivityBridge, scanDesktopActivityBridge, openDesktopExternalUrl } from "../desktop";
import type { GameActivityState } from "../state/game-activity";

export type ActivityActionsDeps = {
  currentUser: AccountUser | null;
  activitySettingsRef: MutableRefObject<ActivitySettings>;
  steamIntegrationRef: MutableRefObject<SteamIntegrationState>;
  automaticActivityActiveRef: MutableRefObject<boolean>;
  lastPublishedActivityRef: MutableRefObject<string>;
  steamPollAtRef: MutableRefObject<number>;
  steamLinkPollTimerRef: MutableRefObject<number | null>;
  authorizedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  setCurrentUserFromResponse: (nextUser: AccountUser) => void;
  gameActivity: GameActivityState;
};

/** Called once per render with that render's values. */
export function createActivityActions(deps: ActivityActionsDeps) {
  const {
    currentUser,
    activitySettingsRef,
    steamIntegrationRef,
    automaticActivityActiveRef,
    lastPublishedActivityRef,
    steamPollAtRef,
    steamLinkPollTimerRef,
    authorizedFetch,
    setCurrentUserFromResponse,
    gameActivity,
  } = deps;
  const { setActivityState, setSteamIntegration, setDetectedDesktopGame, setActivityNotice, setActivityBusy } =
    gameActivity;

  const refreshActivityState = async (): Promise<ActivityState | null> => {
    if (!currentUser) return null;
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/profile/activity`);
      if (!response.ok) return null;
      const data = (await response.json()) as ActivityState;
      setActivityState(data);
      automaticActivityActiveRef.current = Boolean(data.automaticText);
      if (data.steam) {
        steamIntegrationRef.current = data.steam;
        setSteamIntegration(data.steam);
      }
      lastPublishedActivityRef.current = data.automaticText ? `${data.source}|${data.appId}|${data.automaticText}` : "";
      return data;
    } catch (error) {
      console.warn("Could not load activity state:", error);
      return null;
    }
  };

  const refreshSteamIntegration = async (): Promise<SteamIntegrationState | null> => {
    if (!currentUser) return null;
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/integrations/steam/status`);
      if (!response.ok) return null;
      const data = (await response.json()) as SteamIntegrationState;
      steamIntegrationRef.current = data;
      setSteamIntegration(data);
      return data;
    } catch (error) {
      console.warn("Could not refresh Steam presence:", error);
      return null;
    }
  };

  const publishAutomaticActivity = async (
    gameName: string,
    source: AutomaticActivitySource,
    appId = "",
    startedAt: string | null = null,
  ): Promise<void> => {
    if (!currentUser) return;
    const text = gameName ? `Playing ${gameName}`.slice(0, 80) : "";
    const signature = text ? `${source}|${appId}|${text}` : "";
    if (signature === lastPublishedActivityRef.current) return;

    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/profile/activity/automatic`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, source, appId, startedAt }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        user?: AccountUser;
        activity?: Omit<ActivityState, "steam">;
        error?: string;
      };
      if (!response.ok || !data.user || !data.activity) {
        if (data.error) setActivityNotice(data.error);
        return;
      }
      lastPublishedActivityRef.current = signature;
      automaticActivityActiveRef.current = Boolean(data.activity.automaticText);
      setCurrentUserFromResponse(data.user);
      setActivityState((current) => ({
        manualText: data.activity!.manualText,
        automaticText: data.activity!.automaticText,
        effectiveText: data.activity!.effectiveText,
        source: data.activity!.source,
        appId: data.activity!.appId,
        startedAt: data.activity!.startedAt,
        steam: current?.steam ?? steamIntegrationRef.current,
      }));
    } catch (error) {
      console.warn("Could not publish automatic activity:", error);
    }
  };

  const normalizedActivityName = (value: string) => value.trim().toLocaleLowerCase();

  const isActivityExcluded = (gameName: string): boolean => {
    const key = normalizedActivityName(gameName);
    return activitySettingsRef.current.excludedGames.some((item) => normalizedActivityName(item) === key);
  };

  const runAutomaticActivityScan = async (forceSteam = false): Promise<void> => {
    if (!currentUser) return;
    const settings = activitySettingsRef.current;

    if (!settings.publishAutomatic) {
      if (automaticActivityActiveRef.current || lastPublishedActivityRef.current) {
        await publishAutomaticActivity("", "");
      }
      return;
    }

    let localGame: DetectedDesktopGame | null = null;
    let desktopScanSupported = false;
    if (settings.autoDetectLocal && hasDesktopActivityBridge()) {
      try {
        const scan = await scanDesktopActivityBridge();
        localGame = scan.supported ? scan.game : null;
        desktopScanSupported = scan.supported;
        setDetectedDesktopGame(localGame);
        if (!scan.supported) {
          setActivityNotice(`Local game detection is unavailable on ${scan.platform}.`);
        }
      } catch (error) {
        console.warn("Local activity scan failed:", error);
        setDetectedDesktopGame(null);
        setActivityNotice(
          error instanceof Error ? `Desktop activity scan failed: ${error.message}` : "Desktop activity scan failed.",
        );
      }
    } else {
      setDetectedDesktopGame(null);
    }

    let steam = steamIntegrationRef.current;
    const now = Date.now();
    if (settings.useSteamPresence && (forceSteam || now >= steamPollAtRef.current)) {
      steamPollAtRef.current = now + 45_000;
      steam = (await refreshSteamIntegration()) ?? steam;
    }

    if (localGame && !isActivityExcluded(localGame.gameName)) {
      await publishAutomaticActivity(
        localGame.gameName,
        localGame.source === "steam" ? "desktop-steam" : "desktop-epic",
        localGame.appId,
        localGame.startedAt,
      );
      return;
    }

    if (
      settings.useSteamPresence &&
      !desktopScanSupported &&
      steam.linked &&
      steam.gameName &&
      !/wallpaper|^blender$|^obs studio$|^unreal engine/i.test(steam.gameName) &&
      !isActivityExcluded(steam.gameName)
    ) {
      await publishAutomaticActivity(steam.gameName, "steam", steam.gameId ?? "", null);
      return;
    }

    await publishAutomaticActivity("", "");
  };

  const connectSteam = async () => {
    if (!currentUser) return;
    setActivityBusy(true);
    setActivityNotice("");
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/integrations/steam/connect`, {
        method: "POST",
      });
      const data = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!response.ok || !data.url) {
        setActivityNotice(data.error || "Could not start Steam connection.");
        return;
      }

      if (hasDesktopActivityBridge()) {
        const opened = await openDesktopExternalUrl(data.url);
        if (!opened) throw new Error("Steam login URL was blocked");
      } else {
        window.open(data.url, "_blank", "noopener,noreferrer");
      }
      setActivityNotice("Complete the Steam sign-in in your browser. DeCave will detect the link automatically.");

      if (steamLinkPollTimerRef.current !== null) {
        window.clearInterval(steamLinkPollTimerRef.current);
      }
      const stopAt = Date.now() + 2 * 60_000;
      steamLinkPollTimerRef.current = window.setInterval(() => {
        if (Date.now() >= stopAt) {
          if (steamLinkPollTimerRef.current !== null) window.clearInterval(steamLinkPollTimerRef.current);
          steamLinkPollTimerRef.current = null;
          return;
        }
        void refreshSteamIntegration().then((status) => {
          if (!status?.linked) return;
          if (steamLinkPollTimerRef.current !== null) window.clearInterval(steamLinkPollTimerRef.current);
          steamLinkPollTimerRef.current = null;
          setActivityNotice(`Steam connected${status.personaName ? ` as ${status.personaName}` : ""}.`);
          void refreshActivityState();
          void runAutomaticActivityScan(true);
        });
      }, 2_000);
    } catch (error) {
      console.error("Steam connection failed:", error);
      setActivityNotice("Could not open Steam sign-in.");
    } finally {
      setActivityBusy(false);
    }
  };

  const disconnectSteam = async () => {
    if (!currentUser) return;
    setActivityBusy(true);
    setActivityNotice("");
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/integrations/steam`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setActivityNotice(data.error || "Could not disconnect Steam.");
        return;
      }
      const nextSteam = { linked: false, apiConfigured: steamIntegrationRef.current.apiConfigured };
      steamIntegrationRef.current = nextSteam;
      setSteamIntegration(nextSteam);
      setActivityNotice("Steam disconnected.");
      void runAutomaticActivityScan(true);
    } finally {
      setActivityBusy(false);
    }
  };

  return {
    refreshActivityState,
    refreshSteamIntegration,
    runAutomaticActivityScan,
    connectSteam,
    disconnectSteam,
  };
}

export type ActivityActions = ReturnType<typeof createActivityActions>;
