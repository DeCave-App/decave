import { useCallback, useSyncExternalStore } from "react";
import { useSession } from "@/src/providers/SessionProvider";
import { cachedHubList, loadHubList, subscribeHubLists, type HubListKind } from "@/src/lib/hub-list-cache";
import type { Hub } from "@/src/types";

/**
 * A cached Hub list for the signed-in account: null until it first loads.
 * `refresh` loads it again (sharing a request already in flight) and rejects
 * when the request fails, so callers decide how to report errors.
 */
export function useHubList(kind: HubListKind): {
  hubs: Hub[] | null;
  refresh: (options?: { maxAgeMs?: number }) => Promise<Hub[]>;
} {
  const { token } = useSession();
  const hubs = useSyncExternalStore(subscribeHubLists, () => cachedHubList(kind, token));
  const refresh = useCallback(
    (options: { maxAgeMs?: number } = {}) =>
      token ? loadHubList(kind, token, options) : Promise.resolve<Hub[]>([]),
    [kind, token],
  );
  return { hubs, refresh };
}
