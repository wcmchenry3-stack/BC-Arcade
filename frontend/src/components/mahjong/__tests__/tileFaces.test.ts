/**
 * #2962: the native tile-face cache (`tileFaces.ts`). The 42 SVGs are decoded once per app
 * session and rasterised once per face size; these tests drive the module directly with a
 * stubbed Skia (`loadData`, `Skia.SVG`, `Skia.Surface`) to pin the decode-once promise, the
 * bitmap geometry, the GPU-to-raster hand-off and its fallbacks, and the size cache's bound.
 * GameCanvas.native.test.tsx covers the same cache through the canvas.
 */
import { act, renderHook } from "@testing-library/react-native";
import { loadData, Skia } from "@shopify/react-native-skia";

import { TILE_REQUIRES } from "../tileAssets";
import { ART_INSET, loadTileSVGs, resetTileFaces, tileFacesFor, useTileFaces } from "../tileFaces";

jest.mock("@shopify/react-native-skia", () => ({
  loadData: jest.fn((source: unknown, factory: (d: unknown) => unknown) =>
    Promise.resolve(factory(source))
  ),
  Skia: {
    SVG: { MakeFromData: jest.fn((source: unknown) => ({ svg: source })) },
    Surface: { MakeOffscreen: jest.fn(), Make: jest.fn() },
  },
}));

const mockLoadData = loadData as unknown as jest.Mock;
const mockMakeSvg = Skia.SVG.MakeFromData as unknown as jest.Mock;
const mockOffscreen = Skia.Surface.MakeOffscreen as unknown as jest.Mock;
const mockCpu = Skia.Surface.Make as unknown as jest.Mock;

/** A stub surface; `raster: false` makes its snapshot refuse a raster copy. */
function fakeSurface(kind: string, { raster = true } = {}) {
  return (width: number, height: number) => {
    const canvas = { scale: jest.fn(), drawSvg: jest.fn() };
    const snapshot = {
      kind: `${kind}-snapshot`,
      makeNonTextureImage: () => (raster ? { kind: `${kind}-raster`, width, height } : null),
    };
    return {
      canvas,
      getCanvas: () => canvas,
      flush: jest.fn(),
      makeImageSnapshot: () => snapshot,
      dispose: jest.fn(),
    };
  };
}

const SVGS = TILE_REQUIRES.map((src) => ({ svg: src }));

beforeEach(() => {
  resetTileFaces();
  jest.clearAllMocks();
  mockOffscreen.mockImplementation(fakeSurface("gpu"));
  mockCpu.mockImplementation(fakeSurface("cpu"));
});

describe("loadTileSVGs", () => {
  it("reads and parses every face once, however often it is asked", async () => {
    const [a, b] = await Promise.all([loadTileSVGs(), loadTileSVGs()]);
    expect(a).toBe(b);
    expect(await loadTileSVGs()).toBe(a);
    expect(mockLoadData).toHaveBeenCalledTimes(42);
    expect(a).toEqual(SVGS);
  });

  it("a face that fails to load, parse or even start loading is null; the rest load", async () => {
    mockLoadData
      .mockImplementationOnce(() => Promise.reject(new Error("missing asset")))
      .mockImplementationOnce(() => {
        throw new Error("unresolvable source");
      });
    mockMakeSvg.mockImplementationOnce(() => null); // the third face's data does not parse
    const svgs = await loadTileSVGs();
    expect(svgs.slice(0, 3)).toEqual([null, null, null]);
    expect(svgs.slice(3)).toEqual(SVGS.slice(3));
  });
});

describe("tileFacesFor", () => {
  it("draws each face into its art box at the pixel ratio and keeps a raster copy", () => {
    const faces = tileFacesFor(SVGS, 40, 52, 3);
    const w = 40 - 2 * ART_INSET;
    const h = 52 - 2 * ART_INSET;
    expect(faces).toHaveLength(42);
    expect(faces[0]).toEqual({ kind: "gpu-raster", width: w * 3, height: h * 3 });
    const surface = mockOffscreen.mock.results[0]!.value;
    expect(mockOffscreen).toHaveBeenCalledWith(w * 3, h * 3);
    expect(surface.canvas.scale).toHaveBeenCalledWith(3, 3);
    expect(surface.canvas.drawSvg).toHaveBeenCalledWith(SVGS[0], w, h);
    expect(surface.flush).toHaveBeenCalled();
    expect(surface.dispose).toHaveBeenCalled();
    expect(mockCpu).not.toHaveBeenCalled();
  });

  it("rounds a fractional pixel size up and scales the drawing to fill it", () => {
    tileFacesFor(SVGS.slice(0, 1), 10.5, 20, 2);
    const w = 10.5 - 2 * ART_INSET;
    expect(mockOffscreen).toHaveBeenCalledWith(Math.ceil(w * 2), (20 - 2 * ART_INSET) * 2);
    const surface = mockOffscreen.mock.results[0]!.value;
    expect(surface.canvas.scale).toHaveBeenCalledWith(Math.ceil(w * 2) / w, 2);
  });

  it("is computed once per size and pixel ratio", () => {
    const a = tileFacesFor(SVGS, 40, 52, 2);
    expect(tileFacesFor(SVGS, 40, 52, 2)).toBe(a);
    expect(mockOffscreen).toHaveBeenCalledTimes(42);
    expect(tileFacesFor(SVGS, 40, 52, 3)).not.toBe(a);
    expect(tileFacesFor(SVGS, 41, 52, 2)).not.toBe(a);
    expect(mockOffscreen).toHaveBeenCalledTimes(3 * 42);
  });

  it("keeps the four latest sizes, dropping the oldest", () => {
    const first = tileFacesFor(SVGS, 30, 40, 1);
    for (const w of [31, 32, 33]) tileFacesFor(SVGS, w, 40, 1);
    expect(tileFacesFor(SVGS, 30, 40, 1)).toBe(first);
    tileFacesFor(SVGS, 34, 40, 1); // a fifth size: 30 goes
    expect(tileFacesFor(SVGS, 30, 40, 1)).not.toBe(first);
  });

  it("falls back to a CPU surface, and to the snapshot itself without a raster copy", () => {
    mockOffscreen.mockReturnValue(null);
    mockCpu.mockImplementation(fakeSurface("cpu", { raster: false }));
    const faces = tileFacesFor(SVGS.slice(0, 1), 40, 52, 1);
    expect(faces[0]).toEqual({ kind: "cpu-snapshot", makeNonTextureImage: expect.any(Function) });
    // The snapshot still needs its surface.
    expect(mockCpu.mock.results[0]!.value.dispose).not.toHaveBeenCalled();
  });

  it("a face with no surface, no SVG or no room is null", () => {
    mockOffscreen.mockReturnValue(null);
    mockCpu.mockReturnValue(null);
    expect(tileFacesFor(SVGS.slice(0, 2), 40, 52, 1)).toEqual([null, null]);
    mockOffscreen.mockImplementation(fakeSurface("gpu"));
    expect(tileFacesFor([null, SVGS[1]!], 40, 53, 1)[0]).toBeNull();
    expect(tileFacesFor(SVGS.slice(0, 1), 2 * ART_INSET, 52, 1)).toEqual([null]);
  });
});

describe("useTileFaces", () => {
  it("is null until the SVGs load, then the faces for the size; later mounts have them at once", async () => {
    const first = await renderHook(() => useTileFaces(40, 52));
    expect(first.result.current).toHaveLength(42);
    const faces = first.result.current;
    await first.unmount();

    const second = await renderHook(() => useTileFaces(40, 52));
    expect(second.result.current).toBe(faces);
    expect(mockLoadData).toHaveBeenCalledTimes(42);
  });

  it("a load an unmounted canvas started still finishes for the next mount", async () => {
    const pending: (() => void)[] = [];
    mockLoadData.mockImplementation((source: unknown, factory: (d: unknown) => unknown) =>
      new Promise<void>((r) => pending.push(r)).then(() => factory(source))
    );
    const hook = await renderHook(() => useTileFaces(40, 52));
    expect(hook.result.current).toBeNull();
    await hook.unmount();
    await act(async () => {
      pending.forEach((r) => r());
      await loadTileSVGs();
    });

    const next = await renderHook(() => useTileFaces(40, 52));
    expect(next.result.current).toHaveLength(42);
    expect(mockLoadData).toHaveBeenCalledTimes(42);
  });
});
