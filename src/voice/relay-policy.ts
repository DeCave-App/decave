// Relay-only WebRTC policy shared by channel voice and direct calls.
//
// Every peer connection is forced through TURN (`iceTransportPolicy: "relay"`)
// so peers never learn each other's IP addresses. There is deliberately no
// peer-to-peer fallback: a STUN-only server list cannot produce a relay path,
// so callers must refuse to connect and surface RELAY_UNAVAILABLE_MESSAGE.

type IceServerLike = { urls?: string | string[] | null };
type IceCandidateLike = { candidate?: string | null } | string | null | undefined;

export const RELAY_ICE_TRANSPORT_POLICY = "relay" as const;

export const RELAY_UNAVAILABLE_MESSAGE = "Voice relay is unavailable right now. Try again in a moment.";

const iceServerUrls = (server: IceServerLike): string[] => {
  const urls = server?.urls;
  if (typeof urls === "string") return [urls];
  return Array.isArray(urls) ? urls.filter((url): url is string => typeof url === "string") : [];
};

/** True when at least one server offers a TURN (`turn:`/`turns:`) URL. */
export function hasRelayIceServer(servers: readonly IceServerLike[] | null | undefined): boolean {
  if (!Array.isArray(servers)) return false;
  return servers.some((server) => iceServerUrls(server).some((url) => /^turns?:/i.test(url.trim())));
}

/**
 * Defense in depth on top of the relay transport policy: only relay candidates
 * may be sent or applied. The end-of-candidates marker (null or an empty
 * candidate string) is allowed through so ICE gathering can complete.
 */
export function isRelayIceCandidate(candidate: IceCandidateLike): boolean {
  if (candidate === null || candidate === undefined) return true;
  const value = typeof candidate === "string" ? candidate : candidate.candidate;
  if (value === null || value === undefined || value === "") return true;
  return / typ relay(?:\s|$)/.test(value);
}
