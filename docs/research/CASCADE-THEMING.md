# Cascade — New Theme Onboarding Guide

This document captures everything learned building the `fruits` and `cosmos` theme sets. Follow it in order. Each phase has validation gates; do not advance past a gate until it passes.

Closes #262.

---

## Overview of the pipeline

```
Source PNGs
  → remove_backgrounds.py  (background removal, alpha cleanup)
  → extract_vertices.py    (convex hull, sprite offset/scale)
  → {theme}-vertices.json  (runtime asset data)
  → fruitSets.ts           (tier definitions)
  → useFruitImages.ts      (image loading)
  → fruitVertices.ts       (runtime vertex lookup)
```

Every past theme pain-point traces back to one of these steps being skipped or wrong. The checklist below makes each step explicit.

---

## Phase 1 — Asset Preparation (PNG files)

### 1.1 Collect source PNGs

- One PNG per tier (11 tiers for a full set)
- Recommended minimum resolution: **512 × 512 px**
- All tiers at consistent resolution

### 1.2 Identify body shape per asset

Before running any scripts, document for each asset:

| Asset          | Body shape              | Notes                                |
| -------------- | ----------------------- | ------------------------------------ |
| e.g. apple     | roughly circular        | slight horizontal taper at top       |
| e.g. cherry    | two spheres + long stem | stem shifts visual center far upward |
| e.g. pineapple | oval body + tall crown  | crown adds ~60% extra height         |

Assets with stems, crowns, tails, rings, or multi-body geometry will need careful offset/scale inspection in Phase 2.

### 1.3 Choose a background removal mode

`frontend/scripts/remove_backgrounds.py` supports two modes:

| Mode        | When to use                                                                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `color`     | Solid or near-solid backgrounds. Samples corner pixels to determine the background color. Fast and accurate for most cartoon/icon assets.                                            |
| `celestial` | Complex backgrounds (gradients, starfields, checkerboards). Uses a two-pass color-distance + radial mask. Needed when single-threshold removal eats grey artwork (see: Moon, Venus). |

**Test on the hardest asset first** — the greyest, most transparent, or most irregular one. If that passes, the rest will too.

### 1.4 Run `remove_backgrounds.py`

```bash
cd frontend
python scripts/remove_backgrounds.py \
  --mode color \          # or celestial
  --input assets/raw-{theme}/ \
  --output assets/{theme}-icons/
```

### 1.5 Visual inspection (required — do not skip)

Open every processed PNG and zoom in on:

- **Body edges** — soft, anti-aliased boundary? Good. Jagged or with a halo? Adjust threshold.
- **Transparent regions** — fully transparent (checkerboard preview)? Good. Grey or colored fringe? Threshold too soft.
- **Body interior** — fully opaque? Good. Any eaten pixels (unexpected holes)? Threshold too aggressive.

Pay particular attention to assets with:

- Grey bodies on grey backgrounds (two-pass / `celestial` mode may be needed)
- Thin features (stems, tails, antennae)
- Semi-transparent glows or shadows

### 1.6 Validate alpha channel (ghost pixel check)

Semi-transparent pixels retain their original RGB values. At runtime, canvas resampling blends those RGB values with adjacent opaque pixels, producing checkerboard or halo artifacts.

**Gate: every pixel with alpha < 200 must have R=G=B=0.**

`remove_backgrounds.py` applies this automatically. Verify by loading a processed PNG in a browser dev tool's image inspector and checking a few edge pixels.

---

## Phase 2 — Vertex & Sprite Extraction

### 2.1 Run `extract_vertices.py`

```bash
cd frontend
python scripts/extract_vertices.py \
  --input assets/{theme}-icons/ \
  --output assets/{theme}-vertices.json
```

This outputs a JSON file with per-asset entries:

```json
{
  "cherry": {
    "verts": [[x, y], ...],       // convex hull, normalized to [-1, 1]
    "spriteOffset": [ox, oy],     // image center → hull center, normalized
    "spriteScale": [sx, sy]       // image half-size in normalized coords
  }
}
```

### 2.2 Inspect convex hulls

For each asset, verify that the hull traces the **body boundary**, not the image boundary. The hull should:

- Wrap the opaque fruit/planet body
- Exclude stems, tails, rings, crowns (these are not part of the collision shape)
- For roughly circular assets: be close to a circle

If hulls include non-body features (e.g., cherry stem is included in the hull), the physics body will be wrong. Return to Phase 1 and tighten the alpha threshold, or mask out the non-body region.

### 2.3 Check sprite offset

`spriteOffset` maps the image center to the hull center so asymmetric assets render aligned with their physics body. A wrong offset means the sprite floats or sinks relative to where collisions happen.

Verify by adding the asset to a local build and dropping it from height. The visual body should land where the physics body lands.

### 2.4 Check sprite scale

`spriteScale` sets the image half-size in normalized coords (multiply by radius for world-space). Confirm:

- The physics circle fits inside the sprite body (no visible gap between collision boundary and art)
- The sprite body does not visibly extend beyond the physics circle (see also: Phase 4 clip check)

### 2.5 Decide: polygon or circle collider

If all assets are roughly circular (e.g., planets), clear the `verts` arrays and let Matter.js use its native circle collider:

```json
{ "verts": [], "spriteOffset": [...], "spriteScale": [...] }
```

Circle colliders are faster, more stable under high stacking, and free of polygon-decomposition edge cases (e.g., Moon falling through floor). Use them whenever the body shape is close enough to a circle that the visual mismatch is imperceptible.

---

## Phase 3 — Runtime Integration

### 3.1 Add theme to `fruitSets.ts`

- Define all 11 tiers: `name`, `nameKey`, `color`, `icon` path, `radius`
- `color` is used as the background fill on web (visible between the body edge and the circular clip). Choose a color that complements the asset.
- `nameKey` must match the JSON key in `{theme}-vertices.json`

### 3.2 Add image imports to `useFruitImages.ts`

Map each tier's `icon` path to the loaded image asset. Follow the existing pattern for `fruits` and `cosmos`.

### 3.3 Register vertex JSON in `fruitVertices.ts`

Add an `import` for `assets/{theme}-vertices.json` and a branch in `getEntry()`:

```typescript
import themeVerticesRaw from "../../../assets/{theme}-vertices.json";

function getEntry(setId: string, nameKey: string): AssetEntry | null {
  // ...existing branches...
  else if (setId === "{theme}") map = themeVerticesRaw as ...;
  // ...
}
```

### 3.4 Test `cleanImage()` on web

Load the game in a browser with the new theme selected. For each tier:

- No checkerboard visible at body edges → alpha cleaning worked
- No halo or glow ring around asset → background removal was clean
- If artifacts appear, go back to Phase 1 and adjust the alpha threshold

---

## Phase 4 — Visual Validation

These checks have caught every cross-theme bug so far. Do all of them.

### 4.1 Circular clip check

Every sprite is clipped to a circle whose radius is computed by `spriteClipRadius()` in `fruitVertices.ts`. This radius is the minimum enclosing circle for the sprite's bounding rectangle, which is larger than the physics radius to accommodate assets with rings or large offsets.

For each asset, confirm:

- The visible sprite body sits inside the physics collision boundary
- No art is clipped mid-body (the clip is large enough)

For assets with rings or imagery that extends beyond the physics radius (e.g., Uranus, Saturn), verify the clip shows the full ring.

### 4.2 Background fill check (web only)

On web, the area inside the clip circle but outside the transparent sprite body is filled with the tier's `color`. Confirm:

- No white, black, or checkerboard patches visible at body edges
- The fill color complements the asset

### 4.3 Bin border layering

The bin walls are drawn **twice** in the render loop — once before fruits (so fruits overlap walls), and once after (so wall edges are always crisp). Verify:

- Drop a fruit against each wall: the wall edge should be clean, not smeared by the sprite background fill
- The outer edge of any sprite's background fill should not be visible above the bin border

### 4.4 Fruit-on-fruit layering (black overlap check)

When two fruits touch, each fruit's background fill must not overwrite the other's art. This is prevented by the background fill using an arc (circle) rather than a rect:

```typescript
// GameCanvas.web.tsx — drawFruitBody
ctx.beginPath();
ctx.arc(0, 0, r, 0, Math.PI * 2); // fill stays within physics radius
ctx.fill();
```

Verify: stack several fruits and confirm no black or background-colored patches appear between them.

### 4.5 Asymmetric body test

For each asset with a stem, crown, tail, or non-circular body:

- Drop from height — physics landing should match visual landing
- Roll against a wall — visual and physics rotation should match
- Stack — asset should not appear to float above or sink below the pile

### 4.6 Native (iOS/Android) rendering check

The Skia renderer (`GameCanvas.tsx`) does not use a background fill — it clip-draws the image directly. Verify:

- No ring artifacts at the clip boundary on device or simulator
- Transparent sprite regions show the game background, not a solid color

### 4.7 Small screen test

Cascade scales the world to fit narrow devices (#261). On a narrow viewport:

- Assets should not visually overflow the bin
- Physics radius and visual body should still align

---

## Phase 5 — Automated Gates

All of these must pass before merging a new theme:

```bash
cd frontend
npx jest --testPathPattern="fruitAssets|fruitVertices"
```

- **`fruitAssets.test.ts`**: hull coverage ≥ 60%, vertex count ≤ 24, all vertices within [-1.001, 1.001], centroid near origin, spriteClipRadius > 0
- **`fruitVertices.test.ts`**: existing tests cover the runtime lookup paths — add theme-specific fixture entries if needed
- **ESLint + Prettier**: `npx eslint src && npx prettier --check src`
- **Manual sign-off**: Web + iOS + Android, using the Phase 4 checklist above

---

## Key lessons by problem type

| Problem                               | Root cause                                       | Fix                                             | Applies to all themes? |
| ------------------------------------- | ------------------------------------------------ | ----------------------------------------------- | ---------------------- |
| Checkerboard ghost artifacts          | Semi-transparent pixels retain bright RGB        | `cleanImage()` zeros RGB when alpha < 200       | Yes                    |
| Collision hull too large              | Semi-transparent glow included in threshold      | Raise alpha threshold in extraction             | Yes                    |
| Asymmetric body misaligned            | Hull centered on image center, not body center   | `spriteOffset` normalized to opaque bbox center | Yes                    |
| Sprite visually offset                | Offset computed from raw PNG                     | Always compute from processed PNG               | Yes                    |
| Black overlaps between fruits         | Background `fillRect` bled beyond physics circle | Use `arc+fill` instead of `fillRect` for bg     | Yes                    |
| Rings clipped at physics radius       | Clip hardcoded to `r`, not sprite extent         | Use `spriteClipRadius()` for clip radius        | Yes                    |
| Planet grey eaten by removal          | Single threshold too aggressive for grey bodies  | Two-pass `celestial` mode with radial mask      | Celestial-type themes  |
| Near-circle asset falls through floor | Polygon decomposition on small vertex count      | Clear `verts` array, use native circle collider | Round-body assets      |

---

## Files reference

| File                                                      | Purpose                                           |
| --------------------------------------------------------- | ------------------------------------------------- |
| `frontend/scripts/remove_backgrounds.py`                  | Background removal; may need a new mode per theme |
| `frontend/scripts/extract_vertices.py`                    | Hull + sprite metadata extraction                 |
| `frontend/assets/{theme}-vertices.json`                   | Runtime vertex/sprite data                        |
| `frontend/assets/{theme}-icons/*.png`                     | Processed PNG assets                              |
| `frontend/src/theme/fruitSets.ts`                         | Tier definitions per theme                        |
| `frontend/src/theme/useFruitImages.ts`                    | Image loading hooks                               |
| `frontend/src/game/cascade/fruitVertices.ts`              | Runtime vertex lookup + `spriteClipRadius`        |
| `frontend/src/components/cascade/GameCanvas.web.tsx`      | Web rendering (`cleanImage`, `drawFruitBody`)     |
| `frontend/src/components/cascade/GameCanvas.tsx`          | Native rendering (`FruitBodySkia`)                |
| `frontend/src/game/cascade/__tests__/fruitAssets.test.ts` | Automated hull/sprite validation                  |
