// 從 public/icon.svg 產生 PWA 需要的 PNG icons
// 跑：node scripts/generate-icons.mjs

import sharp from 'sharp';
import fs from 'node:fs';

const svg = fs.readFileSync('public/icon.svg');
const sizes = [192, 512];

for (const size of sizes) {
  await sharp(svg).resize(size, size).png().toFile(`public/icon-${size}.png`);
  console.log(`✓ public/icon-${size}.png`);
}

// favicon
await sharp(svg).resize(32, 32).png().toFile('public/favicon.png');
console.log('✓ public/favicon.png');
