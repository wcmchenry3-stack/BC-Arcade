#!/usr/bin/env node
/**
 * Prebuild asset optimization: losslessly crush PNG app icons using sharp.
 * Safe to run repeatedly — skips files that cannot be further compressed.
 */
import sharp from "sharp";
import { existsSync, statSync, renameSync, unlinkSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(__dirname, "..", "assets");
const ICONS = ["icon.png", "splash-icon.png", "adaptive-icon.png", "favicon.png"];

async function crushPng(filePath) {
  const before = statSync(filePath).size;
  const tmp = filePath + ".tmp";
  try {
    await sharp(filePath).png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(tmp);
    const after = statSync(tmp).size;
    if (after < before) {
      renameSync(tmp, filePath);
      const saved = (((before - after) / before) * 100).toFixed(1);
      console.log(`  ${basename(filePath)}: ${kb(before)} → ${kb(after)} KB (−${saved}%)`);
    } else {
      unlinkSync(tmp);
      console.log(`  ${basename(filePath)}: ${kb(before)} KB (already optimal)`);
    }
  } finally {
    if (existsSync(tmp)) unlinkSync(tmp);
  }
}

function kb(bytes) {
  return (bytes / 1024).toFixed(0);
}

(async () => {
  console.log("optimize-assets: crushing PNG icons...");
  for (const name of ICONS) {
    const fp = join(ASSETS_DIR, name);
    if (!existsSync(fp)) {
      console.log(`  ${name}: not found, skipping`);
      continue;
    }
    await crushPng(fp);
  }
  console.log("optimize-assets: done.");
})().catch((err) => {
  console.error("optimize-assets: failed —", err.message);
  process.exit(1);
});
