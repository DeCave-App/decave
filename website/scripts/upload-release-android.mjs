// Publishes a signed Android APK to downloads.de-cave.com:
//   updates/android/DeCave-<versionName>-<versionCode>.apk  (immutable)
//   DeCave.apk                                             (the website button)
//   updates/android/latest.json                            (the in-app update banner)
//
// npm run release:upload:android -- <signed.apk>
// npm run release:upload:android -- --eas-latest      (newest finished EAS "apk" build)
//
// The APK must be signed with the certificate pinned in
// mobile/android-signing-certificate.txt (the EAS-managed release key). Android
// only installs an update signed with the same key as the installed app, so a
// build signed with any other key would strand everyone who installed it.
// The first upload records the pin: pass --pin-certificate once.
import fs from "node:fs/promises";
import os from "node:os";
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
const mobileRoot = path.join(projectRoot, "mobile");
const pinFile = path.join(mobileRoot, "android-signing-certificate.txt");
const PACKAGE_NAME = "com.example.decave";
const DOWNLOAD_ORIGIN = "https://downloads.de-cave.com";

const args = process.argv.slice(2);
const pinCertificate = args.includes("--pin-certificate");
const fromEas = args.includes("--eas-latest");
const apkArg = args.find((arg) => !arg.startsWith("--"));
if (!fromEas && !apkArg) {
  throw new Error("Usage: npm run release:upload:android -- <signed.apk> | --eas-latest [--pin-certificate]");
}

function run(command, commandArgs, { allowFailure = false, ...options } = {}) {
  const result = spawnSync(command, commandArgs, { encoding: "utf8", shell: false, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${path.basename(command)} ${commandArgs[0]} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

async function buildTool(name) {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk) throw new Error("Set ANDROID_HOME to the Android SDK to inspect the APK.");
  const versions = (await fs.readdir(path.join(sdk, "build-tools"))).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
  const ext = process.platform === "win32" ? (name === "apksigner" ? ".bat" : ".exe") : "";
  for (const version of versions.reverse()) {
    const candidate = path.join(sdk, "build-tools", version, name + ext);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }
  throw new Error(`Could not find ${name} in the Android SDK build-tools.`);
}

async function downloadLatestEasApk() {
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const listed = run(
    npx,
    ["eas-cli@latest", "build:list", "--platform", "android", "--build-profile", "apk", "--status", "finished", "--limit", "1", "--json", "--non-interactive"],
    { cwd: mobileRoot, shell: process.platform === "win32" },
  );
  const build = JSON.parse(listed.slice(listed.indexOf("[")))[0];
  const url = build?.artifacts?.applicationArchiveUrl || build?.artifacts?.buildUrl;
  if (!url || !/\.apk(\?|$)/.test(url)) throw new Error("The newest finished EAS \"apk\" build has no APK artifact.");
  console.log(`Downloading EAS build ${build.id} (${build.appVersion} / ${build.appBuildVersion})...`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Downloading the EAS artifact failed: HTTP ${response.status}`);
  const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "decave-apk-")), "DeCave.apk");
  await fs.writeFile(file, Buffer.from(await response.arrayBuffer()));
  return file;
}

const apkPath = fromEas ? await downloadLatestEasApk() : path.resolve(apkArg);
const apkBytes = await fs.readFile(apkPath);

const badging = run(await buildTool("aapt"), ["dump", "badging", apkPath]);
const pkg = badging.match(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m);
if (!pkg) throw new Error("Could not read the package line from the APK.");
const [, packageName, versionCodeText, versionName] = pkg;
const versionCode = Number(versionCodeText);
if (packageName !== PACKAGE_NAME) throw new Error(`Expected ${PACKAGE_NAME}, got ${packageName}.`);
if (!/^\d+\.\d+\.\d+$/.test(versionName)) throw new Error(`Unexpected versionName ${versionName}.`);

// An unsigned APK fails verification; the missing digest below explains it.
const signers = run(await buildTool("apksigner"), ["verify", "--print-certs", apkPath], {
  shell: process.platform === "win32",
  allowFailure: true,
});
const certDigest = signers.match(/Signer #1 certificate SHA-256 digest: ([0-9a-f]{64})/)?.[1];
const certSubject = signers.match(/Signer #1 certificate DN: (.+)/)?.[1]?.trim() ?? "";
if (!certDigest) throw new Error("The APK is not signed (apksigner found no signer). Android will refuse to install it.");
if (/Android Debug/i.test(certSubject)) throw new Error("The APK is signed with a debug key. Build it with EAS (profile \"apk\").");

let pinned = null;
try {
  pinned = (await fs.readFile(pinFile, "utf8")).trim().toLowerCase();
} catch {}
if (!pinned) {
  if (!pinCertificate) {
    throw new Error(
      `No signing certificate is pinned yet. This APK is signed by:\n  ${certSubject}\n  SHA-256 ${certDigest}\n` +
        "If that is the EAS release key, rerun with --pin-certificate and commit mobile/android-signing-certificate.txt.",
    );
  }
  await fs.writeFile(pinFile, `${certDigest}\n`);
  console.log(`Pinned the Android signing certificate ${certDigest} in mobile/android-signing-certificate.txt.`);
} else if (pinned !== certDigest) {
  throw new Error(`The APK is signed by ${certDigest}, not the pinned release certificate ${pinned}. Installed apps could not update to it.`);
}

try {
  const response = await fetch(`${DOWNLOAD_ORIGIN}/updates/android/latest.json`, { cache: "no-store" });
  if (response.ok) {
    const published = await response.json();
    if (Number(published.versionCode) >= versionCode) {
      throw new Error(`versionCode ${versionCode} is not newer than the published ${published.versionCode} (${published.versionName}).`);
    }
  }
} catch (error) {
  if (String(error.message).includes("is not newer")) throw error;
}

const apkName = `DeCave-${versionName}-${versionCode}.apk`;
const immutableUrl = `${DOWNLOAD_ORIGIN}/updates/android/${apkName}`;
const manifest = {
  versionCode,
  versionName,
  url: immutableUrl,
  sha256: createHash("sha256").update(apkBytes).digest("hex"),
  size: apkBytes.length,
  publishedAt: new Date().toISOString(),
};
const manifestPath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "decave-apk-manifest-")), "latest.json");
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Using ${apkName} (${(apkBytes.length / 1024 / 1024).toFixed(1)} MiB), signed by ${certSubject}`);

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
if (!wranglerBin) throw new Error("Could not find Wrangler locally. Run npm install in the project root.");

function upload({ file, destination, label, contentType, cacheControl, downloadName }) {
  console.log(`\n${label}`);
  const uploadArgs = [wranglerBin, "r2", "object", "put", destination, "--file", file, "--content-type", contentType, "--cache-control", cacheControl];
  if (downloadName) uploadArgs.push("--content-disposition", `attachment; filename="${downloadName}"`);
  uploadArgs.push("--remote");
  const result = spawnSync(process.execPath, uploadArgs, { cwd: projectRoot, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status}.`);
}

const apkType = "application/vnd.android.package-archive";
upload({ file: apkPath, destination: `example-decave-downloads/updates/android/${apkName}`, label: "Uploading versioned APK...", contentType: apkType, cacheControl: "public, max-age=31536000, immutable", downloadName: apkName });
upload({ file: apkPath, destination: "example-decave-downloads/DeCave.apk", label: "Updating the website's stable APK...", contentType: apkType, cacheControl: "public, max-age=300, must-revalidate", downloadName: "DeCave.apk" });
// Publish the manifest last so the in-app banner never points at an APK that is still uploading.
upload({ file: manifestPath, destination: "example-decave-downloads/updates/android/latest.json", label: "Publishing the update manifest last...", contentType: "application/json; charset=utf-8", cacheControl: "no-store, max-age=0" });

console.log("\nDeCave Android release uploaded.");
console.log(`Website: ${DOWNLOAD_ORIGIN}/DeCave.apk`);
console.log(`Immutable: ${immutableUrl}`);
console.log(`Updates: ${DOWNLOAD_ORIGIN}/updates/android/latest.json`);
