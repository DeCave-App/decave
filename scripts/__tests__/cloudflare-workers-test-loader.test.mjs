import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "../test-support/cloudflare-workers-test-loader.mjs";

test("Worker test loader only adds .ts to extensionless relative imports", async () => {
  const context = { parentURL: "file:///repo/worker/index.ts" };
  const fallback = async (specifier) => ({ url: `default:${specifier}` });
  for (const specifier of [
    "../electron/provider.cjs",
    "./module.js",
    "./module.mjs",
    "./module.ts",
    "./fixture.json",
    "node:fs",
  ]) {
    assert.deepEqual(await resolve(specifier, context, fallback), { url: `default:${specifier}` });
  }
  assert.deepEqual(await resolve("./db", context, fallback), {
    shortCircuit: true,
    url: "file:///repo/worker/db.ts",
  });
  assert.match((await resolve("cloudflare:workers", context, fallback)).url, /^data:text\/javascript,/);
});
