#!/usr/bin/env node
/*
 * Repeatable store-size audit (#2829, epic #2828).
 *
 * Quantifies, separately, the three things that make up an Android/iOS build
 * from this repo:
 *   1. JS bundle bytes        (minified, pre-Hermes; Hermes bytecode is measured natively)
 *   2. Packaged assets        (the --assets-dest dir that `expo export:embed` writes, which
 *                              Gradle/Xcode copy into the APK/IPA), bucketed
 *   3. Source contributors    (checked-in assets/ buckets plus the big generated payloads
 *                              Metro inlines into the JS bundle). Informational only.
 * Native code/libs (.so, Hermes, Sentry/RN) are NOT visible here: see the native
 * checklist in docs/PERFORMANCE.md.
 *
 * Build the inputs exactly as CI's android-bundle-check job does:
 *
 *   mkdir -p dist
 *   ENTRY_FILE=$(node -e "require('expo/scripts/resolveAppEntry')" . android absolute | tail -n 1)
 *   EXPO_PUBLIC_API_URL=https://games-api.buffingchi.com EXPO_PUBLIC_TEST_HOOKS=0 \
 *     npx expo export:embed --platform android --dev false --entry-file "$ENTRY_FILE" \
 *       --bundle-output dist/index.android.bundle --assets-dest dist/assets
 *   node scripts/size-report.mjs --bundle dist/index.android.bundle --assets dist/assets
 *
 * Flags (all optional except --bundle):
 *   --bundle <file>          JS bundle to measure
 *   --assets <dir>           packaged-assets dir (--assets-dest) to measure
 *   --max-js <bytes>         fail if the JS bundle is larger
 *   --warn-js <bytes>        warn (exit 0) if the JS bundle is larger
 *   --max-assets <bytes>     fail if packaged assets are larger
 *   --forbid-hidden-assets   fail if any hidden-premium-only asset is packaged
 *                            (store bundles must not ship them, #2830)
 *   --sources                also report checked-in assets/ and generated payload sizes
 *   --json                   machine-readable output (default: Markdown tables)
 *   --github-output <file>   append js_bytes / asset_bytes / asset_files / status lines
 *                            (pass "$GITHUB_OUTPUT")
 *
 * Exit code: 0 ok (warnings allowed), 1 a hard limit or the hidden-asset guard failed,
 * 2 usage error / missing input.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Metro flattens `assets/sounds/starswarm-bg-1.mp3` to `assets_sounds_starswarmbg1.mp3`
 * (lowercased, non-alphanumerics other than `_` dropped) and Android groups it under
 * `drawable-*` (images) or `raw/` (everything else). Fonts keep their file name.
 */
export const HIDDEN_PREMIUM_PATTERNS = [
  { name: "Star Swarm / Mahjong BGM", re: /(?:^|_)(?:starswarm|mahjong)bg\d*\./ },
  { name: "celestial-icons", re: /(?:^|_)celestialicons_/ },
  { name: "fruit-icons", re: /(?:^|_)fruiticons_/ },
  { name: "cosmos-baked", re: /(?:^|_)cosmosbaked_/ },
  { name: "fruits-baked", re: /(?:^|_)fruitsbaked_/ },
  { name: "cosmos/fruit vertices", re: /(?:^|_)(?:cosmos|fruit)vertices\./ },
  { name: "Mahjong tile art", re: /(?:^|_)assets_mahjong_/ },
  { name: "Star Swarm sprites", re: /(?:^|_)assets_starswarm_/ },
];

/** Bucket a packaged asset (path relative to --assets-dest) for the report. */
export function bucketPackagedAsset(rel) {
  const base = path.posix.basename(rel.split(path.sep).join("/")).toLowerCase();
  if (/\.(mp3|ogg|wav|m4a|aac)$/.test(base)) return "sounds";
  if (/\.(ttf|otf)$/.test(base)) return "fonts";
  if (/\.(png|webp|jpe?g|gif|svg)$/.test(base)) {
    if (base.startsWith("node_modules_")) return "images: libraries (node_modules)";
    if (/(?:^|_)(?:icon|adaptiveicon|splashicon|favicon|logo)\./.test(base))
      return "images: app icon/splash";
    if (/(?:^|_)(?:celestialicons|cosmosbaked)_/.test(base)) return "images: celestial/cosmos";
    if (/(?:^|_)(?:fruiticons|fruitsbaked)_/.test(base)) return "images: fruits";
    if (/(?:^|_)mahjong_/.test(base)) return "images: mahjong tiles";
    if (/(?:^|_)starswarm_/.test(base)) return "images: starswarm sprites";
    if (/(?:^|_)svgsprites_/.test(base)) return "images: svg sprites";
    return "images: other";
  }
  return "other";
}

/** Metro's packaged name for a file under assets/: `sounds/hearts-broken.mp3` -> `assets_sounds_heartsbroken.mp3`. */
export function metroAssetName(relToAssets) {
  const parts = relToAssets.split("/");
  const file = parts.pop();
  const dot = file.lastIndexOf(".");
  const flat = (seg) => seg.toLowerCase().replace(/[^a-z0-9_]/g, "");
  return (
    ["assets", ...parts.map(flat), flat(file.slice(0, dot))].join("_") +
    file.slice(dot).toLowerCase()
  );
}

/**
 * Sounds only the hidden premium games use (#2830): required by a hidden game's
 * `src/game/<slug>/sounds.ts` and by no other game's. Derived from the sound maps
 * and HIDDEN_GAMES (src/entitlements/gameVisibility.ts) so a new premium SFX is
 * covered without editing this script. Returns Metro packaged names.
 */
export function hiddenOnlySoundNames(rootDir = root) {
  const visibility = fs.readFileSync(
    path.join(rootDir, "src/entitlements/gameVisibility.ts"),
    "utf8"
  );
  const setBody = visibility.match(/HIDDEN_GAMES[^=]*=\s*new Set\(\[([^\]]*)\]/)?.[1];
  if (!setBody) throw new Error("size-report: could not read HIDDEN_GAMES from gameVisibility.ts");
  const hiddenGames = new Set([...setBody.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  const gameDir = path.join(rootDir, "src/game");
  const hiddenUse = new Set();
  const freeUse = new Set();
  for (const slug of fs.readdirSync(gameDir)) {
    const map = path.join(gameDir, slug, "sounds.ts");
    if (!fs.existsSync(map)) continue;
    const text = fs.readFileSync(map, "utf8");
    for (const m of text.matchAll(/require\("(?:\.\.\/)+assets\/([^"]+)"\)/g)) {
      (hiddenGames.has(slug) ? hiddenUse : freeUse).add(metroAssetName(m[1]));
    }
  }
  return new Set([...hiddenUse].filter((name) => !freeUse.has(name)));
}

/** Returns [{file, bytes, pattern}] for packaged files that only hidden premium games use. */
export function findHiddenPremiumAssets(files, hiddenSounds = new Set()) {
  const hits = [];
  for (const f of files) {
    const base = path.posix.basename(f.file.split(path.sep).join("/")).toLowerCase();
    const pattern = hiddenSounds.has(base)
      ? { name: "hidden-game-only sound" }
      : HIDDEN_PREMIUM_PATTERNS.find((p) => p.re.test(base));
    if (pattern) hits.push({ file: f.file, bytes: f.bytes, pattern: pattern.name });
  }
  return hits;
}

/** Sum files into buckets: {bucket: {files, bytes}} sorted by bytes desc. */
export function summarize(files, bucketOf = bucketPackagedAsset) {
  const buckets = {};
  for (const f of files) {
    const b = (buckets[bucketOf(f.file)] ??= { files: 0, bytes: 0 });
    b.files += 1;
    b.bytes += f.bytes;
  }
  return Object.fromEntries(Object.entries(buckets).sort((a, b) => b[1].bytes - a[1].bytes));
}

export function walkFiles(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, base, out);
    else if (e.isFile()) out.push({ file: path.relative(base, p), bytes: fs.statSync(p).size });
  }
  return out;
}

/** Decide pass/warn/fail from measurements and thresholds (all optional). */
export function evaluate({ jsBytes, assetBytes, hidden = [] }, limits = {}) {
  const failures = [];
  const warnings = [];
  if (limits.maxJs != null && jsBytes > limits.maxJs)
    failures.push(`JS bundle ${jsBytes} B exceeds hard limit ${limits.maxJs} B`);
  else if (limits.warnJs != null && jsBytes > limits.warnJs)
    warnings.push(`JS bundle ${jsBytes} B exceeds warn threshold ${limits.warnJs} B`);
  if (limits.maxAssets != null && assetBytes != null && assetBytes > limits.maxAssets)
    failures.push(`Packaged assets ${assetBytes} B exceed hard limit ${limits.maxAssets} B`);
  if (limits.forbidHidden && hidden.length)
    failures.push(
      `${hidden.length} hidden-premium asset(s) packaged in a store bundle: ` +
        hidden
          .slice(0, 8)
          .map((h) => h.file)
          .join(", ") +
        (hidden.length > 8 ? `, and ${hidden.length - 8} more` : "")
    );
  return { failures, warnings };
}

// ---- checked-in sources (informational) -----------------------------------

const GENERATED_PAYLOADS = [
  ["Yacht oracle table (generated TS)", "src/game/yacht/oracle/oracleTable.generated.ts"],
  ["Sudoku puzzle banks (generated TS)", "src/game/sudoku/puzzleBanks.generated.ts"],
  ["Sudoku puzzles.json", "src/game/sudoku/puzzles.json"],
  ["Sudoku puzzles_mini.json", "src/game/sudoku/puzzles_mini.json"],
];

export function sourceReport(rootDir = root) {
  const assetsDir = path.join(rootDir, "assets");
  const assets = {};
  if (fs.existsSync(assetsDir)) {
    for (const e of fs.readdirSync(assetsDir, { withFileTypes: true })) {
      const p = path.join(assetsDir, e.name);
      const files = e.isDirectory()
        ? walkFiles(p).filter((f) => !/\.md$/i.test(f.file))
        : [{ bytes: fs.statSync(p).size }];
      assets[e.isDirectory() ? `assets/${e.name}/` : `assets/${e.name}`] = {
        files: files.length,
        bytes: files.reduce((n, f) => n + f.bytes, 0),
      };
    }
  }
  const generated = {};
  for (const [label, rel] of GENERATED_PAYLOADS) {
    const p = path.join(rootDir, rel);
    if (fs.existsSync(p)) generated[label] = { path: rel, bytes: fs.statSync(p).size };
  }
  const locales = path.join(rootDir, "src/i18n/locales");
  if (fs.existsSync(locales)) {
    const all = walkFiles(locales).filter(
      (f) => !f.file.startsWith("_meta") && f.file.endsWith(".json")
    );
    generated["i18n locale JSON (13 locales, excl. _meta)"] = {
      path: "src/i18n/locales/",
      bytes: all.reduce((n, f) => n + f.bytes, 0),
      files: all.length,
    };
  }
  return { assets, generated };
}

// ---- CLI ------------------------------------------------------------------

const kb = (b) => (b / 1024).toFixed(1);
const mb = (b) => (b / 1048576).toFixed(2);

function parseArgs(argv) {
  const o = { flags: new Set() };
  const valued = new Set(["bundle", "assets", "max-js", "warn-js", "max-assets", "github-output"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`Unexpected argument: ${a}`);
    const k = a.slice(2);
    if (valued.has(k)) {
      if (argv[i + 1] == null) throw new Error(`--${k} needs a value`);
      o[k] = argv[++i];
    } else if (["forbid-hidden-assets", "sources", "json"].includes(k)) o.flags.add(k);
    else throw new Error(`Unknown flag: ${a}`);
  }
  const num = (k) => {
    if (o[k] == null) return undefined;
    const n = Number(o[k]);
    if (!Number.isFinite(n) || n < 0) throw new Error(`--${k} must be a byte count, got ${o[k]}`);
    return n;
  };
  o.limits = {
    maxJs: num("max-js"),
    warnJs: num("warn-js"),
    maxAssets: num("max-assets"),
    forbidHidden: o.flags.has("forbid-hidden-assets"),
  };
  return o;
}

function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
    if (!o.bundle) throw new Error("--bundle <file> is required");
  } catch (e) {
    console.error(`size-report: ${e.message}`);
    process.exit(2);
  }
  if (!fs.existsSync(o.bundle)) {
    console.error(`size-report: bundle not found: ${o.bundle}`);
    process.exit(2);
  }
  if (o.assets && !fs.existsSync(o.assets)) {
    // expo export:embed does not create --assets-dest when nothing is packaged.
    console.error(`size-report: assets dir not found: ${o.assets}`);
    process.exit(2);
  }

  const jsBytes = fs.statSync(o.bundle).size;
  const files = o.assets ? walkFiles(o.assets) : [];
  const assetBytes = o.assets ? files.reduce((n, f) => n + f.bytes, 0) : undefined;
  const hidden = o.assets ? findHiddenPremiumAssets(files, hiddenOnlySoundNames()) : [];
  const buckets = o.assets ? summarize(files) : {};
  const { failures, warnings } = evaluate({ jsBytes, assetBytes, hidden }, o.limits);
  const sources = o.flags.has("sources") ? sourceReport() : undefined;

  if (o.flags.has("json")) {
    console.log(
      JSON.stringify(
        {
          jsBytes,
          assetBytes,
          assetFiles: files.length,
          buckets,
          hidden,
          sources,
          limits: o.limits,
          failures,
          warnings,
        },
        null,
        2
      )
    );
  } else {
    console.log(`### Size report\n`);
    console.log(`| Component | Files | Bytes | MB |\n|---|---:|---:|---:|`);
    console.log(`| JS bundle (minified, pre-Hermes) | 1 | ${jsBytes} | ${mb(jsBytes)} |`);
    if (o.assets)
      console.log(
        `| Packaged assets (--assets-dest) | ${files.length} | ${assetBytes} | ${mb(assetBytes)} |`
      );
    if (o.assets) {
      console.log(`\n#### Packaged assets by bucket\n\n| Bucket | Files | KB |\n|---|---:|---:|`);
      for (const [b, v] of Object.entries(buckets))
        console.log(`| ${b} | ${v.files} | ${kb(v.bytes)} |`);
      console.log(`\nHidden-premium assets packaged: ${hidden.length}`);
      for (const h of hidden) console.log(`- ${h.file} (${h.bytes} B, ${h.pattern})`);
    }
    if (sources) {
      console.log(
        `\n#### Checked-in assets/ (source, not necessarily packaged)\n\n| Path | Files | KB |\n|---|---:|---:|`
      );
      for (const [p, v] of Object.entries(sources.assets).sort((a, b) => b[1].bytes - a[1].bytes))
        console.log(`| ${p} | ${v.files} | ${kb(v.bytes)} |`);
      console.log(
        `\n#### Large source payloads that enter Metro\n\n| Payload | Path | KB |\n|---|---|---:|`
      );
      for (const [l, v] of Object.entries(sources.generated))
        console.log(`| ${l} | ${v.path} | ${kb(v.bytes)} |`);
    }
    for (const w of warnings) console.log(`\nWARNING: ${w}`);
    for (const f of failures) console.log(`\nFAIL: ${f}`);
  }

  if (o["github-output"]) {
    const lines = [
      `js_bytes=${jsBytes}`,
      `asset_bytes=${assetBytes ?? ""}`,
      `asset_files=${o.assets ? files.length : ""}`,
      `hidden_assets=${hidden.length}`,
      `status=${failures.length ? "fail" : warnings.length ? "warn" : "ok"}`,
    ];
    fs.appendFileSync(o["github-output"], lines.join("\n") + "\n");
  }
  for (const w of warnings) console.error(`::warning::${w}`);
  for (const f of failures) console.error(`::error::${f}`);
  process.exit(failures.length ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
