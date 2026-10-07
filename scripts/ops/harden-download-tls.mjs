import path from "node:path";
import tls from "node:tls";
import { spawnSync } from "node:child_process";

const cli = path.resolve(import.meta.dirname, "../../node_modules/wrangler/bin/wrangler.js");
const result = spawnSync(process.execPath, [cli, "auth", "token", "--json"], {
  encoding: "utf8",
  windowsHide: true,
  timeout: 30000,
});
if (result.status !== 0) throw new Error("Existing Wrangler authentication unavailable");
const auth = JSON.parse(result.stdout);
if (!auth.token) throw new Error("Bearer authentication unavailable");
const endpoint =
  "https://api.cloudflare.com/client/v4/accounts/00000000000000000000000000000000/r2/buckets/example-decave-downloads/domains/custom/downloads.de-cave.com";
async function api(method = "GET", body) {
  const response = await fetch(endpoint, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(20000),
    headers: { authorization: `Bearer ${auth.token}`, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const value = await response.json();
  if (!response.ok || !value.success)
    throw new Error(`Download domain API failed (HTTP ${response.status}); response withheld`);
  return value.result;
}
function handshake(version) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: "downloads.de-cave.com",
      port: 443,
      servername: "downloads.de-cave.com",
      minVersion: version,
      maxVersion: version,
      rejectUnauthorized: true,
    });
    socket.setTimeout(15000, () => socket.destroy(new Error("TLS handshake timed out")));
    socket.once("error", reject);
    socket.once("secureConnect", () => {
      const protocol = socket.getProtocol();
      socket.end();
      resolve({ requested: version, negotiated: protocol, certificateAuthorized: socket.authorized });
    });
  });
}
const before = await api();
if (before.domain !== "downloads.de-cave.com" || before.enabled !== true)
  throw new Error("Expected active download domain not verified");
let changed = false;
if (["1.0", "1.1"].includes(before.minTLS ?? "1.0")) {
  await api("PUT", { enabled: before.enabled, minTLS: "1.2", ...(before.ciphers ? { ciphers: before.ciphers } : {}) });
  changed = true;
}
const after = await api();
if (after.domain !== before.domain || after.enabled !== before.enabled || !["1.2", "1.3"].includes(after.minTLS))
  throw new Error("Download TLS hardening did not verify");
const checks = [await handshake("TLSv1.2"), await handshake("TLSv1.3")];
console.log(
  JSON.stringify(
    {
      recordedAt: new Date().toISOString(),
      domain: after.domain,
      changed,
      minimumTlsBefore: before.minTLS ?? "1.0",
      minimumTlsAfter: after.minTLS,
      publicDownloadAccessPreserved: after.enabled === before.enabled,
      handshakes: checks,
    },
    null,
    2,
  ),
);
