// node --test scripts/size-report.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  bucketPackagedAsset,
  evaluate,
  findHiddenLocaleStrings,
  findHiddenPremiumAssets,
  hiddenGameSlugs,
  hiddenLocaleMarkers,
  hiddenLobbyTilePattern,
  hiddenOnlySoundNames,
  metroAssetName,
  readStringSet,
  summarize,
} from "./size-report.mjs";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "size-report.mjs");
const f = (file, bytes = 1) => ({ file, bytes });

test("bucketPackagedAsset groups Metro-flattened android asset names", () => {
  assert.equal(bucketPackagedAsset("raw/assets_sounds_yachtdiceroll.ogg"), "sounds");
  assert.equal(
    bucketPackagedAsset("raw/node_modules_expogooglefonts_manrope_400regular.ttf"),
    "fonts"
  );
  assert.equal(bucketPackagedAsset("drawable-mdpi/assets_logo.png"), "images: app icon/splash");
  assert.equal(
    bucketPackagedAsset(
      "drawable-mdpi/node_modules_reactnavigation_elements_lib_module_assets_backicon.png"
    ),
    "images: libraries (node_modules)"
  );
  assert.equal(bucketPackagedAsset("raw/keep.xml"), "other");
});

test("findHiddenPremiumAssets flags Star Swarm's one music track (#3638)", () => {
  const hits = findHiddenPremiumAssets([f("raw/assets_sounds_starswarmbgm.mp3")]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].pattern, "Star Swarm / Mahjong BGM");
});

test("findHiddenPremiumAssets flags premium-only art and BGM but not shared sounds", () => {
  const hits = findHiddenPremiumAssets([
    f("raw/assets_sounds_starswarmbg1.mp3"),
    f("raw/assets_sounds_mahjongbg3.mp3"),
    f("raw/assets_mahjong_01whitedragon.svg"),
    f("drawable-mdpi/assets_starswarm_playership.webp"),
    // allowed: shared / free-game assets
    f("raw/assets_sounds_yachtdiceroll.ogg"),
    f("raw/assets_sounds_blackjackwin.ogg"),
    f("drawable-mdpi/assets_logo.png"),
  ]);
  assert.equal(hits.length, 4);
  assert.ok(hits.every((h) => !h.file.includes("yacht") && !h.file.includes("logo")));
});

test("findHiddenPremiumAssets flags a hidden game's lobby tile, not a free game's (#4011)", () => {
  const hits = findHiddenPremiumAssets([
    f("drawable-mdpi/assets_home_mahjongtile.webp"),
    f("drawable-mdpi/assets_home_starswarmtile.webp"),
    // allowed: the free games' tiles
    f("drawable-mdpi/assets_home_yachttile.webp"),
    f("drawable-mdpi/assets_home_sorttile.webp"),
    f("drawable-mdpi/assets_home_sudokutile.webp"),
    f("drawable-mdpi/assets_home_twenty48tile.webp"),
  ]);
  assert.deepEqual(
    hits.map((h) => [h.file, h.pattern]),
    [
      ["drawable-mdpi/assets_home_mahjongtile.webp", "Hidden game lobby tile"],
      ["drawable-mdpi/assets_home_starswarmtile.webp", "Hidden game lobby tile"],
    ]
  );
});

test("hiddenLobbyTilePattern follows HIDDEN_GAMES", () => {
  for (const slug of hiddenGameSlugs()) {
    assert.ok(hiddenLobbyTilePattern().re.test(metroAssetName(`home/${slug}-tile.webp`)), slug);
  }
  // Once a game is unhidden its tile is allowed again; lookalike names never match.
  const re = hiddenLobbyTilePattern(new Set(["hearts"])).re;
  assert.ok(re.test("assets_home_heartstile.webp"));
  assert.ok(!re.test("assets_home_mahjongtile.webp"));
  assert.ok(!re.test("assets_home_heartstileback.webp"));
  assert.ok(!re.test("assets_hearts_tile.webp"));
});

test("CLI: --forbid-hidden-assets fails a packaged hidden-game lobby tile (#4011)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "size-report-tile-"));
  try {
    const bundle = path.join(dir, "b.bundle");
    fs.writeFileSync(bundle, "x");
    const assets = path.join(dir, "assets/drawable-mdpi");
    fs.mkdirSync(assets, { recursive: true });
    const run = () =>
      spawnSync(
        process.execPath,
        [script, "--bundle", bundle, "--assets", path.dirname(assets), "--forbid-hidden-assets"],
        { encoding: "utf8" }
      );
    fs.writeFileSync(path.join(assets, "assets_home_yachttile.webp"), "y");
    assert.equal(run().status, 0);
    fs.writeFileSync(path.join(assets, "assets_home_mahjongtile.webp"), "m");
    const failed = run();
    assert.equal(failed.status, 1);
    assert.match(failed.stdout, /assets_home_mahjongtile\.webp.*Hidden game lobby tile/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("summarize totals files and bytes per bucket, largest first", () => {
  const s = summarize([f("a.ogg", 5), f("b.ogg", 7), f("c.ttf", 100)]);
  assert.deepEqual(Object.keys(s), ["fonts", "sounds"]);
  assert.deepEqual(s.sounds, { files: 2, bytes: 12 });
});

test("evaluate: hard limit fails, warn threshold warns, boundaries are inclusive", () => {
  assert.deepEqual(evaluate({ jsBytes: 100 }, { maxJs: 100 }).failures, []);
  assert.equal(evaluate({ jsBytes: 101 }, { maxJs: 100 }).failures.length, 1);
  const w = evaluate({ jsBytes: 90 }, { maxJs: 100, warnJs: 80 });
  assert.equal(w.failures.length, 0);
  assert.equal(w.warnings.length, 1);
  assert.equal(evaluate({ jsBytes: 1, assetBytes: 11 }, { maxAssets: 10 }).failures.length, 1);
  // Asset warn line (#3631): warns between the warn and hard limits, never fails, and is
  // silent at or below the line; above the hard limit only the failure is reported.
  const aw = evaluate({ jsBytes: 1, assetBytes: 8 }, { maxAssets: 10, warnAssets: 6 });
  assert.deepEqual(aw.failures, []);
  assert.equal(aw.warnings.length, 1);
  assert.deepEqual(
    evaluate({ jsBytes: 1, assetBytes: 6 }, { maxAssets: 10, warnAssets: 6 }).warnings,
    []
  );
  const awFail = evaluate({ jsBytes: 1, assetBytes: 11 }, { maxAssets: 10, warnAssets: 6 });
  assert.equal(awFail.failures.length, 1);
  assert.deepEqual(awFail.warnings, []);
  const h = [{ file: "x", bytes: 1, pattern: "p" }];
  assert.equal(evaluate({ jsBytes: 1, hidden: h }, { forbidHidden: true }).failures.length, 1);
  assert.equal(evaluate({ jsBytes: 1, hidden: h }, {}).failures.length, 0);
  const l = [{ locale: "de", ns: "common", key: "k", value: "v" }];
  const forbidden = evaluate({ jsBytes: 1, hiddenLocales: l }, { forbidHiddenLocales: true });
  assert.match(forbidden.failures[0], /1 non-launch locale string.*\(de\).*de\/common:k/);
  assert.equal(evaluate({ jsBytes: 1, hiddenLocales: l }, {}).failures.length, 0);
});

test("CLI exit codes and JSON output", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "size-report-"));
  try {
    const bundle = path.join(dir, "b.bundle");
    fs.writeFileSync(bundle, "x".repeat(1000));
    fs.mkdirSync(path.join(dir, "assets/raw"), { recursive: true });
    fs.writeFileSync(path.join(dir, "assets/raw/assets_sounds_yachtdiceroll.ogg"), "y".repeat(50));
    const run = (...a) => spawnSync(process.execPath, [script, ...a], { encoding: "utf8" });

    const ok = run(
      "--bundle",
      bundle,
      "--assets",
      path.join(dir, "assets"),
      "--json",
      "--max-js",
      "1000",
      "--forbid-hidden-assets"
    );
    assert.equal(ok.status, 0);
    const j = JSON.parse(ok.stdout);
    assert.equal(j.jsBytes, 1000);
    assert.equal(j.assetBytes, 50);
    assert.equal(j.assetFiles, 1);

    assert.equal(run("--bundle", bundle, "--max-js", "999").status, 1);
    assert.equal(
      run("--bundle", bundle, "--assets", path.join(dir, "assets"), "--max-assets", "49").status,
      1
    );
    assert.equal(run("--bundle", path.join(dir, "missing")).status, 2);
    assert.equal(run().status, 2);

    fs.writeFileSync(path.join(dir, "assets/raw/assets_sounds_starswarmbg1.mp3"), "z");
    assert.equal(
      run("--bundle", bundle, "--assets", path.join(dir, "assets"), "--forbid-hidden-assets")
        .status,
      1
    );
    assert.equal(run("--bundle", bundle, "--assets", path.join(dir, "assets")).status, 0);

    const out = path.join(dir, "gh.out");
    run("--bundle", bundle, "--github-output", out);
    assert.match(fs.readFileSync(out, "utf8"), /js_bytes=1000\n.*status=ok/s);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("metroAssetName flattens like Metro's Android asset names", () => {
  assert.equal(metroAssetName("sounds/hearts-broken.mp3"), "assets_sounds_heartsbroken.mp3");
  assert.equal(metroAssetName("home/Star-Tile.webp"), "assets_home_startile.webp");
});

test("hiddenOnlySoundNames: premium-only sounds, not ones a free game shares", () => {
  const names = hiddenOnlySoundNames();
  // Only hidden games use these.
  assert.ok(names.has("assets_sounds_heartsbrokenheartbeat.ogg"));
  assert.ok(names.has("assets_sounds_starswarmbombblast.ogg"));
  assert.ok(names.has("assets_sounds_mahjongmatch1.ogg"));
  // Cascade's own synthesized sets (#3702); the old Kenney files are gone.
  assert.ok(names.has("assets_sounds_cascadefruitsmerget0.ogg"));
  assert.ok(names.has("assets_sounds_cascadecosmoswin.ogg"));
  assert.ok(!names.has("assets_sounds_cascadefruitmerge.ogg"));
  // Hidden games share these with free games (solitaire, yacht, 2048...).
  assert.ok(!names.has("assets_sounds_heartsmoonshot.mp3"));
  assert.ok(!names.has("assets_sounds_cardplace1.ogg"));
  // Free games' own sounds are never flagged.
  assert.ok(!names.has("assets_sounds_yachtdiceroll.ogg"));
  const hits = findHiddenPremiumAssets(
    [
      { file: "raw/assets_sounds_heartsbrokenheartbeat.ogg", bytes: 1 },
      { file: "raw/assets_sounds_heartsmoonshot.mp3", bytes: 1 },
    ],
    names
  );
  assert.deepEqual(
    hits.map((h) => h.file),
    ["raw/assets_sounds_heartsbrokenheartbeat.ogg"]
  );
});

test("hiddenLocaleMarkers: strings only the non-launch locales hold (#3150)", () => {
  const markers = hiddenLocaleMarkers();
  const locales = new Set(markers.map((m) => m.locale));
  assert.deepEqual([...locales].sort(), [
    "ar",
    "de",
    "he",
    "hi",
    "ja",
    "ko",
    "nl",
    "pt",
    "ru",
    "zh",
  ]);
  // Every hidden locale is well covered, so one leaked file cannot slip through.
  for (const code of locales)
    assert.ok(markers.filter((m) => m.locale === code).length > 100, code);
});

test("findHiddenLocaleStrings reads through the minifier's escapes", () => {
  const markers = [
    { locale: "de", ns: "common", key: "a", value: "Zurück zur Übersicht" },
    { locale: "ja", ns: "common", key: "b", value: "ゲームを続けますか" },
    { locale: "ru", ns: "common", key: "c", value: "Продолжить игру" },
  ];
  const escape = (v) =>
    [...v]
      .map((ch) => {
        const code = ch.charCodeAt(0);
        if (code < 0x80) return ch;
        return code < 0x100
          ? `\\x${code.toString(16)}`
          : `\\u${code.toString(16).padStart(4, "0").toUpperCase()}`;
      })
      .join("");
  const bundle = `__d(function(){m.exports={a:"${escape(markers[0].value)}",b:"${escape(markers[1].value)}"}})`;
  assert.deepEqual(
    findHiddenLocaleStrings(bundle, markers).map((m) => m.key),
    ["a", "b"]
  );
  assert.deepEqual(findHiddenLocaleStrings(`m.exports={a:"Back to overview"}`, markers), []);
});

test("CLI: --forbid-hidden-locales fails a bundle that holds a hidden locale's strings", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "size-report-locales-"));
  const run = (text) => {
    const bundle = path.join(dir, "index.android.bundle");
    fs.writeFileSync(bundle, text);
    return spawnSync(process.execPath, [script, "--bundle", bundle, "--forbid-hidden-locales"], {
      encoding: "utf8",
    });
  };
  try {
    const leaked = run(`m.exports={k:${JSON.stringify(hiddenLocaleMarkers()[0].value)}}`);
    assert.equal(leaked.status, 1);
    assert.match(leaked.stdout, /Non-launch locale strings in the JS bundle: 1/);
    assert.equal(run(`m.exports={k:"Play again"}`).status, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- #4017: slug source covers HIDDEN_GAMES + DISABLED_GAMES and survives empty sets ---

/** A throwaway project root holding only a gameVisibility.ts with the given set literals. */
function fixtureRoot(hidden, disabled) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "size-report-vis-"));
  fs.mkdirSync(path.join(dir, "src/entitlements"), { recursive: true });
  fs.mkdirSync(path.join(dir, "src/game"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "src/entitlements/gameVisibility.ts"),
    `export const HIDDEN_GAMES: ReadonlySet<string> = ${hidden};\n` +
      `export const DISABLED_GAMES: ReadonlySet<string> = ${disabled};\n`
  );
  return dir;
}

test("hiddenGameSlugs tolerates empty sets, type arguments, comments and multi-line lists", () => {
  const cases = [
    ["new Set([])", "new Set([])", []],
    ["new Set<string>([])", "new Set<string>([])", []],
    ['new Set<string>(["a", "b"])', "new Set([])", ["a", "b"]],
    ["new Set(['a'])", "new Set<string>([ ])", ["a"]],
    ['new Set<string>([\n  // note, "x"\n  "a",\n  "b", /* "y" */\n])', "new Set([])", ["a", "b"]],
  ];
  for (const [hidden, disabled, want] of cases) {
    const dir = fixtureRoot(hidden, disabled);
    try {
      assert.deepEqual([...hiddenGameSlugs(dir)].sort(), want, hidden);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("hiddenGameSlugs is HIDDEN_GAMES union DISABLED_GAMES (a disabled-only slug counts)", () => {
  const dir = fixtureRoot('new Set(["hearts"])', 'new Set<string>(["cascade"])');
  try {
    assert.deepEqual([...hiddenGameSlugs(dir)].sort(), ["cascade", "hearts"]);
    // hiddenOnlySoundNames shares the parser: a disabled game's sounds count as hidden-only.
    fs.mkdirSync(path.join(dir, "src/game/cascade"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "src/game/cascade/sounds.ts"),
      'export const S = require("../../../assets/sounds/cascade-win.ogg");\n'
    );
    assert.ok(hiddenOnlySoundNames(dir).has("assets_sounds_cascadewin.ogg"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("hiddenGameSlugs still throws when a set declaration is missing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "size-report-vis-"));
  fs.mkdirSync(path.join(dir, "src/entitlements"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src/entitlements/gameVisibility.ts"), "export const X = 1;\n");
  try {
    assert.throws(() => hiddenGameSlugs(dir), /could not read HIDDEN_GAMES/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an empty slug set means no hidden lobby tile: nothing matches, nothing throws", () => {
  const { re } = hiddenLobbyTilePattern(new Set());
  assert.ok(!re.test("assets_home_tile.webp"));
  assert.ok(!re.test("assets_home_starswarmtile.webp"));
  const hits = findHiddenPremiumAssets(
    [{ file: "drawable-mdpi/assets_home_yachttile.webp", bytes: 1 }],
    new Set(),
    new Set()
  );
  assert.deepEqual(hits, []);
});

test("findHiddenPremiumAssets flags a tile for a slug given from DISABLED_GAMES", () => {
  const hits = findHiddenPremiumAssets(
    [{ file: "drawable-mdpi/assets_home_cascadetile.webp", bytes: 1 }],
    new Set(),
    new Set(["cascade"])
  );
  assert.equal(hits.length, 1);
});

test("readStringSet rejects non-literal entries instead of dropping them (#4017 review)", () => {
  const read = (body) => readStringSet(`export const S = new Set([${body}]);`, "S");
  assert.throws(() => read('...OTHER, "a"'), /plain string literals/);
  assert.throws(() => read('"a", someSlug'), /plain string literals/);
  assert.throws(() => read("`a${x}`"), /plain string literals/);
  assert.deepEqual([...read("`a`, 'b', \"c\"")], ["a", "b", "c"]);
});

test("readStringSet anchors to the declaration and handles nested generics", () => {
  // The name appears in a semicolon-less import before the real declaration.
  const src =
    'import { HIDDEN_GAMES }\nconst unrelated = new Set(["zzz"])\n' +
    'export const HIDDEN_GAMES: ReadonlySet<string> = new Set<Array<string>>(["a"]);\n';
  assert.deepEqual([...readStringSet(src, "HIDDEN_GAMES")], ["a"]);
  assert.throws(
    () => readStringSet('import { HIDDEN_GAMES }\nconst x = new Set(["zzz"]);\n', "HIDDEN_GAMES"),
    /could not read HIDDEN_GAMES/
  );
});
