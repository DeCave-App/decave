import assert from "node:assert/strict";
import test from "node:test";
import { selectTurnServers } from "../acceptance/turn-test-config.mjs";

const servers = [
  { urls: "stun:stun.example.test:3478" },
  {
    username: "test-user",
    credential: "test-only",
    urls: [
      "turn:relay.example.test:3478?transport=udp",
      "turn:relay.example.test:3478?transport=tcp",
      "turns:relay.example.test:443?transport=tcp",
    ],
  },
];
for (const [transport, index] of [
  ["udp", 0],
  ["tcp", 1],
  ["tls", 2],
]) {
  test(`TURN ${transport} matrix cannot silently fall back to another transport`, () => {
    assert.deepEqual(selectTurnServers(servers, transport), [
      { username: "test-user", credential: "test-only", urls: [servers[1].urls[index]] },
    ]);
  });
}
test("TURN matrix rejects missing relay URLs, credentials and unknown transport", () => {
  assert.throws(() => selectTurnServers([{ urls: "stun:example.test" }], "udp"));
  assert.throws(() => selectTurnServers([{ urls: "turn:example.test?transport=udp" }], "udp"));
  assert.throws(() => selectTurnServers(servers, "anything"));
});
