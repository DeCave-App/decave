import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceExtensions = new Set([".cjs", ".css", ".html", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const homeSource = readFileSync(path.join(root, "src/app/home-dashboard.ts"), "utf8").replace(
  /^import[\s\S]*?;\s*$/gm,
  "",
);
const homeOutput = ts.transpileModule(homeSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const homeContext = vm.createContext({ exports: {}, URL });
vm.runInContext(`${homeOutput}\nglobalThis.__homeExports = exports;`, homeContext);
const { normalizeHomeQuickLink } = homeContext.__homeExports;

function sourceFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return entry.isFile() && sourceExtensions.has(path.extname(entry.name)) ? [file] : [];
  });
}

test("application and desktop source no longer contain video platform integrations", () => {
  const workerSource = sourceFiles(path.join(root, "worker"))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  const appSource = sourceFiles(path.join(root, "src"))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  const desktopSource = ["electron/main.cjs", "electron/security-boundary.cjs", "electron/capture-apps.cjs"]
    .map((file) => readFileSync(path.join(root, file), "utf8"))
    .join("\n");

  assert.doesNotMatch(workerSource, /youtube\/(?:search|v3\/search)|twitch\/discovery|api\.twitch\.tv/i);
  assert.doesNotMatch(appSource, /YouTubeDock|TwitchDock|youtube-nocookie\.com|youtube\.com|twitch\.tv/i);
  assert.doesNotMatch(desktopSource, /youtube-nocookie\.com|youtube\.com|twitch\.tv/i);
});

test("video platform credentials are absent from configuration examples", () => {
  const config = [".dev.vars.example", "package.json", "wrangler.jsonc"]
    .filter((file) => existsSync(path.join(root, file)))
    .map((file) => readFileSync(path.join(root, file), "utf8"))
    .join("\n");
  assert.doesNotMatch(config, /youtube|twitch/i);
});

test("saved quick links for removed video providers are discarded", () => {
  assert.equal(normalizeHomeQuickLink({ id: "youtube", name: "YouTube", url: "https://www.youtube.com/" }), null);
  assert.equal(normalizeHomeQuickLink({ id: "twitch", name: "Twitch", url: "https://www.twitch.tv/" }), null);
});
