import assert from "node:assert/strict";
import test from "node:test";
import { nextReleaseVersion } from "../release/versioning.mjs";

test("release version advances past the newest Windows or macOS release", () => {
  assert.equal(nextReleaseVersion("0.1.128", ["0.1.128", "0.1.131"]), "0.1.132");
});

test("release version advances from the current package when it is newer than both feeds", () => {
  assert.equal(nextReleaseVersion("0.2.4", ["0.1.128", "0.2.3"]), "0.2.5");
});

test("invalid or unavailable feed versions do not affect the next release", () => {
  assert.equal(nextReleaseVersion("0.1.128", [null, "", "latest", "0.1.127"]), "0.1.129");
});

test("invalid package versions are rejected", () => {
  assert.throws(() => nextReleaseVersion("0.1", ["0.2.0"]), /non-semver version/);
});
