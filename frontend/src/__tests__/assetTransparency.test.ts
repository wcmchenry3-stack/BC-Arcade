/**
 * @jest-environment node
 *
 * Asset format gate: no raw PNGs in `frontend/assets/` sub-folders (#581).
 *
 * This file also checked the corner transparency of the Cascade icon WebPs
 * (`fruit-icons/`, `celestial-icons/`); those went in #3698 when the pieces became
 * code-drawn (`game/cascade/art/`), and `game/cascade/__tests__/assetBudget.test.ts`
 * keeps Cascade images out of `assets/`.
 */
import * as fs from "fs";
import * as path from "path";

const FRONTEND_ROOT = path.resolve(__dirname, "..", "..");

describe("No raw PNGs in icon asset directories", () => {
  const ASSETS_ROOT = path.join(FRONTEND_ROOT, "assets");
  const EXEMPT_DIRS = new Set<string>();

  const subdirs = fs
    .readdirSync(ASSETS_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => !EXEMPT_DIRS.has(name));

  for (const dirName of subdirs) {
    it(`assets/${dirName} contains no raw PNG files`, () => {
      const dirPath = path.join(ASSETS_ROOT, dirName);
      const pngFiles = fs.readdirSync(dirPath).filter((f) => f.endsWith(".png"));
      if (pngFiles.length > 0) {
        throw new Error(
          `Found raw PNG(s) in assets/${dirName}: ${pngFiles.join(", ")} — ` +
            "convert them to WebP before committing (docs/ASSETS.md)"
        );
      }
    });
  }
});
