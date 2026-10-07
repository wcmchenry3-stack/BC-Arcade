/**
 * #2962: the native tile-face cache (`tileFaces.ts`). The 42 SVGs are decoded once per app
 * session (a face that failed is retried on the next mount) and rasterised once per face size
 * on a CPU raster surface; these tests drive the module directly with a stubbed Skia
 * (`loadData`, `Skia.SVG`, `Skia.Surface.Make`) to pin the decode and retry, the bitmap
 * geometry, the surface's disposal, the LRU of sizes and its disposal on eviction, and the
 * hook rasterising after the commit rather than during a render.
 * GameCanvas.native.test.tsx covers the same cache through the canvas.
 */
import { act, renderHook } from "@testing-library/react-native";
import { PixelRatio } from "react-native";
import { loadData, Skia } from "@shopify/react-native-skia";

import { TILE_REQUIRES } from "../tileAssets";
import { ART_INSET, loadTileSVGs, resetTileFaces, tileFacesFor, useTileFaces } from "../tileFaces";

jest.mock("@shopify/react-native-skia", () => ({
  loadData: jest.fn((source: unknown, factory: (d: unknown) => unknown) =>
    Promise.resolve(factory(source))
  ),
  Skia: {
    SVG: { MakeFromData: jest.fn((source: unknown) => ({ svg: source })) },
    Surface: { Make: jest.fn() },
  },
}));

const mockLoadData = loadData as unknown as jest.Mock;
const mockMakeSvg = Skia.SVG.MakeFromData as unknown as jest.Mock;
const mockMake = Skia.Surface.Make as unknown as jest.Mock;

/** A stub CPU surface; its snapshot is an image naming its size, with a `dispose` spy. */
function fakeSurface(width: number, height: number) {
  const canvas = { scale: jest.fn(), drawSvg: jest.fn() };
  return {
    canvas,
    getCanvas: () => canvas,
    flush: jest.fn(),
    makeImageSnapshot: jest.fn(() => ({ width, height, dispose: jest.fn() })),
    dispose: jest.fn(),
  };
}

const SVGS = TILE_REQUIRES.map((src) => ({ svg: src }));
const asSvgs = (list: unknown[]) => list as unknown as Parameters<typeof tileFacesFor>[0];

/** Run the hook's post-commit rasterisation (timers are fake: nothing runs until asked). */
const afterCommit = () =>
  act(() => {
    jest.runOnlyPendingTimers();
  });

beforeEach(() => {
  resetTileFaces();
  jest.clearAllMocks();
  mockMake.mockImplementation(fakeSurface);
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
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

  it("retries only the faces that failed, keeping the ones that loaded", async () => {
    mockLoadData.mockImplementationOnce(() => Promise.reject(new Error("flaky read")));
    const first = await loadTileSVGs();
    expect(first[0]).toBeNull();
    const second = await loadTileSVGs();
    expect(second).toEqual(SVGS);
    expect(second.slice(1).every((svg, i) => svg === first[i + 1])).toBe(true);
    expect(mockLoadData).toHaveBeenCalledTimes(43);
    expect(mockLoadData.mock.calls.at(-1)![0]).toBe(TILE_REQUIRES[0]);
    // Complete now: no more reads.
    expect(await loadTileSVGs()).toBe(second);
    expect(mockLoadData).toHaveBeenCalledTimes(43);
  });
});

describe("tileFacesFor", () => {
  it("draws each face into its art box at the pixel ratio on a CPU surface, then frees it", () => {
    const faces = tileFacesFor(asSvgs(SVGS), 40, 52, 3);
    const w = 40 - 2 * ART_INSET;
    const h = 52 - 2 * ART_INSET;
    expect(faces).toHaveLength(42);
    expect(faces[0]).toMatchObject({ width: w * 3, height: h * 3 });
    expect(mockMake).toHaveBeenCalledWith(w * 3, h * 3);
    const surface = mockMake.mock.results[0]!.value;
    expect(surface.canvas.scale).toHaveBeenCalledWith(3, 3);
    expect(surface.canvas.drawSvg).toHaveBeenCalledWith(SVGS[0], w, h);
    expect(surface.flush).toHaveBeenCalled();
    expect(surface.dispose).toHaveBeenCalled();
    // The snapshot is the face, so it stays alive.
    expect(faces[0]!.dispose).not.toHaveBeenCalled();
  });

  it("a face Skia cannot draw is null, and its surface is still freed", () => {
    const broken = fakeSurface(1, 1);
    broken.canvas.drawSvg.mockImplementation(() => {
      throw new Error("bad svg");
    });
    mockMake.mockReturnValueOnce(broken);
    const faces = tileFacesFor(asSvgs(SVGS.slice(0, 2)), 40, 52, 1);
    expect(faces[0]).toBeNull();
    expect(faces[1]).not.toBeNull();
    expect(broken.dispose).toHaveBeenCalled();
  });

  it("rounds a fractional pixel size up and scales the drawing to fill it", () => {
    tileFacesFor(asSvgs(SVGS.slice(0, 1)), 10.5, 20, 2);
    const w = 10.5 - 2 * ART_INSET;
    expect(mockMake).toHaveBeenCalledWith(Math.ceil(w * 2), (20 - 2 * ART_INSET) * 2);
    const surface = mockMake.mock.results[0]!.value;
    expect(surface.canvas.scale).toHaveBeenCalledWith(Math.ceil(w * 2) / w, 2);
  });

  it("is computed once per size and pixel ratio", () => {
    const a = tileFacesFor(asSvgs(SVGS), 40, 52, 2);
    expect(tileFacesFor(asSvgs(SVGS), 40, 52, 2)).toBe(a);
    expect(mockMake).toHaveBeenCalledTimes(42);
    expect(tileFacesFor(asSvgs(SVGS), 40, 52, 3)).not.toBe(a);
    expect(tileFacesFor(asSvgs(SVGS), 41, 52, 2)).not.toBe(a);
    expect(mockMake).toHaveBeenCalledTimes(3 * 42);
  });

  it("keeps the four most recently used sizes and disposes the one it drops", () => {
    const svgs = asSvgs(SVGS.slice(0, 2));
    const first = tileFacesFor(svgs, 30, 40, 1);
    for (const w of [31, 32, 33]) tileFacesFor(svgs, w, 40, 1);
    tileFacesFor(svgs, 34, 40, 1); // a fifth size: 30 is the least recently used
    expect(first.every((face) => (face!.dispose as jest.Mock).mock.calls.length === 1)).toBe(true);
    expect(tileFacesFor(svgs, 30, 40, 1)).not.toBe(first);
  });

  it("using a size makes it the most recently used, so it is not the one dropped", () => {
    const svgs = asSvgs(SVGS.slice(0, 2));
    const first = tileFacesFor(svgs, 30, 40, 1);
    const second = tileFacesFor(svgs, 31, 40, 1);
    for (const w of [32, 33]) tileFacesFor(svgs, w, 40, 1);
    expect(tileFacesFor(svgs, 30, 40, 1)).toBe(first); // 30 is used again
    tileFacesFor(svgs, 34, 40, 1); // so 31 goes
    expect(tileFacesFor(svgs, 30, 40, 1)).toBe(first);
    expect(first[0]!.dispose).not.toHaveBeenCalled();
    expect(second[0]!.dispose).toHaveBeenCalled();
  });

  it("after a retried load draws only the faces that are new", () => {
    const partial = asSvgs([null, SVGS[1]]);
    const before = tileFacesFor(partial, 40, 52, 1);
    expect(before[0]).toBeNull();
    const complete = asSvgs([SVGS[0], SVGS[1]]);
    const after = tileFacesFor(complete, 40, 52, 1);
    expect(after[1]).toBe(before[1]);
    expect(after[0]).not.toBeNull();
    expect(mockMake).toHaveBeenCalledTimes(2);
  });

  it("a face with no surface, no SVG or no room is null", () => {
    mockMake.mockReturnValue(null);
    expect(tileFacesFor(asSvgs(SVGS.slice(0, 2)), 40, 52, 1)).toEqual([null, null]);
    mockMake.mockImplementation(fakeSurface);
    expect(tileFacesFor(asSvgs([null, SVGS[1]]), 40, 53, 1)[0]).toBeNull();
    expect(tileFacesFor(asSvgs(SVGS.slice(0, 1)), 2 * ART_INSET, 52, 1)).toEqual([null]);
  });
});

describe("useTileFaces", () => {
  it("rasterises after the commit; a later mount has the faces on its first render", async () => {
    const first = await renderHook(() => useTileFaces(40, 52));
    // The SVGs have loaded but nothing is drawn during a render.
    expect(first.result.current).toBeNull();
    expect(mockMake).not.toHaveBeenCalled();
    await afterCommit();
    expect(first.result.current).toHaveLength(42);
    expect(mockMake).toHaveBeenCalledTimes(42);
    const faces = first.result.current;
    await first.unmount();

    const second = await renderHook(() => useTileFaces(40, 52));
    expect(second.result.current).toBe(faces);
    await afterCommit();
    expect(second.result.current).toBe(faces);
    expect(mockLoadData).toHaveBeenCalledTimes(42);
    expect(mockMake).toHaveBeenCalledTimes(42);
  });

  it("a new size keeps the old faces until its own are drawn after the commit", async () => {
    const hook = await renderHook(({ w }: { w: number }) => useTileFaces(w, 52), {
      initialProps: { w: 40 },
    });
    await afterCommit();
    const old = hook.result.current;
    expect(old).toHaveLength(42);
    await hook.rerender({ w: 30 });
    expect(hook.result.current).toBe(old);
    expect(mockMake).toHaveBeenCalledTimes(42);
    await afterCommit();
    expect(hook.result.current).not.toBe(old);
    expect(hook.result.current![0]).toMatchObject({
      width: Math.ceil((30 - 2 * ART_INSET) * PixelRatio.get()),
    });
  });

  it("retries a face that failed on the next mount", async () => {
    mockLoadData.mockImplementationOnce(() => Promise.reject(new Error("flaky read")));
    const first = await renderHook(() => useTileFaces(40, 52));
    await afterCommit();
    expect(first.result.current![0]).toBeNull();
    expect(first.result.current![1]).not.toBeNull();
    await first.unmount();

    const second = await renderHook(() => useTileFaces(40, 52));
    await afterCommit();
    expect(second.result.current![0]).not.toBeNull();
    expect(second.result.current![1]).toBe(first.result.current![1]);
    expect(mockLoadData).toHaveBeenCalledTimes(43);
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
    await afterCommit();
    expect(next.result.current).toHaveLength(42);
    expect(mockLoadData).toHaveBeenCalledTimes(42);
  });
});
