# Starswarm

**Category:** Arcade
**Tier:** TBD
**Status:** In Development (early)

## How to Play

Starswarm is an arcade shooter. Details of the core loop, controls, and level structure are still being defined. This document will be updated as the game design solidifies.

What is known:

- The game is rendered via `@shopify/react-native-skia` (canvas-based)
- It is a score-attack game — the goal is to survive as long as possible and score as many points as possible
- No local save state is persisted to AsyncStorage (intentional — the game has no resume state)

## Enemy Tiers

| Tier    | Count / wave          | HP  | Points | Behaviour                                                                                                                                                                              |
| ------- | --------------------- | --- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grunt   | 16–40 (2–5 rows of 8) | 1   | 100    | Single shots, partly aimed; deep dives from wave 1; can ram                                                                                                                            |
| Elite   | 16 (2 rows of 8)      | 2   | 200    | Always-aimed shots; shallow dives early, deep dives + circling once ≤35% Grunts/Elites remain                                                                                          |
| Boss    | 4                     | 4   | 400    | Silent until ≤35% Grunts/Elites remain, then 3–5 shot bursts; dives when ≤3 enemies remain                                                                                             |
| Carrier | 1 (top row, #2484)    | 8   | 1000   | Never dives. **Armored while any Boss lives**: ordinary shots ring off it; piercing shots (lightning, buddy burst) get through. Beam, reinforcements and lone-ship fire land in #2485. |

Diving enemies score 2×. The Carrier and Bosses are excluded from the "non-boss" thresholds that
drive Elite/Boss escalation (`isLeaderTier`). `isCarrierArmored(state)` is the renderer-facing
helper for the armor state; the screen announces `a11y.carrierExposed` when it drops.

## Hazards: Errant Asteroids (#2486)

From wave 2, a rock drifts in from a top corner every 12–20 s of the Playing phase (never during
swoop-in or bonus waves; at most 2 in flight from timed spawns). It is a neutral third party:

- **Both sides can hit it.** Any bullet, from either owner and piercing or not, that reaches a rock is
  spent on it, so a large rock is temporary cover. Large rocks (22 px, 6 HP) split into two small
  ones (12 px, 2 HP); small ones are removed.
- **It hits both sides.** A rock deals 1 damage to any ship it touches, once per ship — including
  ships still swooping in once they are on screen. A small rock shatters on impact; a large one keeps
  going. The Carrier's force field shatters any rock harmlessly (ring plays). On the player it acts
  like a shot: the shield absorbs it, otherwise it costs a life; either way it shatters.
- **Nobody scores.** Breaking a rock and enemies a rock kills award no points and don't advance the
  power-up kill counter (they do count toward wave clear and the Elite/Boss thresholds).
- The smart bomb clears rocks. Rocks in flight carry across a wave boundary like bullets do.
- Dev panel: "Asteroids off" (timed spawns) and "Throw asteroid" (`throwAsteroid()` in the engine).

Enemy dodging and flak are #2487; salvage drops are #2488.

## Scoring (Persistence)

`final_score` = points at game over. Leaderboard tracks top scores.

## Client-Side Engine

- Location: `frontend/src/game/starswarm/` — check this directory for current engine structure
- Rendering: `@shopify/react-native-skia`

## Backend

- No `module.py` — Starswarm has a router-only backend
- Endpoints: `backend/starswarm/router.py`
- No metadata model
- Scoring: score submitted via the router at game over

## Accessibility

Starswarm uses a Skia canvas for all rendering. Accessible text overlays for score and game state are required. See [`docs/ACCESSIBILITY.md §4`](../ACCESSIBILITY.md#4-screen-readers).

## Entitlement

Tier TBD. If premium: requires a valid entitlement JWT; see [`docs/ARCHITECTURE.md §10`](../ARCHITECTURE.md#10-premium-entitlements).

## Known Issues / Limitations

- In early development — game design is not finalized
- No `module.py`; tracked in issue #893 (in-memory leaderboard migration)
