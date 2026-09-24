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

| Tier    | Count / wave          | HP  | Points | Behaviour                                                                                                                                                                                                |
| ------- | --------------------- | --- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grunt   | 16–40 (2–5 rows of 8) | 1   | 100    | Single shots, partly aimed; deep dives from wave 1; can ram                                                                                                                                              |
| Elite   | 16 (2 rows of 8)      | 2   | 200    | Always-aimed shots; shallow dives early, deep dives + circling once ≤35% Grunts/Elites remain                                                                                                            |
| Boss    | 4                     | 4   | 400    | Silent until ≤35% Grunts/Elites remain, then 3–5 shot bursts; dives when ≤3 enemies remain                                                                                                               |
| Carrier | 1 (top row, #2484)    | 8   | 1000   | Never dives. **Armored while any Boss lives**: ordinary shots ring off it; piercing shots (lightning, buddy burst) get through. Sweep beam, reinforcements and lone-ship twin lasers (#2485), see below. |

Diving enemies score 2×. The Carrier and Bosses are excluded from the "non-boss" thresholds that
drive Elite/Boss escalation (`isLeaderTier`). `isCarrierArmored(state)` is the renderer-facing
helper for the armor state; the screen announces `a11y.carrierExposed` when it drops.

## Carrier Actions (#2485)

- **Sweep beam.** Every 7 s (÷ min(1.6, difficulty paramScale)) the Carrier shudders and glows for
  600 ms, then fires a 24 px-wide vertical beam below itself for 1.2 s while the formation sway
  drags it sideways. The beam is not a bullet (no `bulletCap()` slot). In the column it costs a
  life; the shield holds it off; post-hit invincibility covers the rest of the sweep.
  `carrierBeam(state)` gives the renderers position and progress; the screen speaks
  `a11y.carrierBeam` when the telegraph starts.
- **Reinforcements.** Every 8 s while it lives (Playing phase, not on Ensign) it launches 2–4 grunts
  that swoop into empty grunt slots, capped per wave at half the wave's grunt slots
  (`reinforceCap`). They never touch `startingNonBossCount`, so the 35% / ≤3 latches are unaffected
  once crossed. Killing the Carrier early is the wave's objective.
- **Lone-ship lasers.** Once nothing else is alive (in-flight reinforcements count as alive) it fires
  a pair of aimed shots every 1.1 s (÷ the same cadence factor) so the player can't park off to one
  side and plink it. These do count against `bulletCap()`.
- Sounds: `starswarm.beamcharge`, `starswarm.beamfire`, `starswarm.reinforce` (reused files, #2492).

## In-Run Ship Upgrades (#2488)

Two ladders that live and die with the run. Nothing persists between runs and nothing is sold, so
the leaderboard stays fair.

| Ladder | Levels                                                            | Source                                                                              | Lost on                            |
| ------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------- |
| Guns   | L1 single → L2 twin (±7 px) → L3 twin + spread pair (±0.14 px/ms) | **Salvage crate**: 40% chance from any large asteroid that breaks, whoever broke it | one level per life lost (floor L1) |
| Hull   | 0 → 1 → 2 plating                                                 | **Hull plating**: always dropped when the Carrier dies                              | one level per hit absorbed         |

- Hit order is **shield → hull → life**. Plating absorbs a shot, a rock, the beam or a ram (the
  rammer still dies), flashes a ring on the ship and grants 600 ms of grace. Lightning still
  multiplies fire rate on top of the gun level (its piercing shots at every level).
- `MAX_PLAYER_BULLETS` is 40 (was 20): L3 fires four bullets a volley.
- Collecting salvage at L3 or plating at 2 does nothing (and awards no points).
- HUD shows `GUNS L{n} · HULL ◆◆`; the screen speaks `a11y.gunsUp/gunsDown/hullUp/hullHit`.
- Dev panel: "salvage" and "hull" buttons under Power-ups (`applyPowerUp`).
- Sounds `starswarm.salvage`, `starswarm.hullup`, `starswarm.hullhit` reuse existing files (#2492).

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
- The smart bomb clears rocks. Rocks in flight carry across a wave boundary like bullets do, except
  into a bonus wave: those start rock-free (a rock there would absorb shots and kill targets the
  player can't then hit, putting the PERFECT bonus out of reach).
- Dev panel: "Asteroids off" (timed spawns) and "Throw asteroid" (`throwAsteroid()` in the engine).

Salvage drops are #2488.

### Enemy AI: asteroid response (#2487)

When a rock will cross a ship's hitbox within the next 700 ms (sampled at +200/+400/+700 ms
against where the ship will be — on its path if it is swooping, diving or returning), the ship
rolls **once per rock** to dodge. Success chance is `base × difficulty paramScale`, capped at 97%:

| Tier    | Dodge base | Flak base | Dodge action                                         |
| ------- | ---------- | --------- | ---------------------------------------------------- |
| Grunt   | 25%        | 30%       | formation: 22 px sidestep (600 ms); on a path: nudge |
| Elite   | 55%        | 70%       | same                                                 |
| Boss    | 80%        | 90%       | same                                                 |
| Carrier | never      | 100%      | rocks shatter on its force field                     |

A path nudge splits the curve at the ship's current progress and shifts the _remaining_ segment's
control points 40 px away from the rock, restarting it from the ship's position with the time it
had left — the ship doesn't jump, and it still arrives where it was going. Ships still off-screen (`pathT < 0`)
are not threatened; circling ships never dodge. A failed roll takes no action, so the collision
follows naturally and reads as a botched dodge.

**Flak.** A ship holding formation fires one aimed shot at a rock approaching within 120 px
(probability `flak base × min(1.3, paramScale)`, 900 ms cooldown per ship). Flak is an enemy
bullet marked `flak`: it is drawn amber, sits outside `bulletCap()`, is spent on the rock like any
shot, and can still hit the player if it misses. The dev "Enemy missiles off" toggle silences it.

**Counters.** `state.tierStats` records per tier: rolls, dodged, pathRolls, pathDodged, struck and
flak. They carry across waves and reset on a new game; the dev panel view is #2491.

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
