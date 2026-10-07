import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { normalizePublisherDn, verifyAuthenticodePublisher } = require("../../electron/windows-update-trust.cjs");

// Read-only comparison of one exact local release artifact with its public
// production download. Neither provider credentials nor fixture accounts are used.
const args = process.argv.slice(2);
assert.equal(args.length, 4, "Use --file <local artifact> --url <production download URL>.");
assert.equal(args[0], "--file");
assert.equal(args[2], "--url");
const localPath = path.resolve(args[1]);
const url = new URL(args[3]);
assert.ok(["https://downloads.de-cave.com", "https://de-cave.com"].includes(url.origin));
assert.equal(url.username + url.password + url.search + url.hash, "");
assert.match(
  url.pathname,
  url.origin === "https://downloads.de-cave.com"
    ? /^\/updates\/windows\/[A-Za-z0-9._-]+\.(?:exe|blockmap)$/
    : /^\/downloads\/[A-Za-z0-9._-]+\.apk$/,
);
assert.equal(path.basename(localPath), url.pathname.split("/").at(-1), "Artifact filenames differ.");
const stat = await fs.stat(localPath);
assert.ok(stat.isFile() && stat.size > 0 && stat.size < 1024 * 1024 * 1024);
if (localPath.toLowerCase().endsWith(".exe")) {
  const publisher = normalizePublisherDn(process.env.DECAVE_WINDOWS_PUBLISHER);
  assert.ok(
    publisher,
    "Set DECAVE_WINDOWS_PUBLISHER to the full trusted subject DN before validating a Windows client.",
  );
  const signature = verifyAuthenticodePublisher(localPath, publisher);
  assert.ok(signature.ok, `Windows client signature verification failed: ${signature.reason}`);
}
const localSha256 = createHash("sha256");
const localSha512 = createHash("sha512");
for await (const chunk of createReadStream(localPath)) {
  localSha256.update(chunk);
  localSha512.update(chunk);
}
const expectedSha256 = localSha256.digest("hex");
const expectedSha512 = localSha512.digest("base64");
const response = await fetch(url, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(120000) });
assert.equal(response.status, 200, "Published artifact is not available.");
assert.equal(response.redirected, false);
if (response.headers.has("content-length")) assert.equal(Number(response.headers.get("content-length")), stat.size);
assert.ok(response.body, "Published artifact has no body.");
const remoteSha256 = createHash("sha256");
const remoteSha512 = createHash("sha512");
let bytes = 0;
for await (const chunk of response.body) {
  bytes += chunk.byteLength;
  assert.ok(bytes <= stat.size, "Published artifact exceeds the local artifact size.");
  remoteSha256.update(chunk);
  remoteSha512.update(chunk);
}
assert.equal(bytes, stat.size, "Published artifact is truncated.");
assert.equal(remoteSha256.digest("hex"), expectedSha256, "Published SHA-256 differs.");
assert.equal(remoteSha512.digest("base64"), expectedSha512, "Published SHA-512 differs.");
console.log(
  JSON.stringify(
    {
      pass: true,
      recordedAt: new Date().toISOString(),
      url: url.href,
      localArtifact: path.basename(localPath),
      bytes,
      sha256: expectedSha256,
      sha512: expectedSha512,
      signatureOrIndependentReviewClaimed: false,
    },
    null,
    2,
  ),
);
