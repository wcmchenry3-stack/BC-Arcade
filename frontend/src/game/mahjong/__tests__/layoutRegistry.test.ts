/**
 * Tests for the layout JSON infrastructure (#1688, #1690):
 *   - loader.ts  (parseLayout)
 *   - registry.ts (LAYOUTS, getLayout)
 *   - turtle.json, pyramid.json, square.json, arena.json, four_rivers.json
 */

import { parseLayout } from "../layouts/loader";
import { LAYOUTS, getLayout, resolveLayoutId } from "../layouts/registry";
import { TURTLE_LAYOUT } from "../layouts/turtle";
import { PYRAMID_LAYOUT } from "../layouts/pyramid";
import { SQUARE_LAYOUT } from "../layouts/square";
import { ARENA_LAYOUT } from "../layouts/arena";
import { FOUR_RIVERS_LAYOUT } from "../layouts/four_rivers";
import { BUTTERFLY_LAYOUT } from "../layouts/butterfly";
import { FISH_LAYOUT } from "../layouts/fish";
import { SPIDER_LAYOUT } from "../layouts/spider";
import { CAT_LAYOUT } from "../layouts/cat";
import { SNOWFLAKE_LAYOUT } from "../layouts/snowflake";
import { CASTLE_LAYOUT } from "../layouts/castle";
import { BRIDGE_LAYOUT } from "../layouts/bridge";
import { GATE_LAYOUT } from "../layouts/gate";
import { DOUBLE_PYRAMID_LAYOUT } from "../layouts/double_pyramid";
import { ANCHOR_LAYOUT } from "../layouts/anchor";
import { CROWN_LAYOUT } from "../layouts/crown";
import { SHIELD_LAYOUT } from "../layouts/shield";
import { HEART_LAYOUT } from "../layouts/heart";
import { HOURGLASS_LAYOUT } from "../layouts/hourglass";
import { THE_KEY_LAYOUT } from "../layouts/the_key";
import { DIAMOND_LAYOUT } from "../layouts/diamond";
import { X_WING_LAYOUT } from "../layouts/x_wing";
import { MAZE_LAYOUT } from "../layouts/maze";
import { ZIG_ZAG_LAYOUT } from "../layouts/zig_zag";
import { CONCENTRIC_SQUARES_LAYOUT } from "../layouts/concentric_squares";
import type { Layout } from "../types";

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

// ---------------------------------------------------------------------------
// Tier-1 layouts validity (#1690) — pyramid, square, arena, four_rivers
// ---------------------------------------------------------------------------

const TIER1_IDS = ["pyramid", "square", "arena", "four_rivers"] as const;

const TS_SOURCES: Record<string, Layout> = {
  pyramid: PYRAMID_LAYOUT,
  square: SQUARE_LAYOUT,
  arena: ARENA_LAYOUT,
  four_rivers: FOUR_RIVERS_LAYOUT,
};

describe.each(TIER1_IDS)("%s layout", (id) => {
  it("loads without throwing", () => {
    expect(() => getLayout(id)).not.toThrow();
  });

  it("has exactly 144 slots", () => {
    expect(getLayout(id).length).toBe(144);
  });

  it("has no duplicate coordinates", () => {
    const layout = getLayout(id);
    const keys = layout.map((s) => `${s.col},${s.row},${s.layer}`);
    expect(new Set(keys).size).toBe(144);
  });

  it("has an even tile count per layer (solvability precondition)", () => {
    const layout = getLayout(id);
    const byLayer = new Map<number, number>();
    for (const s of layout) byLayer.set(s.layer, (byLayer.get(s.layer) ?? 0) + 1);
    for (const count of byLayer.values()) {
      expect(count % 2).toBe(0);
    }
  });

  it("is present in LAYOUTS registry with correct shape", () => {
    const meta = LAYOUTS.find((l) => l.id === id);
    expect(meta).toBeDefined();
    expect(meta!.tier).toBe(1);
    expect(meta!.tileCount).toBe(144);
    expect(Array.isArray(meta!.data)).toBe(true);
  });

  it("matches its .ts source exactly", () => {
    const json = getLayout(id);
    const ts = TS_SOURCES[id]!;
    expect(json.length).toBe(ts.length);
    for (let i = 0; i < ts.length; i++) {
      expect(json[i]).toEqual(ts[i]);
    }
  });
});

// ---------------------------------------------------------------------------
// Tier-2 organic layouts validity (#1691) — butterfly, fish, spider, cat, snowflake
// ---------------------------------------------------------------------------

const TIER2_IDS = ["butterfly", "fish", "spider", "cat", "snowflake"] as const;

const TIER2_TS_SOURCES: Record<string, Layout> = {
  butterfly: BUTTERFLY_LAYOUT,
  fish: FISH_LAYOUT,
  spider: SPIDER_LAYOUT,
  cat: CAT_LAYOUT,
  snowflake: SNOWFLAKE_LAYOUT,
};

describe.each(TIER2_IDS)("%s layout", (id) => {
  it("loads without throwing", () => {
    expect(() => getLayout(id)).not.toThrow();
  });

  it("has exactly 144 slots", () => {
    expect(getLayout(id).length).toBe(144);
  });

  it("has no duplicate coordinates", () => {
    const layout = getLayout(id);
    const keys = layout.map((s) => `${s.col},${s.row},${s.layer}`);
    expect(new Set(keys).size).toBe(144);
  });

  it("has an even tile count per layer (solvability precondition)", () => {
    const layout = getLayout(id);
    const byLayer = new Map<number, number>();
    for (const s of layout) byLayer.set(s.layer, (byLayer.get(s.layer) ?? 0) + 1);
    for (const count of byLayer.values()) {
      expect(count % 2).toBe(0);
    }
  });

  it("is present in LAYOUTS registry with correct shape", () => {
    const meta = LAYOUTS.find((l) => l.id === id);
    expect(meta).toBeDefined();
    expect(meta!.tier).toBe(2);
    expect(meta!.tileCount).toBe(144);
    expect(Array.isArray(meta!.data)).toBe(true);
  });

  it("matches its .ts source exactly", () => {
    const json = getLayout(id);
    const ts = TIER2_TS_SOURCES[id]!;
    expect(json.length).toBe(ts.length);
    for (let i = 0; i < ts.length; i++) {
      expect(json[i]).toEqual(ts[i]);
    }
  });
});

// ---------------------------------------------------------------------------
// Tier-2 structure layouts validity -- castle, bridge, gate, double_pyramid, anchor
// ---------------------------------------------------------------------------

const TIER2_STRUCTURE_IDS = ["castle", "bridge", "gate", "double_pyramid", "anchor"] as const;

const TIER2_STRUCTURE_TS_SOURCES: Record<string, Layout> = {
  castle: CASTLE_LAYOUT,
  bridge: BRIDGE_LAYOUT,
  gate: GATE_LAYOUT,
  double_pyramid: DOUBLE_PYRAMID_LAYOUT,
  anchor: ANCHOR_LAYOUT,
};

describe.each(TIER2_STRUCTURE_IDS)("%s layout", (id) => {
  it("loads without throwing", () => {
    expect(() => getLayout(id)).not.toThrow();
  });

  it("has exactly 144 slots", () => {
    expect(getLayout(id).length).toBe(144);
  });

  it("has no duplicate coordinates", () => {
    const layout = getLayout(id);
    const keys = layout.map((s) => `${s.col},${s.row},${s.layer}`);
    expect(new Set(keys).size).toBe(144);
  });

  it("has an even tile count per layer (solvability precondition)", () => {
    const layout = getLayout(id);
    const byLayer = new Map<number, number>();
    for (const s of layout) byLayer.set(s.layer, (byLayer.get(s.layer) ?? 0) + 1);
    for (const count of byLayer.values()) {
      expect(count % 2).toBe(0);
    }
  });

  it("is present in LAYOUTS registry with tier=2", () => {
    const meta = LAYOUTS.find((l) => l.id === id);
    expect(meta).toBeDefined();
    expect(meta!.tier).toBe(2);
    expect(meta!.tileCount).toBe(144);
    expect(Array.isArray(meta!.data)).toBe(true);
  });

  it("matches its .ts source exactly", () => {
    const json = getLayout(id);
    const ts = TIER2_STRUCTURE_TS_SOURCES[id]!;
    expect(json.length).toBe(ts.length);
    for (let i = 0; i < ts.length; i++) {
      expect(json[i]).toEqual(ts[i]);
    }
  });
});

// ---------------------------------------------------------------------------
// Tier-2 symbol layouts validity -- crown, shield, heart, hourglass, the_key
// ---------------------------------------------------------------------------

const TIER2_SYMBOL_IDS = ["crown", "shield", "heart", "hourglass", "the_key"] as const;

const TIER2_SYMBOL_TS_SOURCES: Record<string, Layout> = {
  crown: CROWN_LAYOUT,
  shield: SHIELD_LAYOUT,
  heart: HEART_LAYOUT,
  hourglass: HOURGLASS_LAYOUT,
  the_key: THE_KEY_LAYOUT,
};

describe.each(TIER2_SYMBOL_IDS)("%s layout", (id) => {
  it("loads without throwing", () => {
    expect(() => getLayout(id)).not.toThrow();
  });

  it("has exactly 144 slots", () => {
    expect(getLayout(id).length).toBe(144);
  });

  it("has no duplicate coordinates", () => {
    const layout = getLayout(id);
    const keys = layout.map((s) => `${s.col},${s.row},${s.layer}`);
    expect(new Set(keys).size).toBe(144);
  });

  it("has an even tile count per layer (solvability precondition)", () => {
    const layout = getLayout(id);
    const byLayer = new Map<number, number>();
    for (const s of layout) byLayer.set(s.layer, (byLayer.get(s.layer) ?? 0) + 1);
    for (const count of byLayer.values()) {
      expect(count % 2).toBe(0);
    }
  });

  it("is present in LAYOUTS registry with tier=2", () => {
    const meta = LAYOUTS.find((l) => l.id === id);
    expect(meta).toBeDefined();
    expect(meta!.tier).toBe(2);
    expect(meta!.tileCount).toBe(144);
    expect(Array.isArray(meta!.data)).toBe(true);
  });

  it("matches its .ts source exactly", () => {
    const json = getLayout(id);
    const ts = TIER2_SYMBOL_TS_SOURCES[id]!;
    expect(json.length).toBe(ts.length);
    for (let i = 0; i < ts.length; i++) {
      expect(json[i]).toEqual(ts[i]);
    }
  });
});

// ---------------------------------------------------------------------------
// Tier-2 geometric layouts validity -- diamond, x_wing, maze, zig_zag, concentric_squares
// ---------------------------------------------------------------------------

const TIER2_GEOMETRIC_IDS = ["diamond", "x_wing", "maze", "zig_zag", "concentric_squares"] as const;

const TIER2_GEOMETRIC_TS_SOURCES: Record<string, Layout> = {
  diamond: DIAMOND_LAYOUT,
  x_wing: X_WING_LAYOUT,
  maze: MAZE_LAYOUT,
  zig_zag: ZIG_ZAG_LAYOUT,
  concentric_squares: CONCENTRIC_SQUARES_LAYOUT,
};

describe.each(TIER2_GEOMETRIC_IDS)("%s layout", (id) => {
  it("loads without throwing", () => {
    expect(() => getLayout(id)).not.toThrow();
  });

  it("has exactly 144 slots", () => {
    expect(getLayout(id).length).toBe(144);
  });

  it("has no duplicate coordinates", () => {
    const layout = getLayout(id);
    const keys = layout.map((s) => `${s.col},${s.row},${s.layer}`);
    expect(new Set(keys).size).toBe(144);
  });

  it("has an even tile count per layer (solvability precondition)", () => {
    const layout = getLayout(id);
    const byLayer = new Map<number, number>();
    for (const s of layout) byLayer.set(s.layer, (byLayer.get(s.layer) ?? 0) + 1);
    for (const count of byLayer.values()) {
      expect(count % 2).toBe(0);
    }
  });

  it("is present in LAYOUTS registry with tier=2", () => {
    const meta = LAYOUTS.find((l) => l.id === id);
    expect(meta).toBeDefined();
    expect(meta!.tier).toBe(2);
    expect(meta!.tileCount).toBe(144);
    expect(Array.isArray(meta!.data)).toBe(true);
  });

  it("matches its .ts source exactly", () => {
    const json = getLayout(id);
    const ts = TIER2_GEOMETRIC_TS_SOURCES[id]!;
    expect(json.length).toBe(ts.length);
    for (let i = 0; i < ts.length; i++) {
      expect(json[i]).toEqual(ts[i]);
    }
  });
});
