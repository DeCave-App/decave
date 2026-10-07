// Source of the Worker for source-level checks: worker/index.ts followed by the
// modules split out of it (worker/lib and worker/routes).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function sourceFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(file);
      return /\.ts$/.test(entry.name) ? [file] : [];
    })
    .sort();
}

export function readWorkerSource() {
  const files = [
    path.join(root, "worker/index.ts"),
    ...sourceFiles(path.join(root, "worker/lib")),
    ...sourceFiles(path.join(root, "worker/routes")),
  ];
  return files.map((file) => fs.readFileSync(file, "utf8")).join("\n");
}
