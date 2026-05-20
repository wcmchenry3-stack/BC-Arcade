#!/usr/bin/env node
/**
 * Prebuild asset optimization: losslessly crush PNG app icons using sharp.
 * Safe to run repeatedly — skips files that cannot be further compressed.
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const ICONS = [
  'icon.png',
  'splash-icon.png',
  'adaptive-icon.png',
  'favicon.png',
];

async function crushPng(filePath) {
  const before = fs.statSync(filePath).size;
  const tmp = filePath + '.tmp';
  await sharp(filePath)
    .png({ compressionLevel: 9, effort: 10 })
    .toFile(tmp);
  const after = fs.statSync(tmp).size;
  if (after < before) {
    fs.renameSync(tmp, filePath);
    const saved = ((before - after) / before * 100).toFixed(1);
    console.log(`  ${path.basename(filePath)}: ${kb(before)} → ${kb(after)} KB (−${saved}%)`);
  } else {
    fs.unlinkSync(tmp);
    console.log(`  ${path.basename(filePath)}: ${kb(before)} KB (already optimal)`);
  }
}

function kb(bytes) {
  return (bytes / 1024).toFixed(0);
}

(async () => {
  console.log('optimize-assets: crushing PNG icons...');
  for (const name of ICONS) {
    const fp = path.join(ASSETS_DIR, name);
    if (!fs.existsSync(fp)) {
      console.log(`  ${name}: not found, skipping`);
      continue;
    }
    await crushPng(fp);
  }
  console.log('optimize-assets: done.');
})();
