import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { assertPublicationReady } from "../../scripts/release/publication-readiness.mjs";

assertPublicationReady();

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const websiteRoot = path.resolve(scriptDir, "..");
const projectRoot = path.resolve(websiteRoot, "..");
const releaseDir = path.join(projectRoot, "release");

const packageJson = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8"));
if (typeof packageJson.version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version)) {
  throw new Error("package.json must contain a valid release version.");
}
const version = packageJson.version;
const arches = ["arm64", "x64"];

const artifact = (name) => ({ file: path.join(releaseDir, name), name });
const zips = arches.map((arch) => artifact(`DeCave-${version}-${arch}.zip`));
const blockmaps = zips.map((zip) => artifact(`${zip.name}.blockmap`));
const dmgs = arches.map((arch) => ({ ...artifact(`DeCave-${version}-${arch}.dmg`), arch }));
const updateManifest = artifact("latest-mac.yml");

try {
  const response = await fetch("https://downloads.de-cave.com/updates/mac/latest-mac.yml", { cache: "no-store" });
  if (response.ok) {
    const published = (await response.text()).match(/^version:\s*([^\s]+)/m)?.[1];
    if (published === version) {
      throw new Error(`macOS release ${version} is already published. Run npm run release:next before building and uploading.`);
    }
  }
} catch (error) {
  if (error.message.includes("already published")) throw error;
}

for (const item of [...zips, ...blockmaps, ...dmgs, updateManifest]) {
  try {
    item.size = (await fs.stat(item.file)).size;
  } catch {
    throw new Error(`Missing ${item.name}. Run npm run desktop:build:mac before uploading the release.`);
  }
}

// latest-mac.yml records the DMG checksums from before notarization stapling, so refresh
// their entries, then refuse to publish if any listed file differs from disk.
let manifestText = await fs.readFile(updateManifest.file, "utf8");
const sha512 = async (file) => createHash("sha512").update(await fs.readFile(file)).digest("base64");
for (const dmg of dmgs) {
  const hash = await sha512(dmg.file);
  manifestText = manifestText.replace(
    new RegExp(`(url: ${dmg.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n\\s+sha512: )\\S+(\\n\\s+size: )\\d+`),
    `$1${hash}$2${dmg.size}`,
  );
}
await fs.writeFile(updateManifest.file, manifestText);
for (const [, name, hash, size] of manifestText.matchAll(/url: (\S+)\n\s+sha512: (\S+)\n\s+size: (\d+)/g)) {
  const file = path.join(releaseDir, name);
  if ((await sha512(file)) !== hash || (await fs.stat(file)).size !== Number(size)) {
    throw new Error(`latest-mac.yml checksum for ${name} does not match the file on disk.`);
  }
}
if (manifestText.match(/^version:\s*([^\s]+)/m)?.[1] !== version) {
  throw new Error(`latest-mac.yml does not describe version ${version}.`);
}
for (const zip of zips) {
  if (!manifestText.includes(zip.name)) throw new Error(`latest-mac.yml does not list ${zip.name}.`);
}

// Never publish a disk image Gatekeeper would reject on a user's Mac.
for (const dmg of dmgs) {
  const check = spawnSync("xcrun", ["stapler", "validate", dmg.file], { encoding: "utf8" });
  if (check.status !== 0) {
    throw new Error(`${dmg.name} has no stapled notarization ticket. Rebuild with APPLE_KEYCHAIN_PROFILE set to a notarytool profile stored in the signing keychain.`);
  }
}

const wranglerBinCandidates = [
  path.join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js"),
  path.join(websiteRoot, "node_modules", "wrangler", "bin", "wrangler.js"),
];

let wranglerBin = null;

for (const candidate of wranglerBinCandidates) {
  try {
    await fs.access(candidate);
    wranglerBin = candidate;
    break;
  } catch {}
}

if (!wranglerBin) {
  throw new Error(
    "Could not find Wrangler locally. Run npm install in the project root.",
  );
}

function upload({ artifact, destination, label, contentType, cacheControl, downloadName }) {
  console.log(`\n${label}`);

  const args = [
    wranglerBin,
    "r2",
    "object",
    "put",
    destination,
    "--file",
    artifact.file,
    "--content-type",
    contentType,
    "--cache-control",
    cacheControl,
    "--remote",
  ];
  if (downloadName) args.splice(args.length - 1, 0, "--content-disposition", `attachment; filename="${downloadName}"`);

  const result = spawnSync(process.execPath, args, { cwd: projectRoot, stdio: "inherit", shell: false });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}.`);
  }
}

const immutableCache = "public, max-age=31536000, immutable";
const stableCache = "public, max-age=300, must-revalidate";
const updateRoot = "example-decave-downloads/updates/mac";

for (const zip of zips) {
  upload({ artifact: zip, destination: `${updateRoot}/${zip.name}`, label: `Uploading versioned update archive ${zip.name}...`, contentType: "application/zip", cacheControl: immutableCache, downloadName: zip.name });
}
for (const blockmap of blockmaps) {
  upload({ artifact: blockmap, destination: `${updateRoot}/${blockmap.name}`, label: `Uploading differential-update blockmap ${blockmap.name}...`, contentType: "application/octet-stream", cacheControl: immutableCache });
}
for (const dmg of dmgs) {
  upload({ artifact: dmg, destination: `${updateRoot}/${dmg.name}`, label: `Uploading versioned disk image ${dmg.name}...`, contentType: "application/x-apple-diskimage", cacheControl: immutableCache, downloadName: dmg.name });
  upload({ artifact: dmg, destination: `example-decave-downloads/DeCave-Mac-${dmg.arch}.dmg`, label: `Updating downloads.de-cave.com stable ${dmg.arch} disk image...`, contentType: "application/x-apple-diskimage", cacheControl: stableCache, downloadName: `DeCave-Mac-${dmg.arch}.dmg` });
}

// Publish the manifest last so no client can discover a release whose archives
// have not finished uploading.
upload({ artifact: updateManifest, destination: `${updateRoot}/latest-mac.yml`, label: "Publishing macOS update manifest last...", contentType: "text/yaml; charset=utf-8", cacheControl: "no-store, max-age=0" });

console.log("\nDeCave macOS release uploaded successfully.");
for (const dmg of dmgs) {
  console.log(`${dmg.arch === "arm64" ? "Apple silicon" : "Intel"}: https://downloads.de-cave.com/DeCave-Mac-${dmg.arch}.dmg?v=${encodeURIComponent(version)}`);
}
console.log("Updates: https://downloads.de-cave.com/updates/mac/latest-mac.yml");
