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
active during combat (never during swoop-in or the wave-clear extraction — see
[Wave Structure](#wave-structure)).

> **#2776 refinement boundary.** This document describes current `dev`. Every #2776 child story
> has landed: the wave lifecycle (#2842), the staged Carrier encounter (#2843), the asteroid
> battlefield rules (#2844), Buddy as an allied ship (#2845), the edge-drag regression (#2846) and
> upgrade-pickup communication (#2847).

## Controls

- Drag horizontally to move the player ship. Each new touch anchors on the ship's current position (including during the pre-wave countdown, when the engine is frozen), and reversing at either edge moves the ship immediately. While the wave-clear autopilot flies the ship (#2842) the drag is ignored; a drag held through it picks up from the ship's new position rather than snapping back under the finger.
- The ship auto-fires; there is no ammunition economy.
- Pause suspends and saves the run for resume.
- New Game starts a clean run and abandons the old server session if one is open.
- Development-only tuning controls are test aids, not player rules.

Shared input/accessibility conventions: [GAMEPLAY_STANDARDS.md](../GAMEPLAY_STANDARDS.md).

## Difficulty Tiers

| Tier                 | Score multiplier | AI parameter scale |
| -------------------- | ---------------: | -----------------: |
| Ensign               |               1× |               0.70 |
| Lieutenant J.G.      |             1.5× |               1.00 |
| Lieutenant           |               2× |               1.15 |
| Lieutenant Commander |             2.5× |               1.30 |
| Commander            |               3× |               1.50 |
| Captain              |               4× |               1.70 |
| Rear Admiral         |               5× |               1.90 |
| Vice Admiral         |               6× |               2.15 |
| Admiral              |               8× |               2.50 |
| Fleet Admiral        |              10× |               3.00 |

The score multiplier applies to enemy kills, rout catches and wave-clear bonuses. The AI parameter
scale drives dive cadence/floor, bullet density, aimed-shot pressure, formation aggression and
several Carrier/asteroid-AI cadences or probabilities.

Ensign is additionally gentler: normal ≤3-survivor straggler aggression is disabled and the
Carrier does not launch reinforcements. Every Carrier cadence divides by `min(1.6, paramScale)`,
so Ensign's are the slowest (see [Carrier encounter](#carrier-encounter-2843)).

Each tier has its own public leaderboard partition.

## Ordinary Wave Progression

Outside boss waves, every wave contains:

- 1 Carrier;
- 4 Guardian escorts;
- 16 Elites (two rows of eight);
- 2–5 Grunt rows of eight.

| Ordinary wave formula | Grunt rows | Grunts | Total enemies |
| --------------------- | ---------: | -----: | ------------: |
| 1–2                   |          2 |     16 |            37 |
| 3–4                   |          3 |     24 |            45 |
| 5–6                   |          4 |     32 |            53 |
| 7+                    |          5 |     40 |            61 |

Boss waves replace the ordinary formation, so wave 5, 9, 13, … do not use those ordinary totals.

Progression rules include:

- max simultaneous divers: 1 on waves 1–2, 2 on 3–4, 3 on 5–6, then 4;
- dive interval shortens by wave with a difficulty-scaled floor;
- enemy bullet cap starts at 3 on wave 1, adds 1 every two waves, scales with difficulty, and caps
  at 24;
- Grunt aimed-shot chance starts at 10% on wave 1 and rises 5 percentage points per wave, with a
  difficulty-scaled cap;
- once ≤35% of the starting non-leader population remains, Elite/Guardian escalation latches on;
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
| ----- | -----: | ---------: | --------: | ----: |
| 0–1   |    33% |        33% |       17% |   17% |
| 2+    |    25% |        25% |       25% |   25% |

- **Lightning:** 5 seconds; faster fire, 4-damage piercing shots that are also **armor-piercing**
  (`armorPiercing`): the one explicit exception that gets through the escorted Carrier's field.
- **Shield:** 5 seconds; absorbs incoming damage while active (the player's only, never Buddy's).
- **Smart Bomb:** instant; clears enemy bullets/asteroids, deals 1 damage to every alive enemy,
  respects Carrier armor, and awards normal base-score credit for kills (no dive multiplier).
- **Buddy:** launches an allied ship with its own HP that flies three attack runs, each a 3–4-shot
  spread burst whose shots stop after two hits, draws enemy fire and can be shot down. See [Buddy](#buddy-2845). Its
  shots share the player-bullet cap.

Collecting Lightning or Shield replaces the currently active duration power-up.

## Enemy Tiers

The hierarchy is **Grunt → Elite → Guardian → Carrier**. #2843 renamed the escort tier from
"Boss" to **Guardian** everywhere: the engine's tier id (`"Guardian"`), player-facing text and
accessibility strings, docs, tests and telemetry. Boss _waves_ keep their name (`isBossWave`,
`phase.bossWave`, `a11y.bossWave`). The sprite file is still `enemy-boss.webp` (its asset
credits refer to it); the code knows it as `enemyGuardian`.

| Tier     | Count / wave          | HP  | Points | Behaviour                                                                                                                                                                                                                                                                                                         |
| -------- | --------------------- | --- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grunt    | 16–40 (2–5 rows of 8) | 1   | 100    | Single shots, partly aimed; deep dives from wave 1; can ram                                                                                                                                                                                                                                                       |
| Elite    | 16 (2 rows of 8)      | 2   | 200    | Always-aimed shots; shallow dives early, deep dives + circling once ≤35% Grunts/Elites remain                                                                                                                                                                                                                     |
| Guardian | 4                     | 4   | 400    | Silent until ≤35% Grunts/Elites remain, then 3–5 shot bursts; dives when ≤3 enemies remain                                                                                                                                                                                                                        |
| Carrier  | 1 (top row, #2484)    | 8   | 1000   | Never joins the formation's dives. **Armored while any Guardian lives**: every shot that is not armor-piercing is spent on its field, Buddy's piercing burst included; only Lightning gets through. Staged boss encounter: traveling beam, twin lasers, reinforcements and its own attack run (#2843), see below. |

Diving enemies score 2×. The Carrier and Guardians are excluded from the "non-leader" thresholds
that drive Elite/Guardian escalation (`isLeaderTier`; state `startingNonLeaderCount`,
`guardianThresholdCrossed`, `guardianDeepThresholdCrossed`). `isCarrierArmored(state)` is the renderer-facing
helper for the armor state; the screen announces `a11y.carrierExposed` when it drops.

## Wave Structure

Each wave runs through one lifecycle (#2842), with the engine phase in brackets:

```
countdown (screen, engine frozen) → swoop-in [SwoopIn] → combat [Playing]
  → last kill → extraction [Extraction] → hard reset → next wave's countdown
```

### Wave entry: countdown and swoop-in

A new wave opens behind the screen's 3-second countdown (`WAVE_COUNTDOWN_MS`). The engine does not
tick during it, so nothing can happen then. The formation then swoops into place (`SwoopIn`). That is
safe setup time, gated centrally in the engine:

- **No new fire, from anyone.** `weaponsFree(state)` is true only in `Playing`. It gates player
  fire, enemy shots (a ship that reaches its slot early holds its fire), flak, Buddy bursts, timed
  asteroid spawns and dev-panel throws. Everything the Carrier does (beam, twin lasers,
  reinforcements, attack runs) only runs in `Playing`.
- **Everyone is invulnerable.** `hazardsLive(state)` is false in `SwoopIn`, so `tick()` skips
  collision resolution entirely. No shot, rock, beam or ram damages the player or any enemy, and
  no incoming enemy can be pre-damaged.

Combat begins on the tick the last ship reaches formation, which is after the countdown has
finished. A resumed save skips the countdown and resumes in whatever phase it was saved in.

### Wave clear: live extraction

When the last enemy dies (shot, rammed, rock-struck, or a routed grunt escaping), the engine
enters `Extraction` (`waveJustCleared(prev, next)` marks the tick). It:

1. awards the wave-clear bonus (once) and raises the non-blocking MISSION COMPLETE banner;
2. stops manual fire (`weaponsFree` is false) and hands the ship to an AI autopilot
   (`isAutopilot`). Input is ignored, and the screen keeps its commanded X on the ship;
3. keeps everything already in flight **live and harmful**: player shots, enemy shots (including
   ones whose ship is dead) and asteroids keep moving and resolving. A hit still goes shield →
   hull → life, and can end the run. Nothing is frozen and nothing is spawned.

The autopilot (`tickExtractionPilot`, deterministic) scores candidate lanes against every
`liveHazards(state)` entry over a 700 ms lookahead and steers for the safest one at
`PILOT_SPEED`. It holds the lane for at least `EXTRACTION_HOLD_MIN_MS` (500 ms) while hazards
resolve. Once nothing can still reach it, or at `EXTRACTION_HOLD_MAX_MS` (2.5 s) regardless, it
accelerates off the top of the screen, still dodging. When the ship is off-screen, or at
`EXTRACTION_MAX_MS` (6 s) whatever happens, the hard reset runs.

### Hard boundary reset

`clearTransientCombat(state)` is the single, explicit wave-boundary cleanup. It runs just before
`buildWaveState` builds wave N+1, and it clears:

- all player shots (Buddy's shots are player-owned, so included);
- all enemy shots (aimed, burst, twin-laser, flak, and #2845's shots at Buddy) and every released
  Carrier beam (#2843);
- all asteroids;
- every Buddy ship, with its HP, remaining bursts and steering state (#2845), and any beam charge
  or attack-run brace still on a Carrier.

Nothing from wave N can interact with wave N+1. The new wave also re-centres the ship on its lane
and drops falling pickups and any active Lightning/Shield, as before.

**Projectile persistence.** Apart from this boundary, a projectile leaves play only by hitting
something, despawning off-screen, or a Smart Bomb. The death of the ship that fired it never
removes it: Buddy's shots fly on after Buddy dies, and a Carrier shot at Buddy still lands after
the Carrier dies. **Plug-in point:** any new transient combat entity must be cleared in
`clearTransientCombat` and, if hostile, listed in `liveHazards` so the autopilot dodges it. #2843's
released Carrier beam is both: `liveHazards` covers its length with a chain of overlapping circles.
Buddy and its shots are allied, so they are cleared but never listed; enemy shots aimed at Buddy
are enemy shots and are listed like any other.

### Boss waves

Boss waves are **5, 9, 13, …** and contain only 1 Carrier + 4 Guardian escorts.

- Guardian escalation is active from the first tick.
- Carrier beam cadence is 1.5× faster in every stage (still never below its floor).
- No Carrier reinforcements: the wave has no original Grunts to refill.
- When the last Guardian dies, the lone Carrier goes straight from protected to **final stand**
  (the most aggressive stage), so the lone-Carrier climax stays active: fast twin fire, beams and
  attack runs until it dies. That tick is announced once, as the armor drop.
- No timed asteroid spawns, and nothing carries in from the previous wave (#2842 hard reset).
- Wave-clear bonus is doubled.
- CARRIER SIGHTED banner/sound/accessibility announcement play during entry.

The old Free Fire Zone / shooting-gallery bonus wave no longer exists.

## Carrier Encounter (#2843)

The Carrier is a staged boss encounter. Its code lives in `tickCarrier` (engine.ts); the stage is
derived from the live roster.

### Stages

`carrierStage(state)` returns `protected`, `exposed`, `finalStand`, or null when no Carrier is
alive. Each stage is more aggressive than the last, and the stage only escalates within a wave.

| Stage           | When                                                                       | Armor | Beam      | Twin lasers     | Attack run                        | Reinforcements             |
| --------------- | -------------------------------------------------------------------------- | ----- | --------- | --------------- | --------------------------------- | -------------------------- |
| **Protected**   | any Guardian alive                                                         | on    | 6–9 s     | none            | none                              | every 6.5–10 s, 2–3 grunts |
| **Exposed**     | the moment the last Guardian dies                                          | off   | 4–6.5 s   | every 0.9–1.5 s | every 7–11 s                      | every 5–8 s, 2–4 grunts    |
| **Final stand** | the Carrier is the only meaningful enemy left (fleeing grunts don't count) | off   | 2.6–4.2 s | every 0.6–1.0 s | every 4.2–7 s, deeper and quicker | none                       |

- Ranges are base values (`CARRIER_CADENCE`), divided by `min(1.6, paramScale)` (difficulty) and,
  for the beam only, by 1.5 on a boss wave. No scaling goes below the fair minimum spacing
  (`CARRIER_CADENCE_FLOOR`): beam 1.5 s of idle between one release and the next charge, twin 0.4 s,
  reinforcement 4 s, attack run 3 s. `carrierCadenceBounds(kind, stage, difficulty, bossWave)` is
  the source of truth; tests hold that each later stage has a shorter average and never a longer
  maximum.
- **Solo Carrier (final stand only).** The beam is aimed: the Carrier slides toward the player's
  column during the 600 ms charge, following the player for the first `BEAM_AIM_LOCK_FRAC` (60%) and
  then holding the column for the last stretch, and releases straight down from there. The slide is
  capped at `BEAM_AIM_MAX_SLIDE` (140 px) and kept 24 px off the screen edges, and it only happens
  on station (a beam charged mid attack run still drops straight down). The twin volley gains a
  third, centre gun. Protected and exposed Carriers fire straight down their own column with two
  guns. The aim reuses `diveTargetX`, which is free during a charge.
- Every interval is a seeded roll (`rollCarrierCadence`, the engine's `rng()`), uniform within its
  bounds. None is a fixed metronomic reset, and a seeded run replays exactly.
- **Escalation.** On the first tick after a stage change, timers pull in. An action that just came
  online (twin fire, attack runs on exposure) rolls fresh. One already running keeps the sooner of
  its timer and a new roll from the new stage. The engine records the stage it last acted on in
  `state.carrierStage`.
- Screen events (`CarrierEvent`, raised by both canvases): the armor drop (`a11y.carrierExposed`,
  `carrierJustExposed`) and `finalStand` (`a11y.carrierFinalStand`,
  `carrierFinalStandJustStarted`). `finalStand` is raised only for exposed → final stand. A boss
  wave's lone Carrier jumps protected → final stand, and that is announced once, as the armor
  drop.

### Traveling beam

- **Charge (telegraph).** For `BEAM_CHARGE_MS` (600 ms in every stage), the Carrier shudders and
  its emitter swells. A thin line shows the column the bolt will take (`carrierBeamCharge`,
  `beamCharge` event, `a11y.carrierBeam`).
- **Release.** The charge becomes an independent `CarrierBeam` in `state.carrierBeams`: a
  140 × 24 px bolt travelling straight down at 1.1 px/ms (it crosses the lane in about 0.4 s). The
  release raises the `beamFire` event (`carrierBeamJustFired`). The Carrier goes straight back to
  idle and rolls its next interval.
- **Persistence.** A released beam leaves play only by reaching the player, leaving the bottom of
  the screen, a Smart Bomb, or the wave-boundary reset. It survives the Carrier's death and the
  wave-clear extraction. Killing the Carrier mid-charge cancels only the unreleased charge.
- **Hit.** A beam that touches the ship's hurt circle is spent on it, shield-absorbed or not. So
  one beam costs at most one plate or one life (shield → hull → life), and `runStats.beamHits`
  counts it once. **Beams pass through rocks** (#2844): a released beam and an asteroid never
  interact. The beam is not absorbed, it does not damage the rock, and the rock does not block it.
  This keeps the beam a readable lane threat (a rock drifting across the lane can't silently eat it),
  and keeps rocks cover against bullets only. The beam stays in `liveHazards` alongside rocks so the
  extraction autopilot dodges both. The enemy-fire dev toggle stops a charge from releasing anything.

### Twin lasers

In the exposed and final-stand stages only: a pair of aimed shots (±14 px) per roll. They count
against `bulletCap()`.

**Finite combat capacity.** The Carrier's timers decide _when_ it fires and how much;
`chooseCarrierTarget` decides only _where_. The target is a `CarrierTarget`: the player, or (#2844)
a rock. An exposed Carrier with a live rock approaching within `CARRIER_FLAK_RANGE` (180 px,
`carrierFlakRock`) **diverts its whole twin volley to flak at that rock**. The volley is the same two
guns on the same timer, so the diversion replaces a player-directed volley and adds no cadence. The
flak bolts are marked `flak` (amber, outside `bulletCap()`; the price was the volley they replaced).
The armored Carrier never flaks (its force field handles rocks). #2845: failing a rock, an exposed
Carrier may put the volley on **Buddy** instead (`CarrierTarget` kind `buddy`, see
[Buddy](#buddy-2845)) — again the same two guns on the same timer. The #2487 per-ship flak roll no
longer applies to the Carrier.

### Attack run

In the exposed and final-stand stages only. When its roll comes up (never while a beam charges),
the Carrier **braces** for `ATTACK_RUN_BRACE_MS` (800 ms). It rears up 8 px, an amber ring tightens
around it and a chevron shows under it (`carrierRunBrace`, `attackRun` event,
`a11y.carrierAttackRun`). It captures the player's X as it braces. It then flies its own heavy
swoop (enemy phase `AttackRun`, `carrierRunPath`). This is not a Grunt dive: it leans out, sweeps
down to the captured column and climbs back to its station in one slow, wide cubic. Exposed: 3.4 s
to 46% of the canvas height. Final stand: 2.8 s to 56%. It never reaches the player lane, so there
is no body collision. It keeps its twin-fire timer during the run, and on return it rolls the next
run.

Telegraphs never overlap: a beam charge never starts during a brace, and a brace waits for a
charge to finish. While exposed, the beam also holds for the whole run. In the final stand, beam,
direct fire and movement can combine: a charge may start mid-run, with its usual telegraph.

### Reinforcements

- A seeded interval and launch count per stage (table above). None on Ensign, in the final stand,
  or on a wave with no original Grunts (a boss wave).
- Only **vacant original Grunt slots** are refilled (`originalGruntCount(wave)` slots, taken from
  the wave's layout). The live Grunt count never exceeds the wave's original simultaneous Grunt
  population. A per-wave total cap of half the original slots (`reinforceCap`) also applies.
- Reinforcements never touch `startingNonLeaderCount`, so the 35% / ≤3 latches are unaffected once
  crossed. Killing the Carrier early is the wave's objective.

### Rendering and sound

`render/carrier.ts` (`carrierOps`) holds the shared geometry: the charge telegraph, each released
bolt (glow, core and a white-hot head) and the brace ring/chevron. The native Picture
(`buildFrame`) appends it, and the web canvas replays the same ops, so the two cannot drift.
Sounds: `starswarm.beamcharge` (charge and attack-run brace), `starswarm.beamfire` (release),
`starswarm.reinforce`, and the boss-wave sting for the final stand (all reused files, #2492).

## Buddy (#2845)

Buddy is a real allied ship, not a ghost: it has HP, it evades, enemies shoot at it, and it can be
destroyed. Its value is its own offence plus the enemy fire it draws away from the player.

### Sortie

`applyPowerUp(s, "buddy")` or a Buddy pickup launches one (`runStats.buddyLaunched`). It enters
from a side edge (picked by a hash of its id) and flies through three phases (`BuddyPhase`):

1. **Entering**: flies to its station at `BUDDY_TRANSIT_SPEED` (0.34 px/ms).
2. **OnStation**: holds a lane 55 px below the lowest ship in formation (never above 40% of the
   canvas height, never within 90 px of the player lane), strafing ±55 px about its target line.
   It makes `BUDDY_BURSTS` (3) **attack runs**: the first comes 700 ms after it arrives, then one
   every 2.2 s. For the last `BUDDY_RUN_MS` (700 ms) before each burst it lines up under its target
   and climbs 24 px, then fires one 3–4-shot spread (±20°, 0.5 px/ms) at it. Each shot is `piercing` but capped: it carries
   `pierceLeft` (starts at `BUDDY_PIERCE_HITS`, 2), loses one per ship it hits, and is spent on the
   last (that hit still lands). The counter is persisted in `saveShape`. Lightning and the player's
   own piercing carry no counter and are never capped. Its target is
   the exposed Carrier; otherwise it is the centre of the other ships on screen. The armored Carrier
   is never Buddy's target, because the field would stop the burst. A burst is only spent when
   the whole fan fits under the player-bullet cap (`MAX_PLAYER_BULLETS`, which Buddy's shots
   share). Until then Buddy holds its run, lined up. Its station time keeps running, so a blocked
   burst never stretches the sortie.
3. **Leaving**: 0.8 s after its last burst, after `BUDDY_STATION_MS` (9 s) on station, or as soon
   as the wave's last enemy dies (extraction), it peels off the nearer side edge. Bursts it has not
   fired are lost.

**Standoff.** On station Buddy never comes within `BUDDY_STANDOFF` (150 px) of the Carrier: its
lane is at least that far below the Carrier, and its evasion never dodges up into that band. So
it makes attack runs from a distance, never a point-blank pass through the Carrier. The only
exception is the floor: if the Carrier's own attack run dives deeper than the floor minus 150 px,
Buddy holds its floor lane, just above the player's.

### Durability

`BUDDY_HP` is 9 (#2880: the offense was the problem, not toughness, so HP only moved 10 → 9;
the sim also measured 8, see [Balance simulation](#balance-simulation-2880)). Hostiles damage
Buddy, and the player's shield never covers it:

| Source                                                                                      | Damage                                 | Then                                        |
| ------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------- |
| Any enemy shot (any tier, the exposed Carrier's twin fire, flak, shots aimed at the player) | the shot's damage (1)                  | the shot is spent on Buddy                  |
| Released Carrier beam                                                                       | `BUDDY_BEAM_DAMAGE` (3)                | the beam is spent on Buddy                  |
| Asteroid (`asteroidHits`)                                                                   | `BUDDY_ROCK_DAMAGE` (2), once per rock | a small rock shatters, a large one flies on |

Hostiles resolve against Buddy before the player in the same tick, so a shot that reaches Buddy
first is spent there. At 0 HP Buddy explodes and is removed (`runStats.buddyLost`,
`buddyJustLost`, which drives the screen's `a11y.buddyDown` announcement). Its unfired bursts go
with it. The shots it already fired are separate entities and fly on.

The HP bar is shared geometry (`render/buddy.ts`, `buddyOps`). It shows one pip per hit point
above the ship: green, then amber at half, then red at a quarter. A hit flashes a ring. The native
Picture appends it after each Buddy sprite, and the web canvas replays the same ops. The sprite
faces its direction of travel (`facingRight`).

### Enemy targeting and finite capacity

Every tier may shoot at Buddy, but it costs them. **A shot at Buddy replaces a shot at the player.**
No ship gains a gun or any cadence because Buddy is on the field.

- **Ordinary ships.** Grunts, Elites and Guardians fire from formation, dives, circling or bursts.
  When one of them is about to release a shot at the player, and a Buddy is on screen, within
  380 px and at least 20 px below it, that same bullet (same ship, same timer, same id) is
  re-aimed at Buddy on a divert roll. The roll is a stateless hash of the bullet id, so it never
  draws from the seeded rng. The bullet is tagged `target: "buddy"`.
- **Carrier.** Its volley goes through the `chooseCarrierTarget` seam. A threatening rock comes
  first (#2844), then Buddy on the Carrier's divert roll, then the player. `CarrierTarget` has the
  kinds `player`, `rock` and `buddy`. The armored Carrier never targets Buddy (`buddyTargetFor`
  returns null), because it has no aimed guns then. **From the moment the last Guardian dies** it
  treats Buddy as hostile. It does not wait for its final stand.
- **Not focus-fired.** At most `BUDDY_MAX_INCOMING` (3) shots may be in flight at Buddy. Past that
  cap, ships keep shooting at the player, and a Carrier volley already chosen for Buddy is turned
  back onto the player.

`BUDDY_TARGETING` sets each tier's effectiveness (`aimAtBuddy`). The ordering is the design, and
tests hold it:

| Tier     | Divert chance | Shot speed (px/ms) | Aim error (± rad) | Leads Buddy's motion |
| -------- | ------------: | -----------------: | ----------------: | -------------------: |
| Grunt    |           12% |               0.28 |              0.22 |                   0% |
| Elite    |           25% |               0.35 |              0.12 |                  40% |
| Guardian |           40% |               0.46 |              0.06 |                  75% |
| Carrier  | 55% (exposed) |               0.52 |              0.02 |                 100% |

A ship that is evading a rock has its player-directed aim degraded (#2844). A shot it diverts to
Buddy keeps its `BUDDY_TARGETING` aim instead; the degrade's rng draws are still taken, so the
seeded stream is the same whichever target the shot went to.
`runStats.buddyShotsDrawn` counts the diverted shots. A counterfactual test holds the invariant:
with the same seed, the enemy's player-directed plus Buddy-directed fire never exceeds its
player-directed fire without Buddy.

### Evasion

Buddy actively dodges enemy shots, released Carrier beams and rocks (`buddyHazards`). A rock
counts only when `asteroidThreatens(rock, buddyThreatCircle(b, 6), 900)` says it will reach Buddy.
Every `BUDDY_REPLAN_MS` (220 ms) Buddy scores its station and a ring of nearby points (±90 px
across, ±40 px up or down) against those hazards over a 720 ms lookahead, sampled every 40 ms at
its capped speed. It steers for the safest point, pulled toward its station.

- **Strong.** It sees 720 ms ahead and weighs near danger most.
- **Bounded and readable.** On station it moves at no more than `BUDDY_SPEED` (0.14 px/ms), within
  a small ring, and stays inside the field and outside the Carrier standoff.
- **Imperfect.** It notices each hazard only with `BUDDY_NOTICE` odds (shots 80%, beams 90%, rocks
  85%), decided by a stateless hash of the hazard's id, and it reacts only on re-plans. A shot
  _aimed at Buddy_ (`target: "buddy"`, a deliberate leading shot) uses its own, lower
  `BUDDY_NOTICE_AIMED` (60%) instead of the 80% shot rate; beams and rocks are unchanged. An
  unnoticed hazard is simply not dodged.

Player shots are allied and never count as hazards to Buddy.

### Allied collision policy

The player and Buddy are allies. These are explicit rules, with `shotHarmsAllies` as the one
predicate (only enemy-owned shots hurt an ally), not omissions:

- player shots pass through Buddy harmlessly;
- Buddy's shots (player-owned, `source: "buddy"`) pass through the player harmlessly;
- player and Buddy shots never collide with or cancel each other;
- the player's hull and Buddy's hull overlapping costs neither anything.

Both still meet hostiles and rocks normally. Buddy's shots kill enemies, pierce up to two ordinary hulls and
are spent on rocks. Enemy hulls do not ram Buddy: divers fly the player's lane, and ramming is a
player-only rule.

### Carrier armor

Multi-hit and armor bypass are now separate `Bullet` flags. `piercing` means multi-hit through
ordinary hulls (one hit per enemy per bullet). `armorPiercing` means the shot gets through the
escorted Carrier's field. Buddy's burst is `piercing` only (plus the `pierceLeft` hit cap, a third, Buddy-only concept), so the armored Carrier's field
**spends** those shots (ring, `runStats.armorDeflects`, no damage). Lightning is both, as the one
explicit exception. Once exposed, the Carrier is Buddy's first target.

### Projectile persistence

Every released shot is its own entity, so these trades are valid:

- Buddy fires, then dies, and its shots still kill the Carrier.
- The Carrier fires at Buddy, then dies, and its shot still lands.
- In near-simultaneous mutual destruction, both die on the same tick.

### Extraction and reset

On the wave's last kill every Buddy switches to Leaving. `weaponsFree` is false, so it fires
nothing new. `hazardsLive` is true, so shots already in flight can still damage it. The extraction
autopilot dodges shots aimed at Buddy (they are ordinary enemy shots), and Buddy and its shots are
never hazards to the player. `clearTransientCombat` removes every Buddy and every shot either side
fired, and `saveShape` persists Buddy's full state.

### Balance simulation (#2880)

`frontend/src/game/starswarm/sim/` is a seeded, headless balance harness for Buddy. It drives the
real `tick()` with an autoplayed player and launches Buddy through `applyPowerUp(s, "buddy")`.
Nothing in the engine is instrumented. Every metric comes from diffing consecutive states:
which enemy shot vanished on Buddy's hull, which ship a Buddy shot newly pierced, and which of
Buddy's attack runs fired it. The attribution is checked against Buddy's real HP loss
(`Attr. misses`: a shot fired and landed within one tick is invisible to diffing, which is rare).

- **Scenarios.** `boss-exposed`: wave 5, launched the tick the last Guardian dies.
  `boss-start`: wave 5, launched as combat starts. `normal-start`: wave 3, launched as combat
  starts, against the full 45-ship fleet. `normal-mid`: wave 3, launched once a seeded 15–75% of
  the wave is dead. `normal-exposed`: wave 3, launched at Carrier exposure.
- **Pilots.** `autoplay`: a fallible player. It sweeps under its target and fires. It dodges
  shots, rocks, beams, beam telegraphs and divers over a 720 ms lookahead, but notices only 85%
  of hazards and re-plans every 120 ms at 0.45 px/ms. It has Guns L2, and its lives are topped up
  so it always finishes the fight. `invincible`: the same player, never hurt. `duel`: invincible,
  and it stops firing at launch, so whatever dies, Buddy killed. It measures Buddy vs the
  Carrier, and whether one sortie can clear a wave alone.
- **Pairing.** Each seed plays to the launch point once. It then forks the exact state and
  engine counters into a with-Buddy branch and a without-Buddy branch, so the Carrier's
  time-to-kill is compared on the same seed. Seeds are hashed (`cellSeed`, `_shared/simRandom`),
  because the engine's LCG makes neighbouring seeds nearly identical. The same index gives the
  same seed in every cell and variant.
- **House rules.** Pickups are removed as they spawn, so no stray Bomb or Shield skews a sortie.
- **Overrides.** `sim/engineVariant.ts` builds a private copy of `engine.ts` with named constants
  (or exact code snippets) rewritten, for sweeps and behaviour prototypes. The shipped engine is
  never modified. An anchor that no longer matches throws, and the smoke test re-applies every
  preset. The variants and presets are in `sim/presets.ts`.

**Rebalance and results.** The sim found Buddy's problem was per-sortie _output_, not toughness: 3
runs of 5–7 shots with unlimited pierce wiped 43–52% of a normal wave per sortie and solo-killed
the exposed Carrier 96–100% of the time, while its evasion kept it at about 0% destroyed. The
shipped tuning (the sim's `legacy (pre-#2880)` variant is the old one; `base` is the real engine):

| Setting                             | Before    | Now                                          |
| ----------------------------------- | --------- | -------------------------------------------- |
| Fan size                            | 5–7       | 3–4                                          |
| Hits per Buddy shot                 | unlimited | 2 (`BUDDY_PIERCE_HITS`, `Bullet.pierceLeft`) |
| `BUDDY_HP`                          | 10        | 9                                            |
| `BUDDY_SPEED` (evade)               | 0.2 px/ms | 0.14                                         |
| `BUDDY_REPLAN_MS`                   | 140       | 220                                          |
| Notice chance, shots aimed at Buddy | 0.8       | 0.6 (`BUDDY_NOTICE_AIMED`)                   |

Runs per sortie (3), finite capacity (no extra enemy fire) and determinism are unchanged. Results
at 200 seeds per cell (`--preset proposal`, same seeds before and after), range over the ten
difficulties Ensign to Fleet Admiral:

| Measure (target band)                                                     | Before                | After                                                                                  |
| ------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------- |
| One sortie vs a full 45-ship wave, duel: fleet killed, mean (15–30%)      | 42–54%                | 27–29%                                                                                 |
| …p90 (≤ 35%) / max                                                        | 44–60% / 51–64%       | 29–33% / 31–38%                                                                        |
| …wave cleared by the sortie alone (never)                                 | 0%                    | 0%                                                                                     |
| Duel, exposed Carrier: Buddy destroyed (25–40%)                           | 0–1%                  | Ens 1, LtJG 10, Lt 20, LCdr 16, Cdr 28, Capt 35, RAdm 27, VAdm 34, Adm 36, FAdm 36 (%) |
| …Carrier solo-killed by Buddy (≤ 35%)                                     | 95–100%               | 0–35% (Ens 35, VAdm 24, rest ≤ 18)                                                     |
| With the player, exposed Carrier: Buddy's share of Carrier damage (≤ 25%) | 12–40%                | 8–19%                                                                                  |
| With the player: Carrier time-to-kill with / without Buddy                | 1.5–2.3 s / 1.6–3.6 s | 1.5–3.1 s / 1.6–3.6 s                                                                  |
| Normal waves, with the player: Buddy destroyed (≤ 10%)                    | 0–1%                  | 0–1%                                                                                   |

Where it misses the band. Low difficulties are under the duel band (Ensign 1%, Lt. JG 10%, Lt. Cdr.
16% destroyed; Lt. is at 20%) because the Carrier fires slowly there. Nothing is above it (the top
is 36%). The autoplay boss-start run at Rear Admiral is an outlier (33% destroyed, the rest of
the row is 0–12%). HP was not tuned further. At `BUDDY_HP` 8 the duel rates are Ens 3%, LtJG 21%,
Capt 46%, FAdm 46% (HP 9: 1%, 10%, 35%, 36%), which fixes the low end and overshoots the top, so
9 was kept. The autoplay pilot is more accurate than a human, so a real Carrier fight lands
between the autoplay and duel numbers; waves 3 and 5 only, pickups disabled.

**Counterfactual alignment.** Buddy's own entities (the ship, its shots, its wreck's explosion)
take ids from a separate range (`BUDDY_ID_BASE`, a second counter carried in `engineCounters()`
as the optional `buddyNextId`). Carrier targeting and every hazard-notice hash are keyed on ids,
so with one shared counter a with-Buddy branch drifts from the without-Buddy branch just because
Buddy allocated ids. Now the main stream is identical in both, and the paired time-to-kill and
player-hit comparisons hold; a test pins it. Buddy's range is seeded from the main counter's
position at launch (read only), so its id, and with it its side, fan size and noticing, still vary run to run.

**Sweeps.** `SWEEPS`, `CANDIDATES` and `OFFENSE` are deltas on the **pre-#2880** tuning
(`LEGACY`), so `--preset sensitivity|offense|candidates` reproduce the investigation. `BASE` is
the shipped engine, and `--preset shipped` is a small sweep around it (HP 8/10, evade speed,
aimed-notice chance). The no-evade and notice sweeps also set the aimed-notice chance
(`aimedNotice`), because `BUDDY_NOTICE` no longer covers shots aimed at Buddy.

The files follow the Hearts sim layout, and are ready for a regression gate (#2884):

| File                            | Role                                                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sim/balance.ts`                | Pure and deterministic, with no output. `runCell` / `measureCell(engine, {scenario, difficulty, pilot, variant, seeds})` returns a plain `CellSummary`. |
| `sim/presets.ts`                | The variants, `engineFor`, and the presets: `fast`, `baseline`, `offense`, `sensitivity`, `candidates`, `shipped`, `proposal`.                          |
| `sim/report.ts`                 | Markdown tables built from `CellSummary`.                                                                                                               |
| `scripts/simulate-starswarm.ts` | The CLI.                                                                                                                                                |

The `fast` preset (3 seeds, two cells) is the jest smoke test in
`sim/__tests__/balance.test.ts`, which runs with `npx jest src/game/starswarm` in about 15 s. The
full runs use the CLI:

```bash
# from the repo root
npx tsx scripts/simulate-starswarm.ts --preset baseline --jobs 4 --md /tmp/base.md --json /tmp/base.json
npx tsx scripts/simulate-starswarm.ts --preset offense --jobs 4       # fan / pierce / damage, 3 runs fixed
npx tsx scripts/simulate-starswarm.ts --preset sensitivity --jobs 4   # one-at-a-time sweeps
npx tsx scripts/simulate-starswarm.ts --preset candidates --jobs 4    # survivability combos on the offense core
npx tsx scripts/simulate-starswarm.ts --preset proposal --jobs 4      # pre-#2880 tuning vs the shipped one, same seeds
# filters: --seeds 200 --seed-base 0 --diffs Captain,Ensign --scenarios boss-exposed
#          --pilots autoplay,duel --variants base,hp8
npx tsx scripts/simulate-starswarm.ts --merge /tmp/a.json,/tmp/b.json --md /tmp/all.md
```

A boss-wave seed takes about 0.2 s. An ordinary-wave seed takes 0.3–1.5 s, because the pilot has
to play the wave down to the launch point. The whole baseline is roughly 1 CPU-hour, which is why
`--jobs` forks shard processes.

## In-Run Ship Upgrades (#2488)

Two ladders that live and die with the run. Nothing persists between runs and nothing is sold, so
the leaderboard stays fair.

| Ladder | Levels                                                            | Source                                                                              | Lost on                            |
| ------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------- |
| Guns   | L1 single → L2 twin (±7 px) → L3 twin + spread pair (±0.14 px/ms) | **Salvage crate**: 40% chance from any large asteroid that breaks, whoever broke it | one level per life lost (floor L1) |
| Hull   | 0 → 1 → 2 plating                                                 | **Hull plating**: always dropped when the Carrier dies                              | one level per hit absorbed         |

- Hit order is **shield → hull → life**. Plating absorbs a shot, a rock, a Carrier beam or a ram (the
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

The moment no Elite, Guardian or Carrier is left alive in the Playing phase and at least one grunt is,
the wave's grunts break and run: `state.routed` latches for the wave and every surviving grunt in
any phase but swoop-in enters `Fleeing` — a cubic path from where it is to off-screen top on its
nearer side, 1.5–2.1 s long (× 1.4 on Ensign) after a 0–375 ms hesitation. A reinforcement still
swooping in when it happens runs the moment it lands. Fleeing grunts never shoot, dive or ram;
they still roll to dodge rocks and can be struck by them.

- **Caught** on the way out: `TIER_SCORE.Grunt × 2` (the dive multiplier) and `runStats.routCaught`.
- **Escaped** (`pathT ≥ 1`): removed with no score, `runStats.routEscaped`. The wave clears once
  nothing is alive, escapes included.
- The ≤3-survivor straggler rule stands down for a routed set; it still engages when an Elite or
  Guardian is among the survivors (the grunts don't rout then).
- Boss waves have no grunts, so nothing routs there. Killing the leaders last farms nothing: the
  Carrier's reinforcements only refill original grunt slots (and are capped per wave), so they
  bound how many grunts can exist, and each caught one pays double.
- "ROUT!" banner (`phase.rout`) while any grunt is fleeing, a `starswarm.rout` sting and an
  `a11y.rout` announcement with the count. Dev panel: "Rout off" restores the old mop-up ending.

## Hazards: Errant Asteroids (#2486, #2844)

From wave 2, a rock crosses the field every 12-20 s of the Playing phase (never during swoop-in,
the wave-clear extraction or a boss wave; at most 2 in flight from timed spawns). It is a neutral
third party:

- **Both sides can hit it.** Any bullet, from either owner and piercing or not, that reaches a rock is
  spent on it, so a large rock is temporary cover. Large rocks (22 px, 6 HP) split into two small
  ones (12 px, 2 HP); small ones are removed. Released Carrier beams pass through rocks.
- **It hits both sides.** A rock deals 1 damage to any ship it touches, once per ship, including
  reinforcements still swooping in mid-combat once they are on screen (during the wave's own
  swoop-in nothing takes damage, #2842). A small rock shatters on impact; a large one keeps going.
  On the player it acts like a shot: the shield absorbs it, otherwise it costs a life; either way
  it shatters. For the Carrier see _Carrier vs asteroids_ below.
- **Nobody scores.** Breaking a rock and enemies a rock kills award no points and don't advance the
  power-up kill counter (they do count toward wave clear and the Elite/Guardian thresholds).
- The smart bomb clears rocks. Rocks in flight stay live through the wave-clear extraction and are
  cleared by the hard reset before the next wave (#2842); none ever carries into a new wave.
- Dev panel: "Asteroids off" (timed spawns) and "Throw asteroid" (`throwAsteroid()` in the engine).
- Drawn as one of 4 Kenney meteor sprites (picked per rock, reused at both `large`/`small` sizes
  since collision uses the radius, not the art), spinning at `spin` rad/ms; falls back to the
  procedural rock outline while sprites load (#2573).

Salvage drops are #2488.

### Entry geometry (#2844)

`planAsteroidEntry(canvasW, canvasH, radius, actors, rand)` plans one rock. It draws an entry
region, an off-screen start point, a point in the play space to cross and a speed:

| Region             | Odds | Start (always fully off-screen)                |
| ------------------ | ---- | ---------------------------------------------- |
| left edge          | 28%  | just left of the canvas, y in 4-54% of height  |
| right edge         | 28%  | just right of the canvas, y in 4-54% of height |
| top edge           | 26%  | just above the canvas, x in 10-90% of width    |
| upper-left corner  | 9%   | up to 20 px diagonally beyond the corner       |
| upper-right corner | 9%   | up to 20 px diagonally beyond the corner       |

The rock is aimed through a random point in 15-85% of the width and 25-70% of the height, at
0.15-0.22 px/ms (size still 65% large / 35% small). A candidate is rejected and redrawn (up to
`ASTEROID_ENTRY_ATTEMPTS` = 8) unless it:

- heads downward at least `ASTEROID_MIN_ANGLE` (0.3 rad) below horizontal: no flat skim;
- spends at least half the canvas width of path inside the field (`ASTEROID_MIN_CROSS_FRAC`): it
  crosses meaningful space instead of skimming a corner;
- leaves at least 1.5 s (`ASTEROID_MIN_REACTION_MS`) between touching the screen and being able to
  reach the player's row (`asteroidEntryMetrics`);
- does not start overlapping any ship, including reinforcements waiting off-screen, or Buddy.

If the random attempts all fail (common on a short landscape canvas), a deterministic fallback scans
side-edge entries at the slowest speed over fixed angles, so a timed spawn is not dropped; it obeys
the same fairness rules. If even that is blocked by ships, no rock spawns this time (the timer still resets). Everything is
drawn from the seeded `rng()`, so a seeded run replays exactly. Timed spawns still respect
`MAX_ASTEROIDS`.

### Enemy AI: asteroid response (#2487, #2844)

When a rock will cross a ship's hitbox within the next 700 ms (sampled at +200/+400/+700 ms
against where the ship will be, on its path if it is swooping, diving or returning), the ship is
**threatened** and rolls **once per rock** to dodge. Success chance is `base × difficulty
paramScale`, capped at 97%. Only threatened ships react: a far-off ship is untouched.

| Tier     | Dodge base | Flak base | Dodge action                                         |
| -------- | ---------- | --------- | ---------------------------------------------------- |
| Grunt    | 25%        | 30%       | formation: 22 px sidestep (600 ms); on a path: nudge |
| Elite    | 55%        | 70%       | same                                                 |
| Guardian | 80%        | 90%       | same                                                 |
| Carrier  | never      | see below | heavy: no sidestep, see _Carrier vs asteroids_       |

A path nudge splits the curve at the ship's current progress and shifts the _remaining_ segment's
control points 40 px away from the rock, restarting it from the ship's position with the time it
had left: the ship doesn't jump, and it still arrives where it was going. Ships still off-screen
(`pathT < 0`) are not threatened; circling ships are detected but have nothing to sidestep with,
so they skip the roll (see _Diver awareness_). A failed roll takes no action, so the
collision follows naturally and reads as a botched dodge.

**Flak.** A ship holding formation (divers and circlers: see _Diver awareness_) fires one aimed shot at a rock approaching within 120 px
(probability `flak base × min(1.3, paramScale)`, 900 ms cooldown per ship). Flak is an enemy
bullet marked `flak`: it is drawn amber, sits outside `bulletCap()`, is spent on the rock like any
shot, and can still hit the player if it misses. The dev "Enemy missiles off" toggle silences it.

**Attention cost (finite combat capacity).** Answering a rock is paid for out of the ship's own
offensive capacity, never on top of it. All three costs act on the ship's next-shot timer or aim
and scale by tier (`ASTEROID_ATTENTION`, `asteroidAttention(tier)`). The order is the design: Grunt
most distracted, then Elite, then Guardian, then Carrier least.

| Tier     | Threatened (once per rock) | Flak fired | Aim spread while evading |
| -------- | -------------------------- | ---------- | ------------------------ |
| Grunt    | +350 ms                    | +1200 ms   | 0.60                     |
| Elite    | +220 ms                    | +800 ms    | 0.40                     |
| Guardian | +120 ms                    | +450 ms    | 0.22                     |
| Carrier  | +60 ms                     | +250 ms\*  | 0.10 (it never evades)   |

- **Nearby threat:** a mild local distraction. `withAsteroidAttention(timer, tier, "threat")` adds
  the threat cost to the ship's next-shot timer once per rock, whether or not its dodge roll succeeds.
- **Debt, not just a timer bump:** every cost is also booked as `enemy.attentionMs`, a floor that
  is re-applied under the ship's next-shot timer after every tick. A dive launch (which zeroes the
  timer) or the straggler rule (which caps it) therefore cannot cash the debt in early.
- **Flak engagement** (only for a ship the rock actually threatens; a rock passing wide costs
  nothing): firing flak adds the flak cost to the same timer, so the gun that shot at the
  rock is not also shooting at the player. Flak stays outside the global bullet cap; the timer is
  what pays for it.
- **Active dodge:** a successful dodge (sidestep or nudge) sets `enemy.evadeMs` to 600 ms. While it
  runs, the ship still fires, but each player-directed shot's `vx` is kicked sideways by
  0.5-1 × the tier's aim spread × the shot's speed, in a random direction (`degradeAim`). It is
  always a real miss-angle, bigger for the more distracted tiers. Flak is never degraded.
- \* The Carrier's flak is its twin volley diverted (below), so its cost is the volley it replaces.

### Diver awareness (#2881)

Diving ships stay committed to their path and may still hit a rock, but they visibly react. In
`tickAsteroidThreats`, a ship in **Wiggling, Diving, Returning, Fleeing or Circling** (`REACTION_PHASES`)
that a rock threatens gets one reaction opportunity per rock **per phase**: `reactedAsteroidIds`
is cleared whenever the ship's phase changes, so a ship that rolled against a rock in formation can
still react when it dives, with no per-tick spam. The opportunity is three independent rolls, all on
the seeded `rng()`:

| Tier     | Flinch (`FLINCH_CHANCE`) | Late nudge (`LATE_NUDGE_CHANCE`) | Flak at the rock                         |
| -------- | ------------------------ | -------------------------------- | ---------------------------------------- |
| Grunt    | 100%                     | 35%                              | `FLAK_BASE` x 0.8 x min(1.3, paramScale) |
| Elite    | 85%                      | 50%                              | same                                     |
| Guardian | 60%                      | 60%                              | same                                     |
| Carrier  | never                    | never                            | unchanged (diverted twin volley)         |

- **Flinch.** Sets `evadeMs` to `FLINCH_MS` (450 ms), so the existing aim degrade applies to
  player-directed shots, and `flinchMs`, which drives a render-only wobble (`flinchWobble` in
  `render/flinch.ts`: a decaying lateral jitter of up to 3 px and a tilt of up to 0.22 rad, shared by
  the native display list and the web canvas).
- **Flak** (`DIVER_FLAK_FACTOR`). Pays the tier's `flakMs` into `shootTimer` and `attentionMs`
  through `payAttention`, so it displaces a shot at the player rather than adding one. It respects
  the per-ship `flakCooldown` and stays outside `bulletCap()`.
- **Late nudge** (`LATE_NUDGE_PX` = 60). Only when the ordinary dodge did not happen on this
  tick: the remaining path segment's control points shift 60 px away from the rock; p0 and the dive
  endpoint p3 are untouched. It needs a path, so Wiggling and Circling ships get flinch and flak only.
- **Circling** is no longer skipped: it is detected, pays the threat cost and gets flinch and flak.
  It has no sidestep or path, so the ordinary dodge roll does not apply to it.
- The armored Carrier and the exposed Carrier's AttackRun are unchanged (the latter never evades).
  A Fleeing ship never fires, so it gets flinch and the late nudge only. Diver flak uses the same envelope as formation flak (rock approaching and within `FLAK_RANGE`). The dev "Dodge off" toggle gates only the dodge roll and the nudges, and "Flak off" gates all flak (formation and diver); the flinch is gated by neither.

`frontend/src/game/starswarm/sim/asteroidAwareness.ts` is a seeded headless sim over the real
`tick()` that measures each phase (threat, flinch, flak, dodge and hit rates, and how often a
"successful" dodge still collides) against a control run with dodge and flak disabled.
`measureAwareness()` is pure and returns plain data, so a future gate can diff it against a
baseline. Run the full sweep with
`SIM=1 npx jest src/game/starswarm/__tests__/asteroidAwareness.sim.test.ts`; the fast smoke runs
with the normal suite. Unit tests are in `__tests__/diverAwareness.test.ts`.

### Carrier vs asteroids (#2844)

Immunity derives from the armor state, never from `tier === "Carrier"`. `rocksStrikeEnemies` takes
`armored` (the tick's starting roster, like the rest of #2484's armor rule):

- **Armored** (any Guardian alive): the force field shatters the rock, the ring plays, the Carrier
  takes no damage, and `runStats.armorDeflects` counts it. Flagged as shattered, so the rock does not
  split or pay salvage.
- **Exposed** (the tick after the last Guardian dies): the Carrier is an ordinary hull. The rock
  deals 1 damage (once per rock, like any ship) and a large rock keeps going. A Carrier the rock kills
  still drops its hull plating. No score is awarded (rocks never pay).
- **Heavy:** the Carrier never sidesteps and never nudges its path. A rock bearing down takes a small
  attention cost (above) and, while exposed, the Carrier's twin volley is diverted to flak at the
  rock (`carrierFlakRock` / `chooseCarrierTarget`), replacing a player-directed volley with no extra
  cadence. The armored Carrier ignores rocks entirely.

### Shared threat and collision contract (for Buddy, #2845)

Enemies, the extraction autopilot and Buddy ask the same pure questions through these exports:

| Helper                                         | Answers                                                               |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| `asteroidThreatens(rock, circle, lookaheadMs)` | Exact closest-approach: will the rock reach the circle in the window? |
| `asteroidHits(rock, circle)`                   | Overlap right now, circle vs circle                                   |
| `asteroidHitsBox(rock, box)`                   | Overlap right now, circle vs a centred box (how ships are hit)        |
| `enemyThreatCircle(enemy)`                     | A ship's hitbox as a `ThreatCircle`                                   |
| `liveHazards(state)`                           | Every hostile thing in flight, rocks included, as moving circles      |
| `ASTEROID_STATS`, `MAX_ASTEROIDS`              | Rock radius/HP and the in-flight cap                                  |

A `ThreatCircle` is `{ x, y, r, vx?, vy? }`; give it a velocity to have the test run in the
relative frame. Pad `r` for a safety margin. A destroyed rock (hp <= 0) never threatens or hits.
Buddy owns its own HP, avoidance odds and damage response; this contract only says which rocks
threaten and which have hit. Rocks deal 1 damage to enemy ships (`rocksStrikeEnemies`). Buddy
(#2845) uses the same contract: `asteroidThreatens` against `buddyThreatCircle` for its evasion,
`asteroidHits` for impact, and the same one-hit-per-rock rule (`hitRockIds`); it takes
`BUDDY_ROCK_DAMAGE`.

**Counters.** `state.tierStats` records per tier: rolls, dodged, pathRolls, pathDodged, struck and
flak. They carry across waves and reset on a new game; see _Telemetry_ below for how to read them.

## Telemetry: run stats (#2491)

Two sets of counters live on the engine state, both carried across waves and reset on a new game:

- `tierStats` (per tier, #2487): dodge rolls, dodged, path rolls, struck, flak shots.
- `runStats` (whole run): reinforcements launched, armor deflections (ordinary shots the escorted
  Carrier shrugged off), beam hits on the player (released Carrier beams that cost plating or a
  life — a shield-absorbed beam is not one), rocks spawned, rocks broken by the player's shots and by
  enemy shots (flak included; a bomb or a hull shatter credits nobody), fleeing grunts caught
  (shot or bombed) or escaped (#2489), and (#2845) Buddy ships launched, Buddy ships lost, and enemy
  shots drawn by Buddy (each one a shot that would have gone at the player).

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

| Event                               |     Base score |
| ----------------------------------- | -------------: |
| Grunt kill                          |            100 |
| Elite kill                          |            200 |
| Guardian kill                       |            400 |
| Carrier kill                        |           1000 |
| Enemy killed while Diving/Circling  |        2× base |
| Fleeing Grunt caught by player fire |            200 |
| Fleeing Grunt killed by Smart Bomb  |            100 |
| Ordinary wave clear                 |     500 × wave |
| Boss-wave clear                     | 500 × wave × 2 |

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
treat the source set as open. Since #2843 the escort tier's sources are `Guardian`,
`Guardian:dive`, … . Results from older builds carry `Boss`, `Boss:dive`, … for the same tier.
The backend keeps both unchanged (it validates shape, not names), so a reader that aggregates
across builds should treat `Boss*` as `Guardian*`.

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
The breakdown is in the result only, not the `game_ended` event. The owner sees it on Game Details (Profile → Recent Games → a run; `frontend/src/components/gameDetail/`, #2840) as one row per wave with its sources, the `earlier` fold as one "Waves X–Y" row, and a note when it doesn't add up to the score.

`StarSwarmResult` checks the block adds up (per wave `end - start == total == sum(pts)`, each
wave starting at the previous `end` or at `earlier.total`, waves strictly ascending, strict
non-negative integers) and, when the completion's `final_score` is in the validation context,
that it reconciles to it. A block that fails is dropped to `null` and reported to Sentry
(`starswarm-result-breakdown-dropped`, field paths and error types only); the run still completes
and ranks.

Adding `scoreLedger` to the saved state changed `SAVE_FINGERPRINT`, so a run paused on a build
before #2837 is discarded once, not restored, after the update (Star Swarm is hidden in store
builds, so this is accepted). #2843 did the same again (`carrierBeams`, `carrierStage`, the
Carrier's `runPhase`/`runTimer`, and the Guardian renames of `startingNonLeaderCount` and the
`guardian*ThresholdCrossed` latches), so a run paused before it is discarded once too. No save
restores with a `"Boss"` tier id.

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
Carrier's armor ring, hit-flash bursts, the Carrier's beams and telegraphs (`render/carrier.ts`,
shared with the web canvas), the invincibility
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

The broad game contract is documented above, including all of the #2776 epic. Buddy's tuning
numbers (`BUDDY_HP`, `BUDDY_TARGETING`, `BUDDY_NOTICE`) are starting values; set them from
survival-time data (`runStats.buddyLost` against `buddyLaunched`, and `buddyShotsDrawn`) and the
[balance simulation](#balance-simulation-2880) (#2880).

Other active bugs/tuning work belongs in GitHub rather than a duplicated Known Issues list.
