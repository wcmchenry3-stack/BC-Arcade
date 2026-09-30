#!/usr/bin/env node
/*
 * Lists which files under frontend/assets are reachable from app code
 * (require("...") / import "...") and which are not, so the asset-rights audit
 * (docs/audits/ASSET-RIGHTS-AUDIT.md) can be repeated for later releases.
 *
 *   node scripts/list-bundled-assets.js          # human-readable
 *   node scripts/list-bundled-assets.js --json   # machine-readable
 *
 * Static scan only: test files (__tests__, *.test.*) are ignored. Dev-only screens
 * (src/screens/__dev__) are reported separately because they are not user-facing.
 * Metro bundles only what is referenced, so "unreferenced" files are not shipped.
 * Also lists third-party fonts/icon sets imported from npm (not files under assets/).
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const assetsDir = path.join(root, "assets");
const EXT = /\.(png|webp|jpe?g|gif|svg|mp3|ogg|wav|m4a|json|ttf|otf|mp4|lottie)$/i;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "__tests__") continue;
      walk(p, out);
    } else out.push(p);
  }
  return out;
}

const srcFiles = [path.join(root, "App.tsx"), path.join(root, "index.ts")]
  .filter((f) => fs.existsSync(f))
  .concat(
    walk(path.join(root, "src")).filter(
      (f) => /\.(tsx?|js)$/.test(f) && !/\.test\.(tsx?|js)$/.test(f)
    )
  );

const refs = new Map(); // asset abs path -> Set(source files)
const npmFontIcon = new Map(); // package specifier -> Set(source files)
const re = /(?:require\(|from\s+|import\s+)["']([^"']+)["']/g;
for (const f of srcFiles) {
  const text = fs.readFileSync(f, "utf8");
  let m;
  while ((m = re.exec(text))) {
    const spec = m[1];
    if (/^(@expo-google-fonts\/|@expo\/vector-icons)/.test(spec)) {
      if (!npmFontIcon.has(spec)) npmFontIcon.set(spec, new Set());
      npmFontIcon.get(spec).add(path.relative(root, f));
      continue;
    }
    if (!spec.startsWith(".") || !EXT.test(spec)) continue;
    const abs = path.resolve(path.dirname(f), spec);
    if (!abs.startsWith(assetsDir)) continue;
    if (!refs.has(abs)) refs.set(abs, new Set());
    refs.get(abs).add(path.relative(root, f));
  }
}

// app.json icon / splash config also ships.
const appJson = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8")).expo;
const cfg = [
  appJson.icon,
  appJson.splash && appJson.splash.image,
  appJson.android && appJson.android.adaptiveIcon && appJson.android.adaptiveIcon.foregroundImage,
  appJson.web && appJson.web.favicon,
].filter(Boolean);
for (const c of cfg) {
  const abs = path.resolve(root, c);
  if (!refs.has(abs)) refs.set(abs, new Set());
  refs.get(abs).add("app.json");
}

const all = walk(assetsDir).filter((f) => !/\.md$/i.test(f));
const rows = all
  .map((f) => {
    const users = refs.has(f) ? [...refs.get(f)] : [];
    const runtime = users.filter((u) => !u.includes("__dev__"));
    return {
      file: path.relative(root, f),
      bytes: fs.statSync(f).size,
      status: runtime.length ? "bundled" : users.length ? "dev-only" : "unreferenced",
      referencedBy: users,
    };
  })
  .sort((a, b) => a.file.localeCompare(b.file));

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ files: rows, npm: [...npmFontIcon.keys()] }, null, 2));
} else {
  for (const s of ["bundled", "dev-only", "unreferenced"]) {
    const g = rows.filter((r) => r.status === s);
    console.log(`\n## ${s} (${g.length})`);
    for (const r of g) console.log(`${r.file}\t${r.bytes}\t${r.referencedBy.join(", ")}`);
  }
  console.log(`\n## npm fonts/icon sets imported (${npmFontIcon.size})`);
  for (const [k, v] of npmFontIcon) console.log(`${k}\t${[...v].join(", ")}`);
}
