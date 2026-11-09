/**
 * #2963: the background and starfield are recorded once into their own Pictures — one per depth
 * layer — and slid on the UI thread, instead of 96 display-list ops every frame.
 * #3597: the backdrop Picture also holds the nebula, and the stars are tinted by depth.
 */
type Gradient = { center: unknown; radius: number; colors: number[]; mode: number };
type Call = { fn: string; args: unknown[]; color?: number; shader?: Gradient | null };
const mockRecorded: { size: unknown; calls: Call[] }[] = [];
const mockDispose = jest.fn();
/** #3597: what the recorders free once they are done (kinds: "paint", "shader"). */
const mockFreed: string[] = [];

jest.mock("@shopify/react-native-skia", () => ({
  Skia: {
    Color: (packed: number) => ({ packed }),
    Paint: () => {
      const p = {
        color: 0,
        antiAlias: false,
        shader: null as Gradient | null,
        setColor: (c: { packed: number }) => {
          p.color = c.packed;
        },
        setAntiAlias: (b: boolean) => {
          p.antiAlias = b;
        },
        setShader: (sh: Gradient) => {
          p.shader = sh;
        },
        dispose: () => mockFreed.push("paint"),
      };
      return p;
    },
    Shader: {
      MakeRadialGradient: (
        center: unknown,
        radius: number,
        colors: { packed: number }[],
        _pos: unknown,
        mode: number
      ) =>
        // dispose is not enumerable, so a recorded shader still compares as plain data
        Object.defineProperty(
          { center, radius, colors: colors.map((c) => c.packed), mode },
          "dispose",
          { value: () => mockFreed.push("shader") }
        ),
    },
  },
  TileMode: { Clamp: 0 },
  createPicture: (draw: (canvas: object) => void, size: unknown) => {
    const calls: Call[] = [];
    draw({
      drawColor: (c: { packed: number }) => calls.push({ fn: "drawColor", args: [c.packed] }),
      drawCircle: (
        cx: number,
        cy: number,
        r: number,
        p: { color: number; antiAlias: boolean; shader: Gradient | null }
      ) =>
        calls.push({
          fn: "drawCircle",
          args: [cx, cy, r, p.antiAlias],
          color: p.color,
          ...(p.shader ? { shader: p.shader } : {}),
        }),
    });
    mockRecorded.push({ size, calls });
    return { id: mockRecorded.length - 1, dispose: mockDispose };
  },
}));

import {
  BACKGROUND,
  disposeStarfield,
  layerTransform,
  recordStarfield,
} from "../render/starfieldPictures";
import { withAlpha } from "../render/color";
import { nebulaBlobs } from "../render/nebula";
import { STAR_FAR_RGB, STAR_MID_RGB, STAR_NEAR_RGB } from "../render/palette";
import { initStarfield, starLayers, tickStarfield } from "../starfield";

beforeEach(() => {
  mockRecorded.length = 0;
  mockFreed.length = 0;
});

describe("recordStarfield", () => {
  it("records the background, then one Picture per depth layer, at the canvas size", () => {
    const sf = initStarfield(400, 700);
    const pics = recordStarfield(sf);
    expect(mockRecorded).toHaveLength(4);
    expect(mockRecorded.every((r) => JSON.stringify(r.size) === '{"width":400,"height":700}')).toBe(
      true
    );
    expect(mockRecorded[0]!.calls[0]).toEqual({ fn: "drawColor", args: [BACKGROUND] });
    expect(pics.backdrop).toMatchObject({ id: 0 });
    expect(pics.layers.map((l) => l.speed)).toEqual([0.02, 0.05, 0.1]);
    expect(pics.layers.map((l) => (l.picture as unknown as { id: number }).id)).toEqual([1, 2, 3]);
  });

  it("#3597: the backdrop paints the nebula over the fill, one soft radial gradient per blob", () => {
    const sf = initStarfield(400, 700);
    recordStarfield(sf);
    const blobs = nebulaBlobs(400, 700);
    expect(blobs.length).toBeGreaterThan(0);
    const [fill, ...clouds] = mockRecorded[0]!.calls;
    expect(fill).toEqual({ fn: "drawColor", args: [BACKGROUND] });
    expect(clouds).toHaveLength(blobs.length);
    clouds.forEach((c, i) => {
      const b = blobs[i]!;
      expect(c).toMatchObject({ fn: "drawCircle", args: [b.cx, b.cy, b.r, true] });
      // from the blob's colour at its alpha in the centre to fully transparent at the edge
      expect(c.shader).toEqual({
        center: { x: b.cx, y: b.cy },
        radius: b.r,
        colors: [withAlpha(b.rgb, b.alpha), withAlpha(b.rgb, 0)],
        mode: 0,
      });
      expect(b.alpha).toBeLessThanOrEqual(0.3); // subtle
    });
  });

  it("each layer draws its stars where they start, in draw order, as antialiased dots tinted by depth", () => {
    const sf = initStarfield(400, 700);
    recordStarfield(sf);
    const tints = [STAR_FAR_RGB, STAR_MID_RGB, STAR_NEAR_RGB];
    starLayers(sf).forEach((layer, i) => {
      const calls = mockRecorded[i + 1]!.calls;
      expect(calls).toHaveLength(layer.stars.length);
      layer.stars.forEach((star, j) => {
        expect(star.rgb).toBe(tints[i]);
        expect(calls[j]).toEqual({
          fn: "drawCircle",
          args: [star.x, star.y, star.r, true],
          color: withAlpha(tints[i]!, star.opacity),
        });
      });
    });
  });

  it("depends on the layout alone — a scrolled starfield records the same pictures", () => {
    const sf = initStarfield(400, 700);
    recordStarfield(sf);
    const first = mockRecorded.splice(0);
    recordStarfield(tickStarfield(sf, 5000));
    expect(mockRecorded).toEqual(first);
  });
});

describe("recordStarfield frees what it made (#3597)", () => {
  it("disposes each gradient shader and every paint once recorded; the Pictures keep their own", () => {
    recordStarfield(initStarfield(400, 700));
    const blobs = nebulaBlobs(400, 700).length;
    expect(mockFreed.filter((k) => k === "shader")).toHaveLength(blobs);
    // the backdrop's paint and one per depth layer
    expect(mockFreed.filter((k) => k === "paint")).toHaveLength(1 + 3);
  });
});

describe("disposeStarfield", () => {
  it("disposes the background and every layer picture", () => {
    mockDispose.mockClear();
    disposeStarfield(recordStarfield(initStarfield(400, 700)));
    expect(mockDispose).toHaveBeenCalledTimes(4);
  });
});

describe("layerTransform", () => {
  it("slides a layer down by its wrapped scroll offset", () => {
    expect(layerTransform(0, 0.1, 700)).toEqual([{ translateY: 0 }]);
    expect(layerTransform(1000, 0.1, 700)).toEqual([{ translateY: 100 }]);
    expect(layerTransform(8000, 0.1, 700)[0]!.translateY).toBeCloseTo(100);
  });
});
