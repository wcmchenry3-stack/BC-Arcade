#!/usr/bin/env node
/**
 * Prebuild asset optimization (sharp). Safe to run repeatedly.
 *
 * 1. App icons: lossless PNG crush. Skips files that cannot be further compressed.
 * 2. Cascade baked sprites (assets/fruits-baked, assets/cosmos-baked): 256-colour
 *    palette PNG with alpha (libimagequant, dithered), kept only when it is
 *    visually lossless (PSNR >= MIN_PSNR_DB on premultiplied RGBA) and smaller.
 *    Already-palette files are skipped, so re-runs are no-ops. bake_sprites.py
 *    writes truecolor PNGs; run this script after a re-bake (#2833).
 */
import sharp from "sharp";
import { existsSync, readdirSync, statSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(__dirname, "..", "assets");
const ICONS = ["icon.png", "splash-icon.png", "adaptive-icon.png", "favicon.png"];
const BAKED_DIRS = ["fruits-baked", "cosmos-baked"];
const MIN_PSNR_DB = 45;

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

/** PSNR (dB) between two same-sized RGBA buffers, on premultiplied colour + alpha. */
function psnr(a, b) {
  let se = 0;
  for (let i = 0; i < a.length; i += 4) {
    const aa = a[i + 3] / 255;
    const ba = b[i + 3] / 255;
    for (let c = 0; c < 3; c++) {
      const e = a[i + c] * aa - b[i + c] * ba;
      se += e * e;
    }
    const e = a[i + 3] - b[i + 3];
    se += e * e;
  }
  const mse = se / a.length;
  return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
}

async function quantizeBaked(filePath) {
  const name = `${basename(dirname(filePath))}/${basename(filePath)}`;
  const meta = await sharp(filePath).metadata();
  if (meta.isPalette) {
    console.log(`  ${name}: palette PNG (already optimized)`);
    return;
  }
  const before = statSync(filePath).size;
  const out = await sharp(filePath)
    .png({ palette: true, quality: 100, effort: 10, dither: 1.0, compressionLevel: 9 })
    .toBuffer();
  const [orig, quant] = await Promise.all([
    sharp(filePath).ensureAlpha().raw().toBuffer(),
    sharp(out).ensureAlpha().raw().toBuffer(),
  ]);
  const db = psnr(orig, quant);
  if (out.length < before && db >= MIN_PSNR_DB) {
    writeFileSync(filePath, out);
    console.log(`  ${name}: ${kb(before)} → ${kb(out.length)} KB (PSNR ${db.toFixed(1)} dB)`);
  } else {
    console.log(`  ${name}: kept truecolor (PSNR ${db.toFixed(1)} dB, ${kb(out.length)} KB)`);
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
  console.log("optimize-assets: quantizing Cascade baked sprites...");
  for (const dir of BAKED_DIRS) {
    const dp = join(ASSETS_DIR, dir);
    if (!existsSync(dp)) continue;
    for (const f of readdirSync(dp).filter((n) => n.endsWith(".png"))) {
      await quantizeBaked(join(dp, f));
    }
  }
  console.log("optimize-assets: done.");
})().catch((err) => {
  console.error("optimize-assets: failed —", err.message);
  process.exit(1);
});
