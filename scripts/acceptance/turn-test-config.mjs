import fs from "node:fs/promises";
import assert from "node:assert/strict";

export function selectTurnServers(iceServers, transport) {
  assert.ok(["udp", "tcp", "tls"].includes(transport), "TURN test transport must be udp, tcp or tls");
  assert.ok(Array.isArray(iceServers), "Missing ICE server list");
  const selected = [];
  for (const server of iceServers) {
    const urls = (Array.isArray(server.urls) ? server.urls : [server.urls]).filter(
      (url) =>
        typeof url === "string" &&
        (transport === "tls"
          ? url.startsWith("turns:")
          : url.startsWith("turn:") && url.includes(`transport=${transport}`)),
    );
    if (!urls.length) continue;
    assert.ok(
      typeof server.username === "string" &&
        server.username.length > 0 &&
        typeof server.credential === "string" &&
        server.credential.length > 0,
      "TURN test requires username/password credentials",
    );
    selected.push({ urls, username: server.username, credential: server.credential });
  }
  assert.ok(selected.length > 0, `No TURN URLs available for ${transport}`);
  return selected;
}

export async function loadTurnTestConfig(file, transport = "udp") {
  const raw = await fs.readFile(file, "utf8");
  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    config = Object.fromEntries(
      raw
        .split(/\r?\n/)
        .filter((line) => /^CLOUDFLARE_TURN_(KEY_ID|API_TOKEN)=/.test(line.trim()))
        .map((line) => {
          const i = line.indexOf("=");
          return [
            line.slice(0, i).trim(),
            line
              .slice(i + 1)
              .trim()
              .replace(/^(['"])(.*)\1$/, "$2"),
          ];
        }),
    );
  }
  let iceServers = config.iceServers;
  if (!iceServers) {
    const keyId = config.CLOUDFLARE_TURN_KEY_ID,
      apiToken = config.CLOUDFLARE_TURN_API_TOKEN;
    assert.ok(
      typeof keyId === "string" && keyId.length > 0 && typeof apiToken === "string" && apiToken.length > 0,
      "Missing Cloudflare TURN key ID/API token",
    );
    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
        body: JSON.stringify({ ttl: 3600 }),
        signal: AbortSignal.timeout(20000),
      },
    );
    assert.equal(
      response.status,
      201,
      `Cloudflare TURN credential issuance failed (HTTP ${response.status}); response withheld`,
    );
    iceServers = (await response.json()).iceServers;
  }
  return {
    iceServers: selectTurnServers(iceServers, transport),
    iceTransportPolicy: "relay",
    turnTestTransport: transport,
  };
}
