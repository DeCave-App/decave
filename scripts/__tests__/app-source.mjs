// Source of the app shell for source-level checks: src/App.tsx followed by the
// modules split out of it (src/app, src/realtime, the voice engine and the
// shell stylesheets in src/styles/shell).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function sourceFiles(dir, pattern = /\.tsx?$/) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(file, pattern);
      return pattern.test(entry.name) ? [file] : [];
    })
    .sort();
}

export function readAppSource() {
  const files = [
    path.join(root, "src/App.tsx"),
    ...sourceFiles(path.join(root, "src/app")),
    ...sourceFiles(path.join(root, "src/realtime")),
    path.join(root, "src/voice/engine.ts"),
    ...sourceFiles(path.join(root, "src/voice")).filter((file) => /[\\/]use[A-Z]\w*\.ts$/.test(file)),
    ...sourceFiles(path.join(root, "src/styles/shell"), /\.css$/),
  ];
  return files.map((file) => fs.readFileSync(file, "utf8")).join("\n");
}
