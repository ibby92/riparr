// Rasterizes the Riparr mark into PWA / touch icons.
// Run from the repo root:  node design/brand/build-icons.cjs   (uses the project's sharp)
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const dir = __dirname;
const mark = fs.readFileSync(path.join(dir, "logo-mark.svg"), "utf8");

// Full-bleed square version (no rounded corners, glyph inside the 80% safe zone)
// for maskable icons and iOS, which apply their own mask.
const fullBleed = mark
  .replace('rx="15"', 'rx="0"')
  .replace('transform="translate(-1.6 -2.6)"', 'transform="translate(5.4 4.6) scale(0.82)"');

const out = [
  ["icon-192.png", mark, 192],
  ["icon-512.png", mark, 512],
  ["icon-maskable-512.png", fullBleed, 512],
  ["apple-touch-icon.png", fullBleed, 180],
  ["favicon-32.png", fs.readFileSync(path.join(dir, "favicon.svg"), "utf8"), 32],
];

(async () => {
  for (const [name, svg, size] of out) {
    await sharp(Buffer.from(svg), { density: Math.ceil((72 * size) / 64) * 2 })
      .resize(size, size)
      .png({ compressionLevel: 9 })
      .toFile(path.join(dir, name));
    console.log("wrote", name, size);
  }
})();
