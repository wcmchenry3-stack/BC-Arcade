# Cascade

**Category:** Arcade
**Tier:** TBD
**Status:** Shipped (v2 engine — see epic #1746)

## How to Play

Cascade is a physics-based piece-drop game. Pieces fall from the top of the screen into a bin. When two pieces of the same tier collide they merge into a higher-tier piece, scoring points. The goal is to score as high as possible before the bin overflows.

### Piece Progression

Pieces evolve through 10 fixed tiers. The lowest-tier pieces are droppable (tiers 0–4); higher tiers are only reachable via merging. The highest tier is the **Watermelon** (jackpot merge). Definitions are in `frontend/src/game/cascade/pieceDefs.ts`.

Merge scores follow powers of two: `2^(tier+1)` per merge, plus a +256 jackpot bonus on a tier-9 (Watermelon) merge.

### Gameplay

- The current piece and the next queued piece are shown at the top of the screen
- The player taps or swipes to aim, then releases to drop
- Pieces roll and stack after landing — physics are fully simulated at 60 Hz
- Merges can chain: a merge may cause the new piece to immediately contact another of the same tier, triggering another merge
- Game over when any piece rests above the bin's overflow line for more than 3 seconds of accumulated ticks

## Client-Side Engine

All game logic is client-side and offline-capable. The backend receives only the final score.

### Module Map

| File                | Purpose                                                                      |
| ------------------- | ---------------------------------------------------------------------------- |
| `engine2.ts`        | Core physics simulation (`CascadeEngine` class, Matter.js wrapper)           |
| `pieceDefs.ts`      | 10-tier piece definitions: label, color, score, shape (`circle` or `convex`) |
| `constants.ts`      | All tunable physics & gameplay parameters                                    |
| `pieceQueue2.ts`    | Current + next piece queue (preview UI data)                                 |
| `spawnSelector2.ts` | Weighted random tier selection with drought correction & danger suppression  |
| `scoring.ts`        | Merge score calculator (isolated, reused by engine + UI)                     |
| `storage2.ts`       | AsyncStorage save/load — versioned `SavedState` (v3)                         |
| `scoreSync.ts`      | Registers Cascade handler in the global offline score queue                  |
| `api.ts`            | HTTP wrapper for leaderboard submission and score fetching                   |
| `types.ts`          | API response shapes and `GameEvent` union type                               |

### Physics

- **Engine:** Matter.js (rigid-body simulation), rendered via `@shopify/react-native-skia`
- **Timestep:** Fixed 16.67 ms (60 Hz) with up to 3 substeps per frame to handle variable frame rates
- **Sleep system:** Pieces sleep after 10 frames below velocity threshold — eliminates micro-vibration
- **Guard rails:** Out-of-bounds bodies are clamped back inside and a `guardRailFired` event is emitted. `Matter.World.remove()` is only called during confirmed merges — no silent deletion
- **Angular damping:** Applied post-physics with a hard clamp on `MAX_ANGULAR_VELOCITY`

### Piece Queue & Spawn Selection (`pieceQueue2.ts`, `spawnSelector2.ts`)

- Queue holds `{ current, next }` tiers; `advanceQueue()` shifts forward and generates a new `next`
- Tier selection uses a weighted random algorithm:
  1. Base weights favour lower tiers (`{0:5, 1:4, 2:3, 3:2, 4:1}`)
  2. Drought boost: tiers absent from the last 10 drops gain +3 weight
  3. Danger penalty: when the stack is near the overflow line, tiers ≥3 are reduced to 20% weight
  4. Streak hard-ban: if the last 4 picks are identical, that tier is banned for one turn
- RNG is injectable for deterministic testing and seeded replay

### Combo Detection (`engine2.ts`)

A `cascadeCombo` event is emitted when ≥3 merges occur within `COMBO_WINDOW_TICKS` (120 ticks, ~2 s). The combo counter resets on each drop.

### Persistence (`storage2.ts`)

- Saved state is versioned (`SavedState` v3) — includes pieces, score, and queue state
- `looksValid()` type guard runs strict validation on load; corrupt saves are wiped cleanly
- Sentry is notified on any storage error

## Backend

- Module: `backend/cascade/module.py`
- Endpoints: `backend/cascade/router.py`
- Metadata model: `CascadeMetadata` — `player_name: str = ""` (max 64 chars)
- Scoring: `final_score` = total points at game over (submitted by `scoreSync.ts` via the offline score queue)

## Accessibility

Cascade uses a Skia canvas for rendering. The native accessibility tree does not include canvas content. Requirements:

- Current score must be displayed in a native `Text` element outside the canvas
- Game-over state must be announced via an accessible modal or live region
- Canvas element marked `accessible={false}`

See [`docs/ACCESSIBILITY.md §4`](../ACCESSIBILITY.md#4-screen-readers) for the full canvas accessibility contract.

## Entitlement

Tier TBD. If premium: requires a valid entitlement JWT; see [`docs/ARCHITECTURE.md §10`](../ARCHITECTURE.md#10-premium-entitlements).
