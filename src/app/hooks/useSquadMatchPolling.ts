// Loads Squad Finder matches on sign-in, and every 8 s while a squad search is open.

import { useEffect } from "react";
import type { SquadSearch, AccountUser } from "../types";
import type { SquadSearchActions } from "../actions/squad-search";

export type SquadMatchPollingDeps = {
  currentUser: AccountUser | null;
  squadCurrent: SquadSearch | null;
  squadSearch: SquadSearchActions;
};

export function useSquadMatchPolling(deps: SquadMatchPollingDeps): void {
  const { currentUser, squadCurrent, squadSearch } = deps;

  useEffect(() => {
    if (!squadCurrent) return;
    const timer = window.setInterval(() => void squadSearch.loadSquadMatches(), 8_000);
    return () => window.clearInterval(timer);
  }, [squadCurrent?.id]);

  useEffect(() => {
    if (currentUser?.id) void squadSearch.loadSquadMatches();
  }, [currentUser?.id]);
}
