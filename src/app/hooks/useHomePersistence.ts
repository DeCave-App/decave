// Home page persistence: loads the signed-in user's widget layout and saves it,
// plus quick links and notes, to this device.

import { type Dispatch, type SetStateAction, useEffect } from "react";
import type { AccountUser, HomeDashboardWidget } from "../types";
import {
  HOME_QUICK_LINKS_KEY,
  type HomeQuickLink,
  homeLayoutStorageKey,
  loadHomeLayout,
  loadHomeNotes,
  saveHomeNotes,
} from "../home-dashboard";

export type HomePersistenceDeps = {
  currentUser: AccountUser | null;
  setHomeWidgets: Dispatch<SetStateAction<HomeDashboardWidget[]>>;
  setHomeNotes: Dispatch<SetStateAction<string>>;
  setHomeNotesOwner: Dispatch<SetStateAction<string | null>>;
  homeWidgets: HomeDashboardWidget[];
  homeLayoutOwner: string | null;
  setHomeLayoutOwner: Dispatch<SetStateAction<string | null>>;
  homeQuickLinks: HomeQuickLink[];
  homeNotes: string;
  homeNotesOwner: string | null;
};

export function useHomePersistence(deps: HomePersistenceDeps): void {
  const {
    currentUser,
    setHomeWidgets,
    setHomeNotes,
    setHomeNotesOwner,
    homeWidgets,
    homeLayoutOwner,
    setHomeLayoutOwner,
    homeQuickLinks,
    homeNotes,
    homeNotesOwner,
  } = deps;

  useEffect(() => {
    const userId = currentUser?.id ?? null;
    if (userId === homeLayoutOwner) return;
    setHomeWidgets(loadHomeLayout(userId));
    setHomeLayoutOwner(userId);
    setHomeNotes(loadHomeNotes(userId));
    setHomeNotesOwner(userId);
  }, [currentUser?.id, homeLayoutOwner]);

  useEffect(() => {
    // Only persist once the signed-in user's own layout has been loaded.
    if (!homeLayoutOwner || homeLayoutOwner !== (currentUser?.id ?? null)) return;
    try {
      localStorage.setItem(homeLayoutStorageKey(homeLayoutOwner), JSON.stringify(homeWidgets));
    } catch {}
  }, [homeWidgets, homeLayoutOwner, currentUser?.id]);

  useEffect(() => {
    try {
      localStorage.setItem(HOME_QUICK_LINKS_KEY, JSON.stringify(homeQuickLinks));
    } catch {}
  }, [homeQuickLinks]);

  useEffect(() => {
    const userId = currentUser?.id ?? null;
    if (!userId || homeNotesOwner !== userId) return;
    saveHomeNotes(userId, homeNotes);
  }, [homeNotes, homeNotesOwner, currentUser?.id]);
}
