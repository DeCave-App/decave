import process from "node:process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const { normalizePublisherDn } = require("../../electron/windows-update-trust.cjs");

export function getWindowsSigningReadinessIssues(env = process.env) {
  const issues = [];
  if (!normalizePublisherDn(env.DECAVE_WINDOWS_PUBLISHER)) {
    issues.push("Set DECAVE_WINDOWS_PUBLISHER to the exact full certificate subject DN (including CN and organization). CN-only trust is rejected.");
  }
  if (![env.WIN_CSC_LINK, env.CSC_LINK, env.WIN_CSC_NAME, env.CSC_NAME].some((value) => typeof value === "string" && value.trim())) {
    issues.push("Configure a Windows signing certificate through WIN_CSC_LINK/CSC_LINK or an installed certificate through WIN_CSC_NAME/CSC_NAME.");
  }
  return issues;
}

// Advisory for now: missing signing configuration warns and the build continues unsigned.
// Set DECAVE_ENFORCE_WINDOWS_SIGNING=true to make it fail again. Returns true when signing is configured.
export function assertWindowsSigningReady(env = process.env) {
  const issues = getWindowsSigningReadinessIssues(env);
  if (!issues.length) return true;
  const list = `\n- ${issues.join("\n- ")}`;
  if (env.DECAVE_ENFORCE_WINDOWS_SIGNING?.trim().toLowerCase() === "true") {
    throw new Error(`Windows release build is blocked:${list}`);
  }
  console.warn(`Windows signing is not configured (advisory, building unsigned):${list}`);
  return false;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (assertWindowsSigningReady()) console.log("Windows signing configuration is present.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
