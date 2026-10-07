/**
 * Small, side effect free guards shared by the desktop voice and realtime
 * paths.  Keeping these decisions outside App makes the asynchronous edges
 * easy to exercise without constructing a browser/WebRTC runtime.
 */

// Microphone setup and ICE configuration before VOICE_JOIN can legitimately take
// longer than a socket round trip. Keep this separate from the post-send
// acknowledgement guard so a slow pre-join does not fail while the worker restarts.
export const DESKTOP_VOICE_PRE_JOIN_DEADLINE_MS = 60_000;
export const DESKTOP_VOICE_JOIN_TIMEOUT_MS = 20_000;

export type ReliabilityChannel = {
  id: number;
  type: string;
};

export type ReliabilityServer = {
  id: number;
  channels: ReliabilityChannel[];
};

export function isCurrentGeneration(generation: number, currentGeneration: number): boolean {
  return generation === currentGeneration;
}

export function isCurrentChannelLoad(
  requestedChannelId: number,
  activeChannelId: number,
  generation: number,
  currentGeneration: number,
): boolean {
  return requestedChannelId === activeChannelId && isCurrentGeneration(generation, currentGeneration);
}

/**
 * Select a usable channel after a realtime CHANNEL_DELETED notification.
 * The server response is the source of truth; the fallback id is only used
 * when it still belongs to that server and is not the deleted room.
 */
export function resolveDeletedChannel(
  servers: ReliabilityServer[],
  serverId: number,
  deletedChannelId: number,
  fallbackChannelId: number,
): { server: ReliabilityServer; channel: ReliabilityChannel } | null {
  const server =
    servers.find((item) => item.id === serverId) ??
    servers.find((item) => item.channels.some((channel) => channel.id === fallbackChannelId));
  if (!server) return null;

  const fallback = server.channels.find(
    (channel) => channel.id === fallbackChannelId && channel.id !== deletedChannelId,
  );
  const firstText = server.channels.find((channel) => channel.id !== deletedChannelId && channel.type === "text");
  const firstAvailable = server.channels.find((channel) => channel.id !== deletedChannelId);
  const channel = fallback ?? firstText ?? firstAvailable;
  return channel ? { server, channel } : null;
}

export function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.message === "The operation was cancelled.");
}
