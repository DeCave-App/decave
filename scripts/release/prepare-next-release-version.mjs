import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nextReleaseVersion } from "./versioning.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packagePath = path.join(root, "package.json");
const lockPath = path.join(root, "package-lock.json");
const pkg = JSON.parse(await fs.readFile(packagePath, "utf8"));

const feeds = [
  ["Windows", "https://downloads.de-cave.com/updates/windows/latest.yml"],
  ["macOS", "https://downloads.de-cave.com/updates/mac/latest-mac.yml"],
];
const published = await Promise.all(
  feeds.map(async ([platform, url]) => {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) return [platform, null];
      const version = (await response.text()).match(/^version:\s*([^\s]+)/m)?.[1] ?? null;
      return [platform, version];
    } catch {
      return [platform, null];
    }
  }),
);
const next = nextReleaseVersion(pkg.version, published.map(([, version]) => version));

pkg.version = next;
await fs.writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
lock.version = next;
if (lock.packages?.[""]) lock.packages[""].version = next;
await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
const summaries = published.filter(([, version]) => version).map(([platform, version]) => `${platform} ${version}`);
console.log(`Prepared next unused release version: ${next}${summaries.length ? ` (latest published: ${summaries.join(", ")})` : ""}`);
