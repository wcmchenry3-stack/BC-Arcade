/**
 * #3698: Cascade's code-drawn pieces, rendered on real Skia: RN Skia's web API (`JsiSkApi`) on
 * CanvasKit, the wasm build web Cascade uses, in Node. Every other Cascade test stubs Skia out.
 *
 * Pinned here: every tier of both sets has a drawing; the body is drawn at the ladder radius and
 * fills the collider; nothing is drawn outside a piece's declared `box`, and only the
 * owner-approved pieces overhang the circle at all; output is deterministic and matches the
 * reference sheet (`__raster__/sheet.png`, `UPDATE_RASTER_REFS=1 npx jest art.test` rewrites it,
 * docs/TESTING.md); the sprite and picture caches key on set, size and pixel scale and never
 * hand out a bitmap smaller than the screen pixels it covers.
 *
 * Not covered: native Skia (Ganesh/Graphite on device), see the Manual QA list in the PR.
 */
import * as fs from "fs";
import * as path from "path";
import type { CanvasKit } from "canvaskit-wasm";
import type { SkImage, SkSurface } from "@shopify/react-native-skia";

import { TIER_COUNT, tierRadius } from "../../tiers";
import { LAYERS, drawLayer, drawPiece, type ArtSet } from "../pen";
import {
  ART_SETS,
  MAX_SPRITE_SETS,
  __resetArtCachesForTests,
  artSet,
  pieceSprites,
  piecePicture,
} from "../sprites";

// Skia is the real web API on CanvasKit for this file; installed in `beforeAll`.
const adapter: { skia: unknown } = { skia: null };
// The enums are Skia's own; `Skia` is a live getter (a spread would read it once, as null).
jest.mock("@shopify/react-native-skia", () =>
  Object.defineProperty(
    { ...jest.requireActual("@shopify/react-native-skia/lib/commonjs/skia/types") },
    "Skia",
    { get: () => adapter.skia, enumerable: true }
  )
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySkia = any;
let ck: CanvasKit;
let Skia: AnySkia;

const REF = path.join(__dirname, "__raster__", "sheet.png");
const UPDATE = process.env.UPDATE_RASTER_REFS === "1";
/** Mean absolute channel difference (0..1) allowed against the reference. */
const MAX_MEAN_DIFF = 0.01;

const expoTextDecoder = globalThis.TextDecoder;

beforeAll(async () => {
  // CanvasKit's loader decodes utf-16le; jest-expo's TextDecoder polyfill does not (Node's does).
  globalThis.TextDecoder = require("util").TextDecoder; // eslint-disable-line @typescript-eslint/no-require-imports
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const init = require("canvaskit-wasm/bin/full/canvaskit") as (o: {
    locateFile: (f: string) => string;
  }) => Promise<CanvasKit>;
  ck = await init({
    locateFile: (f) =>
      path.resolve(__dirname, "../../../../../node_modules/canvaskit-wasm/bin/full", f),
  });
  (globalThis as { CanvasKit?: CanvasKit }).CanvasKit = ck;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { JsiSkApi } = require("@shopify/react-native-skia/lib/commonjs/skia/web");
  Skia = JsiSkApi(ck);
  adapter.skia = Skia;
});

afterAll(() => {
  globalThis.TextDecoder = expoTextDecoder;
});

beforeEach(() => __resetArtCachesForTests());

function rgba(img: SkImage): Uint8Array {
  return img.readPixels(0, 0, img.getImageInfo()) as Uint8Array;
}

/** Draws with `fn` on a w x h surface and returns its pixels. */
function render(w: number, h: number, fn: (c: AnySkia) => void): { img: SkImage; px: Uint8Array } {
  const surface: SkSurface = Skia.Surface.Make(w, h);
  fn(surface.getCanvas());
  surface.flush();
  const img = surface.makeImageSnapshot();
  surface.dispose();
  return { img, px: rgba(img) };
}

const SETS = Object.entries(ART_SETS) as [string, ArtSet][];

describe("the pieces", () => {
  it("every tier of both sets has a drawing", () => {
    for (const [, set] of SETS) {
      expect(set.pieces).toHaveLength(TIER_COUNT);
      expect(set.ink).toHaveLength(TIER_COUNT);
    }
    for (const [id] of SETS) {
      for (let tier = 0; tier < TIER_COUNT; tier++) {
        const sprite = pieceSprites(id, 2)[tier];
        expect(sprite).not.toBeNull();
        // Some ink in every layer.
        for (const img of [sprite!.body, sprite!.light, sprite!.top]) {
          const px = rgba(img);
          let ink = 0;
          for (let i = 3; i < px.length; i += 4) if (px[i]! > 0) ink++;
          expect(ink).toBeGreaterThan(0);
        }
      }
    }
  });

  it("an unknown set id draws Fruits", () => {
    expect(artSet("nope")).toBe(ART_SETS.fruits);
  });
});

describe("drawn radius = ladder radius", () => {
  const PX = 3;

  it("places every tier's bitmaps at its ladder radius", () => {
    for (const [id, set] of SETS) {
      const sprites = pieceSprites(id, PX);
      for (let tier = 0; tier < TIER_COUNT; tier++) {
        const r = tierRadius(tier);
        const s = sprites[tier]!;
        // The light covers exactly the collider's square.
        const side = Math.ceil(2 * r * PX) / PX;
        expect(s.lightRect).toEqual([-r, -r, side, side]);
        const [l, t, rr, b] = set.pieces[tier]!.box;
        expect(s.rect[0]).toBeCloseTo(l * r, 9);
        expect(s.rect[1]).toBeCloseTo(t * r, 9);
        expect(s.rect[2]).toBeGreaterThanOrEqual((rr - l) * r);
        expect(s.rect[3]).toBeGreaterThanOrEqual((b - t) * r);
      }
    }
  });

  it("fills the collider circle to its edge, and stops there where nothing overhangs", () => {
    for (const [id, set] of SETS) {
      const sprites = pieceSprites(id, PX);
      for (let tier = 0; tier < TIER_COUNT; tier++) {
        const r = tierRadius(tier);
        const s = sprites[tier]!;
        const px = rgba(s.body);
        const w = s.body.width();
        // Bitmap pixel at world (x, y) around the centre.
        const alpha = (x: number, y: number) => {
          const i = Math.floor((y - s.rect[1]) * PX) * w + Math.floor((x - s.rect[0]) * PX);
          return px[i * 4 + 3]!;
        };
        const inside = r - 1.5 / PX;
        for (let a = 0; a < 360; a += 15) {
          const rad = (a * Math.PI) / 180;
          expect(alpha(Math.cos(rad) * inside, Math.sin(rad) * inside)).toBe(255);
        }
        // Straight down, past the edge: empty, unless the piece declares a bottom overhang.
        if (set.pieces[tier]!.box[3] <= 1) {
          const edge = r + 1.5 / PX;
          if (edge < s.rect[1] + s.rect[3]) expect(alpha(0, edge)).toBe(0);
        }
      }
    }
  });
});

describe("overhangs", () => {
  /** Pieces that draw outside the collider (owner-approved list, 2026-11-14). */
  const OVERHANGING: Record<string, number[]> = {
    // cherry, grape, apple, peach, dragonfruit, pineapple, pumpkin (stems, leaves, crowns)
    fruits: [0, 3, 5, 6, 8, 9, 11],
    // Uranus and Saturn (rings)
    cosmos: [7, 8],
  };
  /** The largest overhang allowed, any piece, in radii: the cherry's stem with its cap. */
  const MAX_OVERHANG = 0.55;

  it("only the approved pieces declare a box past the circle, and none past the cap", () => {
    for (const [id, set] of SETS) {
      set.pieces.forEach((art, tier) => {
        const [l, t, r, b] = art.box;
        const over = Math.max(-1 - l, -1 - t, r - 1, b - 1);
        expect(over).toBeLessThanOrEqual(MAX_OVERHANG);
        if (OVERHANGING[id]!.includes(tier)) expect(over).toBeGreaterThan(0);
        else expect(art.box).toEqual([-1, -1, 1, 1]);
      });
    }
  });

  it("draws nothing outside each piece's box", () => {
    const R = 100;
    const S = R * 4;
    for (const [, set] of SETS) {
      set.pieces.forEach((art, tier) => {
        const { px } = render(S, S, (c) => {
          c.translate(S / 2, S / 2);
          c.scale(R, R);
          for (const layer of LAYERS) drawLayer(c, set, tier, layer);
        });
        const [l, t, r, b] = art.box.map((v) => S / 2 + v * R);
        let outside = 0;
        for (let y = 0; y < S; y++)
          for (let x = 0; x < S; x++)
            if (px[(y * S + x) * 4 + 3]! > 0 && (x < l! || x >= r! || y < t! || y >= b!))
              outside++;
        expect({ tier, outside }).toEqual({ tier, outside: 0 });
      });
    }
  });
});

describe("deterministic output", () => {
  /** Both sets, upright, a row each, at a 22 px radius (about game size) on a dark bin colour. */
  function sheet(): { img: SkImage; px: Uint8Array } {
    const cell = 64;
    return render(cell * TIER_COUNT, cell * 2, (c) => {
      c.clear(Skia.Color("#19191f"));
      SETS.forEach(([, set], row) =>
        set.pieces.forEach((_, tier) => {
          c.save();
          c.translate(cell * tier + cell / 2, cell * row + cell / 2 + 6);
          c.scale(22, 22);
          drawPiece(c, set, tier);
          c.restore();
        })
      );
    });
  }

  it("draws the same pixels every time", () => {
    expect(Buffer.from(sheet().px).equals(Buffer.from(sheet().px))).toBe(true);
  });

  it("matches the reference piece sheet", () => {
    const { img, px } = sheet();
    if (UPDATE) {
      fs.mkdirSync(path.dirname(REF), { recursive: true });
      fs.writeFileSync(REF, Buffer.from(img.encodeToBytes()));
    }
    expect(fs.existsSync(REF)).toBe(true);
    const ref = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(fs.readFileSync(REF)));
    expect([ref.width(), ref.height()]).toEqual([img.width(), img.height()]);
    const want = rgba(ref);
    let sum = 0;
    for (let i = 0; i < px.length; i++) sum += Math.abs(px[i]! - want[i]!);
    expect(sum / px.length / 255).toBeLessThan(MAX_MEAN_DIFF);
  });
});

describe("caches", () => {
  it("returns the same sprites for the same set and pixel scale", () => {
    const a = pieceSprites("fruits", 2);
    expect(pieceSprites("fruits", 2)).toBe(a);
    expect(pieceSprites("cosmos", 2)).not.toBe(a);
    expect(pieceSprites("fruits", 3)).not.toBe(a);
  });

  it("rasterises at screen size x pixel ratio: never fewer bitmap pixels than screen pixels", () => {
    for (const px of [1, 2.625, 3]) {
      pieceSprites("cosmos", px).forEach((s, tier) => {
        const r = tierRadius(tier);
        expect(s!.light.width()).toBe(Math.ceil(2 * r * px));
        expect(s!.body.width()).toBeGreaterThanOrEqual(s!.rect[2] * px - 1e-9);
        expect(s!.body.width() / s!.rect[2]).toBeCloseTo(px, 9);
      });
    }
  });

  it(`keeps ${MAX_SPRITE_SETS} sprite sets and disposes the least recently used`, () => {
    const first = pieceSprites("fruits", 1);
    const dispose = jest.spyOn(first[0]!.body, "dispose");
    const second = pieceSprites("fruits", 2);
    const evicted = jest.spyOn(second[0]!.body, "dispose");
    pieceSprites("fruits", 3);
    expect(pieceSprites("fruits", 1)).toBe(first); // used again: now the most recent
    expect(evicted).not.toHaveBeenCalled();
    pieceSprites("cosmos", 1); // a fourth set: evicts fruits@2, the least recently used
    expect(evicted).toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
    expect(pieceSprites("fruits", 1)).toBe(first);
  });

  it("records one icon picture per set, tier and size", () => {
    const p = piecePicture("fruits", 8, 22);
    expect(p).not.toBeNull();
    expect(piecePicture("fruits", 8, 22)).toBe(p);
    expect(piecePicture("fruits", 8, 16)).not.toBe(p);
    expect(piecePicture("cosmos", 8, 22)).not.toBe(p);
    expect(piecePicture("fruits", 42, 22)).toBeNull();
  });

  it("fits a piece and its overhangs inside the icon square", () => {
    for (const [id, set] of SETS) {
      set.pieces.forEach((_, tier) => {
        const size = 40;
        const { px } = render(size + 20, size + 20, (c) => {
          c.translate(10, 10);
          c.drawPicture(piecePicture(id, tier, size));
        });
        const W = size + 20;
        for (let y = 0; y < W; y++)
          for (let x = 0; x < W; x++) {
            const out = x < 10 || y < 10 || x >= 10 + size || y >= 10 + size;
            if (out) expect(px[(y * W + x) * 4 + 3]).toBe(0);
          }
      });
    }
  });

  it("leaves a tier null (placeholder circle) when Skia cannot draw it", () => {
    const real = adapter.skia;
    adapter.skia = { ...Skia, Surface: { Make: () => null } };
    try {
      expect(pieceSprites("fruits", 7).every((s) => s === null)).toBe(true);
    } finally {
      adapter.skia = real;
    }
  });
});
