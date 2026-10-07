import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const publicationDocuments = [
  ["docs/legal/PRIVACY-POLICY.md", "privacy policy", 1],
  ["docs/legal/TERMS-OF-SERVICE.md", "terms of service", 1],
  ["website/src/main.tsx", "published website policy pages", 2],
];

const unresolvedPlaceholders = /\[(?:LEGAL ENTITY NAME|CONTROLLER(?:\/CONTRACTING)? ADDRESS|GOVERNING LAW AND COURTS|INSERT CAP AMOUNT|INSERT AFTER LEGAL REVIEW)\]/;
const approvedStatusLine = /^[ \t]*(?:\/\/\s*)?Publication status:\s*Approved for publication\s*$/gim;

export function getPublicationReadinessIssues({ env = process.env, read = fs.readFileSync, documents } = {}) {
  const required = [
    ["DECAVE_LEGAL_ENTITY_NAME", "legal entity name"],
    ["DECAVE_CONTROLLER_ADDRESS", "controller address"],
    ["DECAVE_SERVICE_COUNTRIES", "countries where the service will be offered"],
    ["DECAVE_PUBLICATION_APPROVED", "explicit publication approval (set to true after review)"],
  ];
  const issues = required
    .filter(([key]) => typeof env[key] !== "string" || !env[key].trim() || (key === "DECAVE_PUBLICATION_APPROVED" && env[key].trim().toLowerCase() !== "true"))
    .map(([, label]) => `Set ${label}.`);
  const content = [];
  for (const [relativePath, label, requiredStatusCount] of publicationDocuments) {
    const file = path.join(repositoryRoot, relativePath);
    let source;
    try {
      source = documents?.[relativePath] ?? read(file, "utf8");
    } catch {
      issues.push(`Required publication document is missing: ${relativePath}.`);
      continue;
    }
    content.push(source);
    const approvedStatusCount = [...source.matchAll(approvedStatusLine)].length;
    approvedStatusLine.lastIndex = 0;
    if (approvedStatusCount < requiredStatusCount) {
      issues.push(`${label} (${relativePath}) must have ${requiredStatusCount} explicit Approved for publication status line${requiredStatusCount === 1 ? "" : "s"}.`);
    }
    if (unresolvedPlaceholders.test(source)) {
      issues.push(`${relativePath} still contains an unresolved publication placeholder.`);
    }
  }
  const combined = content.join("\n");
  for (const key of ["DECAVE_LEGAL_ENTITY_NAME", "DECAVE_CONTROLLER_ADDRESS", "DECAVE_SERVICE_COUNTRIES"]) {
    const value = env[key]?.trim();
    if (value && !combined.includes(value)) issues.push(`${key} must match the approved policy text.`);
  }
  return [...new Set(issues)];
}

// Advisory for now: missing legal/publication details are reported but do not block builds or releases.
// Set DECAVE_ENFORCE_PUBLICATION_GATE=true to make them fail again.
export function assertPublicationReady(options) {
  const issues = getPublicationReadinessIssues(options);
  if (!issues.length) return;
  const list = `\n- ${issues.join("\n- ")}`;
  const env = options?.env ?? process.env;
  if (env.DECAVE_ENFORCE_PUBLICATION_GATE?.trim().toLowerCase() === "true") {
    throw new Error(`Publication is blocked until its legal and privacy details are complete:${list}`);
  }
  console.warn(`Publication readiness (advisory, not blocking):${list}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    assertPublicationReady();
    if (!getPublicationReadinessIssues().length) console.log("Publication readiness passed.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
