import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const websiteRoot = process.cwd();
const projectRoot = path.resolve(websiteRoot, "..");
const source = path.join(
  projectRoot,
  "src",
  "assets",
  "decave-mark-reference.png",
);
const outBrand = path.join(websiteRoot, "public", "brand");

await fs.mkdir(outBrand, { recursive: true });
await fs.access(source);

const original = await fs.readFile(source);

await fs.writeFile(
  path.join(outBrand, "decave-mark.png"),
  original,
);

await sharp(original, { limitInputPixels: false })
  .resize(1024, 1024, {
    fit: "contain",
    kernel: sharp.kernel.lanczos3,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png({ compressionLevel: 9, adaptiveFiltering: true })
  .toFile(path.join(outBrand, "decave-mark-1024.png"));

console.log(
  "Prepared the exact reference DeCave DC mark for the public website.",
);
