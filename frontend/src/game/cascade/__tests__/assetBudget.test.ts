/**
 * #3692: Cascade art budget guard. Cascade piece art is drawn in code (<= 20 KB, no image
 * files; #3698 `game/cascade/art/`), so `frontend/assets/` must not gain Cascade image files,
 * no Cascade source may import an image, and the dead pipeline outputs deleted in #3692 and the
 * sprites deleted in #3698 must not come back. See docs/PERFORMANCE.md "Cascade size budget".
 *
 * ALLOWED_CASCADE_IMAGES is empty since #3698: any Cascade image file or folder fails here.
 */
import * as fs from "fs";
import * as path from "path";

const ASSETS_DIR = path.join(__dirname, "../../../../assets");
const REPO_ROOT = path.join(ASSETS_DIR, "../..");

/** Folder (relative to frontend/assets) -> exact image files it may hold. Empty since #3698. */
const ALLOWED_CASCADE_IMAGES: Record<string, string[]> = {};

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

  it("the unreferenced files deleted in #3845 stay deleted", () => {
    for (const gone of [
      "fruit-icons/pumpkin.webp",
      "fruits-baked/pumpkin.png",
      "celestial-icons/milkyway.webp",
      "cosmos-baked/milkyway.png",
      "sounds/hearts-moon-shot.mp3",
      "sounds/solitaire-invalid-move.ogg",
    ]) {
      expect(fs.existsSync(path.join(ASSETS_DIR, gone))).toBe(false);
    }
  });

  it("the sprite folders replaced by code-drawn art in #3698 stay deleted", () => {
    for (const gone of ["fruit-icons", "fruits-baked", "celestial-icons", "cosmos-baked"]) {
      expect(fs.existsSync(path.join(ASSETS_DIR, gone))).toBe(false);
    }
  });

  it("no Cascade source imports or requires an image (#3698)", () => {
    const SRC = path.join(ASSETS_DIR, "../src");
    const roots = ["game/cascade", "components/cascade", "theme/fruitSets.ts"];
    const sources = roots.flatMap((r) => {
      const full = path.join(SRC, r);
      if (fs.statSync(full).isFile()) return [full];
      return listFiles(full)
        .filter((f) => !f.includes("__tests__") && /\.(ts|tsx)$/.test(f))
        .map((f) => path.join(full, f));
    });
    expect(sources.length).toBeGreaterThan(10);
    const IMAGE_IMPORT = /(?:from\s+|require\(\s*)["'][^"']+\.(png|webp|jpe?g|gif|svg|avif)["']/;
    const offenders = sources.filter((f) => IMAGE_IMPORT.test(fs.readFileSync(f, "utf8")));
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
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
