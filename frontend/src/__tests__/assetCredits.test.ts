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

  it("no sound is left marked as unconfirmed provenance", () => {
    const credits = fs.readFileSync(path.join(SOUNDS, "SOUND_CREDITS.md"), "utf8");
    expect(credits).not.toMatch(/provenance to be confirmed/i);
  });
});
