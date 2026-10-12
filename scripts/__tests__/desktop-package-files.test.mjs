import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// 0.1.141 shipped without electron/foreground-game.cjs and crashed at launch:
// every local module the desktop main process loads must be in build.files.
test("every electron module required at runtime is packaged", () => {
  const files = new Set(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).build.files);
  const seen = new Set();
  const visit = (relative) => {
    if (seen.has(relative)) return;
    seen.add(relative);
    const source = fs.readFileSync(path.join(root, relative), "utf8");
    for (const match of source.matchAll(/require\(\s*["'](\.\/[^"']+)["']\s*\)/g)) {
      const target = path.posix.join(path.posix.dirname(relative), match[1]);
      visit(target.endsWith(".cjs") || target.endsWith(".js") ? target : `${target}.cjs`);
    }
  };
  for (const entry of ["electron/main.cjs", "electron/preload.cjs"]) visit(entry);
  const missing = [...seen].filter((file) => !files.has(file));
  assert.deepEqual(missing, [], "add these to package.json build.files");
});
