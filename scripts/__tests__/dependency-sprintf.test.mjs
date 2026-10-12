import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { sprintf, vsprintf } = require("../../vendor/sprintf-js");
const sprintfEntry = require.resolve("../../vendor/sprintf-js");

test("sprintf clamps attacker-controlled numeric precision without throwing", () => {
  for (const type of ["e", "f", "g"]) {
    assert.doesNotThrow(() => sprintf(`%.101${type}`, 1.234));
    assert.doesNotThrow(() => sprintf(`%.999999999999999999999999999${type}`, 1.234));
  }

  assert.equal(sprintf("%.101f", 1.234), (1.234).toFixed(100));
  assert.equal(sprintf("%.101e", 1.234), (1.234).toExponential(100));
  assert.equal(sprintf("%.101g", 1.234), String(Number((1.234).toPrecision(100))));
  assert.equal(sprintf("%.0g", 1.234), String(Number((1.234).toPrecision(1))));
});

test("an asynchronous precision attack does not terminate the Node process", () => {
  const source = `const { sprintf } = require(${JSON.stringify(sprintfEntry)}); setImmediate(() => console.log(sprintf("%.101f", 1.234)))`;
  const result = spawnSync(process.execPath, ["--eval", source], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), (1.234).toFixed(100));
});

test("sprintf keeps normal precision and nonnumeric precision behavior", () => {
  assert.equal(sprintf("%.0f", 1.6), "2");
  assert.equal(sprintf("%.0e", 1.6), (1.6).toExponential(0));
  assert.equal(sprintf("%.2f", 1.236), "1.24");
  assert.equal(sprintf("%.2e", 1.236), (1.236).toExponential(2));
  assert.equal(sprintf("%.2g", 1.236), String(Number((1.236).toPrecision(2))));
  assert.equal(sprintf("%.150s", "x".repeat(150)), "x".repeat(150));
  assert.equal(vsprintf("%.101f", [1.234]), (1.234).toFixed(100));
});
