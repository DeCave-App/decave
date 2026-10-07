import assert from "node:assert/strict";
import { summarizeIceRelayEvidence } from "../acceptance/rtc-ice-evidence.mjs";

const relay = (fingerprint, relayProtocol = "tls") => ({
  type: "relay",
  protocol: "udp",
  relayProtocol,
  endpointFingerprint: fingerprint,
});
const remote = (fingerprint, type = "prflx") => ({ type, protocol: "udp", endpointFingerprint: fingerprint });

assert.deepEqual(
  summarizeIceRelayEvidence({ local: relay("a"), remote: remote("b") }, { local: relay("b"), remote: remote("a") }),
  {
    localRelay: true,
    peerLocalRelay: true,
    localRelayProtocolIsTls: true,
    peerLocalRelayProtocolIsTls: true,
    remoteMatchesPeerLocalRelay: true,
    peerRemoteMatchesLocalRelay: true,
    bothLocalRelay: true,
    bothRemoteEndpointsMatch: true,
  },
);

const mismatch = summarizeIceRelayEvidence(
  { local: relay("a"), remote: remote("wrong") },
  { local: relay("b"), remote: remote("a") },
);
assert.equal(mismatch.bothLocalRelay, true);
assert.equal(mismatch.remoteMatchesPeerLocalRelay, false);
assert.equal(mismatch.bothRemoteEndpointsMatch, false);

const directFallback = summarizeIceRelayEvidence(
  { local: { ...relay("a"), type: "host", relayProtocol: undefined }, remote: remote("b") },
  { local: relay("b"), remote: remote("a") },
);
assert.equal(directFallback.localRelay, false);
assert.equal(directFallback.bothLocalRelay, false);
assert.equal(directFallback.bothRemoteEndpointsMatch, true);

console.log(
  JSON.stringify({ pass: true, cases: ["matching relay/prflx", "mismatched remote endpoint", "direct fallback"] }),
);
