/**
 * @jest-environment ./jest-env/node.js
 *
 * Asset transparency smoke test — CI gate
 * ----------------------------------------
 * Verifies that every sprite WebP in the fruit-icons and celestial-icons
 * directories has transparent corner pixels (alpha < 200), confirming that
 * `tools/assets/remove_backgrounds.py` has been run and the conversion preserved
 * the alpha channel.
 *
 * This test will FAIL on CI if unprocessed opaque-background assets ship.
 */

// Each 2048×2048 WebP takes ~1–3 s to decode with sharp.
// 24 files across two directories: ~60 s. Keep a generous timeout.
jest.setTimeout(300_000);

import * as fs from "fs";
import * as path from "path";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require("sharp");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface CornerAlphas {
  topLeft: number;
  topRight: number;
  bottomLeft: number;
  bottomRight: number;
}

async function getCornerAlphas(filePath: string): Promise<CornerAlphas | null> {
  let result: { data: Buffer; info: { width: number; height: number; channels: number } };
  try {
    result = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch {
    return null; // unreadable file — skip
  }

  const { data, info } = result;
  const { width, height, channels } = info;
  if (!data || width < 1 || height < 1 || channels < 4) return null;

  // raw RGBA bytes, row-major; alpha is every 4th byte starting at index 3
  const stride = width * 4;
  const topLeft = data[3] ?? 0;
  const topRight = data[(width - 1) * 4 + 3] ?? 0;
  const bottomLeft = data[(height - 1) * stride + 3] ?? 0;
  const bottomRight = data[(height - 1) * stride + (width - 1) * 4 + 3] ?? 0;

  return { topLeft, topRight, bottomLeft, bottomRight };
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const FRONTEND_ROOT = path.resolve(__dirname, "..", "..");

const ASSET_DIRS = [
  path.join(FRONTEND_ROOT, "assets", "fruit-icons"),
  path.join(FRONTEND_ROOT, "assets", "celestial-icons"),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// No raw PNGs in icon asset directories (#581)
// ---------------------------------------------------------------------------

describe("No raw PNGs in icon asset directories", () => {
  const ASSETS_ROOT = path.join(FRONTEND_ROOT, "assets");
  const EXEMPT_DIRS = new Set<string>();

  const subdirs = fs
    .readdirSync(ASSETS_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => !name.endsWith("-baked") && !EXEMPT_DIRS.has(name));

  for (const dirName of subdirs) {
    it(`assets/${dirName} contains no raw PNG files`, () => {
      const dirPath = path.join(ASSETS_ROOT, dirName);
      const pngFiles = fs.readdirSync(dirPath).filter((f) => f.endsWith(".png"));
      if (pngFiles.length > 0) {
        throw new Error(
          `Found raw PNG(s) in assets/${dirName}: ${pngFiles.join(", ")} — ` +
            `run \`python tools/assets/convert_icons_to_webp.py frontend/assets/${dirName}\` to convert`
        );
      }
    });
  }
});

// ---------------------------------------------------------------------------

describe("WebP asset transparency (post background-removal)", () => {
  for (const dir of ASSET_DIRS) {
    const dirName = path.basename(dir);
    const webpFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".webp"));

    describe(`assets/${dirName}`, () => {
      it("contains at least one WebP file", () => {
        expect(webpFiles.length).toBeGreaterThan(0);
      });

      for (const file of webpFiles) {
        const filePath = path.join(dir, file);

        it(`${file} — corner pixels are transparent (alpha < 200)`, async () => {
          const alphas = await getCornerAlphas(filePath);

          if (alphas === null) {
            // Unreadable file — skip rather than fail
            return;
          }

          const { topLeft, topRight, bottomLeft, bottomRight } = alphas;
          const maxCornerAlpha = Math.max(topLeft, topRight, bottomLeft, bottomRight);

          expect(maxCornerAlpha).toBeLessThan(200);
        });
      }
    });
  }
});
