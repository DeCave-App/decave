// Squad Finder search: the game list and suggestions, starting and cancelling a search, and applying matches.

import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import {
  shouldInterruptQuietPresence,
  type QuietPresenceSettings as QuietPresenceModel,
} from "../../session/quiet-presence.ts";
import type { SupportedSquadFilters } from "../../session/squad-presets.ts";
import type { SquadSearch, UiSoundEvent } from "../types";
import { HTTP_URL } from "../env";
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
          "Squad ready",
          `${available.memberCount}/4 players are available for ${available.game}.`,
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
        setSquadNotice(data.error || "Could not load squad matches.");
        return;
      }
      setSquadCurrent(data.current ?? null);
      applySquadMatches(Array.isArray(data.matches) ? data.matches : []);
    } catch {
      setSquadNotice("Could not connect to Squad Finder.");
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
      setSquadNotice("Type the missing game name first.");
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
        setSquadNotice(data.error || "Could not submit that game.");
        return;
      }
      setSquadGameSuggestion("");
      setSquadNotice("Submitted for review. It will appear after an owner approves it.");
    } catch {
      setSquadNotice("Could not submit the game suggestion.");
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
        setSquadNotice(data.error || "Could not start the search.");
        return;
      }
      setSquadCurrent(data.current ?? null);
      applySquadMatches(data.matches ?? []);
      setSquadNotice(data.matches?.length ? "Compatible squads found." : "Searching for compatible players…");
    } catch {
      setSquadNotice("Could not start Squad Finder.");
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
      setSquadNotice("Search stopped.");
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
