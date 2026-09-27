# Cascade Physics — Architecture & Developer Reference

> **Scope:** Matter.js physics engine for the Cascade (Suika-style) game.
> Generated from S14 — covers S1 through S12.

---

## 1. Architecture

```
engine.ts  (platform entry point)
    │  re-exports all constants and types from engine.shared
    │  contains createEngine() — the full Matter.js implementation
    │
    ├── engine.shared.ts  (constants, interfaces, shared types)
    │       WORLD_W / WORLD_H / WALL_THICKNESS
    │       all physics-tuning constants (friction, gravity, etc.)
    │       EngineHandle interface
    │       FruitBody / BodySnapshot / MergeEvent types
    │
    └── physicsLayout.ts  (pure math, no Matter.js import)
            calculateBinDimensions(maxRadius)
            calculateMergeCentroid(posA, massA, posB, massB)
            calculateTierRadius(tier, baseRadius, factor?)
            packingTheoremClearance(level1Diameter)
            BIN_WALL_RATIO / BIN_INNER_DIAMETERS / BIN_ASPECT_RATIO
```

**Platform import path:** Always import from `./engine` (which is `engine.ts`). Never import directly from `engine.shared` in application code — `engine.ts` re-exports everything and is the stable public surface.

### `EngineHandle` interface

| Method | Description |
|--------|-------------|
| `step(dt?)` | Advance physics one tick (or `dt` seconds). Returns `{ snapshots, events }`. |
| `drop(def, fruitSetId, x, y)` | Drop a fruit at pixel coords; resets combo counter. |
| `spawnRaw?(def, fruitSetId, x, y)` | Test-only spawn; does **not** reset combo counter. |
| `cleanup()` | Tear down Matter.js engine; clears all dedup Sets so a new session can observe the same anomalies again. |

---

## 2. Normalized-Unit Derivation

The physics world runs at a **fixed pixel size** (`WORLD_W × WORLD_H`). The renderer scales its canvas to fill the device container — the engine never sees device pixels.

### Hardcoded baseline (current)

```ts
WORLD_W = 400   // px
WORLD_H = 700   // px
WALL_THICKNESS = 16  // px
```

These were established during the S3/S4 Matter.js unification. The renderer in `CascadeScreen` computes a CSS `transform: scale(...)` to stretch the `400 × 700` canvas to fit the container.

### Derived values via `calculateBinDimensions`

`physicsLayout.ts` exposes a formula for deriving bin dimensions from the largest fruit radius:

```ts
const { width, height, wallThickness } = calculateBinDimensions(RADII[10]);
// RADII[10] = 168 px (tier-10, the watermelon)

// Internals:
// wallThickness = Math.max(4, round(maxRadius × BIN_WALL_RATIO))   // BIN_WALL_RATIO = 0.4
// innerWidth    = round(maxRadius × 2 × BIN_INNER_DIAMETERS)       // BIN_INNER_DIAMETERS = 4
// width         = innerWidth + 2 × wallThickness
// height        = round(width × BIN_ASPECT_RATIO)                  // BIN_ASPECT_RATIO = 1.75
```

S4 adopted this formula to replace the hardcoded constants. The hardcoded values in `engine.shared.ts` remain as the stable physics-world baseline; `calculateBinDimensions` is authoritative for layout validation and future tier-set changes.

### `DANGER_LINE_RATIO`

```ts
DANGER_LINE_RATIO = 0.18   // 18% from the top of WORLD_H
```

Game-over fires when a **settled** fruit's centre crosses `WORLD_H × DANGER_LINE_RATIO` for `GAME_OVER_CONSECUTIVE_TICKS` consecutive ticks, subject to `GAME_OVER_MERGE_COOLDOWN_TICKS` and `GAME_OVER_VELOCITY_THRESHOLD` guards (see UC5 / UC6).

---

## 3. Constants Table

All constants are exported from `engine.shared.ts`. UC/S references indicate the story that introduced or last modified the constant.

| Constant | Value | Spec reference | Rationale |
|----------|-------|----------------|-----------|
| `WORLD_W` | 400 px | S3 | Fixed physics world width |
| `WORLD_H` | 700 px | S3 | Fixed physics world height |
| `WALL_THICKNESS` | 16 px | S3 | Exceeds max travel per 1/60s sub-step (15 px at `MAX_FRUIT_SPEED_PX_S`) so fruits cannot tunnel through |
| `DANGER_LINE_RATIO` | 0.18 | UC5 | 18% from top — game-over danger line |
| `GAME_OVER_GRACE_MS` | 3000 ms | UC5 | Grace period before overlay fires |
| `GAME_OVER_CONSECUTIVE_TICKS` | 180 | UC5 | Ticks above danger line required before game-over |
| `GAME_OVER_MERGE_COOLDOWN_TICKS` | 90 | UC6 | Ticks after last merge during which game-over is suppressed |
| `GAME_OVER_VELOCITY_THRESHOLD` | 8 px/step | UC6 | Bodies moving faster than this are treated as ballistic, excluded from overflow check |
| `FRUIT_FRICTION` | 0.08 | UC1 (spec: 0.05–0.1) | Low friction so fruits slide and settle naturally |
| `FRUIT_ANGULAR_DAMPING` | 0.05 | UC1 | Kills residual spin after landing |
| `FRUIT_FRICTION_AIR` | 0.01 | UC1 | Air friction for smooth free-fall deceleration |
| `WALL_FRICTION` | 0.2 | UC1 (spec: ~0.2) | Higher than fruit friction so fruits grip walls but slide freely on each other |
| `POP_IMPULSE_SCALE` | 2.0 | UC2 | Radial pop impulse on merge = `nextTierRadius × scale` |
| `FRUIT_DENSITY_BY_TIER` | 0.0005–0.002 | UC3 | Heavier for larger fruit so large tiers sink into piles |
| `FRUIT_RESTITUTION_BY_TIER` | 0.5–0.05 | UC3 | Smaller fruit bounce more; larger fruit thud and settle |
| `RESTITUTION_THRESHOLD` | 0.5 px/tick | UC3 | Approach velocity below which restitution is suppressed (`Matter.Resolver._restingThresh`) |
| `MATTER_GRAVITY_Y` | 1.8 | UC1 | ~1800 px/s² at 60 Hz via `gravity.scale = 0.001` |
| `FIXED_STEP_MS` | 16.67 ms | S3 | Fixed 60 Hz physics sub-step |
| `MATTER_POSITION_ITERATIONS` | 10 | UC1 | Prevents jitter in 15-deep stacks (default 6) |
| `MATTER_VELOCITY_ITERATIONS` | 6 | UC1 | Resolves constraint budget cleanly (default 4) |
| `MATTER_POSITION_ITERATIONS_MERGE` | 15 | S11 | Elevated for 3 sub-steps post-merge to resolve dense pile penetration |
| `MATTER_SLEEP_THRESHOLD` | 30 ticks | UC1 | ≈500 ms at 60 Hz before a body sleeps |
| `MAX_FRUIT_SPEED_PX_S` | 900 px/s | CASCADE-PHYS-08 | Caps travel at 15 px per 1/60s step, below `WALL_THICKNESS` (16 px) |
| `SPAWN_GRACE_TICKS` | 3 | UC2 | Ticks a merge-spawned body is immune to dynamic-vs-dynamic collisions |
| `SPAWN_GRACE_MS` | ≈50 ms | UC2 | Wall-clock equivalent; ticks computed at spawn so 120 Hz devices match 60 Hz protection |
| `WARM_SPAWN_FRAMES` | 10 | UC2 | Ticks over which a merge-spawned body grows from 50% to 100% radius |
| `WARM_SPAWN_START_SCALE` | 0.5 | UC2 | Initial radius scale to prevent explosive ejection on merge |
| `COLLISION_GROUP_WALL` | 0x0001 | UC2 | Bitmask for wall and floor bodies |
| `COLLISION_GROUP_DYNAMIC` | 0x0002 | UC2 | Bitmask for fruit bodies |

---

## 4. TDD UC Order Rationale

The stories were implemented in a strict dependency order. Each UC builds on the previous:

| Story | UC | What it adds | Why it must come before the next |
|-------|----|-------------|----------------------------------|
| S1+S2 | — | `physicsLayout` math module + seeded RNG test harness | Pure-math foundation; downstream tests depend on `calculateBinDimensions` and deterministic RNG |
| S3+S4 | — | Matter.js unification, delete Rapier, normalized coordinate system, `engine.ts` | Establishes stable `EngineHandle` interface and fixed world dimensions that all UC tests target |
| S5 | UC1 | Angular damping, air friction, body sleeping | Settling behavior must be stable before testing collision outcomes (UC2) |
| S6 | UC2 | Warm-spawn merge + mass-weighted velocity pop impulse | Merge correctness depends on settled bodies (UC1); spawn grace requires collision groups |
| S7 | UC3 | Per-tier density, restitution, bounce threshold | Per-tier physics tuning requires a working merge pipeline (UC2) |
| S8 | UC4 | Cascade combo fix + game-over suppression during merge cascades | Combo tracking depends on merge events (UC3); suppression requires cooldown ticks |
| S9 | UC5 | Poly-decomp for concave polygon collision hulls | Accurate collision shapes depend on stable per-tier physics (UC3) |
| S10 | UC6 | Velocity filter — suppress false-positive game-over for ballistic bodies | Builds on the game-over threshold logic from UC4/UC5 |
| S11 | — | Elevated merge-iteration count + NaN/Inf guards | Stability hardening — depends on all merge and spawn logic being in place |
| S12 | — | Sentry observability at 5 guard points | Requires all guard points (init, spawn, merge, step) to be finalized |

---

## 5. Sentry Guide

### Rule: never call Sentry inside `step()` or any tick loop

> **Never call `Sentry.captureMessage` inside `step()`, `update()`, or any per-frame callback.**

The physics engine runs at 60 Hz. A single anomaly (e.g., one body with a NaN position) would fire 60 Sentry events per second. This saturates the Sentry quota in seconds and masks the original signal.

### Module-level `Set` dedup pattern

Each guard point has a corresponding `Set<string>` declared at the top of `createEngine()`:

```ts
const nanPositionDeduped = new Set<string>();
const boundaryEscapeDeduped = new Set<string>();
const explosiveEjectionDeduped = new Set<string>();
const nanSpawnDeduped = new Set<string>();
const decompFailureDeduped = new Set<string>();
```

Before firing to Sentry, the guard checks whether the dedup key is already in the set. If so, it logs to `console.warn` only. If not, it adds the key and (subject to `sampleRate`) calls `captureMessage`.

**The dedup key is scoped to the anomaly identity** — e.g., `tier-${fb.fruitTier}` for NaN position, `${fruitSetId}:${nameKey}` for decomp failures — so a new tier or asset triggers a fresh report.

### `sampleRate` seam

`createEngine` accepts a `sampleRate` parameter (default `0.1`). Every `captureMessage` call is wrapped:

```ts
if (random() < sampleRate) {
  Sentry.captureMessage(...);
}
```

This is the only per-call throttle on top of dedup. In tests, pass `sampleRate: 1` to ensure all anomalies fire. The default 10% rate means ~1 in 10 distinct anomalies per session reaches Sentry in production.

### Reset on cleanup

`cleanup()` calls `.clear()` on all five dedup Sets. This means a new game session (new `createEngine` call) can observe and report the same anomaly again. Do not skip the `cleanup()` call when tearing down the engine.

### The 6 guard points and their `op` tags

| `op` tag | Trigger | Dedup key |
|----------|---------|-----------|
| `engine.init` | Invalid world dimensions (`W` or `H` non-finite or ≤ 0) | None — fires at most once in init code |
| `spawn.decomp` | Polygon decomposition failed for a fruit asset | `${fruitSetId}:${nameKey}` |
| `merge.spawn` | NaN or Inf position after computing merge centroid | `tier-${tier}` |
| `body.explosive-ejection` | Body speed exceeds `MAX_FRUIT_SPEED_PX_S` after a step | `tier-${fb.fruitTier}` |
| `body.nan-position` | Body position is NaN or Inf during step | `tier-${fb.fruitTier}` |
| `body.boundary-escape` | Body centre is outside the physics world bounds | `tier-${fb.fruitTier}` |

All guards use `tags: { subsystem: "cascade.engine", op: "<tag>" }`.

---

## 6. `__cascade_*` Hook Contract

These hooks are registered on `window` by `CascadeScreen.tsx` and cleaned up on unmount. They are **only available when `EXPO_PUBLIC_TEST_HOOKS=1`** is set at build time (used by CI and local E2E runs via `EXPO_PUBLIC_TEST_HOOKS=1 npx expo export --platform web`). In production builds the hooks are absent — calling them is a no-op or undefined access.

| Hook | Signature | When available |
|------|-----------|----------------|
| `window.__cascade_isReady` | `() => boolean` | After `CascadeScreen` mounts and the engine resolves |
| `window.__cascade_setSeed` | `(n: number) => void` | After mount; must be called before the first drop |
| `window.__cascade_dropAt` | `(x: number) => void` | After engine ready; drops next queued fruit at canvas x |
| `window.__cascade_spawnTierAt` | `(tier: number, x: number) => void` | After engine ready; bypasses queue, preserves combo counter |
| `window.__cascade_fastForward` | `(ms: number) => void` | After engine ready; advances physics without wall-clock wait |
| `window.__cascade_getState` | `() => CascadeState` | After engine ready; returns live engine snapshot |
| `window.__cascade_triggerGameOver` | `() => void` | After engine ready; immediately fires game-over |

### `EXPO_PUBLIC_TEST_HOOKS=1` requirement

Without this flag the hooks are tree-shaken out of the bundle. E2E helpers in `e2e/tests/helpers/cascade.ts` call `gotoCascade()` which waits for `__cascade_isReady() === true` before proceeding — this guard also implicitly ensures the flag was set, because the hook itself is absent in production builds and `waitForFunction` would time out.

### `__cascade_isReady`

Returns `true` once the Matter.js engine has finished its async initialisation and the canvas ref has been set. Call this (or use `gotoCascade()` which wraps it) before any spawn or state-read hooks, or the calls silently no-op.

### `__cascade_setSeed`

Seeds the seeded RNG used by `FruitQueue` to produce the next-fruit sequence. Must be called before the first `dropAt` or `spawnTierAt` of a session to produce a fully reproducible run.
