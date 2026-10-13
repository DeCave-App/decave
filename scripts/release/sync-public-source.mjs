#!/usr/bin/env node

// Publishes the current source to the public review repository.
//
// 1. Exports a sanitized snapshot with export-open-source.mjs.
// 2. Refuses to continue if the snapshot contains any private value:
//    production infrastructure IDs, this machine's username, the git author
//    email, or any term listed in the untracked .release-denylist.txt.
// 3. Replaces the public repository's contents with the snapshot and runs
//    Gitleaks over the staged change.
// 4. Commits as the project identity (never the maintainer's personal email,
//    never AI attribution trailers) and pushes one commit, or does nothing when the source is unchanged.
//
// Usage: node scripts/release/sync-public-source.mjs [--dry-run]

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const publicRepository = "https://github.com/DeCave-App/decave.git";
const dryRun = process.argv.includes("--dry-run");

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...options });
}

function privateTerms() {
  // Real values come from the exporter's own replacement table so there is one source of truth.
  const exporter = readFileSync(path.join(repositoryRoot, "scripts/release/export-open-source.mjs"), "utf8");
  const table = exporter.match(/const productionSourceValues = \{([\s\S]*?)\};/);
  if (!table) throw new Error("Could not read productionSourceValues from export-open-source.mjs.");
  const terms = [...table[1].matchAll(/:\s*"([^"]+)"/g)].map((match) => match[1]).filter((value) => value.length >= 6);

  terms.push(os.userInfo().username);
  const email = spawnSync("git", ["config", "user.email"], { cwd: repositoryRoot, encoding: "utf8" }).stdout.trim();
  if (email) terms.push(email, email.split("@")[0]);

  const denylistPath = path.join(repositoryRoot, ".release-denylist.txt");
  if (!existsSync(denylistPath)) {
    throw new Error("Missing .release-denylist.txt (customer names and other private terms, one per line).");
  }
  for (const line of readFileSync(denylistPath, "utf8").split(/\r?\n/)) {
    const term = line.trim();
    if (term && !term.startsWith("#")) terms.push(term);
  }
  return [...new Set(terms.filter((term) => term.length >= 4))];
}

function* walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

function assertNoPrivateTerms(snapshot) {
  const terms = privateTerms().map((term) => term.toLowerCase());
  const hits = [];
  for (const file of walk(snapshot)) {
    // latin1 keeps binary files (wasm, images) searchable byte for byte.
    const contents = readFileSync(file).toString("latin1").toLowerCase();
    for (const term of terms) {
      if (contents.includes(term)) hits.push(`${path.relative(snapshot, file)} contains private term #${terms.indexOf(term) + 1}`);
    }
  }
  if (hits.length) throw new Error(`Refusing to publish; private values found:\n  ${hits.join("\n  ")}`);
  console.log(`Private-term check passed (${terms.length} terms).`);
}

function gitleaksBinary() {
  const local = path.join(repositoryRoot, ".tools", "gitleaks", process.platform === "win32" ? "gitleaks.exe" : "gitleaks");
  if (process.env.GITLEAKS) return process.env.GITLEAKS;
  if (existsSync(local)) return local;
  if (spawnSync("gitleaks", ["version"]).status === 0) return "gitleaks";
  throw new Error(`Gitleaks not found. Install it on PATH, set GITLEAKS, or place it at ${local}.`);
}

function assertGitleaksClean(checkout) {
  // Scans the staged change in the public checkout: git paths use forward
  // slashes on every OS, so the path-scoped allowlists in .gitleaks.toml match.
  const result = spawnSync(
    gitleaksBinary(),
    ["git", "--pre-commit", "--staged", "--config", path.join(checkout, ".gitleaks.toml"), "--redact", "--no-banner", "."],
    { cwd: checkout, stdio: "inherit" },
  );
  if (result.status !== 0) throw new Error("Gitleaks found possible secrets in the snapshot; refusing to publish.");
}

const publicIdentity = { name: "DeCave", email: "security@de-cave.com" };
const attributionPattern = /co-authored-by:\s*claude|generated with \[?claude code/i;

function assertNoAttribution(snapshot) {
  const hits = [];
  for (const file of walk(snapshot)) {
    if (attributionPattern.test(readFileSync(file).toString("latin1"))) hits.push(path.relative(snapshot, file));
  }
  if (hits.length) throw new Error(`Refusing to publish; AI attribution text found in:\n  ${hits.join("\n  ")}`);
}

function assertCleanPublicHistory(checkout) {
  const log = run("git", ["log", "--format=%an <%ae> %cn <%ce>%n%B"], { cwd: checkout });
  const identities = new Set(log.match(/<[^>]+>/g));
  identities.delete(`<${publicIdentity.email}>`);
  if (identities.size) throw new Error(`Refusing to push; unexpected author/committer emails: ${[...identities].join(", ")}`);
  if (attributionPattern.test(log)) throw new Error("Refusing to push; AI attribution text found in public commit messages.");
}

const version = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8")).version;
const workRoot = mkdtempSync(path.join(os.tmpdir(), "decave-public-sync-"));
const snapshot = path.join(workRoot, "snapshot");
const checkout = path.join(workRoot, "public");

try {
  run("node", ["scripts/release/export-open-source.mjs", "--destination", snapshot], { stdio: ["ignore", "ignore", "inherit"] });
  assertNoPrivateTerms(snapshot);
  assertNoAttribution(snapshot);

  run("git", ["clone", "--quiet", publicRepository, checkout]);
  for (const entry of readdirSync(checkout)) {
    if (entry !== ".git") rmSync(path.join(checkout, entry), { recursive: true, force: true });
  }
  cpSync(snapshot, checkout, { recursive: true });
  run("git", ["add", "-A"], { cwd: checkout });
  assertGitleaksClean(checkout);

  if (!run("git", ["status", "--porcelain"], { cwd: checkout }).trim()) {
    console.log("Public source already matches this release; nothing to publish.");
  } else if (dryRun) {
    console.log(run("git", ["status", "--short"], { cwd: checkout }));
    console.log(`Dry run: would publish release ${version} to ${publicRepository}.`);
  } else {
    // Public commits use the project identity, never the maintainer's personal git identity,
    // and carry no tool attribution trailers.
    run(
      "git",
      [
        "-c",
        `user.name=${publicIdentity.name}`,
        "-c",
        `user.email=${publicIdentity.email}`,
        "commit",
        "--quiet",
        "--no-verify",
        "-m",
        `Update review source to ${version}`,
      ],
      { cwd: checkout },
    );
    assertCleanPublicHistory(checkout);
    run("git", ["push", "--quiet", "origin", "HEAD"], { cwd: checkout, stdio: "inherit" });
    console.log(`Published release ${version} source to ${publicRepository}.`);
  }
} finally {
  rmSync(workRoot, { recursive: true, force: true });
}
