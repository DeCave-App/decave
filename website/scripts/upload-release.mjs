import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { verifyWindowsUpdateArtifacts } from "../../scripts/release/windows-update-artifacts.mjs";
import { assertPublicationReady } from "../../scripts/release/publication-readiness.mjs";
import { createRequire } from "node:module";

assertPublicationReady();
const require = createRequire(import.meta.url);
const { normalizePublisherDn, verifyAuthenticodePublisher } = require("../../electron/windows-update-trust.cjs");
const trustedPublisher = normalizePublisherDn(process.env.DECAVE_WINDOWS_PUBLISHER);
if (!trustedPublisher) throw new Error("Windows release upload is blocked: DECAVE_WINDOWS_PUBLISHER must contain the full trusted certificate subject DN.");

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const websiteRoot = path.resolve(scriptDir, "..");
const projectRoot = path.resolve(websiteRoot, "..");
const releaseDir = path.join(projectRoot, "release");

const packageJson = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8"));
if (typeof packageJson.version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version)) {
  throw new Error("package.json must contain a valid release version.");
}
const installerName = `DeCaveSetup-${packageJson.version}-x64.exe`;
const installer = {
  file: path.join(releaseDir, installerName),
  name: installerName,
};
const blockmap = {
  file: `${installer.file}.blockmap`,
  name: `${installer.name}.blockmap`,
};
const updateManifest = {
  file: path.join(releaseDir, "latest.yml"),
  name: "latest.yml",
};

try {
  const response = await fetch("https://downloads.de-cave.com/updates/windows/latest.yml", { cache: "no-store" });
  if (response.ok) {
    const published = (await response.text()).match(/^version:\s*([^\s]+)/m)?.[1];
    if (published === packageJson.version) {
      throw new Error(`Release ${packageJson.version} is already published. Run npm run release:next before building and uploading.`);
    }
  }
} catch (error) {
  if (error.message.includes("already published")) throw error;
}

for (const artifact of [installer, blockmap, updateManifest]) {
  try {
    artifact.size = (await fs.stat(artifact.file)).size;
  } catch {
    throw new Error(`Missing ${artifact.name}. Run npm run desktop:build before uploading the release.`);
  }
}

await verifyWindowsUpdateArtifacts({
  manifestPath: updateManifest.file,
  installerPath: installer.file,
  installerName: installer.name,
  version: packageJson.version,
});
const signature = verifyAuthenticodePublisher(installer.file, trustedPublisher);
if (!signature.ok) throw new Error(`Windows release upload is blocked: ${signature.reason}`);

console.log(
  `Using ${installer.name} (${(installer.size / 1024 / 1024).toFixed(1)} MiB)`,
);

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

  const result = spawnSync(
    process.execPath,
    args,
    {
      cwd: projectRoot,
      stdio: "inherit",
      shell: false,
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `${label} failed with exit code ${result.status}.`,
    );
  }
}

const immutableCache = "public, max-age=31536000, immutable";
const updateRoot = "example-decave-downloads/updates/windows";

upload({ artifact: installer, destination: `${updateRoot}/${installer.name}`, label: "Uploading versioned update installer...", contentType: "application/vnd.microsoft.portable-executable", cacheControl: immutableCache, downloadName: installer.name });
upload({ artifact: blockmap, destination: `${updateRoot}/${blockmap.name}`, label: "Uploading differential-update blockmap...", contentType: "application/octet-stream", cacheControl: immutableCache });
upload({ artifact: installer, destination: "example-decave-downloads/DeCave-Setup.exe", label: "Updating downloads.de-cave.com stable installer...", contentType: "application/vnd.microsoft.portable-executable", cacheControl: "public, max-age=300, must-revalidate", downloadName: "DeCave-Setup.exe" });
upload({ artifact: installer, destination: "example-decave-media/releases/windows/DeCaveSetup.exe", label: "Updating legacy de-cave.com download route...", contentType: "application/vnd.microsoft.portable-executable", cacheControl: "public, max-age=300, must-revalidate", downloadName: "DeCaveSetup.exe" });

// Publish the manifest last so no client can discover a release whose binary or
// differential-download data has not finished uploading.
upload({ artifact: updateManifest, destination: `${updateRoot}/latest.yml`, label: "Publishing update manifest last...", contentType: "text/yaml; charset=utf-8", cacheControl: "no-store, max-age=0" });

console.log("\nDeCave Windows release uploaded successfully.");
console.log(
  `Primary: https://downloads.de-cave.com/DeCave-Setup.exe?v=${encodeURIComponent(packageJson.version)}`,
);
console.log(
  `Immutable: https://downloads.de-cave.com/updates/windows/${encodeURIComponent(installer.name)}`,
);
console.log(
  "Legacy:  https://de-cave.com/downloads/DeCaveSetup.exe",
);
console.log(
  "Updates: https://downloads.de-cave.com/updates/windows/latest.yml",
);
