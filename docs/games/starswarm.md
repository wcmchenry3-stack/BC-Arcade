# Starswarm

**Category:** Arcade
**Tier:** TBD
**Status:** In Development (early)

## Overview and Core Loop

Star Swarm is a score-attack arcade shooter. The player moves horizontally near the bottom of the
screen while the ship auto-fires upward. Survive successive enemy waves, destroy higher-value
targets, collect temporary power-ups and run-long ship upgrades, and push the score as high as
possible before all lives are lost.

A fresh run starts with **3 lives**, **Guns L1**, **Hull 0**, score 0 at wave 1, and the selected
Starfleet difficulty tier.

The ship is clamped to the playable horizontal bounds. Firing is continuous while gameplay input is
active.

> **#2776 refinement boundary.** This document describes current `dev`. #2776 will tighten
> pre-wave invulnerability/firing, wave-clear extraction and cleanup, Carrier beam
> lifecycle/cadence, Carrier late-stage aggression/dives, the right-edge drag regression, and
> (upgrade-pickup communication landed in #2847). Those sections should be updated with #2776; the rest of the game
> specification is not blocked on that work.

## Controls

- Drag horizontally to move the player ship. Each new touch anchors on the ship's current position (including during the pre-wave countdown, when the engine is frozen), and reversing at either edge moves the ship immediately.
- The ship auto-fires; there is no ammunition economy.
- Pause suspends and saves the run for resume.
- New Game starts a clean run and abandons the old server session if one is open.
- Development-only tuning controls are test aids, not player rules.

Shared input/accessibility conventions: [GAMEPLAY_STANDARDS.md](../GAMEPLAY_STANDARDS.md).

## Difficulty Tiers

| Tier | Score multiplier | AI parameter scale |
| --- | ---: | ---: |
| Ensign | 1× | 0.70 |
| Lieutenant J.G. | 1.5× | 1.00 |
| Lieutenant | 2× | 1.15 |
| Lieutenant Commander | 2.5× | 1.30 |
| Commander | 3× | 1.50 |
| Captain | 4× | 1.70 |
| Rear Admiral | 5× | 1.90 |
| Vice Admiral | 6× | 2.15 |
| Admiral | 8× | 2.50 |
| Fleet Admiral | 10× | 3.00 |

The score multiplier applies to enemy kills, rout catches and wave-clear bonuses. The AI parameter
scale drives dive cadence/floor, bullet density, aimed-shot pressure, formation aggression and
several Carrier/asteroid-AI cadences or probabilities.

Ensign is additionally gentler: normal ≤3-survivor straggler aggression is disabled and the
Carrier does not launch reinforcements.

Each tier has its own public leaderboard partition.

## Ordinary Wave Progression

Outside boss waves, every wave contains:

- 1 Carrier;
- 4 Boss escorts;
- 16 Elites (two rows of eight);
- 2–5 Grunt rows of eight.

| Ordinary wave formula | Grunt rows | Grunts | Total enemies |
| --- | ---: | ---: | ---: |
| 1–2 | 2 | 16 | 37 |
| 3–4 | 3 | 24 | 45 |
| 5–6 | 4 | 32 | 53 |
| 7+ | 5 | 40 | 61 |

Boss waves replace the ordinary formation, so wave 5, 9, 13, … do not use those ordinary totals.

Progression rules include:

- max simultaneous divers: 1 on waves 1–2, 2 on 3–4, 3 on 5–6, then 4;
- dive interval shortens by wave with a difficulty-scaled floor;
- enemy bullet cap starts at 3 on wave 1, adds 1 every two waves, scales with difficulty, and caps
  at 24;
- Grunt aimed-shot chance starts at 10% on wave 1 and rises 5 percentage points per wave, with a
  difficulty-scaled cap;
- once ≤35% of the starting non-leader population remains, Elite/Boss escalation latches on;
- once ≤3 total enemies remain, normal straggler aggression activates except on Ensign/routed-grunt
  endings.

## Lives, Damage, and Bonus Lives

The player starts with **3 lives** and can hold at most **5**.

Normal hit precedence is **shield → hull plating → life**. Losing a life also drops Guns by one
level, to a floor of L1.

A bonus life is earned every:

`30,000 × difficulty score multiplier` points.

Awards repeat at each threshold multiple subject to the 5-life cap. A bonus-life award also grants
800 ms of slow motion at 35% game speed and at least 600 ms of invincibility. A threshold crossed
on the same tick as a lethal hit can rescue the player from Game Over.

## Temporary Power-Ups

Ordinary power-ups are separate from the Guns/Hull upgrade ladders.

A normal drop triggers after:

`min(12 + floor((wave - 1) × 1.5), 20) ± 2 kills`

The jitter is re-sampled after each drop. At most one ordinary power-up pickup is on-screen at a
time; salvage/hull upgrade pickups do not consume that slot.

| Lives | Shield | Smart Bomb | Lightning | Buddy |
| --- | ---: | ---: | ---: | ---: |
| 0–1 | 33% | 33% | 17% | 17% |
| 2+ | 25% | 25% | 25% | 25% |

- **Lightning:** 5 seconds; faster fire, 4-damage piercing shots, can penetrate Carrier armor.
- **Shield:** 5 seconds; absorbs incoming damage while active.
- **Smart Bomb:** instant; clears enemy bullets/asteroids, deals 1 damage to every alive enemy,
  respects Carrier armor, and awards normal base-score credit for kills (no dive multiplier).
- **Buddy:** launches a companion ship that fires one 5–7-shot piercing spread burst toward the
  enemy cluster; its shots share the player-bullet cap.

Collecting Lightning or Shield replaces the currently active duration power-up.

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

## Wave Structure

Every wave begins with the enemy formation swooping into place. The UI presents a 3-second combat
countdown before active play.

**Current implementation caveat:** the engine moves from `SwoopIn` to `Playing` as soon as all
enemies arrive, while the visible countdown is owned by the screen. Player fire is not centrally
phase-gated today. #2776 will make swoop-in/countdown true invulnerable setup time.

### Current wave clear

When no enemy remains alive, current `dev`:

1. awards the wave-clear bonus;
2. immediately constructs the next wave;
3. shows a non-blocking MISSION COMPLETE banner;
4. carries player bullets into the new wave;
5. carries enemy bullets but marks them harmless;
6. carries active asteroids.

There is no blocking WinTransition/autopilot today. #2776 will replace this with a short AI
extraction/natural-hazard-resolution sequence followed by a hard transient reset before the next
formation enters.

### Boss waves

Boss waves are **5, 9, 13, …** and contain only 1 Carrier + 4 Boss escorts.

- Boss escalation is active from the first tick.
- Carrier beam cadence is 1.5× faster.
- No Carrier reinforcements.
- No timed asteroid spawns (although a carried asteroid can currently enter).
- Wave-clear bonus is doubled.
- CARRIER SIGHTED banner/sound/accessibility announcement play during entry.

The old Free Fire Zone / shooting-gallery bonus wave no longer exists.

## Carrier Actions

- **Sweep beam (current).** Fixed 7-second base interval, divided by
  `min(1.6, difficulty paramScale)` and another 1.5 on boss waves. The Carrier telegraphs for
  600 ms, then exposes a 24 px-wide vertical beam for 1.2 seconds. Today it is derived from the
  live Carrier's beam state rather than an independent projectile. Shield/hull/life precedence
  applies.
- **Reinforcements.** Every 8 s while it lives (Playing phase, not on Ensign) it launches 2–4 grunts
  that swoop into empty grunt slots, capped per wave at half the wave's grunt slots
  (`reinforceCap`). They never touch `startingNonBossCount`, so the 35% / ≤3 latches are unaffected
  once crossed. Killing the Carrier early is the wave's objective.
- **Twin lasers.** #2699: once it's unarmored (its last Boss escort has died — see armor above) it
  fires a pair of aimed shots every 1.1 s (÷ the same cadence factor), whether or not grunts are
  still alive, so the player can't plink an exposed Carrier for free. These do count against
  `bulletCap()`.

### #2776 Carrier refinements

#2776 will replace the fixed/metronomic beam reset with bounded randomness, make a released beam an
independent traveling hazard, add protected → exposed → final-stand aggression, allow
Carrier-specific attack runs/dives after armor loss, increase final-stand behavioral pressure, and
(pickup communication: see #2847 under In-Run Ship Upgrades). Until then, the current rules above describe
`dev`.
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
- Collecting salvage at L3 or plating at 2 does nothing (and awards no points) — but still shows
  the `GUNS MAX` / `HULL MAX` cue, so the player knows the pickup registered.
- HUD shows `GUNS L{n} · HULL ◆◆`; the screen speaks `a11y.gunsUp/gunsDown/hullUp/hullHit`.
- **Pickup look (#2847).** Both pickups share `render/pickups.ts` (`upgradePickupOps`), replayed by
  the native Picture and the web canvas alike. Timed power-ups are round sprites; upgrade pickups
  are angular, pulse a halo ring (phase from `despawnTimer`, so no clock) and carry a white glyph:
  amber crate with an up-chevron (guns), cyan hex plate with a plus (hull). The halo and glyph mark
  them as rewards, never rocks (grey-brown, spinning); the shape and halo keep them apart from
  timed power-ups.
- **Pickup cue (#2847).** `render/pickupCue.ts` (`pickupCues(prev, next)`) fires `GUNS +1` /
  `HULL +1` on a ladder rise, or `GUNS MAX` / `HULL MAX` when a pickup is collected at the top of
  its ladder (spotted as a pickup that vanished onto the ship). The toast is drawn under the HUD
  ladder line in the pickup's accent colour, pops in, drifts up and fades over `PICKUP_CUE_MS`
  (1.3 s), and is non-modal. Native animates it on the UI thread; it is hidden from screen readers
  because `a11y.gunsUp/hullUp` already speak the change. Strings: `hud.cueGuns`, `hud.cueGunsMax`,
  `hud.cueHull`, `hud.cueHullMax`. Mechanics are untouched — the cue only reads two states.
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

## Scoring

All positive score awards are multiplied by the selected difficulty multiplier.

| Event | Base score |
| --- | ---: |
| Grunt kill | 100 |
| Elite kill | 200 |
| Boss kill | 400 |
| Carrier kill | 1000 |
| Enemy killed while Diving/Circling | 2× base |
| Fleeing Grunt caught by player fire | 200 |
| Fleeing Grunt killed by Smart Bomb | 100 |
| Ordinary wave clear | 500 × wave |
| Boss-wave clear | 500 × wave × 2 |

### Zero-score events

No direct points are awarded for:

- destroying an asteroid with player fire;
- destroying an asteroid with enemy fire/flak;
- an asteroid killing an enemy;
- a routed Grunt escaping;
- collecting a power-up;
- collecting salvage at Guns L3;
- collecting hull plating at Hull 2.

Asteroid-caused enemy deaths still count toward wave clear/escalation but do not advance the normal
player-kill power-up counter. Smart Bomb kills do award normal enemy base score because the bomb is
a player power-up.

### Per-wave score breakdown (#2837)

Every award goes through `frontend/src/game/starswarm/scoreLedger.ts`, which credits it to the
current wave on `state.scoreLedger` (saved and restored with a paused run, so a resumed run never
counts a point twice). Sources are keyed by the engine's tier id, so a renamed tier needs no change:
`<tier>` (shot kill in formation), `<tier>:dive` (shot kill while Diving/Circling), `<tier>:rout`
(fleeing Grunt caught), `<tier>:bomb` (Smart Bomb, pickup or dev panel), `<tier>:ram` (a diver that
rammed the ship), and `clear` (wave-clear bonus, credited to the wave it cleared). Readers must
treat the source set as open.

Game over sends it as the result's `score_breakdown`:
`{v: 1, earlier?: {first, last, total, pts}, waves: [{wave, start, end, total, pts}], unattributed?}`.
The run starts at 0 and waves that scored nothing are absent; `earlier.total` + every
`waves[].total` + `unattributed` (present only when non-zero) equals `final_score`. A wave's
`start`/`end` are the ledger's running total and exclude `unattributed` points; the backend
reports a kept breakdown with non-zero `unattributed` to Sentry as a sign that a scoring path
bypasses the ledger. It is bounded:
the ledger keeps the last 20 scoring waves in detail and folds older ones into `earlier`, and the
summary folds further until its compact JSON is ≤ 4 KiB (`BREAKDOWN_MAX_BYTES`), so the whole result
stays well under the backend's 8 KiB limit (worst case measured ≈ 4.3 KB as the server counts it).
The breakdown is in the result only, not the `game_ended` event. Display is #2840.

`StarSwarmResult` checks the block adds up (per wave `end - start == total == sum(pts)`, each
wave starting at the previous `end` or at `earlier.total`, waves strictly ascending, strict
non-negative integers) and, when the completion's `final_score` is in the validation context,
that it reconciles to it. A block that fails is dropped to `null` and reported to Sentry
(`starswarm-result-breakdown-dropped`, field paths and error types only); the run still completes
and ranks.

Adding `scoreLedger` to the saved state changed `SAVE_FINGERPRINT`, so a run paused on a build
before #2837 is discarded once, not restored, after the update (Star Swarm is hidden in store
builds, so this is accepted).

## Leaderboard and Run Reporting

- **Metric and direction:** `final_score`, higher is better, labelled `score` (`board` in `backend/starswarm/module.py`; `BOARDS.starswarm` in `frontend/src/api/vocab.ts`). It is the points at game over.
- **Tie-break:** none declared. Equal scores go to the earlier `completed_at`, the last tie-break on every board.
- **Partitions:** `difficulty_tier`: each of the ten tiers in `DIFFICULTY_TIERS` (`backend/starswarm/models.py`) is its own board, and only those tiers have one (`partition_values`). A row with no tier counts as `LieutenantJG` (`partition_defaults`). A row with any other tier is stored but never ranks.
- **Recorded, not partitioned:** result (`StarSwarmResult`): `outcome`, `wave_reached` and `score_breakdown` (#2837, [above](#per-wave-score-breakdown-2837)) (`difficulty_tier` is repeated there too). The owner reads them back in `metadata` from `GET /games/{id}`.
- **Max value:** none (#2519 decision 14).
- **Outcomes:** `has_winner = False`: a run ends when the ship is lost. Game over records `completed` (score-only, no win) with `final_score` and the result `{outcome, wave_reached, difficulty_tier, score_breakdown}` (#2626, #2837). Starting another run while one is open, or leaving the screen, records `abandoned` with no result and no score.
- **Duration:** `useGameSync`'s active-play window. The screen sends no `durationMs` of its own (never `0`): the engine keeps no play clock. The window restarts when a run begins (`beginRun`), so time on the difficulty picker is not counted.
- **How it reaches the server:** since #2626 the run's own `useGameSync("starswarm")` session row is its leaderboard entry. The row opens when the run begins, with `difficulty_tier` as creation metadata. `SyncWorker` sends `POST /games` and `PATCH /games/{id}/complete`. If the player has a display name (`PUT /players/me`), the row ranks with no further step. Each tier's board shows each named player's best run on that tier once. The legacy `POST /starswarm/score` was removed in #2644. Shared rules: [Leaderboard routes](../GAME-CONTRACT.md#leaderboard-routes-2618).
- **Where the player sees it:** the result card reads the run's rank on its tier's board through `sessionBoardAdapter` (`GET /games/{id}/rank`). It asks for a display name only when the player has none. The card's "View leaderboard" link and the ⋯ menu open the Leaderboard screen (#2633) on the finished run's tier, else the current tier. Stats (#2635) are in the ⋯ menu. The device keeps the best score (`game/starswarm/bestScore.ts`) for the card's "Best" and "New best". Store builds hide Star Swarm (`HIDDEN_GAMES`, `frontend/src/entitlements/gameVisibility.ts`), so there it has no leaderboard or stats entry point.

## Pause, Backgrounding, and Resume

Star Swarm **does persist paused runs**.

`frontend/src/game/starswarm/pauseStore.ts` stores the paused run in AsyncStorage under
`starswarm.pausedRun`. It saves the complete engine state, difficulty, and engine id/RNG counters
needed to resume safely after a cold process restart.

- Manual pause saves the run.
- Background/inactive transitions save it so the OS can kill the process safely.
- The next process hydrates the save before the screen mounts, with a bounded timeout.
- Corrupt/incompatible saves are dropped rather than restored.
- The screen resumes the shared server session where possible.
- New Game / finish / abandon clears the saved run as appropriate.

This replaces the old, incorrect statement that Star Swarm had no local resume state.

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
- Result model: `StarSwarmResult` — `outcome`, `wave_reached`, `difficulty_tier`, `score_breakdown` (`StarSwarmScoreBreakdown`, #2837), all optional; unknown keys are ignored. A `score_breakdown` that doesn't validate (over 64 waves or 48 sources a wave, a source over 32 characters, a non-integer) is dropped to `null` and the run still completes and ranks
- Tiers: only a `difficulty_tier` in `DIFFICULTY_TIERS` (`backend/starswarm/models.py`) has a board — `Ensign`, `LieutenantJG`, `Lieutenant`, `LieutenantCommander`, `Commander`, `Captain`, `RearAdmiral`, `ViceAdmiral`, `Admiral`, `FleetAdmiral`, the client's `DIFFICULTY_TIERS` (`frontend/src/game/starswarm/engine.ts`). Creation and completion accept any other string up to 32 characters (`captain`, a forged tier) and store it, so the run is never dead-lettered; that row never ranks, and naming it or requesting its board is a 400. `tests/test_starswarm_module.py` parses the client list and fails if the two drift, so **a tier added to the app must be added to the backend in the same release**, or its runs stay off the leaderboard. A missing or `null` tier is allowed
- Board: `final_score` desc, one board per `difficulty_tier` (`GET /games/leaderboard/starswarm?difficulty_tier=Captain`), no cap. A row with no tier counts as `LieutenantJG` (`DEFAULT_DIFFICULTY_TIER`), and a request without `difficulty_tier` is the `LieutenantJG` board; an unknown tier is a 400. `has_winner = False`
- Stats: default pass-through `stats_shape` (`default_stats_shape`)
- Endpoints: none of its own — the generic `/games` routes. The legacy `POST /starswarm/score` (unused since #2626) and `GET /starswarm/leaderboard` (unused since #2633, when the Ranks tab moved to the shared `LeaderboardScreen`; the tab itself was retired in #2634) were removed in #2644
- Scoring: each run's session row (`useGameSync("starswarm")`) completes with its `final_score` and is the leaderboard entry on its tier's board (#2626); see [Scoring](#scoring-persistence)

## Accessibility

Starswarm uses a Skia canvas for all rendering. Accessible text overlays for score and game state are required. See [`docs/ACCESSIBILITY.md §4`](../ACCESSIBILITY.md#4-screen-readers).

## Entitlement

Star Swarm is a **premium/hidden** game in the v1.0 store build. Development/internal/pre-launch
builds can expose it under shared visibility/entitlement rules.

Server premium authorization is based on the current session's entitlement database state; the
cached JWT is the client's navigation/offline cache. See
[ARCHITECTURE.md §10](../ARCHITECTURE.md#10-premium-entitlements) and
[SECURITY.md](../../SECURITY.md).

## Current Refinement Work

The broad game contract is documented above. #2776 is a focused polish/transition story.

After #2776 lands, update the affected sections for:

- pre-wave firing/invulnerability/countdown;
- wave-clear AI extraction and hard transient reset;
- Carrier beam lifecycle/randomized cadence;
- Carrier exposed/final-stage aggression and attack runs;
- right-edge drag regression behavior/testing.

Other active bugs/tuning work belongs in GitHub rather than a duplicated Known Issues list.
