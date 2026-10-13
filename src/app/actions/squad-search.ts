// Squad Finder search: the game list and suggestions, starting and cancelling a search, and applying matches.

import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import {
  shouldInterruptQuietPresence,
  type QuietPresenceSettings as QuietPresenceModel,
} from "../../session/quiet-presence.ts";
import type { SupportedSquadFilters } from "../../session/squad-presets.ts";
import type { SquadSearch, UiSoundEvent } from "../types";
import { HTTP_URL } from "../env";
import { i18next } from "../../i18n/index.ts";
import { apiErrorMessage } from "../../i18n/apiError.ts";
import { authorizedFetch } from "../http";

export type SquadSearchActionsDeps = {
  setSquadGame: Dispatch<SetStateAction<string>>;
  squadGame: string;
  setSquadGames: Dispatch<SetStateAction<string[]>>;
  squadGameSuggestion: string;
  setSquadGameSuggestion: Dispatch<SetStateAction<string>>;
  squadPlatform: string;
  squadLanguage: string;
  squadRegion: string;
  squadMicrophone: boolean;
  setSquadCurrent: Dispatch<SetStateAction<SquadSearch | null>>;
  setSquadMatches: Dispatch<SetStateAction<SquadSearch[]>>;
  setSquadMatchPopup: Dispatch<SetStateAction<SquadSearch | null>>;
  squadNotifiedMatchRef: MutableRefObject<string>;
  setSquadBusy: Dispatch<SetStateAction<boolean>>;
  setSquadNotice: Dispatch<SetStateAction<string>>;
  quietPresenceRef: MutableRefObject<QuietPresenceModel>;
  desktopNotify: (
    title: string,
    body: string,
    kind?: "friend" | "dm" | "voice",
    soundEvent?: UiSoundEvent | null,
    quietKind?: "dm" | "mention" | "other",
  ) => void;
};

/** Called once per render with that render's values. */
export function createSquadSearchActions(deps: SquadSearchActionsDeps) {
  const {
    setSquadGame,
    squadGame,
    setSquadGames,
    squadGameSuggestion,
    setSquadGameSuggestion,
    squadPlatform,
    squadLanguage,
    squadRegion,
    squadMicrophone,
    setSquadCurrent,
    setSquadMatches,
    setSquadMatchPopup,
    squadNotifiedMatchRef,
    setSquadBusy,
    setSquadNotice,
    quietPresenceRef,
    desktopNotify,
  } = deps;

  const applySquadMatches = (matches: SquadSearch[]) => {
    setSquadMatches(matches);
    const available = matches[0];
    const key = available ? available.groupId || available.id : "";
    if (available && squadNotifiedMatchRef.current !== key) {
      squadNotifiedMatchRef.current = key;
      setSquadMatchPopup(available);
      if (shouldInterruptQuietPresence(quietPresenceRef.current, "recommendation"))
        desktopNotify(
          i18next.t("hub.actions.squad.readyTitle"),
          i18next.t("hub.actions.squad.readyBody", { count: available.memberCount, game: available.game }),
          "dm",
          "receive",
          "other",
        );
    } else if (!available) squadNotifiedMatchRef.current = "";
  };

  const loadSquadMatches = async () => {
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/squad-finder`);
      const data = (await response.json().catch(() => ({}))) as {
        current?: SquadSearch | null;
        matches?: SquadSearch[];
        error?: string;
      };
      if (!response.ok) {
        setSquadNotice(apiErrorMessage(data, "client.squad.loadMatches"));
        return;
      }
      setSquadCurrent(data.current ?? null);
      applySquadMatches(Array.isArray(data.matches) ? data.matches : []);
    } catch {
      setSquadNotice(i18next.t("hub.actions.squad.offline"));
    }
  };

  const loadSquadGames = async () => {
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/squad-finder/games`);
      const data = (await response.json()) as { games?: string[] };
      if (response.ok && Array.isArray(data.games) && data.games.length) {
        setSquadGames(data.games);
        setSquadGame((current) => (data.games!.includes(current) ? current : data.games![0]));
      }
    } catch (error) {
      console.warn("Could not load squad games:", error);
    }
  };

  const suggestSquadGame = async () => {
    const gameName = squadGameSuggestion.trim();
    if (!gameName) {
      setSquadNotice(i18next.t("hub.actions.squad.gameNameMissing"));
      return;
    }
    setSquadBusy(true);
    setSquadNotice("");
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/squad-finder/game-suggestions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gameName }),
      });
      const data = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !data.success) {
        setSquadNotice(apiErrorMessage(data, "client.squad.submitGame"));
        return;
      }
      setSquadGameSuggestion("");
      setSquadNotice(i18next.t("hub.actions.squad.gameSubmitted"));
    } catch {
      setSquadNotice(i18next.t("hub.actions.squad.gameSubmitFailed"));
    } finally {
      setSquadBusy(false);
    }
  };

  const startSquadSearch = async (
    filters: SupportedSquadFilters = {
      game: squadGame,
      platform: squadPlatform,
      language: squadLanguage,
      region: squadRegion,
      microphoneRequired: squadMicrophone,
    },
  ) => {
    setSquadBusy(true);
    setSquadNotice("");
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/squad-finder`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(filters),
      });
      const data = (await response.json().catch(() => ({}))) as {
        current?: SquadSearch;
        matches?: SquadSearch[];
        error?: string;
      };
      if (!response.ok) {
        setSquadNotice(apiErrorMessage(data, "client.squad.startSearch"));
        return;
      }
      setSquadCurrent(data.current ?? null);
      applySquadMatches(data.matches ?? []);
      setSquadNotice(
        data.matches?.length ? i18next.t("hub.actions.squad.matchesFound") : i18next.t("hub.actions.squad.searching"),
      );
    } catch {
      setSquadNotice(i18next.t("hub.actions.squad.startFailed"));
    } finally {
      setSquadBusy(false);
    }
  };

  const cancelSquadSearch = async () => {
    setSquadBusy(true);
    try {
      await authorizedFetch(`${HTTP_URL}/api/squad-finder`, { method: "DELETE" });
      setSquadCurrent(null);
      setSquadMatches([]);
      setSquadMatchPopup(null);
      squadNotifiedMatchRef.current = "";
      setSquadNotice(i18next.t("hub.actions.squad.stopped"));
    } finally {
      setSquadBusy(false);
    }
  };

  return {
    loadSquadMatches,
    loadSquadGames,
    suggestSquadGame,
    startSquadSearch,
    cancelSquadSearch,
  };
}

export type SquadSearchActions = ReturnType<typeof createSquadSearchActions>;
