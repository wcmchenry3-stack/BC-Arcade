/**
 * #2963: the background and starfield are recorded once into their own Pictures — one per depth
 * layer — and slid on the UI thread, instead of 96 display-list ops every frame.
 */
type Call = { fn: string; args: unknown[]; color?: number };
const mockRecorded: { size: unknown; calls: Call[] }[] = [];
const mockDispose = jest.fn();

jest.mock("@shopify/react-native-skia", () => ({
  Skia: {
    Color: (packed: number) => ({ packed }),
    Paint: () => {
      const p = {
        color: 0,
        antiAlias: false,
        setColor: (c: { packed: number }) => {
          p.color = c.packed;
        },
        setAntiAlias: (b: boolean) => {
          p.antiAlias = b;
        },
      };
      return p;
    },
  },
  createPicture: (draw: (canvas: object) => void, size: unknown) => {
    const calls: Call[] = [];
    draw({
      drawColor: (c: { packed: number }) => calls.push({ fn: "drawColor", args: [c.packed] }),
      drawCircle: (cx: number, cy: number, r: number, p: { color: number; antiAlias: boolean }) =>
        calls.push({ fn: "drawCircle", args: [cx, cy, r, p.antiAlias], color: p.color }),
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
import { initStarfield, starLayers, tickStarfield } from "../starfield";

beforeEach(() => {
  mockRecorded.length = 0;
});

describe("recordStarfield", () => {
  it("records the background, then one Picture per depth layer, at the canvas size", () => {
    const sf = initStarfield(400, 700);
    const pics = recordStarfield(sf);
    expect(mockRecorded).toHaveLength(4);
    expect(mockRecorded.every((r) => JSON.stringify(r.size) === '{"width":400,"height":700}')).toBe(
      true
    );
    expect(mockRecorded[0]!.calls).toEqual([{ fn: "drawColor", args: [BACKGROUND] }]);
    expect(pics.backdrop).toMatchObject({ id: 0 });
    expect(pics.layers.map((l) => l.speed)).toEqual([0.02, 0.05, 0.1]);
    expect(pics.layers.map((l) => (l.picture as unknown as { id: number }).id)).toEqual([1, 2, 3]);
  });

  it("each layer draws its stars where they start, in draw order, as antialiased white dots", () => {
    const sf = initStarfield(400, 700);
    recordStarfield(sf);
    starLayers(sf).forEach((layer, i) => {
      const calls = mockRecorded[i + 1]!.calls;
      expect(calls).toHaveLength(layer.stars.length);
      layer.stars.forEach((star, j) => {
        expect(calls[j]).toEqual({
          fn: "drawCircle",
          args: [star.x, star.y, star.r, true],
          color: withAlpha(0xffffff, star.opacity),
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
