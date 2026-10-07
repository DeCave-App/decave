import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "../..");
const wrangler = path.join(root, "node_modules/wrangler/bin/wrangler.js");
const config = path.join(root, "wrangler.jsonc");
function readRemote(args) {
  const result = spawnSync(process.execPath, [wrangler, ...args, "--config", config, "--json"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error("Read-only production metadata query failed; raw provider output withheld.");
  return JSON.parse(result.stdout);
}

const deployments = readRemote(["deployments", "list", "--name", "decave"]);
if (!Array.isArray(deployments) || !deployments.length) throw new Error("No production deployment metadata.");
deployments.sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on));
const active = deployments[0];
const versions = [];
for (const selected of active.versions ?? []) {
  if (!(selected.percentage > 0)) continue;
  const version = readRemote(["versions", "view", selected.version_id, "--name", "decave"]);
  const bindings = version.resources?.bindings;
  if (!Array.isArray(bindings)) throw new Error("Production binding metadata unavailable.");
  const binding = (name) => bindings.find((item) => item.name === name);
  versions.push({
    versionId: selected.version_id,
    percentage: selected.percentage,
    databaseBindingMatches:
      binding("DB")?.type === "d1" && binding("DB")?.id === "00000000-0000-0000-0000-000000000000",
    mediaBindingMatches: binding("MEDIA")?.bucket_name === "example-decave-media",
    downloadsBindingMatches: binding("decave_downloads")?.bucket_name === "example-decave-downloads",
    turnKeySecretPresent: binding("CLOUDFLARE_TURN_KEY_ID")?.type === "secret_text",
    turnTokenSecretPresent: binding("CLOUDFLARE_TURN_API_TOKEN")?.type === "secret_text",
    sourceEtag: version.resources?.script?.etag ?? null,
  });
}
const publicChecks = [];
for (const [route, expectedStatus] of [
  ["/api/health", 200],
  ["/api/auth/config", 200],
  ["/api/rtc/ice-servers", 401],
]) {
  const response = await fetch(`https://app.de-cave.com${route}`, {
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  await response.arrayBuffer();
  publicChecks.push({ route, status: response.status, pass: response.status === expectedStatus });
}
const report = {
  recordedAt: new Date().toISOString(),
  readOnly: true,
  worker: "decave",
  deploymentId: active.id,
  deployedAt: active.created_on,
  versions,
  publicChecks,
  turnCredentialValidityTested: false,
  productionCustomerContentRead: false,
  productionMutations: false,
};
report.configurationReady =
  versions.length > 0 &&
  versions.every(
    (version) =>
      version.databaseBindingMatches &&
      version.mediaBindingMatches &&
      version.downloadsBindingMatches &&
      version.turnKeySecretPresent &&
      version.turnTokenSecretPresent,
  ) &&
  publicChecks.every((check) => check.pass);
console.log(JSON.stringify(report, null, 2));
if (!report.configurationReady) process.exitCode = 2;
