// Copy the shared DM encryption files into the mobile app, which can't import
// from outside its own folder. scripts/__tests__/dm-e2ee.test.mjs fails when the
// copies drift.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const target = path.join(root, "mobile/src/lib/e2ee");
fs.mkdirSync(target, { recursive: true });
for (const name of ["dm-e2ee.ts", "dm-e2ee-format.ts", "dm-e2ee-session.ts", "dm-e2ee-sending.ts"]) {
  fs.copyFileSync(path.join(root, "shared", name), path.join(target, name));
  console.log(`copied shared/${name} -> mobile/src/lib/e2ee/${name}`);
}
