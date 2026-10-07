export async function candidateEndpointFingerprint(candidate) {
  const address = candidate?.address ?? candidate?.ip;
  const port = candidate?.port;
  if (typeof address !== "string" || !Number.isInteger(port)) return null;
  const input = new TextEncoder().encode(`${address}|${port}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export function summarizeIceRelayEvidence(localObservation, peerObservation) {
  const localRelay = localObservation?.local?.type === "relay";
  const peerLocalRelay = peerObservation?.local?.type === "relay";
  const remoteMatchesPeerLocalRelay = Boolean(
    localObservation?.remote?.endpointFingerprint &&
    peerObservation?.local?.endpointFingerprint &&
    localObservation.remote.endpointFingerprint === peerObservation.local.endpointFingerprint,
  );
  const peerRemoteMatchesLocalRelay = Boolean(
    peerObservation?.remote?.endpointFingerprint &&
    localObservation?.local?.endpointFingerprint &&
    peerObservation.remote.endpointFingerprint === localObservation.local.endpointFingerprint,
  );
  return {
    localRelay,
    peerLocalRelay,
    localRelayProtocolIsTls: localObservation?.local?.relayProtocol === "tls",
    peerLocalRelayProtocolIsTls: peerObservation?.local?.relayProtocol === "tls",
    remoteMatchesPeerLocalRelay,
    peerRemoteMatchesLocalRelay,
    bothLocalRelay: localRelay && peerLocalRelay,
    bothRemoteEndpointsMatch: remoteMatchesPeerLocalRelay && peerRemoteMatchesLocalRelay,
  };
}
