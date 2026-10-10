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
  findHiddenPremiumAssets,
  hiddenOnlySoundNames,
  metroAssetName,
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
  assert.equal(
    bucketPackagedAsset("drawable-mdpi/assets_celestialicons_earth.webp"),
    "images: celestial/cosmos"
  );
  assert.equal(bucketPackagedAsset("drawable-mdpi/assets_fruitsbaked_apple.png"), "images: fruits");
  assert.equal(bucketPackagedAsset("raw/keep.xml"), "other");
});

test("findHiddenPremiumAssets flags premium-only art and BGM but not shared sounds", () => {
  const hits = findHiddenPremiumAssets([
    f("raw/assets_sounds_starswarmbg1.mp3"),
    f("raw/assets_sounds_mahjongbg3.mp3"),
    f("drawable-mdpi/assets_celestialicons_sun.webp"),
    f("drawable-mdpi/assets_fruiticons_apple.webp"),
    f("drawable-mdpi/assets_cosmosbaked_moon.png"),
    f("drawable-mdpi/assets_fruitsbaked_lemon.png"),
    f("raw/assets_mahjong_01whitedragon.svg"),
    f("drawable-mdpi/assets_starswarm_playership.webp"),
    // allowed: shared / free-game assets
    f("raw/assets_sounds_yachtdiceroll.ogg"),
    f("raw/assets_sounds_blackjackwin.ogg"),
    f("drawable-mdpi/assets_logo.png"),
  ]);
  assert.equal(hits.length, 8);
  assert.ok(hits.every((h) => !h.file.includes("yacht") && !h.file.includes("logo")));
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
  const h = [{ file: "x", bytes: 1, pattern: "p" }];
  assert.equal(evaluate({ jsBytes: 1, hidden: h }, { forbidHidden: true }).failures.length, 1);
  assert.equal(evaluate({ jsBytes: 1, hidden: h }, {}).failures.length, 0);
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
  assert.equal(metroAssetName("fruit-icons/Cherry.webp"), "assets_fruiticons_cherry.webp");
});

test("hiddenOnlySoundNames: premium-only sounds, not ones a free game shares", () => {
  const names = hiddenOnlySoundNames();
  // Only hidden games use these.
  assert.ok(names.has("assets_sounds_heartsbroken.mp3"));
  assert.ok(names.has("assets_sounds_starswarmlaser.ogg"));
  assert.ok(names.has("assets_sounds_mahjongtilematch.ogg"));
  // Hidden games share these with free games (solitaire, yacht, sort, 2048...).
  assert.ok(!names.has("assets_sounds_heartsmoonshot.mp3"));
  assert.ok(!names.has("assets_sounds_blackjackwin.ogg"));
  assert.ok(!names.has("assets_sounds_cascadefruitmerge.ogg"));
  // Free games' own sounds are never flagged.
  assert.ok(!names.has("assets_sounds_yachtdiceroll.ogg"));
  const hits = findHiddenPremiumAssets(
    [
      { file: "raw/assets_sounds_heartsbroken.mp3", bytes: 1 },
      { file: "raw/assets_sounds_heartsmoonshot.mp3", bytes: 1 },
    ],
    names
  );
  assert.deepEqual(
    hits.map((h) => h.file),
    ["raw/assets_sounds_heartsbroken.mp3"]
  );
});
