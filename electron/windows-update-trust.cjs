const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const yaml = require("js-yaml");

function normalizePublisherDn(value) {
  if (typeof value !== "string" || /[\0\r\n]/.test(value)) return null;
  const normalized = value
    .trim()
    .replace(/\s*=\s*/g, "=")
    .replace(/\s*,\s*/g, ",")
    .toLowerCase();
  const components = normalized.split(",");
  const commonName = components.find((component) => component.startsWith("cn="));
  const organization = components.find((component) => component.startsWith("o="));
  if (!commonName?.slice(3).trim() || !organization?.slice(2).trim() || components.length < 2) return null;
  return normalized;
}

function readUnsignedWindowsUpdatesOptIn(packagePath, readFile = fs.readFileSync) {
  const metadata = JSON.parse(readFile(packagePath, "utf8"));
  return metadata?.decaveAllowUnsignedWindowsUpdates === true;
}

function readConfiguredTrustedPublisher(configPath, readFile = fs.readFileSync) {
  const parsed = yaml.load(readFile(configPath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("app-update.yml must contain a Windows update configuration.");
  }

  const publishers = parsed.publisherName;
  if (publishers == null || publishers === "" || (Array.isArray(publishers) && publishers.length === 0)) return null;
  if (Array.isArray(publishers) && publishers.length !== 1) {
    throw new Error("app-update.yml must contain one full trusted Windows publisher DN.");
  }

  const publisher = Array.isArray(publishers) ? publishers[0] : publishers;
  if (typeof publisher === "string" && !publisher.trim()) return null;
  const normalized = normalizePublisherDn(publisher);
  if (!normalized) throw new Error("app-update.yml must contain one full trusted Windows publisher DN.");
  return { publisherName: publisher.trim(), normalizedPublisher: normalized };
}

function readTrustedPublisher(configPath, readFile = fs.readFileSync) {
  const trust = readConfiguredTrustedPublisher(configPath, readFile);
  if (!trust) throw new Error("app-update.yml must contain one full trusted Windows publisher DN.");
  return trust;
}

function configureWindowsUpdateTrust({
  configPath,
  executablePath,
  allowUnsignedUpdates = false,
  autoUpdater,
  verifyPublisher = verifyAuthenticodePublisher,
  readFile = fs.readFileSync,
}) {
  const trust = readConfiguredTrustedPublisher(configPath, readFile);
  if (!trust) {
    if (allowUnsignedUpdates !== true) {
      throw new Error("app-update.yml must contain one full trusted Windows publisher DN.");
    }
    autoUpdater.verifyUpdateCodeSignature = async () => null;
    return "unsigned";
  }

  const currentSignature = verifyPublisher(executablePath, trust);
  if (!currentSignature?.ok) {
    throw new Error(currentSignature?.reason || "The installed Windows publisher could not be verified.");
  }
  autoUpdater.verifyUpdateCodeSignature = async (publisherNames, filePath) => {
    if (
      !Array.isArray(publisherNames) ||
      publisherNames.length !== 1 ||
      normalizePublisherDn(publisherNames[0]) !== trust.normalizedPublisher
    ) {
      return "Update publisher configuration does not match the trusted full publisher DN.";
    }
    const result = verifyPublisher(filePath, trust);
    return result?.ok ? null : result?.reason || "Update publisher verification failed.";
  };
  return "signed";
}

function verifyAuthenticodePublisher(filePath, trustedPublisher, run = spawnSync) {
  const expected =
    typeof trustedPublisher === "string"
      ? normalizePublisherDn(trustedPublisher)
      : trustedPublisher?.normalizedPublisher;
  if (!expected || typeof filePath !== "string" || !filePath.trim() || /[\0\r\n]/.test(filePath)) {
    return { ok: false, reason: "Trusted publisher configuration or artifact path is invalid." };
  }
  let result;
  try {
    result = run(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-InputFormat",
        "None",
        "-Command",
        "$sig = Get-AuthenticodeSignature -LiteralPath $env:DECAVE_SIGNATURE_FILE; if ($null -eq $sig -or $sig.Status -ne 'Valid' -or $null -eq $sig.SignerCertificate) { exit 2 }; [Console]::Out.Write($sig.SignerCertificate.Subject)",
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 20_000,
        env: { ...process.env, DECAVE_SIGNATURE_FILE: filePath },
      },
    );
  } catch {
    return { ok: false, reason: "Authenticode verification could not run." };
  }
  if (result?.error || result?.status !== 0 || result?.stderr?.trim()) {
    return { ok: false, reason: "Authenticode verification failed or its tooling is unavailable." };
  }
  const actual = normalizePublisherDn(result.stdout);
  if (!actual || actual !== expected) {
    return { ok: false, reason: "Artifact signer does not exactly match the trusted publisher DN." };
  }
  return { ok: true, reason: null };
}

module.exports = {
  normalizePublisherDn,
  readUnsignedWindowsUpdatesOptIn,
  readTrustedPublisher,
  configureWindowsUpdateTrust,
  verifyAuthenticodePublisher,
};
