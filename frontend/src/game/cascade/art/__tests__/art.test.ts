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

import { CAPSTONE_TIER, TIER_COUNT, tierDrawnRadius, tierRadius } from "../../tiers";
import { CELEBRATION_TARGET } from "../../celebration";
import { buildCelebrationStyle } from "../../render/celebrationStyle";
import { FLOOR_THICKNESS, WALL_THICKNESS, WORLD_HEIGHT, WORLD_WIDTH } from "../../constants";
import { CASCADE_BIN_PALETTE } from "../../../../theme/theme.cascade";
import {
  BIN_FLOOR_TOP,
  BIN_INNER_LEFT,
  BIN_INNER_RADIUS,
  BIN_INNER_RIGHT,
  __resetBinCacheForTests,
  binPicture,
} from "../bin";
import { LAYERS, drawLayer, drawPiece, type ArtSet } from "../pen";
import {
  ART_SETS,
  CAPSTONE_RASTER_SCALE,
  MAX_CAPSTONE_SPRITES,
  MAX_SPRITE_SETS,
  capstoneSprite,
  __resetArtCachesForTests,
  artSet,
  pieceSprites,
  piecePicture,
  quantizePx,
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
        const r = tierDrawnRadius(tier);
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
        const r = tierDrawnRadius(tier);
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
  /**
   * How far each overhanging piece's ink reaches past the collider circle, in radii, measured with
   * the outline strokes included (owner-approved 2026-11-14: these are the approved pixels).
   * [left, top, right, bottom]; anything not listed overhangs nowhere.
   */
  const OVERHANG: Record<string, Record<number, [number, number, number, number]>> = {
    // #3920: the Peach (Fruits) and the Moon (Cosmos) are gone, so tiers above them moved down.
    fruits: {
      0: [0, 0.52, 0, 0], // cherry stem
      3: [0, 0.4, 0, 0], // grape stem
      5: [0, 0.4, 0, 0], // apple stem and leaf
      7: [0.12, 0.475, 0.12, 0], // dragonfruit: crown on top, side bracts
      8: [0, 0.45, 0, 0], // pineapple crown
      10: [0, 0.335, 0, 0], // pumpkin stem
    },
    cosmos: {
      6: [0, 0.265, 0, 0.245], // Uranus ring (a tilted ring, both ends)
      7: [0.305, 0, 0.305, 0], // Saturn rings
    },
  };
  /** Measurement slack: one pixel of the R = 200 render, and the box margin. */
  const EPS = 0.006;
  const BOX_MARGIN = 0.03;

  /** The ink's extent past the unit circle on each side, in radii. */
  function inkOverhang(set: ArtSet, tier: number): [number, number, number, number] {
    const R = 200;
    const S = R * 4;
    const { px } = render(S, S, (c) => {
      c.translate(S / 2, S / 2);
      c.scale(R, R);
      for (const layer of LAYERS) drawLayer(c, set, tier, layer);
    });
    let l = S;
    let t = S;
    let r = 0;
    let b = 0;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++)
        if (px[(y * S + x) * 4 + 3]! > 0) {
          l = Math.min(l, x);
          r = Math.max(r, x + 1);
          t = Math.min(t, y);
          b = Math.max(b, y + 1);
        }
    const o = (v: number) => Math.max(0, v / R);
    return [o(S / 2 - l - R), o(S / 2 - t - R), o(r - S / 2 - R), o(b - S / 2 - R)];
  }

  it("each piece overhangs the circle by its measured amount and nowhere else", () => {
    for (const [id, set] of SETS) {
      set.pieces.forEach((art, tier) => {
        const want = OVERHANG[id]![tier] ?? [0, 0, 0, 0];
        const got = inkOverhang(set, tier);
        got.forEach((v, i) => expect(Math.abs(v - want[i]!)).toBeLessThanOrEqual(EPS));
        // The declared box hugs the ink: it contains it, with at most a small margin.
        const [l, t, r, b] = art.box;
        const box = [-1 - l, -1 - t, r - 1, b - 1];
        box.forEach((v, i) => {
          expect(v).toBeGreaterThanOrEqual(got[i]! - 1e-9);
          expect(v).toBeLessThanOrEqual(got[i]! + BOX_MARGIN);
        });
      });
    }
  });

  /**
   * #3920: the retired pieces (`<set>.retired`) are kept as recipes, never drawn in play. Drawing
   * them here keeps them from rotting: each still renders, fills its circle, overhangs by its
   * owner-approved amount (as when it was in the ladder) and stays inside its box.
   */
  const RETIRED: Record<string, Record<string, [number, number, number, number]>> = {
    fruits: {
      peach: [0, 0.28, 0, 0], // stem and leaf
      appleRed: [0, 0.4, 0, 0], // stem and leaf, the same drawing as the green Apple
    },
    cosmos: { moon: [0, 0, 0, 0] },
  };

  it("keeps every retired piece's recipe, and it still draws as approved (#3920)", () => {
    for (const [id, set] of SETS) {
      expect(Object.keys(set.retired ?? {}).sort()).toEqual(Object.keys(RETIRED[id]!).sort());
      for (const [name, piece] of Object.entries(set.retired ?? {})) {
        const one: ArtSet = { pieces: [piece.art], ink: [piece.ink], closedEyes: set.closedEyes };
        const got = inkOverhang(one, 0);
        const want = RETIRED[id]![name]!;
        got.forEach((v, i) =>
          expect({ name, i, v: Math.abs(v - want[i]!) <= EPS }).toEqual({ name, i, v: true })
        );
        const [l, t, r, b] = piece.art.box;
        [-1 - l, -1 - t, r - 1, b - 1].forEach((v, i) => {
          expect(v).toBeGreaterThanOrEqual(got[i]! - 1e-9);
          expect(v).toBeLessThanOrEqual(got[i]! + BOX_MARGIN);
        });
        // The body fills the circle: opaque at its centre and just inside its edge.
        const { px } = render(100, 100, (c) => {
          c.translate(50, 50);
          c.scale(40, 40);
          drawPiece(c, one, 0);
        });
        for (const [x, y] of [
          [50, 50],
          [12, 50],
          [88, 50],
          [50, 88],
        ] as const) {
          expect(px[(y * 100 + x) * 4 + 3]).toBe(255);
        }
      }
    }
  });

  // knip (`npx knip`, `npx knip --production`) sees no unused export for the retired pieces: they
  // are a property of each set's ArtSet, which the board uses, not an export of their own. This
  // pins that shape, so a later `export const RETIRED_...` does not need a knip ignore.
  it("keeps the retired pieces on the sets, with no export of their own (#3920, knip)", () => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    expect(Object.keys(require("../fruits"))).toEqual(["FRUIT_ART"]);
    expect(Object.keys(require("../cosmos"))).toEqual(["COSMOS_ART"]);
    /* eslint-enable @typescript-eslint/no-require-imports */
  });

  it("never puts a retired piece in play: the ladder's pieces are not the retired ones (#3920)", () => {
    for (const [, set] of SETS) {
      for (const piece of Object.values(set.retired ?? {})) {
        expect(set.pieces).not.toContain(piece.art);
      }
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
      const q = quantizePx(px); // rounded up to 0.05, never down
      expect(q).toBeGreaterThanOrEqual(px);
      pieceSprites("cosmos", px).forEach((s, tier) => {
        const r = tierDrawnRadius(tier);
        expect(s!.light.width()).toBe(Math.ceil(2 * r * q));
        expect(s!.body.width()).toBeGreaterThanOrEqual(s!.rect[2] * px - 1e-9);
        expect(s!.body.width() / s!.rect[2]).toBeCloseTo(q, 9);
      });
    }
  });

  it("rounds the pixel scale in the key: a one-pixel resize reuses the set", () => {
    expect(quantizePx(2.625)).toBeCloseTo(2.65, 9);
    expect(quantizePx(2.65)).toBeCloseTo(2.65, 9);
    const a = pieceSprites("fruits", 2.626);
    expect(pieceSprites("fruits", 2.649)).toBe(a);
    expect(pieceSprites("fruits", 2.651)).not.toBe(a);
  });

  it("never evicts or disposes the set just requested, however many keys follow", () => {
    for (let i = 0; i < MAX_SPRITE_SETS * 3; i++) {
      const active = pieceSprites("fruits", 1 + i * 0.5);
      const spies = active.map((s) => jest.spyOn(s!.body, "dispose"));
      expect(pieceSprites("fruits", 1 + i * 0.5)).toBe(active);
      spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    }
  });

  it("stops rasterising a tier after its first failed layer", () => {
    const real = adapter.skia;
    const make = jest.fn(() => null);
    adapter.skia = { ...Skia, Surface: { Make: make } };
    try {
      pieceSprites("fruits", 7);
      expect(make).toHaveBeenCalledTimes(TIER_COUNT); // body only, once per tier
    } finally {
      adapter.skia = real;
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

  it("disposes the icon pictures when the picture cache clears", () => {
    const first = piecePicture("fruits", 0, 10)!;
    const spy = jest.spyOn(first, "dispose");
    for (let size = 11; size < 11 + 100; size++) piecePicture("fruits", 0, size);
    expect(spy).toHaveBeenCalled();
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
            if (out)
              expect({ id, tier, x, y, a: px[(y * W + x) * 4 + 3] }).toEqual({
                id,
                tier,
                x,
                y,
                a: 0,
              });
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

// #3699: the win celebration's capstone: its cheering face, and its bigger raster.
describe("the capstone's cheering face and celebration raster (#3699)", () => {
  const R = 100;
  const S = R * 4;
  function capstone(set: ArtSet, face: "top" | "cheer"): Uint8Array {
    return render(S, S, (c) => {
      c.translate(S / 2, S / 2);
      c.scale(R, R);
      for (const layer of ["body", "light", face] as const) drawLayer(c, set, CAPSTONE_TIER, layer);
    }).px;
  }

  it.each(SETS)("%s: a face of its own, inside the capstone's box", (_id, set) => {
    const own = capstone(set, "top");
    const cheer = capstone(set, "cheer");
    let changed = 0;
    for (let i = 0; i < own.length; i += 4) if (own[i] !== cheer[i]) changed++;
    // The face changed (arc eyes, open smile), and nothing else did: the same silhouette.
    expect(changed).toBeGreaterThan(R * R * 0.02);
    const [l, t, r, b] = set.pieces[CAPSTONE_TIER]!.box;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const inBox =
          x >= S / 2 + l * R - 1 &&
          x <= S / 2 + r * R + 1 &&
          y >= S / 2 + t * R - 1 &&
          y <= S / 2 + b * R + 1;
        if (!inBox) expect(cheer[(y * S + x) * 4 + 3]).toBe(0);
        expect(cheer[(y * S + x) * 4 + 3]! > 0).toBe(own[(y * S + x) * 4 + 3]! > 0);
      }
  });

  it("rasterises the capstone once at 1.4x the board's pixel scale, with the cheering face", () => {
    const sprite = capstoneSprite("fruits", 3)!;
    expect(sprite).not.toBeNull();
    expect(capstoneSprite("fruits", 3)).toBe(sprite);
    const q = quantizePx(3 * CAPSTONE_RASTER_SCALE);
    const r = tierDrawnRadius(CAPSTONE_TIER);
    expect(sprite.light.width()).toBe(Math.ceil(2 * r * q));
    expect(sprite.cheer.width()).toBe(sprite.top.width());
    // Sharper than the board's own capstone, which it is drawn up from (never scaled up past it).
    const board = pieceSprites("fruits", 3)[CAPSTONE_TIER]!;
    expect(sprite.body.width()).toBeGreaterThan(board.body.width() * 1.37);
  });

  it(`keeps ${MAX_CAPSTONE_SPRITES} capstone rasters and disposes the least recently used`, () => {
    const first = capstoneSprite("fruits", 1)!;
    const evicted = jest.spyOn(first.cheer, "dispose");
    capstoneSprite("cosmos", 1);
    expect(evicted).not.toHaveBeenCalled();
    capstoneSprite("fruits", 2);
    expect(evicted).toHaveBeenCalled();
  });

  it("is null, not a throw, when Skia cannot draw it", () => {
    const real = adapter.skia;
    adapter.skia = { ...Skia, Surface: { Make: () => null } };
    try {
      expect(capstoneSprite("cosmos", 5)).toBeNull();
    } finally {
      adapter.skia = real;
    }
  });

  it.each(["fruits", "cosmos"] as const)(
    "%s: the celebration builds and draws a frame on real Skia",
    (setId) => {
      const style = buildCelebrationStyle({
        setId,
        theme: setId === "fruits" ? "light" : "dark",
        reduceMotion: false,
        sprite: capstoneSprite(setId, 1),
      })!;
      expect(style).not.toBeNull();
      expect(style.cheer).not.toBeNull();
      const frame = new Float64Array([1, 0, 0, -1, 9, CAPSTONE_TIER, 120, 470, 0.4, 1, 1]);
      // Loaded now, not at the top: the worklets transform captures `Skia` when the module loads,
      // and the real Skia is only installed in `beforeAll`.
      let drawCelebration!: typeof import("../../render/drawCelebration").drawCelebration;
      jest.isolateModules(() => {
        drawCelebration = require("../../render/drawCelebration").drawCelebration; // eslint-disable-line @typescript-eslint/no-require-imports
      });
      const { px } = render(WORLD_WIDTH, WORLD_HEIGHT, (c) =>
        drawCelebration(c, frame, style, 1200)
      );
      // The capstone is drawn at the board centre (its middle pixel is opaque).
      const at = (Math.round(CELEBRATION_TARGET.y) * WORLD_WIDTH + CELEBRATION_TARGET.x) * 4;
      expect(px[at + 3]).toBe(255);
      // And the dim is over the pile (bottom-left of the cavity).
      expect(px[(560 * WORLD_WIDTH + 40) * 4 + 3]).toBeGreaterThan(0);
    }
  );
});

describe("the bin (soft outline)", () => {
  beforeEach(() => __resetBinCacheForTests());

  /** The bin of `theme` at 1 px per world unit: a pixel reader. */
  function binPixels(theme: "light" | "dark") {
    const { px } = render(WORLD_WIDTH, WORLD_HEIGHT, (c) => c.drawPicture(binPicture(theme)));
    return (x: number, y: number) => {
      const i = (y * WORLD_WIDTH + x) * 4;
      return [px[i]!, px[i + 1]!, px[i + 2]!, px[i + 3]!];
    };
  }
  const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const near = (a: number[], b: number[], tol: number) =>
    a.slice(0, 3).every((v, i) => Math.abs(v - b[i]!) <= tol);

  it("puts the inner faces and floor top exactly at the physics", () => {
    expect(BIN_INNER_LEFT).toBe(WALL_THICKNESS);
    expect(BIN_INNER_RIGHT).toBe(WORLD_WIDTH - WALL_THICKNESS);
    expect(BIN_FLOOR_TOP).toBe(WORLD_HEIGHT - FLOOR_THICKNESS);
    expect(BIN_INNER_RADIUS).toBeLessThanOrEqual(tierRadius(0));
  });

  it.each(["light", "dark"] as const)(
    "%s: the solid rail is outside the cavity and the cavity is clear to the floor",
    (theme) => {
      const at = binPixels(theme);
      const accent = hex(CASCADE_BIN_PALETTE[theme].accent);
      const surface = hex(CASCADE_BIN_PALETTE[theme].surface);
      const mid = Math.floor(WORLD_WIDTH / 2);
      // Rail: solid accent on the band side of each face and under the floor top.
      expect(near(at(WALL_THICKNESS - 2, 300), accent, 2)).toBe(true);
      expect(near(at(WORLD_WIDTH - WALL_THICKNESS + 1, 300), accent, 2)).toBe(true);
      expect(near(at(mid, BIN_FLOOR_TOP + 2), accent, 2)).toBe(true);
      // Cavity: no rail ink at or inside the face, and none above the floor top.
      expect(near(at(WALL_THICKNESS, 300), accent, 12)).toBe(false);
      expect(near(at(WALL_THICKNESS + 1, 300), accent, 12)).toBe(false);
      expect(near(at(mid, BIN_FLOOR_TOP - 1), accent, 12)).toBe(false);
      // Above the wash the cavity is the card surface.
      expect(near(at(mid, 100), surface, 1)).toBe(true);
      // The inner bottom corner is rounded: the square corner (21, 579) is band, not cavity.
      expect(
        near(at(WALL_THICKNESS + BIN_INNER_RADIUS, BIN_FLOOR_TOP - BIN_INNER_RADIUS), accent, 12)
      ).toBe(false);
      expect(near(at(WALL_THICKNESS + 1, BIN_FLOOR_TOP - 1), surface, 6)).toBe(false);
    }
  );

  it("draws the same in both sets, once per theme", () => {
    expect(binPicture("dark")).toBe(binPicture("dark"));
    expect(binPicture("dark")).not.toBe(binPicture("light"));
  });

  it("is null, not a throw, when Skia cannot record", () => {
    const real = adapter.skia;
    adapter.skia = {
      ...Skia,
      PictureRecorder: () => {
        throw new Error("no");
      },
    };
    try {
      expect(binPicture("light")).toBeNull();
    } finally {
      adapter.skia = real;
    }
  });
});
