// Safety actions: opening a report, blocking or unblocking a user, and confirming the age check.

import type { Dispatch, SetStateAction } from "react";
import type { SafetyProfile, SafetyReportTarget } from "../../safety/types";
import type { AccountUser, DmNotice, UserContextTarget, UserContextMenuState } from "../types";
import { HTTP_URL } from "../env";
import { authorizedFetch } from "../http";

export type SafetyActionsDeps = {
  setCurrentUser: Dispatch<SetStateAction<AccountUser | null>>;
  setReportTarget: Dispatch<SetStateAction<SafetyReportTarget | null>>;
  blockedUserIds: string[];
  setBlockedUserIds: Dispatch<SetStateAction<string[]>>;
  ageGateBirthDate: string;
  setAgeGateNotice: Dispatch<SetStateAction<string>>;
  setAgeGateBusy: Dispatch<SetStateAction<boolean>>;
  setUserContextMenu: Dispatch<SetStateAction<UserContextMenuState | null>>;
  setDmNotice: Dispatch<SetStateAction<DmNotice | null>>;
};

/** Called once per render with that render's values. */
export function createSafetyActions(deps: SafetyActionsDeps) {
  const {
    setCurrentUser,
    setReportTarget,
    blockedUserIds,
    setBlockedUserIds,
    ageGateBirthDate,
    setAgeGateNotice,
    setAgeGateBusy,
    setUserContextMenu,
    setDmNotice,
  } = deps;

  const openSafetyReport = (target: SafetyReportTarget) => {
    setUserContextMenu(null);
    setReportTarget(target);
  };

  const toggleBlockedUser = async (target: UserContextTarget) => {
    const blocked = blockedUserIds.includes(target.userId);
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/safety/blocks/${encodeURIComponent(target.userId)}`, {
        method: blocked ? "DELETE" : "PUT",
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setDmNotice({
          userId: target.userId,
          username: target.username,
          text: data.error || "Could not update the block.",
        });
        return;
      }
      setBlockedUserIds((current) =>
        blocked ? current.filter((id) => id !== target.userId) : [...current, target.userId],
      );
      setUserContextMenu(null);
    } catch {
      setDmNotice({ userId: target.userId, username: target.username, text: "Could not connect to DeCave." });
    }
  };

  const confirmAgeGate = async () => {
    if (!ageGateBirthDate) {
      setAgeGateNotice("Enter your birth date to continue.");
      return;
    }
    setAgeGateBusy(true);
    setAgeGateNotice("");
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/auth/age`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ birthDate: ageGateBirthDate }),
      });
      const data = (await response.json().catch(() => ({}))) as { safety?: SafetyProfile; error?: string };
      if (!response.ok || !data.safety) {
        setAgeGateNotice(data.error || "We could not verify your age.");
        return;
      }
      setCurrentUser((current) => (current ? { ...current, safety: data.safety } : current));
    } catch {
      setAgeGateNotice("Could not connect to DeCave.");
    } finally {
      setAgeGateBusy(false);
    }
  };

  return {
    openSafetyReport,
    toggleBlockedUser,
    confirmAgeGate,
  };
}
