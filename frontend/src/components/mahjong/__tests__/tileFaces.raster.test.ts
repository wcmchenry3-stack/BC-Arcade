/**
 * #3806: the tile-face raster path of `tileFaces.ts` (`Surface.Make` -> `scale` -> `drawSvg` ->
 * `flush` -> `makeImageSnapshot` -> `dispose`) run on real Skia (CanvasKit, the wasm build the web
 * Cascade uses) in Node, where every other Mahjong test stubs Skia out.
 *
 * What is real: the CPU raster surface, the canvas transform, the snapshot, the pixels, and
 * `tileFacesFor` itself (the face box, the `ceil(size * scale)` bitmap size, flushing and disposing
 * each surface, and returning the cached faces on a second call; all asserted below).
 * What is not: SVG parsing. CanvasKit 0.41 (both the default and the `full` build) has no SVG
 * module, and RN Skia's web API (`JsiSkia`) parses SVG with a DOM `<img>`, which Node lacks. So
 * the adapter below stands in for `Skia.SVG` / `canvas.drawSvg` only: `sharp` (librsvg, already a
 * devDependency) rasterises each face to the pixel size the surface will draw it at, and
 * `drawSvg` blits that into the real surface. librsvg is told to fill the box, so a face whose
 * viewBox aspect differs from the face box would be stretched here where Skia would letterbox it
 * (the tile assets share one aspect, so the references match). A change to Skia's own SVG renderer is therefore
 * not covered here; on-device compositing is not either (#3684 needed simulator screenshots,
 * #3801; fixed in #3864).
 *
 * References live in `__raster__/` (a PNG per face and size). `UPDATE_RASTER_REFS=1 npx jest
 * tileFaces.raster` rewrites them. See docs/TESTING.md.
 */
import * as fs from "fs";
import * as path from "path";
import type { CanvasKit, Image as CKImage } from "canvaskit-wasm";
import sharp from "sharp";

import { calculateMahjongLayout, makeBoardCamera } from "../../../game/mahjong/layout";
import { ART_INSET, resetTileFaces, tileFacesFor } from "../tileFaces";

// Skia is replaced for this file only; the adapter is installed in `beforeAll`.
const adapter: { skia: unknown } = { skia: null };
jest.mock("@shopify/react-native-skia", () => ({
  loadData: jest.fn(),
  get Skia() {
    return adapter.skia;
  },
}));

const ASSET_DIR = path.resolve(__dirname, "../../../../assets/mahjong");
const REF_DIR = path.join(__dirname, "__raster__");
const UPDATE = process.env.UPDATE_RASTER_REFS === "1";
/** Mean absolute channel difference (0..1) allowed against a reference. */
const MAX_MEAN_DIFF = 0.03;

/** One face per suit: character, bamboo, circle, dragon, flower. */
const FACE_PREFIXES = ["12-", "29-", "21-", "03-", "39-"];

// A phone (390 x 844, notch) and a tablet (768 x 1024) on Turtle, as MahjongScreen sizes them.
const BOARD = { boardRows: 8, boardCols: 12, boardLayers: 4 };
const phone = makeBoardCamera(
  calculateMahjongLayout({
    screenWidth: 390,
    screenHeight: 844,
    safeAreaTop: 47,
    safeAreaBottom: 34,
    ...BOARD,
  })
);
const tablet = makeBoardCamera(
  calculateMahjongLayout({
    screenWidth: 768,
    screenHeight: 1024,
    safeAreaTop: 24,
    safeAreaBottom: 20,
    ...BOARD,
  })
);
const CASES = [
  { name: "phone390@2x", cam: phone, ratio: 2 },
  { name: "phone390@3x", cam: phone, ratio: 3 },
  { name: "tablet768@2x", cam: tablet, ratio: 2 },
];

let ck: CanvasKit;
/** Surface calls seen by the adapter, to assert `tileFacesFor` flushes and disposes each one. */
const surfaceCalls = { made: 0, flushed: 0, disposed: 0 };

interface Svg {
  readonly source: string;
  /** Pre-rasterised pixels per `WxH`, filled by `prepare`. */
  readonly bitmaps: Map<string, CKImage>;
}

/** Rasterise `svgs` at `pw` x `ph` with librsvg and upload to CanvasKit. */
async function prepare(svgs: Svg[], pw: number, ph: number): Promise<void> {
  for (const svg of svgs) {
    const { data } = await sharp(Buffer.from(svg.source))
      .resize(pw, ph, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const img = ck.MakeImage(
      {
        width: pw,
        height: ph,
        alphaType: ck.AlphaType.Unpremul,
        colorType: ck.ColorType.RGBA_8888,
        colorSpace: ck.ColorSpace.SRGB,
      },
      data,
      pw * 4
    );
    if (!img) throw new Error("MakeImage failed");
    svg.bitmaps.set(`${pw}x${ph}`, img);
  }
}

/** The subset of RN Skia's `Skia` that `tileFaces.ts` uses, on CanvasKit. */
function makeSkia() {
  return {
    SVG: {
      MakeFromData: (source: string) => ({ source, bitmaps: new Map() }) as Svg,
    },
    Surface: {
      Make: (w: number, h: number) => {
        const surface = ck.MakeSurface(w, h); // a CPU raster surface
        if (!surface) return null;
        surfaceCalls.made += 1;
        const canvas = surface.getCanvas();
        const paint = new ck.Paint();
        let sx = 1;
        let sy = 1;
        return {
          getCanvas: () => ({
            scale(x: number, y: number) {
              sx *= x;
              sy *= y;
              canvas.scale(x, y);
            },
            drawSvg(svg: Svg, width: number, height: number) {
              const key = `${Math.round(width * sx)}x${Math.round(height * sy)}`;
              const bitmap = svg.bitmaps.get(key);
              if (!bitmap) throw new Error(`no prepared bitmap for ${key}`);
              canvas.drawImageRect(
                bitmap,
                ck.XYWHRect(0, 0, bitmap.width(), bitmap.height()),
                ck.XYWHRect(0, 0, width, height),
                paint
              );
            },
          }),
          flush: () => {
            surfaceCalls.flushed += 1;
            surface.flush();
          },
          makeImageSnapshot: () => surface.makeImageSnapshot(),
          dispose: () => {
            surfaceCalls.disposed += 1;
            paint.delete();
            surface.delete();
          },
        };
      },
    },
  };
}

function readRgba(img: CKImage): Uint8Array {
  const px = img.readPixels(0, 0, {
    width: img.width(),
    height: img.height(),
    alphaType: ck.AlphaType.Unpremul,
    colorType: ck.ColorType.RGBA_8888,
    colorSpace: ck.ColorSpace.SRGB,
  });
  if (!px) throw new Error("readPixels failed");
  return px as Uint8Array;
}

function faceFiles(): { id: string; source: string }[] {
  const files = fs.readdirSync(ASSET_DIR);
  return FACE_PREFIXES.map((prefix) => {
    const file = files.find((f) => f.startsWith(prefix) && f.endsWith(".svg"))!;
    return {
      id: file.replace(".svg", ""),
      source: fs.readFileSync(path.join(ASSET_DIR, file), "utf8"),
    };
  });
}

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
      path.resolve(__dirname, "../../../../node_modules/canvaskit-wasm/bin/full", f),
  });
  adapter.skia = makeSkia();
});

afterAll(() => {
  globalThis.TextDecoder = expoTextDecoder;
});

describe("tileFaces raster on real CanvasKit (#3806)", () => {
  const faces = faceFiles();

  describe.each(CASES)("$name", ({ cam, ratio }) => {
    const faceW = cam.faceWidth;
    const faceH = cam.faceHeight;
    const pw = Math.ceil((faceW - 2 * ART_INSET) * ratio);
    const ph = Math.ceil((faceH - 2 * ART_INSET) * ratio);
    let svgs: Svg[];
    let images: (CKImage | null)[];
    let calls: typeof surfaceCalls;

    beforeAll(async () => {
      svgs = faces.map((f) => ({ source: f.source, bitmaps: new Map() }) as Svg);
      await prepare(svgs, pw, ph);
      resetTileFaces();
      surfaceCalls.made = surfaceCalls.flushed = surfaceCalls.disposed = 0;
      images = tileFacesFor(svgs as never, faceW, faceH, ratio) as unknown as (CKImage | null)[];
      calls = { ...surfaceCalls };
    });

    afterAll(() => {
      for (const img of images) img?.delete();
      for (const svg of svgs) for (const bitmap of svg.bitmaps.values()) bitmap.delete();
    });

    it("flushes and disposes one surface per face, and returns the cached faces on a second call", () => {
      expect(calls).toEqual({ made: faces.length, flushed: faces.length, disposed: faces.length });
      const again = tileFacesFor(svgs as never, faceW, faceH, ratio);
      expect(again).toBe(images);
      expect(surfaceCalls.made).toBe(faces.length); // no new rasterising
    });

    it.each(faces.map((f, i) => [f.id, i] as const))("%s: size, content, reference", (id, i) => {
      const img = images[i]!;
      expect(img).not.toBeNull();
      // Dimensions: the art box (face minus the inset) times the pixel ratio, rounded up.
      expect(img.width()).toBe(pw);
      expect(img.height()).toBe(ph);

      // Not blank: some opaque pixels, and more than one colour among them.
      const rgba = readRgba(img);
      const colours = new Set<number>();
      let opaque = 0;
      for (let p = 0; p < rgba.length; p += 4) {
        if (rgba[p + 3]! > 0) {
          opaque += 1;
          colours.add((rgba[p]! << 16) | (rgba[p + 1]! << 8) | rgba[p + 2]!);
        }
      }
      expect(opaque).toBeGreaterThan(pw * ph * 0.02);
      expect(colours.size).toBeGreaterThan(1);

      // Reference image.
      const refPath = path.join(REF_DIR, `${id}.${pw}x${ph}.png`);
      if (UPDATE) {
        fs.mkdirSync(REF_DIR, { recursive: true });
        fs.writeFileSync(refPath, img.encodeToBytes()!);
      }
      const ref = ck.MakeImageFromEncoded(fs.readFileSync(refPath));
      expect(ref).not.toBeNull();
      expect(ref!.width()).toBe(pw);
      expect(ref!.height()).toBe(ph);
      const want = readRgba(ref!);
      let sum = 0;
      for (let p = 0; p < rgba.length; p += 1) sum += Math.abs(rgba[p]! - want[p]!);
      expect(sum / rgba.length / 255).toBeLessThan(MAX_MEAN_DIFF);
      ref!.delete();
    });
  });
});
