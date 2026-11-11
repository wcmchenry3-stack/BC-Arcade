/**
 * #3692: Cascade art budget guard. Cascade piece art is drawn in code (<= 20 KB, no image
 * files), so `frontend/assets/` must not gain Cascade image files, and the dead pipeline
 * outputs deleted in #3692 must not come back. See docs/PERFORMANCE.md "Cascade size budget".
 *
 * ALLOWED_CASCADE_IMAGES pins the sprites that still ship today. Story #3698 replaces them
 * with code-drawn pieces and shrinks this map to empty (`{}`); until then any NEW Cascade
 * image file or folder fails here.
 */
import * as fs from "fs";
import * as path from "path";

const ASSETS_DIR = path.join(__dirname, "../../../../assets");
const REPO_ROOT = path.join(ASSETS_DIR, "../..");

const THEME_NAMES = {
  fruits: [
    "apple",
    "blueberry",
    "cherry",
    "coconut",
    "dragonfruit",
    "grapes",
    "lemon",
    "orange",
    "peach",
    "pineapple",
    "pumpkin",
    "watermelon",
  ],
  bodies: [
    "earth",
    "jupiter",
    "mars",
    "mercury",
    "milkyway",
    "moon",
    "neptune",
    "pluto",
    "saturn",
    "sun",
    "uranus",
    "venus",
  ],
};

const withExt = (names: string[], ext: string) => names.map((n) => `${n}.${ext}`).sort();

/** Folder (relative to frontend/assets) -> exact image files it may hold. Shrinks to {} in #3698. */
const ALLOWED_CASCADE_IMAGES: Record<string, string[]> = {
  "fruit-icons": withExt(THEME_NAMES.fruits, "webp"),
  "fruits-baked": withExt(THEME_NAMES.fruits, "png"),
  "celestial-icons": withExt(THEME_NAMES.bodies, "webp"),
  "cosmos-baked": withExt(THEME_NAMES.bodies, "png"),
};

const IMAGE_EXT = /\.(png|webp|jpe?g|gif|svg|avif)$/i;
// Name heuristic for "looks like Cascade art". If another game ever adds a folder
// whose name matches (e.g. `sprites/`), this guard will flag it: rename the folder
// or narrow this pattern rather than adding the folder to the pinned list.
const CASCADE_DIR = /cascade|fruit|cosmos|celestial|sprite|vertices/i;

function listFiles(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(dir, childRel));
    else out.push(childRel);
  }
  return out;
}

describe("Cascade asset budget guard (#3692)", () => {
  const files = listFiles(ASSETS_DIR);

  it("assets/ holds no Cascade image file or folder outside the pinned allow-list", () => {
    const cascadeImages = files.filter((f) => {
      const parts = f.split("/");
      const inCascadeDir = parts.slice(0, -1).some((d) => CASCADE_DIR.test(d));
      const cascadeNamed = /cascade/i.test(parts[parts.length - 1]) && IMAGE_EXT.test(f);
      return (inCascadeDir && IMAGE_EXT.test(f)) || cascadeNamed;
    });
    const allowed = new Set(
      Object.entries(ALLOWED_CASCADE_IMAGES).flatMap(([dir, names]) =>
        names.map((n) => `${dir}/${n}`)
      )
    );
    const unexpected = cascadeImages.filter((f) => !allowed.has(f));
    expect(unexpected).toEqual([]);
  });

  it("every pinned Cascade folder holds only its pinned files (no additions)", () => {
    for (const [dir, names] of Object.entries(ALLOWED_CASCADE_IMAGES)) {
      const present = files
        .filter((f) => f.startsWith(`${dir}/`))
        .map((f) => f.slice(dir.length + 1))
        .sort();
      expect(present).toEqual(names);
    }
  });

  it("the dead Cascade files deleted in #3692 stay deleted", () => {
    for (const gone of ["fruit-vertices.json", "cosmos-vertices.json", "svg-sprites"]) {
      expect(fs.existsSync(path.join(ASSETS_DIR, gone))).toBe(false);
    }
    for (const gone of ["celestial_images", "fruit_images"]) {
      expect(fs.existsSync(path.join(REPO_ROOT, gone))).toBe(false);
    }
  });
});
