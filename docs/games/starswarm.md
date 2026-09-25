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

## Wave Structure (#2490)

Every wave opens on a swoop-in, a 3-second countdown, then combat; the next wave starts the
instant no enemy is alive — killed or escaped (the "MISSION COMPLETE" banner is cosmetic). Clearing
wave _n_ pays `500 × n × difficultyMultiplier`. A wave ends one of two ways: every ship is shot
down, or the leaders die first and the surviving grunts rout (below) — caught or escaped, they are
gone within a few seconds either way.

**Boss waves** — wave 5, then every 4th (5, 9, 13, …; `isBossWave`) — are the Carrier and its four
Boss escorts and nothing else: a short, hostile stage of its own.

- The Bosses are active from the first tick: the ≤35% threshold is latched at wave start, so they
  burst-fire and dive on the normal dive timer.
- The Carrier's beam interval is ÷1.5 (`BOSS_WAVE_BEAM_SCALE`), first beam included; its armor
  rules are unchanged (kill the escorts, or pierce with lightning / the buddy burst).
- No reinforcements (there are no grunt slots) and no timed asteroid spawns; a rock already in
  flight rides in like any other wave, and the dev-panel throw still works.
- The clear bonus is doubled (`BOSS_WAVE_CLEAR_MULT`): `500 × n × 2 × difficultyMultiplier`.
- The "CARRIER SIGHTED" banner (`phase.bossWave`) shows during the swoop-in, with the
  `starswarm.bosswave` sting and an `a11y.bossWave` announcement.

There is no longer a shooting-gallery bonus wave or a flat perfect bonus; #2490 removed the Free
Fire Zone and everything that hung off it.

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
- **Twin lasers.** #2699: once it's unarmored (its last Boss escort has died — see armor above) it
  fires a pair of aimed shots every 1.1 s (÷ the same cadence factor), whether or not grunts are
  still alive, so the player can't plink an exposed Carrier for free. These do count against
  `bulletCap()`.
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

## Grunt Rout (#2489)

The moment no Elite, Boss or Carrier is left alive in the Playing phase and at least one grunt is,
the wave's grunts break and run: `state.routed` latches for the wave and every surviving grunt in
any phase but swoop-in enters `Fleeing` — a cubic path from where it is to off-screen top on its
nearer side, 1.5–2.1 s long (× 1.4 on Ensign) after a 0–375 ms hesitation. A reinforcement still
swooping in when it happens runs the moment it lands. Fleeing grunts never shoot, dive or ram;
they still roll to dodge rocks and can be struck by them.

- **Caught** on the way out: `TIER_SCORE.Grunt × 2` (the dive multiplier) and `runStats.routCaught`.
- **Escaped** (`pathT ≥ 1`): removed with no score, `runStats.routEscaped`. The wave clears once
  nothing is alive, escapes included.
- The ≤3-survivor straggler rule stands down for a routed set; it still engages when an Elite or
  Boss is among the survivors (the grunts don't rout then).
- Boss waves have no grunts, so nothing routs there. Killing the leaders last farms nothing: the
  Carrier's reinforcement cap bounds how many grunts can exist, and each caught one pays double.
- "ROUT!" banner (`phase.rout`) while any grunt is fleeing, a `starswarm.rout` sting and an
  `a11y.rout` announcement with the count. Dev panel: "Rout off" restores the old mop-up ending.

## Hazards: Errant Asteroids (#2486)

From wave 2, a rock drifts in from a top corner every 12–20 s of the Playing phase (never during
swoop-in or a boss wave; at most 2 in flight from timed spawns). It is a neutral third party:

- **Both sides can hit it.** Any bullet, from either owner and piercing or not, that reaches a rock is
  spent on it, so a large rock is temporary cover. Large rocks (22 px, 6 HP) split into two small
  ones (12 px, 2 HP); small ones are removed.
- **It hits both sides.** A rock deals 1 damage to any ship it touches, once per ship — including
  ships still swooping in once they are on screen. A small rock shatters on impact; a large one keeps
  going. The Carrier's force field shatters any rock harmlessly (ring plays). On the player it acts
  like a shot: the shield absorbs it, otherwise it costs a life; either way it shatters.
- **Nobody scores.** Breaking a rock and enemies a rock kills award no points and don't advance the
  power-up kill counter (they do count toward wave clear and the Elite/Boss thresholds).
- The smart bomb clears rocks. Rocks in flight carry across a wave boundary like bullets do, boss
  waves included (only the timed spawner sits out there, #2490).
- Dev panel: "Asteroids off" (timed spawns) and "Throw asteroid" (`throwAsteroid()` in the engine).
- Drawn as one of 4 Kenney meteor sprites (picked per rock, reused at both `large`/`small` sizes
  since collision uses the radius, not the art), spinning at `spin` rad/ms; falls back to the
  procedural rock outline while sprites load (#2573).

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
flak. They carry across waves and reset on a new game; see _Telemetry_ below for how to read them.

## Telemetry: run stats (#2491)

Two sets of counters live on the engine state, both carried across waves and reset on a new game:

- `tierStats` (per tier, #2487): dodge rolls, dodged, path rolls, struck, flak shots.
- `runStats` (whole run): reinforcements launched, armor deflections (ordinary shots the escorted
  Carrier shrugged off), beam hits on the player (sweeps that cost plating or a life — a
  shield-absorbed sweep is not one), rocks spawned, rocks broken by the player's shots and by
  enemy shots (flak included; a bomb or a hull shatter credits nobody), and fleeing grunts caught
  (shot or bombed) or escaped (#2489).

`dodgeRateByTier(state)` is the pure selector the dev panel and the breadcrumb share: one row per
tier with the base odds, the effective odds at this run's difficulty, and the counts.

**Dev panel** (dev builds only, same `__DEV__` guard as the other toggles): a _Run stats_ section
shows the tier table and the run counters, refreshed 4× a second from a timer — never per frame —
plus _Dodge off_, _Flak off_ and _Kill escorts_ next to _Throw asteroid_. See
[`docs/TESTING.md`](../TESTING.md#star-swarm-tuning-with-the-run-stats-dev-panel-2491) for how to
use it when tuning.

**Sentry.** At game over the screen adds one `starswarm.run_stats` breadcrumb (info level) with
the run counters, the tier table, wave reached, difficulty and score — counts only, nothing that
identifies the player — once per run. `EXPO_PUBLIC_TEST_HOOKS=1` builds also expose
`globalThis.__starswarm_getRunStats()` for an E2E driver.

## Scoring (Persistence)

`final_score` = points at game over. Since #2626 the run's own session row is its leaderboard
entry: game over completes it with `outcome: "completed"` (score-only, no win), `final_score` and a
result of `{outcome, wave_reached, difficulty_tier}`. Each difficulty tier is its own board, and a
player's best run on a tier ranks there under their display name. The result card reads the rank
from `GET /games/{id}/rank` through the shared `sessionBoardAdapter`; it asks for a display name
only when the player has none. The screen sends no `durationMs` (never `0`): the engine keeps no
play clock. The device keeps the best score
(`game/starswarm/bestScore.ts`) for the card's "Best" and "New best".

## Client-Side Engine

- Location: `frontend/src/game/starswarm/` — check this directory for current engine structure
- Rendering: `@shopify/react-native-skia` on native, Canvas 2D on web (`GameCanvas.web.tsx`)

### Native rendering pipeline (epic #2562)

The engine (`engine.ts`) is pure and ticks on the JS thread in the canvas's RAF loop. Every
drawing decision for the native canvas lives in `render/frame.ts`: `buildFrame(state, starfield,
{ loaded, width, height })` returns a flat, back-to-front display list of primitive ops (`fill`,
`rect`, `circle`, `image`, `poly`) — plain data, no Skia objects. Sprite-vs-fallback choices, the
Carrier's armor ring, hit-flash bursts, the beam, harmless-bullet dimming, the invincibility
blink and the #2334 hidden-ship-at-game-over rule are all decided there and unit-tested in
`__tests__/frame.test.ts`. `render/drawFrame.ts` replays the ops and decides nothing (see below).

`render/publish.ts` gates when a frame is published at all (#2563): only when something drawn
changed, so a paused or finished game does not re-render.

Since #2565 the display list is drawn on the UI thread. Each published frame, the RAF loop builds
the list and writes it into one Reanimated shared value; a `useDerivedValue` worklet replays it
with `render/drawFrame.ts` into a Skia `Picture` (`createPicture`), and the canvas renders a single
`<Picture>`. So the pipeline is engine → `buildFrame` (JS thread) → shared value → `drawFrame`
(UI thread) → Picture. `drawFrame` decides nothing and is tested against a recording fake of the
Skia API in `__tests__/drawFrame.test.ts`. A throw inside it is reported to Sentry once
(`starswarm.drawFrame`) and never takes down the UI thread. Sprite images reach the worklet as a
stable set that changes only when an image finishes loading.

Since #2566 the HUD and overlays are the only React state the loop touches, and only on change.
`render/hud.ts` derives a small `HudState` (score, wave, difficulty, guns and hull, lives, the
countdown digit and each banner's visibility, the active power-up) from each published frame and
the loop calls `setHud` only when `sameHud` says a field moved, so steady play with nothing
scored re-renders React zero times. The two cues that do move every frame, the mission-complete
fade and the power-up bar, are shared values (`hudCues`) driving `useAnimatedStyle` on the UI
thread. Gameplay is the Picture; the HUD is on-change React.

The Picture is the only native renderer: phase 5 (#2567) removed the phase-2 declarative path
and its dev switch after the side-by-side device measurement in `PERFORMANCE.md`. The web renderer (unmaintained) still
derives the same rules itself.

The dev panel's _Frame readout_ switch (#2567) shows frame-time average and p95 and the canvas's
React commits per second over the game. See
[`TESTING.md`](../TESTING.md#star-swarm-reading-the-frame-readout-2567) for how to read it and
[`PERFORMANCE.md`](../PERFORMANCE.md#star-swarm-native-renderer-2567) for the measured numbers.

## Backend

- Module: `backend/starswarm/module.py`, registered in `backend/games/registry.py` (#2623)
- Metadata model: `StarSwarmMetadata` in `backend/starswarm/models.py` — `difficulty_tier` only (extra keys forbidden)
- Result model: `StarSwarmResult` — `outcome`, `wave_reached`, `difficulty_tier`, all optional; unknown keys are ignored
- Tiers: `difficulty_tier` must be one of `DIFFICULTY_TIERS` in `backend/starswarm/models.py` — `Ensign`, `LieutenantJG`, `Lieutenant`, `LieutenantCommander`, `Commander`, `Captain`, `RearAdmiral`, `ViceAdmiral`, `Admiral`, `FleetAdmiral`, the client's `DIFFICULTY_TIERS` (`frontend/src/game/starswarm/engine.ts`). Any other value (`captain`, a forged tier) fails creation (422) and completion (400). `tests/test_starswarm_module.py` parses the client list and fails if the two drift, so **a tier added to the app must be added to the backend in the same release**, or its runs dead-letter. A missing or `null` tier is allowed
- Board: `final_score` desc, one board per `difficulty_tier` (`GET /games/leaderboard/starswarm?difficulty_tier=Captain`), no cap. A row with no tier counts as `LieutenantJG`, as on the legacy `POST /starswarm/score`, and a request without `difficulty_tier` is the `LieutenantJG` board; an unknown tier is a 400. `has_winner = False`
- Stats: default pass-through `stats_shape` (`default_stats_shape`)
- Endpoints: `backend/starswarm/router.py` — legacy. `POST /starswarm/score` stays for installed builds; the app no longer calls it (#2626). `GET /starswarm/leaderboard` is read by the Ranks tab until #2634
- Scoring: each run's session row (`useGameSync("starswarm")`) completes with its `final_score` and is the leaderboard entry on its tier's board (#2626); see [Scoring](#scoring-persistence)

## Accessibility

Starswarm uses a Skia canvas for all rendering. Accessible text overlays for score and game state are required. See [`docs/ACCESSIBILITY.md §4`](../ACCESSIBILITY.md#4-screen-readers).

## Entitlement

Tier TBD. If premium: requires a valid entitlement JWT; see [`docs/ARCHITECTURE.md §10`](../ARCHITECTURE.md#10-premium-entitlements).

## Known Issues / Limitations

- In early development — game design is not finalized
