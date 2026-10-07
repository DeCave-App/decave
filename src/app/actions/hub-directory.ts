// Loading the user's Hubs, the Discover list and Hub previews, and saving a Hub's home page.

import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import { parseHubPreview, type HubPreview } from "../../features/discover/discoverModel";
import { normalizeHubHomeConfig, type HubHomeConfig } from "../../../shared/hub-home";
import type { Server, DiscoverServer, ChatMessage, ApiError } from "../types";
import { HTTP_URL } from "../env";
import { authorizedFetch } from "../http";
import { commitForSession, type AccountSessionGuard, type AccountSessionSnapshot } from "../account-session-guard";

export type HubDirectoryActionsDeps = {
  authToken: string;
  setServers: Dispatch<SetStateAction<Server[]>>;
  setSelectedServer: Dispatch<SetStateAction<number>>;
  setSelectedChannel: Dispatch<SetStateAction<number>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setDiscoverServers: Dispatch<SetStateAction<DiscoverServer[]>>;
  setDiscoverLoading: Dispatch<SetStateAction<boolean>>;
  setDiscoverError: Dispatch<SetStateAction<string>>;
  activeServerRef: MutableRefObject<number>;
  activeChannelRef: MutableRefObject<number>;
  sessionGuard: AccountSessionGuard;
  sessionSnapshot: AccountSessionSnapshot;
};

/** Called once per render with that render's values. */
export function createHubDirectoryActions(deps: HubDirectoryActionsDeps) {
  const {
    authToken,
    setServers,
    setSelectedServer,
    setSelectedChannel,
    setMessages,
    setDiscoverServers,
    setDiscoverLoading,
    setDiscoverError,
    activeServerRef,
    activeChannelRef,
    sessionGuard,
    sessionSnapshot,
  } = deps;
  const ownsSession = () => sessionGuard.owns(sessionSnapshot);

  const loadServers = async (): Promise<Server[] | null> => {
    if (!authToken || !ownsSession()) return null;

    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/servers`);
      if (!ownsSession()) return null;
      if (!response.ok) {
        console.error("Failed to load servers:", response.status);
        return null;
      }

      const data: unknown = await response.json();
      if (!ownsSession()) return null;
      if (!Array.isArray(data)) return null;
      const loadedServers = data as Server[];
      if (!commitForSession(sessionGuard, sessionSnapshot, loadedServers, setServers)) return null;

      if (loadedServers.length === 0) {
        activeServerRef.current = 0;
        activeChannelRef.current = 0;
        setSelectedServer(0);
        setSelectedChannel(0);
        setMessages([]);
        return loadedServers;
      }

      const selected = loadedServers.find((server) => server.id === activeServerRef.current) || loadedServers[0];

      if (selected.id !== activeServerRef.current) {
        activeServerRef.current = selected.id;
        setSelectedServer(selected.id);
      }

      const selectedChannelStillExists = selected.channels.some((channel) => channel.id === activeChannelRef.current);
      if (!selectedChannelStillExists) {
        const firstChannel = selected.channels.find((channel) => channel.type === "text") || selected.channels[0];
        if (firstChannel) {
          activeChannelRef.current = firstChannel.id;
          setSelectedChannel(firstChannel.id);
        }
      }

      return loadedServers;
    } catch (error) {
      console.error("Could not load servers:", error);
      return null;
    }
  };

  const saveHubHome = async (hubId: number, config: HubHomeConfig): Promise<void> => {
    if (!ownsSession()) throw new Error("This account session changed.");
    const response = await authorizedFetch(`${HTTP_URL}/api/servers/${hubId}/home`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    const data = (await response.json().catch(() => null)) as (Server & ApiError) | null;
    if (!ownsSession()) throw new Error("This account session changed.");
    if (!response.ok || !data) throw new Error(data?.error || "Could not save Hub Home.");
    const savedHome = normalizeHubHomeConfig(data.home ?? config);
    setServers((current) => current.map((server) => (server.id === hubId ? { ...server, home: savedHome } : server)));
  };

  const loadHubPreview = async (hubId: number, signal: AbortSignal): Promise<HubPreview> => {
    if (!ownsSession()) throw new Error("This account session changed.");
    const response = await authorizedFetch(`${HTTP_URL}/api/servers/${hubId}/preview`, { signal });
    const data: unknown = await response.json().catch(() => null);
    if (!ownsSession()) throw new Error("This account session changed.");
    if (!response.ok) throw new Error((data as ApiError | null)?.error || "Could not load this Hub.");
    const preview = parseHubPreview(data);
    if (!preview) throw new Error("This Hub preview could not be read.");
    return preview;
  };

  const loadDiscoverServers = async (): Promise<DiscoverServer[] | null> => {
    if (!authToken || !ownsSession()) return null;
    setDiscoverLoading(true);
    setDiscoverError("");

    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/servers/discover`);
      if (!ownsSession()) return null;
      const data: unknown = await response.json();
      if (!ownsSession()) return null;
      if (!response.ok) {
        const errorData = data as ApiError;
        setDiscoverError(errorData.error || "Could not load public hubs.");
        return null;
      }
      if (!Array.isArray(data)) {
        setDiscoverError("Invalid hub browser response.");
        return null;
      }
      const publicServers = data as DiscoverServer[];
      if (!commitForSession(sessionGuard, sessionSnapshot, publicServers, setDiscoverServers)) return null;
      return publicServers;
    } catch (error) {
      if (!ownsSession()) return null;
      console.error("Could not load public servers:", error);
      setDiscoverError("Could not connect to the hub browser.");
      return null;
    } finally {
      if (ownsSession()) setDiscoverLoading(false);
    }
  };

  return {
    loadServers,
    saveHubHome,
    loadHubPreview,
    loadDiscoverServers,
  };
}
