import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";

export function assertUpdateManifestMatchesInstaller({ manifest, version, installerName, sha512, size }) {
  assert(manifest && typeof manifest === "object" && !Array.isArray(manifest), "Invalid update manifest");
  assert.equal(manifest.version, version, "Update version differs from the reviewed installer");
  assert.equal(manifest.path, installerName, "Update path must name the reviewed installer");
  assert.equal(manifest.sha512, sha512, "Update digest differs from the reviewed installer");
  assert.equal(manifest.packages, undefined, "Alternate package downloads are forbidden");
  assert(Array.isArray(manifest.files) && manifest.files.length === 1, "Update must contain exactly one Windows installer");
  const file = manifest.files[0];
  assert.equal(file?.url, installerName, "Update URL must be the reviewed installer basename");
  assert.equal(file?.sha512, sha512, "Update file digest differs from the reviewed installer");
  assert.equal(file?.size, size, "Update file size differs from the reviewed installer");
}

export async function verifyWindowsUpdateArtifacts({ manifestPath, installerPath, installerName, version }) {
  const stat = await fs.stat(manifestPath);
  assert(stat.isFile() && stat.size > 0 && stat.size <= 64 * 1024, "Update manifest exceeds its size limit");
  const require = createRequire(import.meta.url);
  const yaml = require("js-yaml");
  const manifest = yaml.load(await fs.readFile(manifestPath, "utf8"), { schema: yaml.JSON_SCHEMA });
  const hash = createHash("sha512");
  let size = 0;
  for await (const chunk of createReadStream(installerPath)) {
    hash.update(chunk);
    size += chunk.length;
  }
  assertUpdateManifestMatchesInstaller({ manifest, version, installerName, sha512: hash.digest("base64"), size });
}
