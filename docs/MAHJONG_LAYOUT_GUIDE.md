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

Every layout **must** satisfy all three rules:

| Rule | Detail | Enforced by |
|---|---|---|
| **Exactly 144 tiles** | 72 matching pairs — no more, no fewer | `parseLayout()` at registry init + tests |
| **No duplicate coordinates** | Every `(col, row, layer)` triple must be unique | `parseLayout()` at registry init + tests |
| **Even count per layer** | Each layer must have an even number of tiles (solvability precondition for the backwards-build shuffler) | Tests (`layoutEquivalence.test.ts`, `layoutRegistry.test.ts`) |

Breaking the first two throws when `registry.ts` is first imported, which crashes the app; the third fails CI.

---

## File Anatomy

**Location:** `frontend/src/game/mahjong/layouts/{id}.ts`

Each layout lives in exactly one place: its `.ts` module. `registry.ts` imports the module directly (there are no JSON layout assets — they were removed in #2968) and runs `parseLayout()` on every layout at module init.

Build layouts from the shared helpers in `layouts/build.ts` instead of listing 144 objects by hand:

| Helper | Emits |
|---|---|
| `slot(col, row, layer)` | One slot |
| `cols(start, stop, step = 2)` | Column positions `start..stop` inclusive (step 2 = one tile) |
| `rows(start, stop)` | Row indices `start..stop` inclusive |
| `grid(layer, colList, rowList)` | Every (col, row) pair, **row-major** |
| `row(layer, r, colList)` | One row, in `colList` order |
| `rect(layer, c0, c1, r0, r1)` | Filled rectangle, cols `c0..c1` (step 2) × rows `r0..r1`, row-major |

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
import { cols, rect, row } from "./build";

export const MY_LAYOUT: Layout = [
  // Layer 0
  ...rect(0, 0, 22, 0, 3),
  ...row(0, 4, [...cols(0, 6), ...cols(16, 22)]),
  // Layer 1
  ...rect(1, 2, 20, 1, 2),
  // ...
];
```

**Slot order is part of the layout.** The deal assigns tile faces to slots by array index, so reordering builder calls (even ones that yield the same set of coordinates) changes every seeded deal and `dealId` for that layout. `layoutEquivalence.test.ts` pins each existing layout's coordinates *and* order with a SHA-256 fingerprint; changing an existing layout's geometry means updating its fingerprint deliberately, and it invalidates saved games for that layout.

---

## Validation

Validation runs in Jest — there is no separate script (the old `scripts/validate-mahjong-layout.py` was removed in #2968):

- `parseLayout()` throws at registry init on a wrong slot count or a duplicate coordinate.
- `layoutEquivalence.test.ts` checks **every** `LAYOUTS` entry for slot count, duplicates and an even count per layer, so a newly registered layout is covered automatically.

```bash
cd frontend && npx jest layoutEquivalence layoutRegistry
```

---

## Wiring Into the Game

### Step 1 — Add to registry

Open `frontend/src/game/mahjong/layouts/registry.ts`:

1. Add an import at the top:

```typescript
import { MY_LAYOUT } from "./my_layout";
```

2. Add an entry to `LAYOUTS`:

```typescript
{
  id: "my_layout",
  name: "My Layout",
  tier: 2,          // 1 = free, 2 = premium
  tileCount: 144,
  data: MY_LAYOUT,
},
```

3. Add the id to `LAYOUTS` in `backend/mahjong/models.py` — `backend/tests/test_board_definitions.py` keeps the two lists in step.

### Step 2 — Add to the test suite

- In `frontend/src/game/mahjong/__tests__/layoutEquivalence.test.ts`, add the layout's fingerprint to `LAYOUT_FINGERPRINTS` (the first test fails until the registry ids and the fingerprint keys match). Compute it from the new layout with the test's own `fingerprint()` function, and say in the PR that it is a new entry.
- Optionally add the id to a tier group in `layoutRegistry.test.ts` for the per-layout `describe.each` checks.

### Step 3 — Run the tests

```bash
cd frontend && npx jest layoutEquivalence layoutRegistry
```

---

## Design Workflow

1. **Sketch on grid paper.** Draw the silhouette on a grid where each cell is one tile. Mark layer boundaries with shading.
2. **Count tiles per layer.** Adjust the design until each layer has an even count and the total is exactly 144.
3. **Translate to coordinates.** Convert each cell at grid position `(x, y)` to `col = x * 2`, `row = y`. Record which layer each tile belongs to.
4. **Write the `.ts` file** with the `build.ts` helpers (`rect`, `row`, `grid`, `cols`, `rows`, `slot`).
5. **Wire up and test.** Follow the steps above; all tests green.

---

## Tips and Pitfalls

**Symmetry saves tile-counting effort.** Designs with left-right or top-bottom symmetry halve the work — compute one half and mirror it.

**Layer counts must be even — design each layer independently.** It is easier to target an even count per layer from the start than to patch it later. Even numbers like 8, 12, 16, 20, 24 work well as building blocks.

**Stacking too high causes narrow playability windows.** Layouts with 5+ layers tend to start with very few free tiles. Keep most tiles in layers 0–2 and use higher layers sparingly.

**Avoid isolated tiles.** A tile with no horizontal neighbours on its layer and nothing above it is permanently free, which can distort game difficulty.

**Use `col = 14` as a rough centre** for a standard-width board (cols 0–28). The Turtle layout uses this as a reference point.

**Never reorder an existing layout casually.** Coordinates and slot order are pinned by `layoutEquivalence.test.ts`; see "Slot order is part of the layout" above.

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
