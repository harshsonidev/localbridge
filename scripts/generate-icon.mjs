/**
 * Build-time icon pipeline: rasterizes assets/icon.svg into PNGs and a
 * multi-resolution Windows .ico. Run whenever the SVG design changes:
 *   node scripts/generate-icon.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svgPath = path.join(root, 'assets', 'icon.svg');
const svg = fs.readFileSync(svgPath);

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

const pngBuffers = [];
for (const size of ICO_SIZES) {
  const buffer = await sharp(svg, { density: 300 }).resize(size, size).png().toBuffer();
  pngBuffers.push(buffer);
}

// 512px master PNG (used as the window icon in development and for docs).
await sharp(svg, { density: 300 })
  .resize(512, 512)
  .png()
  .toFile(path.join(root, 'assets', 'icon.png'));

const ico = await pngToIco(pngBuffers);
fs.writeFileSync(path.join(root, 'assets', 'icon.ico'), ico);

console.log(`[ok] assets/icon.png (512px) and assets/icon.ico (${ICO_SIZES.join(', ')}px) generated`);
