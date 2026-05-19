# Mahjong Layout Authoring Guide

Reference for adding new layouts to BC Arcade Mahjong. Covers the coordinate system, file conventions, validation tooling, and the checklist for wiring a layout into the game.

---

## Coordinate System

Each tile slot is a `{ col, row, layer }` object.

### col — horizontal position

Tiles are **2 grid units wide**. Adjacent tiles in the same row must differ by 2.

```
col:  0   2   4   6   8  10  12 ...
       [0] [1] [2] [3] [4] [5] [6]  ← tile indices
```

Use only even values. Odd `col` values are invalid and will visually overlap neighbours.

### row — vertical position

Rows are **1 grid unit tall**. Any non-negative integer is valid. Layouts can start at any row — Pyramid starts at row 2, Arena starts at row 0.

### layer — depth / stacking

`layer: 0` is the bottom (table surface). Higher layers stack on top with an isometric offset (shifted right and up in screen space). Most layouts use 2–5 layers.

**Stacking rule:** a tile at `(col, row, layer)` blocks the tile at `(col, row, layer-1)` — the lower tile is not free while the upper tile sits on it.

**Free-tile rule (engine):** a tile is playable when:
1. Nothing is stacked on top: no tile exists at `(col, row, layer+1)`
2. At least one horizontal side is clear: no tile at `(col-2, row, layer)` **or** no tile at `(col+2, row, layer)`

Design so that a reasonable number of tiles are free at the start of each game.

### Screen mapping

```
x = padX + (col / 2) * tileWidth  + layer * layerDx
y = padY +  row       * tileHeight - layer * layerDy
```

Tiles shift right (`layerDx`) and up (`layerDy`) per layer, giving the isometric 3D look.

---

## Hard Constraints

Every layout **must** satisfy all three rules — enforced at runtime by `parseLayout()` and in the test suite:

| Rule | Detail |
|---|---|
| **Exactly 144 tiles** | 72 matching pairs — no more, no fewer |
| **No duplicate coordinates** | Every `(col, row, layer)` triple must be unique |
| **Even count per layer** | Each layer must have an even number of tiles (solvability precondition for the backwards-build shuffler) |

Breaking any rule throws at module init, which crashes the app.

---

## File Anatomy

### 1 — JSON file

**Location:** `frontend/assets/mahjong/layouts/{id}.json`

A flat array of 144 slot objects, sorted by layer then row then col (convention, not enforced):

```json
[
  { "col": 4, "row": 2, "layer": 0 },
  { "col": 6, "row": 2, "layer": 0 },
  ...
]
```

### 2 — TypeScript source file

**Location:** `frontend/src/game/mahjong/layouts/{id}.ts`

The `.ts` file is the canonical source of truth. The JSON file is generated from it (or kept in sync manually). Every existing layout has one.

Minimal template:

```typescript
/**
 * MyLayout layout — 144 slots.
 *
 * Brief description of the visual shape.
 *
 * Layer breakdown:
 *   Layer 0 — N tiles: ...
 *   Layer 1 — N tiles: ...
 *   Total: N + N = 144
 */

import type { Layout } from "../types";

function slot(col: number, row: number, layer: number) {
  return { col, row, layer };
}

function rng(start: number, stopInclusive: number, step = 2): number[] {
  const out: number[] = [];
  for (let v = start; v <= stopInclusive; v += step) out.push(v);
  return out;
}

export const MY_LAYOUT: Layout = [
  // Layer 0
  ...rng(4, 24).map((c) => slot(c, 2, 0)),
  // ...
];

if (MY_LAYOUT.length !== 144) {
  throw new Error(`MY_LAYOUT has ${MY_LAYOUT.length} slots, expected 144`);
}
```

The compile-time length check (`if MY_LAYOUT.length !== 144`) catches arithmetic mistakes before tests run.

---

## Validation

Run the standalone Python validator before committing:

```bash
python3 scripts/validate-mahjong-layout.py frontend/assets/mahjong/layouts/{id}.json
```

Successful output:

```
  layer 0: 80 tiles ✓
  layer 1: 48 tiles ✓
  layer 2: 16 tiles ✓
OK — frontend/assets/mahjong/layouts/my_layout.json (144 tiles, 3 layers)
```

The script checks all three hard constraints and exits non-zero on failure.

---

## Wiring Into the Game

### Step 1 — Add to registry

Open `frontend/src/game/mahjong/layouts/registry.ts`:

1. Add an import at the top:

```typescript
import myLayoutData from "../../../../assets/mahjong/layouts/my_layout.json";
```

2. Add an entry to `LAYOUTS`:

```typescript
{
  id: "my_layout",
  name: "My Layout",
  tier: 2,          // 1 = free, 2 = premium
  tileCount: 144,
  data: myLayoutData,
},
```

### Step 2 — Add to the test suite

Open `frontend/src/game/mahjong/__tests__/layoutRegistry.test.ts`.

- Import the `.ts` source at the top of the file alongside the existing imports.
- Add the layout ID to the relevant tier constant (`TIER1_IDS` or `TIER2_IDS`).
- Add the layout to the matching `TS_SOURCES` record.

The `describe.each` block already tests every ID in the array — adding the ID is sufficient.

### Step 3 — Run the tests

```bash
cd frontend && npx jest layoutRegistry
```

All five checks must pass per layout: loads without throwing, 144 slots, no duplicates, even per-layer count, matches `.ts` source.

---

## Design Workflow

1. **Sketch on grid paper.** Draw the silhouette on a grid where each cell is one tile. Mark layer boundaries with shading.
2. **Count tiles per layer.** Adjust the design until each layer has an even count and the total is exactly 144.
3. **Translate to coordinates.** Convert each cell at grid position `(x, y)` to `col = x * 2`, `row = y`. Record which layer each tile belongs to.
4. **Write the `.ts` file.** Use helper functions (`rng`, `slot`, `slots`) rather than listing 144 objects by hand — it keeps intent readable and bugs rare.
5. **Generate / sync the JSON.** Either run the `.ts` through Node to emit JSON, or write the JSON matching the `.ts` output (the test suite enforces they match exactly).
6. **Validate.** `python3 scripts/validate-mahjong-layout.py ...`
7. **Wire up and test.** Follow the steps above; all tests green.

---

## Tips and Pitfalls

**Symmetry saves tile-counting effort.** Designs with left-right or top-bottom symmetry halve the work — compute one half and mirror it.

**Layer counts must be even — design each layer independently.** It is easier to target an even count per layer from the start than to patch it later. Even numbers like 8, 12, 16, 20, 24 work well as building blocks.

**Stacking too high causes narrow playability windows.** Layouts with 5+ layers tend to start with very few free tiles. Keep most tiles in layers 0–2 and use higher layers sparingly.

**Avoid isolated tiles.** A tile with no horizontal neighbours on its layer and nothing above it is permanently free, which can distort game difficulty.

**Use `col = 14` as a rough centre** for a standard-width board (cols 0–28). The Turtle layout uses this as a reference point.

**The `.ts` source must match the JSON exactly.** The test `"matches its .ts source exactly"` diffs every slot index. If you update one, update the other.

---

## Existing Layouts — Reference

| ID | Name | Tier | Layers | Shape |
|---|---|---|---|---|
| `turtle` | Turtle | 1 | 5 | Classic turtle silhouette |
| `pyramid` | Pyramid | 1 | 5 | Stepped pyramid, 4-col peak |
| `square` | Square | 1 | 3 | Concentric hollow squares |
| `arena` | Arena | 1 | 3 | 2-tile-wide ring |
| `four_rivers` | Four Rivers | 1 | 2 | Four 2-wide horizontal strips |
| `butterfly` | Butterfly | 2 | 3 | Two wings + central body |
| `fish` | Fish | 2 | 3 | Fish body + tail fan |
| `spider` | Spider | 2 | 3 | Body + eight radiating legs |
| `cat` | Cat | 2 | 4 | Cat silhouette with ears + tail |
| `snowflake` | Snowflake | 2 | 3 | Six-armed snowflake |

Browse `frontend/src/game/mahjong/layouts/*.ts` for annotated examples of each.
