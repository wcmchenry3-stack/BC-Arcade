#!/usr/bin/env node
/*
 * What is the Android JS bundle made of? (#2869)
 *
 * Build the bundle exactly as CI's android-bundle-check job does, plus a
 * source map, then run this script. See docs/PERFORMANCE.md#js-bundle-size-guardrail.
 *
 *   node scripts/analyze-bundle.mjs            # top 25 contributors
 *   node scripts/analyze-bundle.mjs 50         # top 50
 *
 * Reads dist/index.android.bundle and dist/index.android.bundle.map.
 * Mapped code is grouped by npm package, or by directory for app code.
 * Metro emits JSON modules (translations, puzzle data, icon glyph maps)
 * without source mappings, so source-map-explorer reports them as
 * "[unmapped]". This script finds those modules in the bundle text instead
 * and labels them by what they contain.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { explore } from "source-map-explorer";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundlePath = path.join(root, "dist/index.android.bundle");
const mapPath = `${bundlePath}.map`;
const topN = Number(process.argv[2]) || 25;

for (const f of [bundlePath, mapPath]) {
  if (!fs.existsSync(f)) {
    console.error(`Missing ${path.relative(root, f)}. Build it first (see docs/PERFORMANCE.md).`);
    process.exit(1);
  }
}

const { bundles } = await explore({ code: bundlePath, map: mapPath }, { noBorderChecks: true });
const result = bundles[0];
const groups = new Map();
const add = (key, bytes) => groups.set(key, (groups.get(key) ?? 0) + bytes);

for (const [file, { size }] of Object.entries(result.files)) {
  if (file === "[unmapped]") continue;
  const pkg = file.match(/node_modules\/((@[^/]+\/)?[^/]+)/);
  if (pkg) add(`npm: ${pkg[1]}`, size);
  else if (file.startsWith("[")) add(file, size);
  else {
    const rel = file.replace(/^.*?\/?src\//, "src/");
    const parts = rel.split("/");
    add(parts.length > 3 ? parts.slice(0, 3).join("/") + "/" : rel, size);
  }
}

// JSON modules: `__d(function(...){m.exports={...}},...)` / `...exports=[...]`.
function classify(body) {
  if (/"ab-testing":|"10k":/.test(body)) return "JSON: icon glyph maps (@expo/vector-icons)";
  if (/^\{easy:\["/.test(body)) return "JSON: puzzle banks";
  if (/^\{("?[\w.-]+"?:"|title:)/.test(body)) return "JSON: translations (13 locales)";
  return "JSON: other data";
}
let jsonBytes = 0;
for (const line of fs.readFileSync(bundlePath, "utf8").split("\n")) {
  const m = line.match(/^__d\(function\([^)]*\)\{\w+\.exports=([[{])/);
  if (!m) continue;
  const bytes = Buffer.byteLength(line);
  jsonBytes += bytes;
  add(classify(line.slice(line.indexOf(".exports=") + 9, line.indexOf(".exports=") + 400)), bytes);
}
const unmapped = result.files["[unmapped]"]?.size ?? 0;
add("[unmapped: bundle glue, comments, whitespace]", Math.max(0, unmapped - jsonBytes));

const total = result.totalBytes;
const mb = (b) => (b / 1048576).toFixed(2);
console.log(`Bundle: ${mb(total)} MB (${total} bytes)\n`);
console.log("| # | Contributor | KB | Share |");
console.log("|---|---|---:|---:|");
[...groups.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, topN)
  .forEach(([key, bytes], i) => {
    console.log(
      `| ${i + 1} | ${key} | ${(bytes / 1024).toFixed(1)} | ${((100 * bytes) / total).toFixed(1)}% |`
    );
  });
