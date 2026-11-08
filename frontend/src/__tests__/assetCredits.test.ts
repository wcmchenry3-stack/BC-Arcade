/**
 * #2492: every Star Swarm sprite and sound must have its source recorded in the repo, so
 * provenance survives the shallow-clone history. Adding a file without a credits entry fails here.
 */
import * as fs from "fs";
import * as path from "path";

const ASSETS = path.join(__dirname, "../../assets");
const SPRITES = path.join(ASSETS, "starswarm");
const SOUNDS = path.join(ASSETS, "sounds");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  });
}

/** Every CREDITS.md from the file's folder up to the sprite root — a row in any of them counts. */
function creditsFor(file: string): string {
  let dir = path.dirname(file);
  let text = "";
  for (;;) {
    const c = path.join(dir, "CREDITS.md");
    if (fs.existsSync(c)) text += fs.readFileSync(c, "utf8");
    if (dir === SPRITES) break;
    dir = path.dirname(dir);
  }
  return text;
}

describe("Star Swarm asset credits (#2492)", () => {
  it("every sprite file has a row in a CREDITS.md at or above its folder", () => {
    const missing = walk(SPRITES)
      .filter((f) => !f.endsWith(".md"))
      .filter((f) => {
        const credits = creditsFor(f);
        const name = path.basename(f);
        const frame = /^frame(\d\d)\.png$/.exec(name);
        if (frame) {
          // the 20-frame strip is one row: `explosion/frame00–19.png`
          return !(credits.includes("explosion/frame00–19.png") && Number(frame[1]) <= 19);
        }
        return !credits.includes(name);
      })
      .map((f) => path.relative(SPRITES, f));
    expect(missing).toEqual([]);
  });

  it("every Star Swarm sound has an entry in SOUND_CREDITS.md", () => {
    const credits = fs.readFileSync(path.join(SOUNDS, "SOUND_CREDITS.md"), "utf8");
    const missing = fs
      .readdirSync(SOUNDS)
      .filter((f) => f.startsWith("starswarm-"))
      .filter((f) => {
        const bg = /^starswarm-bg-(\d)\.mp3$/.exec(f);
        if (bg) {
          // the four BGM tracks share one heading: `starswarm-bg-1.mp3 — starswarm-bg-4.mp3`
          return !(
            credits.includes("starswarm-bg-1.mp3 — starswarm-bg-4.mp3") &&
            Number(bg[1]) >= 1 &&
            Number(bg[1]) <= 4
          );
        }
        return !credits.includes(f);
      });
    expect(missing).toEqual([]);
  });

  // #3526: files were removed and replaced; a credit for a file that no longer ships is stale
  it("SOUND_CREDITS.md has no entry for a Star Swarm sound that is not shipped", () => {
    const credits = fs.readFileSync(path.join(SOUNDS, "SOUND_CREDITS.md"), "utf8");
    const shipped = new Set(fs.readdirSync(SOUNDS));
    const headings = [...credits.matchAll(/^### (starswarm-[a-z0-9-]+\.(?:ogg|mp3))/gm)].map(
      (m) => m[1]!
    );
    expect(headings.length).toBeGreaterThan(0);
    expect(headings.filter((f) => !shipped.has(f))).toEqual([]);
  });

  it("every shipped Star Swarm .ogg is an original synthesized sound that names its generator (#3560)", () => {
    const credits = fs.readFileSync(path.join(SOUNDS, "SOUND_CREDITS.md"), "utf8");
    const oggs = fs.readdirSync(SOUNDS).filter((f) => /^starswarm-.*\.ogg$/.test(f));
    expect(oggs.length).toBeGreaterThanOrEqual(20);
    const unsourced = oggs.filter((f) => {
      const at = credits.indexOf(`### ${f}`);
      // an entry can head several files (`### starswarm-pickup.ogg (...)`): find the section
      if (at === -1) return true;
      const end = credits.indexOf("\n### ", at + 1);
      const section = credits.slice(at, end === -1 ? undefined : end);
      // #3560 replaced the whole Star Swarm effects set with sounds synthesized in-house; each
      // names its generator so it can be rebuilt. A third-party file would need its own entry.
      return !(
        /Original sound, synthesized/.test(section) && /synth_starswarm_sfx\.py/.test(section)
      );
    });
    expect(unsourced).toEqual([]);
  });

  it("every Cascade sound has an entry in SOUND_CREDITS.md, cascade-combo.ogg included (#3526)", () => {
    const credits = fs.readFileSync(path.join(SOUNDS, "SOUND_CREDITS.md"), "utf8");
    const cascade = fs.readdirSync(SOUNDS).filter((f) => f.startsWith("cascade-"));
    expect(cascade).toContain("cascade-combo.ogg");
    expect(cascade.filter((f) => !credits.includes(`### ${f}`))).toEqual([]);
  });

  it("no sound is left marked as unconfirmed provenance", () => {
    const credits = fs.readFileSync(path.join(SOUNDS, "SOUND_CREDITS.md"), "utf8");
    expect(credits).not.toMatch(/provenance to be confirmed/i);
  });
});

/**
 * #3563: the card and puzzle games' sounds. Every file their registries use has a credits entry,
 * and every original sound names its generator, so it can be rebuilt.
 */
const ARCADE_GAMES = [
  "blackjack",
  "solitaire",
  "freecell",
  "hearts",
  "mahjong",
  "sudoku",
  "twenty48",
  "yacht",
  "sort",
  "daily_word",
];
// No credits entry yet (ASSET-RIGHTS-AUDIT.md U5); #3563 replaces these with synthesized sounds.
const UNCREDITED_PENDING_3563 = [
  "blackjack-bust.ogg",
  "blackjack-card-deal.ogg",
  "blackjack-push.ogg",
  "blackjack-win.ogg",
];

describe("card and puzzle game sound credits (#3563)", () => {
  const credits = fs.readFileSync(path.join(SOUNDS, "SOUND_CREDITS.md"), "utf8");
  const files = [
    ...new Set(
      ARCADE_GAMES.flatMap((g) => {
        const src = fs.readFileSync(path.join(__dirname, `../game/${g}/sounds.ts`), "utf8");
        return [...src.matchAll(/require\("[^"]*\/sounds\/([^"]+)"\)/g)].map((m) => m[1]!);
      })
    ),
  ];
  const section = (f: string): string | null => {
    const at = credits.indexOf(`### ${f}`);
    if (at === -1) return null;
    const end = credits.indexOf("\n### ", at + 1);
    return credits.slice(at, end === -1 ? undefined : end);
  };

  it("every file the registries use has an entry in SOUND_CREDITS.md", () => {
    expect(files.length).toBeGreaterThan(20);
    const missing = files.filter(
      (f) => section(f) === null && !UNCREDITED_PENDING_3563.includes(f)
    );
    expect(missing).toEqual([]);
  });

  it("every file synth_arcade_sfx.py writes ships, credited as original and naming the generator", () => {
    const generator = fs.readFileSync(
      path.join(__dirname, "../../../tools/assets/synth_arcade_sfx.py"),
      "utf8"
    );
    const registry = generator.slice(generator.indexOf("SOUNDS: dict["));
    const made = [...registry.matchAll(/^ {4}"([a-z0-9-]+)": \(/gm)].map((m) => `${m[1]}.ogg`);
    expect(made).toEqual(expect.arrayContaining(["card-place-1.ogg", "riffle-loop.ogg"]));
    expect(made.filter((f) => !fs.existsSync(path.join(SOUNDS, f)))).toEqual([]);
    const bad = made.filter((f) => {
      const s = section(f) ?? "";
      return !/Original sound, synthesized/.test(s) || !/synth_arcade_sfx\.py/.test(s);
    });
    expect(bad).toEqual([]);
  });
});

describe("puzzle, tile and dice game sound credits (#3578)", () => {
  const credits = fs.readFileSync(path.join(SOUNDS, "SOUND_CREDITS.md"), "utf8");
  const section = (f: string): string | null => {
    const at = credits.indexOf(`### ${f}`);
    if (at === -1) return null;
    const end = credits.indexOf("\n### ", at + 1);
    return credits.slice(at, end === -1 ? undefined : end);
  };

  it("every file synth_puzzle_sfx.py writes ships, credited as original and naming the generator", () => {
    const generator = fs.readFileSync(
      path.join(__dirname, "../../../tools/assets/synth_puzzle_sfx.py"),
      "utf8"
    );
    const registry = generator.slice(generator.indexOf("SOUNDS: dict["));
    const made = [...registry.matchAll(/^ {4}"([a-z0-9-]+)": \(/gm)].map((m) => `${m[1]}.ogg`);
    expect(made).toEqual(
      expect.arrayContaining([
        "dice-roll-1.ogg",
        "dice-roll-2.ogg",
        "dice-roll-3.ogg",
        "die-hold-1.ogg",
        "die-hold-2.ogg",
        "die-hold-3.ogg",
        "die-release-1.ogg",
        "die-release-2.ogg",
        "die-release-3.ogg",
        "score-commit.ogg",
        "upper-bonus.ogg",
        "cpu-score-commit.ogg",
        "cpu-upper-bonus.ogg",
        "score-zero.ogg",
        "small-straight.ogg",
        "large-straight.ogg",
        "full-house.ogg",
        "cpu-score-zero.ogg",
        "cpu-small-straight.ogg",
        "cpu-large-straight.ogg",
        "cpu-full-house.ogg",
        "jackpot-yacht.ogg",
        "jackpot-joker.ogg",
        "cpu-jackpot-yacht.ogg",
        "cpu-jackpot-joker.ogg",
      ])
    );
    expect(made.filter((f) => !fs.existsSync(path.join(SOUNDS, f)))).toEqual([]);
    const bad = made.filter((f) => {
      const s = section(f) ?? "";
      return !/Original sound, synthesized/.test(s) || !/synth_puzzle_sfx\.py/.test(s);
    });
    expect(bad).toEqual([]);
  });
});
