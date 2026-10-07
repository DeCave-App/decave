#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const productionSourceValues = {
  accountId: "00000000000000000000000000000000",
  appleTeamId: "EXAMPLE000",
  databaseId: "00000000-0000-0000-0000-000000000000",
  databaseName: "decave-review-example",
  easProjectId: "00000000-0000-0000-0000-000000000000",
  authRateLimitId: "0",
  recoveryRateLimitId: "0",
};
const infrastructurePlaceholders = [
  [productionSourceValues.accountId, "00000000000000000000000000000000"],
  [productionSourceValues.appleTeamId, "EXAMPLE000"],
  [productionSourceValues.databaseId, "00000000-0000-0000-0000-000000000000"],
  [productionSourceValues.databaseName, "decave-review-example"],
  [productionSourceValues.easProjectId, "00000000-0000-0000-0000-000000000000"],
  [productionSourceValues.authRateLimitId, "0"],
  [productionSourceValues.recoveryRateLimitId, "0"],
  ["example-decave-media", "example-example-decave-media"],
  ["example-decave-downloads", "example-example-decave-downloads"],
  ["example.decave.broadcast", "example.decave.broadcast"],
  ["group.com.example.decave", "group.com.example.decave"],
  ["com.example.decave", "com.example.decave"],
  ["example-owner", "example-owner"],
  ["security@example.invalid", "security@example.invalid"],
];
const textExtensions = new Set([
  ".cjs", ".css", ".html", ".js", ".json", ".jsonc", ".md", ".mjs", ".podspec", ".ps1", ".py", ".scss",
  ".sh", ".sql", ".swift", ".toml", ".ts", ".tsx", ".txt", ".xml", ".yaml", ".yml",
]);
const sourceTemplates = new Map([
  [
    "src/audio/clearvoice/ClearVoiceAiRuntime.ts",
    "scripts/release/templates/ClearVoiceAiRuntime.model-free.ts",
  ],
  [
    "scripts/__tests__/clearvoice-stft.test.mjs",
    "scripts/release/templates/clearvoice-stft.model-free.test.mjs",
  ],
]);

const sourceTextTransforms = new Map([
  ["docs/release/PUBLICATION-READINESS.md", (contents) => {
    const privateStatus = "The source-review repository exists at `https://github.com/DeCave-App/decave` and is currently private.";
    if (!contents.includes(privateStatus)) {
      if (contents.includes("The source-review repository is at `https://github.com/DeCave-App/decave`.")) return contents;
      throw new Error("Expected the source-review repository status in PUBLICATION-READINESS.md for export sanitization.");
    }
    return contents.replace(privateStatus, "The source-review repository is at `https://github.com/DeCave-App/decave`.");
  }],
  ["README.md", (contents) => {
    const cloudflareSection = /## Cloudflare development setup\r?\n[\s\S]*?(?=## Contributing\r?\n)/;
    if (!cloudflareSection.test(contents)) {
      throw new Error("Expected the Cloudflare development setup section in README.md for export sanitization.");
    }
    return contents.replace(
      cloudflareSection,
      [
        "## Cloudflare development setup",
        "",
        "The exported `wrangler.jsonc` uses example hostnames and placeholder Cloudflare resource identifiers. It is not connected to the maintainer's services. Before deploying, configure your own isolated D1, R2, rate limit, email, and domain resources in a local Wrangler config. Keep development data separate from production data.",
        "",
        "To run the Worker locally, create an untracked `wrangler.local.jsonc` with your own local resources, then apply migrations and start Wrangler:",
        "",
        "```sh",
        "npx wrangler d1 migrations apply YOUR_D1_DATABASE --local --config wrangler.local.jsonc",
        "npx wrangler dev --config wrangler.local.jsonc --ip 127.0.0.1 --port 8787",
        "```",
        "",
        "In a second terminal, `npm run dev` starts Vite; its `/api` and `/ws` requests proxy to the local Worker at `127.0.0.1:8787`. The repository does not include a ready-made local Cloudflare resource configuration.",
        "",
      ].join("\n"),
    );
  }],
  ["package.json", (contents) => {
    const productionDatabaseName = `wrangler d1 migrations apply ${productionSourceValues.databaseName} --`;
    const count = contents.split(productionDatabaseName).length - 1;
    if (count !== 2) {
      if (contents.includes('"cf:migrate:local": "wrangler d1 migrations apply decave-review-example --local"')) return contents;
      throw new Error("Expected local and remote D1 scripts to reference the source D1 name in package.json for export sanitization.");
    }
    return contents.replaceAll(productionSourceValues.databaseName, "decave-review-example");
  }],
  ["wrangler.jsonc", (contents) => {
    const replacements = [
      [/"pattern": "app\.de-cave\.com"/g, '"pattern": "app.example.invalid"'],
      [exactTextPattern(`"database_name": "${productionSourceValues.databaseName}"`), '"database_name": "decave-review-example"'],
      [exactTextPattern(`"database_id": "${productionSourceValues.databaseId}"`), '"database_id": "00000000-0000-0000-0000-000000000000"'],
      [/"bucket_name": "example-decave-media"/g, '"bucket_name": "example-example-decave-media"'],
      [/"bucket_name": "example-decave-downloads"/g, '"bucket_name": "example-example-decave-downloads"'],
      [/"allowed_sender_addresses": \["security@de-cave\.com"\]/g, '"allowed_sender_addresses": ["security@example.invalid"]'],
      [exactTextPattern(`"namespace_id": "${productionSourceValues.authRateLimitId}"`), '"namespace_id": "0"'],
      [exactTextPattern(`"namespace_id": "${productionSourceValues.recoveryRateLimitId}"`), '"namespace_id": "0"'],
      [/"remote": true/g, '"remote": false'],
    ];
    for (const [pattern, replacement] of replacements) {
      if (!pattern.test(contents)) {
        if (contents.includes(replacement.split(": ")[0]) && contents.includes(replacement.slice(replacement.indexOf(": ") + 2))) continue;
        throw new Error(`Expected production infrastructure setting in wrangler.jsonc for export sanitization: ${pattern}`);
      }
      contents = contents.replace(pattern, replacement);
    }
    return `// Source review example only. Replace example.invalid hosts and placeholder resource IDs before deployment.\n${contents}`;
  }],
  ["mobile/app.json", (contents) => {
    const replacements = [
      [/"bundleIdentifier": "com\.decave\.mobile"/g, '"bundleIdentifier": "com.example.decave"'],
      [/"group\.com\.decave\.mobile"/g, '"group.com.example.decave"'],
      [/"RTCScreenSharingExtension": "com\.decave\.mobile\.broadcast"/g, '"RTCScreenSharingExtension": "com.example.decave.broadcast"'],
      [/"package": "com\.decave\.mobile"/g, '"package": "com.example.decave"'],
      [/"applinks:app\.de-cave\.com"/g, '"applinks:app.example.invalid"'],
      [exactTextPattern(`"appleTeamId": "${productionSourceValues.appleTeamId}"`), '"appleTeamId": "EXAMPLE000"'],
      [/"apiBaseUrl": "https:\/\/app\.de-cave\.com"/g, '"apiBaseUrl": "https://api.example.invalid"'],
      [exactTextPattern(`"projectId": "${productionSourceValues.easProjectId}"`), '"projectId": "00000000-0000-0000-0000-000000000000"'],
      [/"owner": "example-owner"/g, '"owner": "example-owner"'],
    ];
    for (const [pattern, replacement] of replacements) {
      if (!pattern.test(contents)) {
        if (contents.includes(replacement.slice(replacement.indexOf(": ") + 2, replacement.lastIndexOf('"')))) continue;
        throw new Error(`Expected production mobile setting in mobile/app.json for export sanitization: ${pattern}`);
      }
      contents = contents.replace(pattern, replacement);
    }
    return contents;
  }],
  ["mobile/README.md", (contents) => {
    let replacements = 0;
    const sanitized = contents.replace(
      /^cd C:\\Users\\[^\\\r\n]+\\Desktop\\gamerchat(\\mobile)?$/gm,
      (_match, mobilePath) => {
        replacements += 1;
        return mobilePath ? "cd mobile" : "cd .";
      },
    );
    if (replacements !== 2) {
      throw new Error("Expected two local checkout paths in mobile/README.md for export sanitization.");
    }
    return sanitized;
  }],
  ["scripts/acceptance/home-navigation-acceptance.mjs", (contents) => {
    const localPlaywrightImport =
      /const \{ chromium \} = await import\(\s*pathToFileURL\(\s*"C:\/Users\/[^/]+\/\.cache\/codex-runtimes\/codex-primary-runtime\/dependencies\/node\/node_modules\/playwright\/index\.mjs",\s*\)\.href\s*\);/;
    if (!localPlaywrightImport.test(contents)) {
      throw new Error("Expected the local Playwright import in the acceptance script for export sanitization.");
    }
    return contents.replace(
      localPlaywrightImport,
      [
        "const playwrightModulePath = process.env.PLAYWRIGHT_MODULE_PATH;",
        "if (!playwrightModulePath) {",
        '  throw new Error("Set PLAYWRIGHT_MODULE_PATH to a local Playwright ESM entry point.");',
        "}",
        "const { chromium } = await import(pathToFileURL(playwrightModulePath).href);",
      ].join("\n"),
    );
  }],
]);

const fixedExclusions = [
  /^(?!\.(?:github|githooks)(?:\/|$)|\.(?:editorconfig|gitignore|prettierignore|prettierrc(?:\.json)?|gitleaks\.toml)$)\.[^/]+(?:\/|$)/i,
  /^decave(?:\/|$)/i,
  /^docs\/design(?:\/|$)/i,
  /^docs\/operations(?:\/|$)/i,
  /^docs\/history(?:\/|$)/i,
  /^docs\/release\/open-source-audit\.md$/i,
  /^docs\/legal\/compliance\/[^/]+\.(?:docx|xlsx)$/i,
  /^docs\/redesign-[^/]+\/(?:audit|smoke-test-findings|visual-qa)\.md$/i,
  /^marketing(?:\/|$)/i,
  /^website\/public\/screens(?:\/|$)/i,
  /^src\/audio\/clearvoice\/legacy-onnxruntime(?:\/|$)/i,
  /^\.tmp(?:\/|$)/i,
  /^\.tmp-[^/]+(?:\/|$)/i,
  /^evidence(?:\/|$)/i,
  /^\.audit-input(?:\/|$)/i,
  /^backups(?:\/|$)/i,
  /^experiments(?:\/|$)/i,
  /^release(?:\/|$)/i,
];

const ignoredSecretBasenames = new Set([
  ".env",
  ".dev.vars",
  "credentials.json",
  "secrets.json",
  "service-account.json",
  "serviceaccountkey.json",
  "firebase-service-account.json",
  "google-services.json",
  "google-services.json5",
  "google-services.xml",
  "google-service-info.plist",
  "key.properties",
  "local.properties",
  ".dev-test-account.txt",
  ".local-test-accounts.json",
]);

const secretExtensions = new Set([
  ".pfx",
  ".p12",
  ".pem",
  ".key",
  ".jks",
  ".keystore",
  ".p8",
  ".mobileprovision",
  ".cer",
  ".crt",
  ".dump",
  ".sqlite",
  ".sqlite3",
  ".db",
  ".wav",
]);

const rasterExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const brandAssetPrefixes = [
  "mobile/assets/",
  "mobile/targets/widget/Assets.xcassets/AppIcon.appiconset/",
  "src/assets/decave-mark-512.png",
  "src/assets/decave-mark-reference.png",
  "website/public/brand/",
];

function parseArguments(argv) {
  let destination;
  let dryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--destination" && argv[index + 1]) {
      destination = argv[++index];
    } else if (argument === "--dry-run") {
      dryRun = true;
    } else if (argument === "--help" || argument === "-h") {
      return { help: true };
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }
  if (!destination) throw new Error("Pass a new destination with --destination <path>.");
  return { destination, dryRun };
}

function printHelp() {
  process.stdout.write(
    [
      "Export a filtered source-visible snapshot without Git metadata or ignored files.",
      "",
      "Usage:",
      "  node scripts/release/export-open-source.mjs --destination <new-path> [--dry-run]",
      "",
      "A dry run lists included paths and counts without reading or printing file contents.",
      "An existing destination is always refused.",
      "",
    ].join("\n"),
  );
}

function isPathInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function pathExists(target) {
  try {
    lstatSync(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false;
    throw error;
  }
}

function assertNoSymlinkAncestors(destination) {
  let current = destination;
  while (true) {
    if (pathExists(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`Destination path contains a symbolic link; refusing to follow it: ${current}`);
    }
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function assertSafeDestination(destination) {
  if (pathExists(destination)) throw new Error(`Destination already exists; refusing to overwrite it: ${destination}`);

  const sourceRoot = path.resolve(repositoryRoot);
  assertNoSymlinkAncestors(destination);
  const effectiveDestination = path.resolve(destination);
  if (isPathInside(effectiveDestination, sourceRoot)) {
    throw new Error("Destination cannot be an ancestor of the source checkout.");
  }
  if (isPathInside(sourceRoot, effectiveDestination)) {
    const previewRoot = path.join(sourceRoot, ".tmp", "open-source-preview");
    if (!isPathInside(previewRoot, effectiveDestination)) {
      throw new Error("A destination inside the checkout is allowed only under .tmp/open-source-preview/.");
    }
  }
  return effectiveDestination;
}

function getCandidates() {
  const output = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: repositoryRoot,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
  return output.toString("utf8").split("\0").filter(Boolean).sort();
}

function getIgnoredTrackedPaths(candidates) {
  if (candidates.length === 0) return new Set();
  const result = spawnSync("git", ["check-ignore", "--no-index", "-z", "--stdin"], {
    cwd: repositoryRoot,
    input: Buffer.from(`${candidates.join("\0")}\0`, "utf8"),
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git check-ignore failed: ${result.stderr?.toString("utf8") || `exit ${result.status}`}`);
  }
  return new Set(result.stdout.toString("utf8").split("\0").filter(Boolean));
}

function isSafeTemplateOrExample(basename) {
  return /(?:\.example|\.sample|\.template|\.example\.[^.]*)$/i.test(basename);
}

function isBrandRaster(relativePath) {
  return brandAssetPrefixes.some((prefix) =>
    prefix.endsWith("/") ? relativePath.startsWith(prefix) : relativePath === prefix,
  );
}

function exclusionReason(relativePath, ignoredPaths) {
  const normalized = relativePath.replaceAll("\\", "/");
  const basename = path.posix.basename(normalized);
  const lowerBasename = basename.toLowerCase();
  const extension = path.posix.extname(lowerBasename);

  if (ignoredPaths.has(relativePath)) return "gitignored";
  if (/^ml\/clearvoice(?:\/|$)/i.test(normalized)) return "model-training-source";
  if (fixedExclusions.some((pattern) => pattern.test(normalized))) return "private-or-review-only";
  if (/\.onnx$/i.test(normalized)) return "model-weights";
  if (/\.sql\.gz$/i.test(normalized)) return "local-dump";
  if ((lowerBasename.startsWith(".env") || lowerBasename.startsWith(".dev.vars")) && !isSafeTemplateOrExample(lowerBasename)) {
    return "local-configuration";
  }
  if (ignoredSecretBasenames.has(lowerBasename) && !isSafeTemplateOrExample(lowerBasename)) {
    return "credentials-or-local-data";
  }
  if (/^(?:service-account|firebase-service-account|credentials|secrets)[^/]*\.(?:json|ya?ml)$/i.test(basename)) {
    if (!isSafeTemplateOrExample(lowerBasename)) return "credentials-or-local-data";
  }
  if (secretExtensions.has(extension)) return "credentials-or-local-data";
  if (rasterExtensions.has(extension) && !isBrandRaster(normalized)) return "visual-review-required";
  return null;
}

function getRegularFile(relativePath) {
  const absolutePath = path.join(repositoryRoot, ...relativePath.split("/"));
  let info;
  try {
    info = lstatSync(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw error;
  }
  if (!info.isFile()) return null;
  return { absolutePath, info };
}

function buildPlan() {
  const candidates = getCandidates();
  const ignoredPaths = getIgnoredTrackedPaths(candidates);
  const included = [];
  const excludedCounts = new Map();

  for (const relativePath of candidates) {
    const reason = exclusionReason(relativePath, ignoredPaths);
    if (reason) {
      excludedCounts.set(reason, (excludedCounts.get(reason) || 0) + 1);
      continue;
    }
    const file = getRegularFile(relativePath);
    if (!file) {
      excludedCounts.set("deleted-or-non-file", (excludedCounts.get("deleted-or-non-file") || 0) + 1);
      continue;
    }
    included.push({ relativePath, ...file });
  }

  for (const [target, template] of sourceTemplates) {
    const templateEntry = included.find((entry) => entry.relativePath === template);
    const targetEntry = included.find((entry) => entry.relativePath === target);
    if (!templateEntry || !targetEntry) {
      throw new Error(`Required model-free export substitution is missing or excluded: ${target} <- ${template}`);
    }
  }
  if (!included.some((entry) => entry.relativePath === "LICENSE")) {
    throw new Error("A root LICENSE must be present and included before exporting a source-visible snapshot.");
  }
  return { included, excludedCounts, candidateCount: candidates.length };
}

function exactTextPattern(value) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped, "g");
}

function sanitizeInfrastructureReferences(relativePath, contents) {
  if (!textExtensions.has(path.posix.extname(relativePath).toLowerCase())) return contents;
  let sanitized = contents;
  for (const [sourceValue, placeholder] of infrastructurePlaceholders) {
    if (sourceValue !== placeholder) sanitized = sanitized.replaceAll(sourceValue, placeholder);
  }
  return sanitized;
}

function printPlan(plan, destination) {
  process.stdout.write(`Destination: ${destination}\n`);
  for (const entry of plan.included) process.stdout.write(`${entry.relativePath}\n`);
  process.stdout.write(`Included: ${plan.included.length}; excluded/skipped: ${plan.candidateCount - plan.included.length}\n`);
  for (const [reason, count] of [...plan.excludedCounts.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    process.stdout.write(`  ${reason}: ${count}\n`);
  }
}

function exportNotes() {
  return `# Source snapshot notes

This source snapshot contains no history from the private source checkout. It was assembled from selected working-tree files; the destination repository starts with its own fresh commit history. Files ignored by Git, local credentials and configuration, local data, screenshots awaiting privacy review, internal compliance working papers, the private audit report, and the nested comparison checkout are omitted.

Production Cloudflare resource identifiers and the deployed app host are replaced with example values in the exported \`wrangler.jsonc\`; remote email delivery is disabled. The exported mobile configuration likewise uses placeholder bundle, signing, API, and EAS project values. Replace these example values with resources you control before deploying or publishing a mobile build.

ClearVoice model-training sources, model weights, and the bundled legacy ONNX Runtime are omitted. The ClearVoice AI runtime and its runtime-wiring test are replaced with model-free versions. AI enhancement therefore reports that its models are unavailable; the voice engine continues through its existing non-AI fallback path.

The root LICENSE is the DeCave Source Review License v1.0. It permits private copies for evaluation builds, tests, and security review, including paid independent review, and permits publishing findings and brief source excerpts. Outside those permissions and any applicable GitHub platform permissions, it grants no rights for commercial use, redistribution, modified versions, or use in a product or service. Read LICENSE for the complete terms and limitations. This is not an open-source license. Third-party components and assets may have separate terms; review their notices before using them.
`;
}

function copySnapshot(plan, destination) {
  const safeDestination = assertSafeDestination(destination);
  mkdirSync(path.dirname(safeDestination), { recursive: true });
  mkdirSync(safeDestination);

  try {
    for (const entry of plan.included) {
      const outputPath = path.join(safeDestination, ...entry.relativePath.split("/"));
      mkdirSync(path.dirname(outputPath), { recursive: true });
      const sourceTemplate = sourceTemplates.get(entry.relativePath);
      const sourceTextTransform = sourceTextTransforms.get(entry.relativePath);
      if (sourceTemplate) {
        const contents = readFileSync(path.join(repositoryRoot, ...sourceTemplate.split("/")), "utf8");
        writeFileSync(outputPath, sanitizeInfrastructureReferences(entry.relativePath, contents), { flag: "wx" });
      } else if (sourceTextTransform) {
        const contents = readFileSync(entry.absolutePath, "utf8");
        writeFileSync(outputPath, sanitizeInfrastructureReferences(entry.relativePath, sourceTextTransform(contents)), { flag: "wx" });
      } else if (textExtensions.has(path.posix.extname(entry.relativePath).toLowerCase())) {
        const contents = readFileSync(entry.absolutePath, "utf8");
        writeFileSync(outputPath, sanitizeInfrastructureReferences(entry.relativePath, contents), { flag: "wx" });
      } else {
        copyFileSync(entry.absolutePath, outputPath);
      }
    }
    writeFileSync(path.join(safeDestination, "EXPORT-NOTES.md"), exportNotes(), { flag: "wx" });
  } catch (error) {
    throw new Error(`Export stopped after creating a partial new destination at ${safeDestination}: ${error.message}`, {
      cause: error,
    });
  }
  return safeDestination;
}

try {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  const destination = path.resolve(process.cwd(), args.destination);
  assertSafeDestination(destination);
  const plan = buildPlan();
  printPlan(plan, destination);
  if (!args.dryRun) {
    const output = copySnapshot(plan, destination);
    process.stdout.write(`Snapshot created at ${output}\n`);
  } else {
    process.stdout.write("Dry run only; no files were written.\n");
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
