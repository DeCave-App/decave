import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const root = process.cwd();
const assets = path.join(root, "src", "assets");
const build = path.join(root, "build");

await fs.mkdir(build, { recursive: true });

const source = path.join(assets, "decave-mark-reference.png");
await fs.access(source);

const original = await fs.readFile(source);

// Native Windows icon master. The logo already fills most of its 1024 canvas,
// so no extra blur-inducing crop/resample chain is used.
const native1024 = await sharp(original, { limitInputPixels: false })
  .resize(1024, 1024, {
    fit: "contain",
    kernel: sharp.kernel.lanczos3,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .modulate({ brightness: 1.1, saturation: 1.04 })
  .png({ compressionLevel: 9, adaptiveFiltering: true })
  .toBuffer();

await fs.writeFile(path.join(build, "decave-icon-1024.png"), native1024);

const native512 = await sharp(native1024)
  .resize(512, 512, {
    fit: "fill",
    kernel: sharp.kernel.lanczos3,
  })
  .png({ compressionLevel: 9, adaptiveFiltering: true })
  .toBuffer();

await fs.writeFile(path.join(build, "decave-icon-512.png"), native512);

const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const icoFiles = [];

for (const size of sizes) {
  const png = await sharp(native1024)
    .resize(size, size, {
      fit: "fill",
      kernel: sharp.kernel.lanczos3,
    })
    .sharpen(size <= 24 ? 0.75 : size <= 48 ? 0.45 : 0.2)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();

  const filename = path.join(build, `decave-icon-${size}.png`);
  await fs.writeFile(filename, png);
  icoFiles.push(filename);
}

await fs.writeFile(path.join(build, "decave.ico"), await pngToIco(icoFiles));

console.log("Prepared the exact reference DeCave DC mark for login, sidebar, desktop shortcut and taskbar.");
