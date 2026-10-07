import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertUpdateManifestMatchesInstaller } from "../release/windows-update-artifacts.mjs";

const expected = { version: "1.0.0", installerName: "DeCaveSetup-1.0.0-x64.exe", sha512: "expected-digest", size: 123 };
function manifest() {
  return {
    version: expected.version,
    path: expected.installerName,
    sha512: expected.sha512,
    files: [{ url: expected.installerName, sha512: expected.sha512, size: expected.size }],
  };
}

test("update feed must point to the exact approved installer", () => {
  assert.doesNotThrow(() => assertUpdateManifestMatchesInstaller({ ...expected, manifest: manifest() }));
  for (const mutate of [
    (m) => {
      m.version = "2.0.0";
    },
    (m) => {
      m.path = "https://other.invalid/installer.exe";
    },
    (m) => {
      m.sha512 = "different";
    },
    (m) => {
      m.files[0].url = "../other.exe";
    },
    (m) => {
      m.files[0].sha512 = "different";
    },
    (m) => {
      m.files[0].size++;
    },
    (m) => {
      m.files.push({ ...m.files[0] });
    },
    (m) => {
      m.packages = { x64: { path: "https://other.invalid/package.7z" } };
    },
  ]) {
    const changed = manifest();
    mutate(changed);
    assert.throws(() => assertUpdateManifestMatchesInstaller({ ...expected, manifest: changed }));
  }
});

test("update feed verification runs before any upload", () => {
  const source = readFileSync(new URL("../../website/scripts/upload-release.mjs", import.meta.url), "utf8");
  const feed = source.indexOf("await verifyWindowsUpdateArtifacts(");
  const upload = source.indexOf("upload({ artifact: installer");
  assert(feed >= 0 && upload > feed);
});
