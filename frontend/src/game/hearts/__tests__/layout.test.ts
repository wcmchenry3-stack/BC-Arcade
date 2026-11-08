/**
 * Hearts card-table geometry (#3587): the felt, the four plates, the opponents' fans, the
 * trick and the fanned hand fit the three phone sizes and landscape, without overlap and
 * with readable cards. The sizes are the table area (the screen less its header and tab bar).
 */
import {
  CARD_ASPECT,
  MIN_HAND_CARD_W,
  MIN_TRICK_CARD_W,
  computeHandPoses,
  computeHeartsGeometry,
  handCardBounds,
  rectsOverlap,
  rotatedBounds,
  type HeartsTableGeometry,
  type Rect,
  type TrickPosition,
} from "../layout";

const SIZES = [
  { name: "320x568 (table 320x432)", width: 320, height: 568 - 64 - 72 },
  { name: "360x640", width: 360, height: 640 - 64 - 72 },
  { name: "375x667", width: 375, height: 667 - 64 - 72 },
  { name: "390x844", width: 390, height: 844 - 64 - 72 },
  { name: "430x932", width: 430, height: 932 - 64 - 72 },
  { name: "landscape 844x390", width: 844, height: 390 - 56 - 49 },
  { name: "landscape 667x375", width: 667, height: 375 - 56 - 49 },
  { name: "landscape 932x430", width: 932, height: 430 - 56 - 49 },
] as const;

const POSITIONS: TrickPosition[] = ["bottom", "left", "top", "right"];

function inside(r: Rect, w: number, h: number, slack = 0.5): boolean {
  return r.x >= -slack && r.y >= -slack && r.x + r.w <= w + slack && r.y + r.h <= h + slack;
}

function trickBounds(g: HeartsTableGeometry): Rect[] {
  return POSITIONS.map((p) => {
    const s = g.trick.slots[p];
    return rotatedBounds(
      g.trick.area.x + s.x,
      g.trick.area.y + s.y,
      g.trick.cardW,
      g.trick.cardH,
      s.rotation
    );
  });
}

describe("computeHeartsGeometry matches the approved mockup at 390x708", () => {
  const g = computeHeartsGeometry({ width: 390, height: 708 });

  it("is a portrait table at scale 1", () => {
    expect(g.mode).toBe("portrait");
    expect(g.scale).toBe(1);
  });

  it("puts the felt at x 14, y 64 (128 less the header), 362 x 392, radius 48", () => {
    expect(g.felt).toMatchObject({ x: 14, y: 64, w: 362, h: 392, radius: 48 });
  });

  it("puts the plates where the mockup does", () => {
    // North centred at y 56 (120), West at x 18, y 166 (230), East right-aligned at x 372, You at y 464 (528).
    const { top, left, right, self } = g.plates;
    expect(top.rect.y).toBe(56);
    expect(top.rect.x + top.rect.w / 2).toBe(195);
    expect(left.rect.x).toBe(18);
    expect(left.rect.y).toBe(166);
    expect(right.rect.x + right.rect.w).toBe(372);
    expect(right.rect.y).toBe(166);
    expect(self.rect.y).toBe(464);
    expect(self.rect.x + self.rect.w / 2).toBe(195);
  });

  it("draws 66 dp trick cards 14 dp apart around (195, 266)", () => {
    expect(g.trick.cardW).toBe(66);
    const bottom = g.trick.slots.bottom;
    const left = g.trick.slots.left;
    const right = g.trick.slots.right;
    expect(g.trick.area.x + left.x).toBeCloseTo(195 - 66 - 14, 5);
    expect(g.trick.area.x + right.x).toBeCloseTo(195 + 14, 5);
    expect(g.trick.area.x + bottom.x).toBeCloseTo(195 - 33, 5);
    expect(g.trick.slots.top.rotation).not.toBe(g.trick.slots.bottom.rotation);
  });

  it("fans 64 dp hand cards +-14 degrees with a 26 dp arc", () => {
    expect(g.hand.cardW).toBe(64);
    expect(g.hand.spread).toBe(14);
    expect(g.hand.arcLift).toBe(26);
    expect(g.hand.raise).toBe(10);
    const poses = computeHandPoses(g.hand, 13);
    expect(poses[0]!.rotation).toBeCloseTo(-14, 5);
    expect(poses[12]!.rotation).toBeCloseTo(14, 5);
    expect(poses[6]!.rotation).toBeCloseTo(0, 5);
    expect(poses[0]!.y - poses[6]!.y).toBeCloseTo(26, 5);
  });

  it("draws 30 dp card backs, four to a fan", () => {
    for (const seat of ["top", "left", "right"] as const) {
      expect(g.fans[seat].cardW).toBe(30);
      expect(g.fans[seat].cards).toHaveLength(4);
    }
  });
});

describe.each(SIZES)("computeHeartsGeometry at $name", ({ width, height }) => {
  const g = computeHeartsGeometry({ width, height });
  const plates = Object.values(g.plates);

  it("keeps the felt, plates, fans, trick and hand inside the table", () => {
    expect(inside(g.felt, width, height)).toBe(true);
    for (const p of plates) expect(inside(p.rect, width, height)).toBe(true);
    for (const f of Object.values(g.fans)) expect(inside(f.rect, width, height)).toBe(true);
    for (const b of trickBounds(g)) expect(inside(b, width, height)).toBe(true);
    expect(inside(g.hand.rect, width, height)).toBe(true);
  });

  it("never overlaps one plate with another", () => {
    for (let i = 0; i < plates.length; i++) {
      for (let j = i + 1; j < plates.length; j++) {
        expect(rectsOverlap(plates[i]!.rect, plates[j]!.rect)).toBe(false);
      }
    }
  });

  it("keeps the trick clear of every plate and fan", () => {
    for (const b of trickBounds(g)) {
      for (const p of plates) expect(rectsOverlap(b, p.rect)).toBe(false);
      for (const f of Object.values(g.fans)) expect(rectsOverlap(b, f.rect)).toBe(false);
    }
  });

  it("keeps each fan clear of every other seat's plate", () => {
    for (const f of Object.values(g.fans)) {
      for (const p of plates) {
        if (p.seat === f.seat) continue;
        expect(rectsOverlap(f.rect, p.rect)).toBe(false);
      }
    }
  });

  it("keeps the hand clear of the plates and the trick", () => {
    for (const p of plates) expect(rectsOverlap(g.hand.rect, p.rect)).toBe(false);
    for (const b of trickBounds(g)) expect(rectsOverlap(g.hand.rect, b)).toBe(false);
  });

  it("keeps card widths readable", () => {
    expect(g.hand.cardW).toBeGreaterThanOrEqual(width < 360 ? 36 : MIN_HAND_CARD_W);
    expect(g.trick.cardW).toBeGreaterThanOrEqual(MIN_TRICK_CARD_W);
    expect(g.hand.cardH).toBe(Math.round(g.hand.cardW * CARD_ASPECT));
  });

  it("keeps every rotated hand card on the table, inside the hand box", () => {
    for (const count of [13, 7, 2, 1]) {
      for (const b of handCardBounds(g.hand, count)) {
        expect(inside(b, width, height)).toBe(true);
        expect(
          inside({ ...b, x: b.x - g.hand.rect.x, y: b.y - g.hand.rect.y }, width, g.hand.rect.h)
        ).toBe(true);
      }
    }
  });

  it("leaves room for a selected card to rise without reaching the plate above", () => {
    const poses = computeHandPoses(g.hand, 13);
    for (const p of poses) expect(p.y - g.hand.selectLift).toBeGreaterThanOrEqual(0);
  });

  it("aims a won trick at each winner's plate, on the winner's side of the trick", () => {
    const c = g.trick.plateCentres;
    const mid = { x: g.trick.area.w / 2, y: g.trick.area.h / 2 };
    expect(c.top.y).toBeLessThan(mid.y);
    expect(c.bottom.y).toBeGreaterThan(mid.y);
    expect(c.left.x).toBeLessThan(mid.x);
    expect(c.right.x).toBeGreaterThan(mid.x);
  });

  it("keeps the pass banner clear of every plate and fan", () => {
    if (g.mode === "landscape") return;
    for (const p of plates) expect(rectsOverlap(g.passBanner, p.rect)).toBe(false);
    for (const f of Object.values(g.fans)) expect(rectsOverlap(g.passBanner, f.rect)).toBe(false);
  });

  it("keeps the pass banner inside the felt", () => {
    const b = g.passBanner;
    expect(b.x).toBeGreaterThanOrEqual(g.felt.x);
    expect(b.x + b.w).toBeLessThanOrEqual(g.felt.x + g.felt.w);
    expect(b.y).toBeGreaterThanOrEqual(g.felt.y);
    expect(b.y + b.h).toBeLessThanOrEqual(g.felt.y + g.felt.h);
  });
});

describe("the hand fan", () => {
  const g = computeHeartsGeometry({ width: 390, height: 708 });

  it("exposes at least 24 dp of each of 13 cards on 360, 375, 390 and 430 dp widths, at any table height", () => {
    for (const [width, height] of [
      [360, 504],
      [360, 640],
      [375, 531],
      [375, 667],
      [390, 708],
      [430, 796],
    ] as const) {
      const h = computeHeartsGeometry({ width, height }).hand;
      const poses = computeHandPoses(h, 13);
      expect(poses[1]!.x - poses[0]!.x).toBeGreaterThanOrEqual(24 - 1e-6);
    }
  });

  it("exposes as much as 13 cards can at 320 dp (13 x 24 dp does not fit beside a card there)", () => {
    const h = computeHeartsGeometry({ width: 320, height: 432 }).hand;
    const poses = computeHandPoses(h, 13);
    expect(poses[1]!.x - poses[0]!.x).toBeGreaterThanOrEqual(22);
    expect(h.cardW).toBeGreaterThanOrEqual(36);
  });

  it("keeps the whole 320 x 432 hand, the outer cards included, inside the table", () => {
    const g = computeHeartsGeometry({ width: 320, height: 432 });
    expect(g.hand.rect.y + g.hand.rect.h).toBeLessThanOrEqual(432);
    for (const b of handCardBounds(g.hand, 13)) {
      expect(b.y + b.h).toBeLessThanOrEqual(432 + 0.5);
      expect(b.x).toBeGreaterThanOrEqual(-0.5);
      expect(b.x + b.w).toBeLessThanOrEqual(320 + 0.5);
    }
  });

  it("is finite for a NaN or infinite table size", () => {
    for (const size of [
      { width: NaN, height: 700 },
      { width: 390, height: NaN },
      { width: Infinity, height: Infinity },
    ]) {
      const g = computeHeartsGeometry(size);
      expect(Number.isFinite(g.felt.w)).toBe(true);
      expect(Number.isFinite(g.hand.rect.y)).toBe(true);
    }
  });

  it("exposes at least 24 dp of each of 13 cards on the three phone widths", () => {
    for (const width of [375, 390, 430]) {
      const h = computeHeartsGeometry({ width, height: 708 }).hand;
      const poses = computeHandPoses(h, 13);
      expect(poses[1]!.x - poses[0]!.x).toBeGreaterThanOrEqual(24 - 1e-6);
    }
  });

  it("fans less, and keeps cards together, as the hand plays down", () => {
    const full = computeHandPoses(g.hand, 13);
    const few = computeHandPoses(g.hand, 3);
    expect(Math.abs(few[0]!.rotation)).toBeLessThan(Math.abs(full[0]!.rotation));
    expect(few[1]!.x - few[0]!.x).toBeGreaterThan(full[1]!.x - full[0]!.x);
  });

  it("centres the hand and handles an empty and a one-card hand", () => {
    expect(computeHandPoses(g.hand, 0)).toEqual([]);
    const one = computeHandPoses(g.hand, 1);
    expect(one).toHaveLength(1);
    expect(one[0]!.rotation).toBe(0);
    expect(one[0]!.x + g.hand.cardW / 2).toBeCloseTo(g.hand.rect.w / 2, 5);
  });
});

describe("modes", () => {
  it("is landscape only when wider than tall", () => {
    expect(computeHeartsGeometry({ width: 390, height: 708 }).mode).toBe("portrait");
    expect(computeHeartsGeometry({ width: 844, height: 285 }).mode).toBe("landscape");
  });

  it("grows the felt, not the cards, on a very tall table", () => {
    const tall = computeHeartsGeometry({ width: 390, height: 900 });
    const base = computeHeartsGeometry({ width: 390, height: 708 });
    expect(tall.felt.h).toBeGreaterThan(base.felt.h);
    expect(tall.hand.cardW).toBe(base.hand.cardW);
  });
});

// Review of #3608: the side fans straddled the felt's edge.
describe("side fans sit fully on the felt (portrait)", () => {
  it.each([
    [375, 667],
    [390, 708],
    [390, 844],
    [430, 932],
  ])("%ix%i", (width, height) => {
    const g = computeHeartsGeometry({ width, height });
    for (const seat of ["left", "right"] as const) {
      const r = g.fans[seat].rect;
      expect(r.x).toBeGreaterThanOrEqual(g.felt.x);
      expect(r.x + r.w).toBeLessThanOrEqual(g.felt.x + g.felt.w);
      expect(r.y).toBeGreaterThanOrEqual(g.felt.y);
      expect(r.y + r.h).toBeLessThanOrEqual(g.felt.y + g.felt.h);
    }
  });
});
