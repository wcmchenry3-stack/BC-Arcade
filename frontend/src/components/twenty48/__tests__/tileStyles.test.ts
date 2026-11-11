/**
 * #3688: the tile ladder (every value 2..131072 distinct, AA text, away from the empty slot) and
 * the number's font size from the tile and its digit count.
 */
import {
  TWENTY48_SLOT,
  TWENTY48_TILES,
  TWENTY48_MAX_TILE,
  TWENTY48_GLOW_FROM,
} from "../../../theme/theme.twenty48";
import { getTileFontSize, getTileVisual } from "../tileStyles";

const VALUES = Array.from({ length: 17 }, (_, i) => 2 ** (i + 1));

function channel(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map(channel) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG 2.x contrast ratio. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
/** CIE76 colour difference (Lab): 2.3 is just noticeable; 10+ is plainly different. */
function deltaE(a: string, b: string): number {
  const lab = (hex: string): [number, number, number] => {
    const [r, g, bl] = rgb(hex).map(channel) as [number, number, number];
    const x = (0.4124 * r + 0.3576 * g + 0.1805 * bl) / 0.95047;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    const z = (0.0193 * r + 0.1192 * g + 0.9505 * bl) / 1.08883;
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  };
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

describe("the tile ladder", () => {
  it("has a colour for every value from 2 to 131072", () => {
    expect(VALUES).toHaveLength(17);
    expect(VALUES[0]).toBe(2);
    expect(VALUES[16]).toBe(TWENTY48_MAX_TILE);
    for (const v of VALUES) expect(TWENTY48_TILES[v]).toBeDefined();
    expect(Object.keys(TWENTY48_TILES)).toHaveLength(17);
  });

  it("gives every value its own colour", () => {
    const fills = VALUES.map((v) => TWENTY48_TILES[v]!.bg.toLowerCase());
    expect(new Set(fills).size).toBe(VALUES.length);
  });

  it("keeps every pair of tiles visibly apart, not just different hex codes", () => {
    for (let i = 0; i < VALUES.length; i++) {
      for (let j = i + 1; j < VALUES.length; j++) {
        const d = deltaE(TWENTY48_TILES[VALUES[i]!]!.bg, TWENTY48_TILES[VALUES[j]!]!.bg);
        // A floor, not a target: the closest pair today is ~20.
        expect({ a: VALUES[i], b: VALUES[j], ok: d >= 18 }).toEqual({
          a: VALUES[i],
          b: VALUES[j],
          ok: true,
        });
      }
    }
  });

  it("shows the number at WCAG AA (4.5:1) on every tile", () => {
    for (const v of VALUES) {
      const { bg, text } = TWENTY48_TILES[v]!;
      expect({ v, ratio: contrast(bg, text) >= 4.5 }).toEqual({ v, ratio: true });
    }
  });

  it("keeps every tile clearly apart from the empty slot, in both themes", () => {
    for (const theme of ["dark", "light"] as const) {
      for (const v of VALUES) {
        const d = deltaE(TWENTY48_TILES[v]!.bg, TWENTY48_SLOT[theme]);
        expect({ theme, v, ok: d >= 15 }).toEqual({ theme, v, ok: true });
      }
    }
    // The bug this fixes: the 2 tile was the slot's colour.
    expect(TWENTY48_TILES[2]!.bg).not.toBe(TWENTY48_SLOT.dark);
    expect(TWENTY48_TILES[2]!.bg).not.toBe(TWENTY48_SLOT.light);
  });
});

describe("getTileVisual", () => {
  it("fills the tile with the ladder's colour and sets the ladder's text colour", () => {
    for (const v of VALUES) {
      const visual = getTileVisual(v);
      expect(visual.container.backgroundColor).toBe(TWENTY48_TILES[v]!.bg);
      expect(visual.text.color).toBe(TWENTY48_TILES[v]!.text);
    }
  });

  it("is flat below 2048: no glow, no ring", () => {
    for (const v of VALUES.filter((x) => x < TWENTY48_GLOW_FROM)) {
      const c = getTileVisual(v).container;
      expect(c.shadowRadius).toBeUndefined();
      expect(c.shadowColor).toBeUndefined();
      expect(c.borderWidth).toBeUndefined();
      expect(c.elevation).toBeUndefined();
    }
  });

  it("glows only from 2048", () => {
    for (const v of VALUES.filter((x) => x >= TWENTY48_GLOW_FROM)) {
      const c = getTileVisual(v).container;
      expect(c.shadowRadius).toBeGreaterThan(0);
      expect(c.borderWidth).toBeGreaterThan(0);
    }
  });

  it("falls back to the top colours past the board's maximum, and to the 2 tile for an odd value", () => {
    expect(getTileVisual(TWENTY48_MAX_TILE * 2).container.backgroundColor).toBe(
      TWENTY48_TILES[TWENTY48_MAX_TILE]!.bg
    );
    expect(getTileVisual(3).container.backgroundColor).toBe(TWENTY48_TILES[2]!.bg);
  });
});

describe("getTileFontSize", () => {
  const TILES = [80, 62, 48]; // 390 px, 320 px and a small-board tile

  it("never lets the number overflow the tile's width, with a margin", () => {
    for (const tile of TILES) {
      for (const v of VALUES) {
        const size = getTileFontSize(v, tile);
        const digits = String(v).length;
        expect(size * 0.62 * digits).toBeLessThanOrEqual(tile * 0.8 + 0.001);
      }
    }
  });

  it("shrinks as the digit count grows and never grows past the 1-digit size", () => {
    for (const tile of TILES) {
      const bySize = [2, 16, 128, 1024, 16384, 131072].map((v) => getTileFontSize(v, tile));
      for (let i = 1; i < bySize.length; i++) expect(bySize[i]).toBeLessThanOrEqual(bySize[i - 1]!);
      expect(bySize[0]).toBeLessThanOrEqual(tile * 0.45);
    }
  });

  it("is not the old fixed 14 px for 5-digit values", () => {
    expect(getTileFontSize(16384, 80)).toBeGreaterThan(14);
    expect(getTileFontSize(131072, 80)).toBeGreaterThan(14);
  });

  it("scales with the tile", () => {
    expect(getTileFontSize(2048, 80)).toBeGreaterThan(getTileFontSize(2048, 48));
  });

  it("has a legible floor on a tiny tile", () => {
    expect(getTileFontSize(131072, 12)).toBe(10);
  });
});
