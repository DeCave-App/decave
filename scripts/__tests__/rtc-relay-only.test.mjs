import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as webRelay from "../../src/voice/relay-policy.ts";
import * as mobileRelay from "../../mobile/src/lib/rtc-relay.ts";
import * as sharedRelay from "../../shared/rtc-relay.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const peerConnectionSites = [
  "src/voice/engine.ts",
  "src/components/DirectCallOverlay.tsx",
  "mobile/src/providers/VoiceProvider.tsx",
  "mobile/src/providers/DirectCallProvider.tsx",
  "src/voice/screen-sfu/sfu-session.ts",
];

function sourceFiles(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const file = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(file);
    return /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [file] : [];
  });
}

test("every RTCPeerConnection in the clients is created relay-only", () => {
  const found = [...sourceFiles("src"), ...sourceFiles("mobile/src")]
    .filter((file) => /new RTCPeerConnection\(/.test(read(file)))
    .sort();
  assert.deepEqual(found, [...peerConnectionSites].sort(), "a new peer connection site must be added here");
  for (const file of peerConnectionSites) {
    const source = read(file);
    const constructions = [...source.matchAll(/new RTCPeerConnection\(\{([\s\S]*?)\}(?: as any)?\);/g)];
    assert.ok(constructions.length > 0, `${file} builds its peer connection from an inline config`);
    for (const [, config] of constructions) {
      assert.match(config, /iceTransportPolicy: "relay"/, `${file} must force relay-only ICE`);
    }
  }
});

test("clients drop the STUN-only fallback and refuse to connect without TURN", () => {
  for (const file of peerConnectionSites) {
    const source = read(file);
    assert.doesNotMatch(source, /stun:stun\.cloudflare\.com/, `${file} must not fall back to STUN`);
    assert.match(
      source,
      file.startsWith("mobile/") ? /hasRelayIceServer\(/ : /hasUsableRelayIceServers\(/,
      `${file} must validate the configured relay servers`,
    );
    assert.match(source, /RELAY_UNAVAILABLE_MESSAGE/, `${file} must surface the relay-unavailable error`);
    assert.match(source, /isRelayIceCandidate\(/, `${file} must filter ICE candidates`);
  }
  const engine = read("src/voice/engine.ts");
  assert.match(engine, /if \(!hasUsableRelayIceServers\(iceServersRef\.current\)\)/);
  assert.match(
    engine,
    /if \(!hasUsableRelayIceServers\(servers\)\) throw new Error\(VOICE_RELAY_UNAVAILABLE_MESSAGE\)/,
  );
  assert.match(engine, /if \(!event\.candidate \|\| !isRelayIceCandidate\(event\.candidate\)\) return;/);
  assert.match(engine, /if \(!isRelayIceCandidate\(candidate\)\) return;/);

  const directCall = read("src/components/DirectCallOverlay.tsx");
  assert.match(
    directCall,
    /if \(!hasUsableRelayIceServers\(iceRef\.current\)\) throw new Error\(CALL_RELAY_UNAVAILABLE_MESSAGE\)/,
  );
  assert.match(directCall, /iceTransportPolicy: "relay"/);

  for (const file of ["mobile/src/providers/VoiceProvider.tsx", "mobile/src/providers/DirectCallProvider.tsx"]) {
    assert.match(read(file), /if \(!hasRelayIceServer\(/, `${file} must refuse a TURN-less configuration`);
  }
});

test("web relay availability requires authenticated TURN credentials", () => {
  assert.equal(sharedRelay.hasUsableRelayIceServers(undefined), false);
  assert.equal(sharedRelay.hasUsableRelayIceServers([]), false);
  assert.equal(sharedRelay.hasUsableRelayIceServers([{ urls: "stun:stun.example:3478" }]), false);
  assert.equal(sharedRelay.hasUsableRelayIceServers([{ urls: "turn:relay.example:3478" }]), false);
  assert.equal(
    sharedRelay.hasUsableRelayIceServers([
      { urls: "turn:relay.example:3478", username: "user" },
      { urls: "turn:relay.example:3478", credential: "secret" },
    ]),
    false,
  );
  assert.equal(
    sharedRelay.hasUsableRelayIceServers([
      { urls: "stun:stun.example:3478" },
      { urls: ["turns:relay.example:5349?transport=tcp"], username: "user", credential: "secret" },
    ]),
    true,
  );
});

for (const [name, relay] of [
  ["web", webRelay],
  ["mobile", mobileRelay],
]) {
  test(`${name} relay policy detects TURN servers`, () => {
    assert.equal(relay.RELAY_ICE_TRANSPORT_POLICY, "relay");
    assert.equal(relay.hasRelayIceServer([{ urls: "stun:stun.cloudflare.com:3478" }]), false);
    assert.equal(relay.hasRelayIceServer([{ urls: ["stun:a.test:3478", "stun:b.test:53"] }]), false);
    assert.equal(relay.hasRelayIceServer([]), false);
    assert.equal(relay.hasRelayIceServer(undefined), false);
    assert.equal(relay.hasRelayIceServer([{ urls: ["stun:a.test", "turn:a.test:3478?transport=udp"] }]), true);
    assert.equal(relay.hasRelayIceServer([{ urls: "turns:a.test:5349?transport=tcp" }]), true);
    assert.equal(relay.hasRelayIceServer([{ urls: "TURN:a.test:3478" }]), true);
    assert.equal(relay.RELAY_UNAVAILABLE_MESSAGE, "Voice relay is unavailable right now. Try again in a moment.");
  });

  test(`${name} relay policy only passes relay candidates and end-of-candidates`, () => {
    const relayCandidate =
      "candidate:1 1 udp 41885439 203.0.113.9 50000 typ relay raddr 0.0.0.0 rport 0 generation 0 ufrag x";
    assert.equal(relay.isRelayIceCandidate({ candidate: relayCandidate, sdpMid: "0" }), true);
    assert.equal(relay.isRelayIceCandidate(relayCandidate), true);
    assert.equal(relay.isRelayIceCandidate("candidate:1 1 udp 1 203.0.113.9 50000 typ relay"), true);
    assert.equal(
      relay.isRelayIceCandidate({ candidate: "candidate:1 1 udp 2122260223 192.168.1.4 5000 typ host" }),
      false,
    );
    assert.equal(
      relay.isRelayIceCandidate({
        candidate: "candidate:2 1 udp 1686052607 198.51.100.7 6000 typ srflx raddr 192.168.1.4 rport 5000",
      }),
      false,
    );
    assert.equal(relay.isRelayIceCandidate({ candidate: "candidate:3 1 udp 1 x.local 5000 typ prflx" }), false);
    assert.equal(relay.isRelayIceCandidate({ candidate: "candidate:4 1 udp 1 1.2.3.4 5 typ relayish" }), false);
    assert.equal(relay.isRelayIceCandidate(null), true);
    assert.equal(relay.isRelayIceCandidate(undefined), true);
    assert.equal(relay.isRelayIceCandidate({ candidate: "" }), true);
  });
}

test("mobile relay policy mirrors the web policy", () => {
  const strip = (source) => source.replace(/\r\n/g, "\n").replace(/^\/\/.*\n/gm, "");
  assert.equal(strip(read("mobile/src/lib/rtc-relay.ts")), strip(read("src/voice/relay-policy.ts")));
});
