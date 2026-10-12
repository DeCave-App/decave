// When a different account signs in on this device, the previous account's
// local data is cleared (src/app/actions/clear-account-storage.ts) and the app
// reloads so nothing it had read from that data stays in memory.

import { useEffect } from "react";
import { claimAccountStorage } from "../actions/clear-account-storage";

export function useAccountStorageOwner(userId: string | null | undefined): void {
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void claimAccountStorage(userId)
      .then((result) => {
        if (!cancelled && result === "switched") window.location.reload();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [userId]);
}
