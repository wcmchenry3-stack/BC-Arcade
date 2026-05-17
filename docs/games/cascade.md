# Cascade

**Category:** Arcade
**Tier:** TBD
**Status:** In Development

## How to Play

Cascade is a physics-based fruit-drop game. Fruits fall from the top of the screen into a bin. When two fruits of the same type collide they merge into a larger fruit, scoring points. The goal is to score as high as possible before the bin overflows.

### Fruit Progression

Fruits evolve through a fixed sequence — the smallest type merges into the next size up, and so on. The highest-tier fruit is the "cascade" (jackpot merge). The exact sequence and point values are defined in `frontend/src/game/cascade/fruitSets.ts`.

### Gameplay

- A queued fruit is shown at the top; the player taps or swipes to aim, then releases to drop
- Fruits can roll and stack after landing — physics are fully simulated
- Merges can chain: a merge may cause the new (larger) fruit to immediately contact another of the same type, triggering another merge
- Game over when any fruit comes to rest above the bin's top edge

## Scoring (Persistence)

`final_score` = cumulative point total at game over. Each merge type has a fixed point value; larger merges score more. Leaderboard ranks by `final_score`.

## Client-Side Engine

- Location: `frontend/src/game/cascade/engine.ts` (game rules, merge detection)
- Physics: **Matter.js** (rigid-body simulation), rendered via **@shopify/react-native-skia**
- Theming: `frontend/src/game/cascade/fruitSets.ts`, `frontend/src/game/cascade/fruitVertices.ts`, `frontend/src/game/cascade/useFruitImages.ts`
- Theming pipeline: [`docs/CASCADE-THEMING.md`](../CASCADE-THEMING.md)

## Backend

- Module: `backend/cascade/module.py`
- Endpoints: `backend/cascade/router.py`
- Metadata model: `CascadeMetadata` — `player_name: str = ""` (max 64 chars)
- Scoring: `final_score` = total points at game over

## Accessibility

Cascade uses a Skia canvas for rendering. The native accessibility tree does not include canvas content. Requirements:

- Current score must be displayed in a native `Text` element outside the canvas
- Game-over state must be announced via an accessible modal or live region
- Canvas element marked `accessible={false}`

See [`docs/ACCESSIBILITY.md §4`](../ACCESSIBILITY.md#4-screen-readers) for the full canvas accessibility contract.

## Entitlement

Tier TBD. If premium: requires a valid entitlement JWT; see [`docs/ARCHITECTURE.md §10`](../ARCHITECTURE.md#10-premium-entitlements).

## Known Issues / Limitations

- Angular damping and air friction tuning in progress (branch `feat/1610-cascade-uc1-angular-damping`)
- Theming pipeline documented in [`docs/CASCADE-THEMING.md`](../CASCADE-THEMING.md)
