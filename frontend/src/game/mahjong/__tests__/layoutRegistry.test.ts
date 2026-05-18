/**
 * Tests for the layout JSON infrastructure (#1688):
 *   - loader.ts  (parseLayout)
 *   - registry.ts (LAYOUTS, getLayout)
 *   - turtle.json (144 valid slots)
 */

import { parseLayout } from "../layouts/loader";
import { LAYOUTS, getLayout, resolveLayoutId } from "../layouts/registry";
import { TURTLE_LAYOUT } from "../layouts/turtle";

// ---------------------------------------------------------------------------
// parseLayout
// ---------------------------------------------------------------------------

describe("parseLayout", () => {
  function makeSlots(n: number) {
    return Array.from({ length: n }, (_, i) => ({ col: i * 2, row: 0, layer: 0 }));
  }

  it("returns a valid Layout for correct input", () => {
    const slots = makeSlots(144);
    const layout = parseLayout(slots);
    expect(layout.length).toBe(144);
  });

  it("throws when slot count does not match expectedCount", () => {
    expect(() => parseLayout(makeSlots(143))).toThrow(/expected 144 slots, got 143/);
    expect(() => parseLayout(makeSlots(145))).toThrow(/expected 144 slots, got 145/);
  });

  it("throws on duplicate coordinates", () => {
    const slots = makeSlots(143);
    slots.push({ col: 0, row: 0, layer: 0 }); // duplicate of slot 0
    expect(() => parseLayout(slots)).toThrow(/duplicate coordinate/);
  });

  it("respects a custom expectedCount", () => {
    const slots = makeSlots(4);
    expect(() => parseLayout(slots, 4)).not.toThrow();
    expect(() => parseLayout(slots, 5)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// LAYOUTS registry shape
// ---------------------------------------------------------------------------

describe("LAYOUTS registry", () => {
  it("exports a non-empty array", () => {
    expect(Array.isArray(LAYOUTS)).toBe(true);
    expect(LAYOUTS.length).toBeGreaterThan(0);
  });

  it("turtle entry has correct shape", () => {
    const turtle = LAYOUTS.find((l) => l.id === "turtle");
    expect(turtle).toBeDefined();
    expect(turtle!.name).toBe("Turtle");
    expect(turtle!.tier).toBe(1);
    expect(turtle!.tileCount).toBe(144);
    expect(Array.isArray(turtle!.data)).toBe(true);
  });

  it("every entry has id, name, tier (1|2), tileCount, and data", () => {
    for (const meta of LAYOUTS) {
      expect(typeof meta.id).toBe("string");
      expect(typeof meta.name).toBe("string");
      expect([1, 2]).toContain(meta.tier);
      expect(typeof meta.tileCount).toBe("number");
      expect(Array.isArray(meta.data)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// turtle.json validity
// ---------------------------------------------------------------------------

describe("turtle.json", () => {
  it("produces a valid Layout via getLayout('turtle')", () => {
    expect(() => getLayout("turtle")).not.toThrow();
  });

  it("has exactly 144 slots", () => {
    const layout = getLayout("turtle");
    expect(layout.length).toBe(144);
  });

  it("has no duplicate coordinates", () => {
    const layout = getLayout("turtle");
    const keys = layout.map((s) => `${s.col},${s.row},${s.layer}`);
    expect(new Set(keys).size).toBe(144);
  });

  it("matches TURTLE_LAYOUT from turtle.ts exactly", () => {
    const jsonLayout = getLayout("turtle");
    expect(jsonLayout.length).toBe(TURTLE_LAYOUT.length);
    for (let i = 0; i < TURTLE_LAYOUT.length; i++) {
      expect(jsonLayout[i]).toEqual(TURTLE_LAYOUT[i]);
    }
  });
});

// ---------------------------------------------------------------------------
// getLayout
// ---------------------------------------------------------------------------

describe("getLayout", () => {
  it("returns a Layout for a known id", () => {
    const layout = getLayout("turtle");
    expect(layout.length).toBeGreaterThan(0);
  });

  it("throws for an unknown id", () => {
    expect(() => getLayout("nonexistent")).toThrow(/Layout not found/);
  });

  it("returns the same reference on repeated calls (memoized)", () => {
    expect(getLayout("turtle")).toBe(getLayout("turtle"));
  });
});

// ---------------------------------------------------------------------------
// resolveLayoutId
// ---------------------------------------------------------------------------

describe("resolveLayoutId", () => {
  it("returns the id when currentLayoutId is set", () => {
    expect(resolveLayoutId({ currentLayoutId: "turtle" })).toBe("turtle");
  });

  it("defaults to 'turtle' when currentLayoutId is undefined", () => {
    expect(resolveLayoutId({})).toBe("turtle");
  });
});
