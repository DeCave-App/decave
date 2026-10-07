import path from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--enforce-mfa")) throw new Error("Unsupported argument");
const accountId = "00000000000000000000000000000000";
const cli = path.resolve(import.meta.dirname, "../../node_modules/wrangler/bin/wrangler.js");
const authResult = spawnSync(process.execPath, [cli, "auth", "token", "--json"], {
  encoding: "utf8",
  windowsHide: true,
  timeout: 30000,
});
if (authResult.status !== 0) throw new Error("Existing Wrangler authentication unavailable");
const auth = JSON.parse(authResult.stdout);
if (!auth.token) throw new Error("Bearer authentication unavailable");
async function api(route, method = "GET", body) {
  const response = await fetch("https://api.cloudflare.com/client/v4" + route, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(20000),
    headers: { authorization: `Bearer ${auth.token}`, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await response.json();
  if (!response.ok || json.success !== true)
    throw new Error(
      `Cloudflare ${method} failed (HTTP ${response.status}, codes ${(json.errors || []).map((e) => e.code).join(",")}); response withheld`,
    );
  return json.result;
}
const account = await api(`/accounts/${accountId}`);
const user = await api("/user");
const members = await api(`/accounts/${accountId}/members`);
if (!Array.isArray(members)) throw new Error("Account membership data unavailable");
const soleCurrentAdmin =
  members.length === 1 &&
  members[0].status === "accepted" &&
  members[0].user?.id === user.id &&
  members[0].roles?.some((role) => role.name === "Super Administrator - All Privileges");
const report = {
  recordedAt: new Date().toISOString(),
  accountId,
  memberCount: members.length,
  roleNames: members.flatMap((member) => (member.roles || []).map((role) => role.name)),
  currentAdminMfaEnabled: user.two_factor_authentication_enabled === true,
  soleCurrentAdminVerified: Boolean(soleCurrentAdmin),
  mfaEnforcedBefore: account.settings?.enforce_twofactor === true,
  changed: false,
};
if (args.includes("--enforce-mfa") && !report.mfaEnforcedBefore) {
  if (!soleCurrentAdmin || !report.currentAdminMfaEnabled)
    throw new Error("MFA enforcement requires verified sole administrator with MFA already enabled");
  try {
    await api(`/accounts/${accountId}`, "PUT", {
      id: account.id,
      name: account.name,
      type: account.type,
      settings: { ...account.settings, enforce_twofactor: true },
    });
    report.changed = true;
  } catch (error) {
    report.changeError = error.message;
  }
}
const verified = await api(`/accounts/${accountId}`);
report.mfaEnforcedAfter = verified.settings?.enforce_twofactor === true;
report.accountIdentityPreserved =
  verified.id === account.id && verified.name === account.name && verified.type === account.type;
console.log(JSON.stringify(report, null, 2));
if (!report.mfaEnforcedAfter || !report.accountIdentityPreserved) process.exitCode = 2;
