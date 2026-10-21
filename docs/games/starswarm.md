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
active during combat (never during swoop-in, the pickup wait after the last kill, or the wave-clear
extraction — see [Wave Structure](#wave-structure)).

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
time; salvage/hull upgrade pickups do not consume that slot. No ordinary drop spawns once the wave
is clear, except one rolled on the tick of the last kill itself (see
[Wave clear](#wave-clear-pickup-wait-then-live-extraction)).

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
  → last kill → pickup wait, only while a pickup is on screen [ClearAwaitingPickups]
  → extraction [Extraction] → hard reset → next wave's countdown
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

### Wave clear: pickup wait, then live extraction

When the last enemy dies (shot, rammed, rock-struck, or a routed grunt escaping), the wave is
clear (`waveJustCleared(prev, next)` marks the tick; `isWaveCleared` holds from then on). On that
tick the engine:

1. awards the wave-clear bonus (once, ×2 on a boss wave) and raises the non-blocking MISSION
   COMPLETE banner (`beginWaveClear`);
2. stops the player's weapons and every new arrival from off-screen: `weaponsFree` and
   `arrivalsAllowed` are true only in `Playing`, so there is no new player or enemy fire, no
   asteroid entry, no reinforcement and no top-spawned ordinary power-up drop;
3. keeps everything already on screen **live and fair game**: player shots, enemy shots
   (including ones whose ship is dead) and asteroids keep moving and resolving. A hit still goes
   shield → hull → life, and can end the run through the normal death flow. A rock that a shot
   already in flight breaks can still drop salvage.

The last kill's tick is still combat, so its own drops spawn as usual: the Carrier's hull plating,
and an ordinary power-up if that tick's kill count triggers one (#3132).

**Pickup wait (#3132).** If any pickup is on screen after the last kill, the wave does not go to
the extraction yet. It enters `ClearAwaitingPickups`: the player keeps the ship (input flies it,
the autopilot is off), hazards stay live and pickups can be collected. There is no autopilot
chase and no magnet: the player collects pickups themselves. The wait ends when the pickup list is
empty, because each pickup was collected or fell off the screen (or despawned), and the
extraction below runs as normal. A collected salvage crate or hull plate carries into the next
wave; a collected Shield or Lightning keeps today's reset rule (it ends at the wave boundary).

- **No pickup on screen at the last kill:** the extraction starts on that same tick, exactly as
  before. No wait, no delay.
- **Salvage after the last kill:** a crate from a rock broken by an in-flight shot joins the wait.
  If it appears during the extraction while the ship still holds its lane (it has not started to
  climb), the engine hands the ship back to the player and returns to `ClearAwaitingPickups`.
  Once the ship is climbing out, the extraction runs on.
- **Safety cap:** the wait's clock is `phaseTimer` (game time: it stops while paused). It counts
  from the newest pickup's arrival and ends the wait at `pickupWaitMaxMs(canvasH)`: the longest
  pickup lifetime (`powerUpDespawnMs`) plus `PICKUP_WAIT_SLACK_MS` (1 s). A pickup still on screen
  then is removed and the extraction begins. Every pickup leaves on its own well before that, so
  the cap is only a guard against one that never would.
- **Pause and saves:** pausing stops the ticks, so the wait and its pickups hold still. A paused run
  saves and restores into the same wait (the phase and `phaseTimer` are part of the save).
- **Screen:** the clear sound, haptic and spoken cue fire once, on the last kill. Ship drags stay
  live during the wait (they are ignored only during the extraction), and on web a hidden tab
  pauses the wait like combat. The next wave's countdown starts when the wave number changes,
  after the extraction, as before.

**Extraction.** The engine then enters `Extraction`. It hands the ship to an AI autopilot
(`isAutopilot`): input is ignored, and the screen keeps its commanded X on the ship. Manual fire
stays off, and shots and rocks already in flight stay live. Nothing is frozen and nothing new
enters. The #2945 pickup chase (#3026) is retired: pickups are resolved by the wait before the
extraction begins, so the autopilot only dodges and climbs.

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
and ends any active Lightning/Shield, as before. Falling pickups are normally gone by then: the
pickup wait (#3132) holds the extraction until every pickup is collected or off screen. Only one
that lands during the extraction's climb, or one the safety cap removed, is lost here.

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
- All four Guardians may dive at once: the concurrent-diver cap is lifted to 4 on a boss wave
  (`diveCap`, #3139). Ordinary waves keep the `maxDivers` caps.
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

The Carrier is a staged boss encounter. Its code lives in `tickCarrier` (`engine/carrier.ts`);
the stage is derived from the live roster (`engine/roster.ts`).

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

**Path vetting (#3131).** When the brace ends, the run is checked against every live rock that is
already on screen before the Carrier commits (`pathStrikesRock`, a pure, rng-free helper in
`asteroids.ts`). Each rock is projected in a straight line (`x + vx·t`, `y + vy·t`). The run is
sampled every 100 ms (`PATH_CHECK_STEP_MS`) and each segment is swept, with the same exact
closest-approach geometry as `asteroidThreatens`, against the circle that encloses the Carrier's
rectangular hitbox: half its diagonal plus a 4 px `PATH_CHECK_MARGIN`, so a corner graze counts.
The sweep gives the time the run would first touch each rock. A candidate is rejected only if it
strikes a rock that **holding station would not have met by then**. A rock that would reach the
Carrier on station no later than the run would reach it is ignored, because it is already on
course and still hits. A rock that would reach the station only later, after the run has flown
into it, still rejects the run. The Carrier tries fixed-order alternatives (`carrierRunCandidates`): the
planned run, the mirrored lean, then a shallower run (`ATTACK_RUN_SHALLOW_FACTOR`, 75% depth) with
the planned lean, then mirrored. All of them return to the same station. If every candidate is
blocked, the Carrier stays braced on station and re-checks each tick, with `runTimer` running below
zero. After `ATTACK_RUN_HOLD_MAX_MS` (1.5 s) it stands down and re-rolls its run timer. Only the
choice made at commit time changes. A rock that enters after the run is committed, a rock still off
screen, and two moving bodies that happen to meet are all out of scope, and they collide as before.

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

On the wave's last kill every Buddy switches to Leaving, through the pickup wait (#3132) and the
extraction. `weaponsFree` is false, so it fires nothing new. `hazardsLive` is true, so shots
already in flight can still damage it. A Buddy pickup collected during the wait launches and
stands down at once, as one collected during the extraction always has. The extraction
autopilot dodges shots aimed at Buddy (they are ordinary enemy shots), and Buddy and its shots are
never hazards to the player. `clearTransientCombat` removes every Buddy and every shot either side
fired, and `saveShape` persists Buddy's full state.

### Balance simulation (#2880)

`frontend/tooling/starswarm/` is a seeded, headless balance harness for Buddy. It drives the
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
- **Overrides.** The engine's sweepable tunables are a `Tuning` object (`engine/tuning.ts`;
  `DEFAULT_TUNING` is the shipped game), and `tick`, `initStarSwarm` and `applyPowerUp` take one
  (#2988). `tooling/starswarm/engineVariant.ts` binds the real engine's entry points to
  `DEFAULT_TUNING` plus a variant's overrides — no source is read or patched, and the shipped
  engine is never modified. Behaviour prototypes (the Carrier tracking Buddy, its run aimed at
  Buddy, Buddy's shot damage and lane floor) are `Tuning` knobs that are no-ops at their shipped
  defaults. An override naming something that is not a `Tuning` key throws, and the smoke test
  resolves every preset. The variants and presets are data in `tooling/starswarm/presets.ts`.

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
(`BUDDY_NOTICE_AIMED`), because `BUDDY_NOTICE` no longer covers shots aimed at Buddy.

The files follow the Hearts sim layout, and are ready for a regression gate (#2884):

| File                                 | Role                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tooling/starswarm/balance.ts`       | Pure and deterministic, with no output. `runCell` / `measureCell(engine, {scenario, difficulty, pilot, variant, seeds})` returns a plain `CellSummary`. |
| `tooling/starswarm/engineVariant.ts` | `loadEngineVariant(overrides)`: the real engine bound to a `Tuning` override set (#2988); `resolveTuning` validates the keys.                           |
| `tooling/starswarm/presets.ts`       | The variants (as `Tuning` overrides), `engineFor`, and the presets: `fast`, `baseline`, `offense`, `sensitivity`, `candidates`, `shipped`, `proposal`.  |
| `tooling/starswarm/report.ts`        | Markdown tables built from `CellSummary`.                                                                                                               |
| `tools/sim/simulate-starswarm.ts`    | The CLI.                                                                                                                                                |

The `fast` preset (3 seeds, two cells) is the jest smoke test in
`tooling/starswarm/__tests__/balance.test.ts`, which runs with `npx jest tooling/starswarm` in about 15 s. The
full runs use the CLI:

```bash
# from the repo root
npx --prefix frontend tsx tools/sim/simulate-starswarm.ts --preset baseline --jobs 4 --md /tmp/base.md --json /tmp/base.json
npx --prefix frontend tsx tools/sim/simulate-starswarm.ts --preset offense --jobs 4       # fan / pierce / damage, 3 runs fixed
npx --prefix frontend tsx tools/sim/simulate-starswarm.ts --preset sensitivity --jobs 4   # one-at-a-time sweeps
npx --prefix frontend tsx tools/sim/simulate-starswarm.ts --preset candidates --jobs 4    # survivability combos on the offense core
npx --prefix frontend tsx tools/sim/simulate-starswarm.ts --preset proposal --jobs 4      # pre-#2880 tuning vs the shipped one, same seeds
# filters: --seeds 200 --seed-base 0 --diffs Captain,Ensign --scenarios boss-exposed
#          --pilots autoplay,duel --variants base,hp8
npx --prefix frontend tsx tools/sim/simulate-starswarm.ts --merge /tmp/a.json,/tmp/b.json --md /tmp/all.md
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
the pickup wait or the wave-clear extraction, or on a boss wave; at most 2 in flight from timed spawns). It is a neutral
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
- The smart bomb clears rocks. Rocks in flight stay live through the pickup wait and the wave-clear
  extraction and are cleared by the hard reset before the next wave (#2842); none ever carries
  into a new wave. A large rock broken after the last kill can still drop salvage, and the wave
  waits for it (#3132).
- Dev panel: "Asteroids off" (timed spawns) and "Throw asteroid" (`throwAsteroid()` in the engine).
- Drawn as one of 4 Kenney meteor sprites (picked per rock, reused at both `large`/`small` sizes
  since collision uses the radius, not the art), spinning at `spin` rad/ms; falls back to the
  procedural rock outline while sprites load (#2573).

**Protected feature (#3131): do not remove or bypass.** Asteroids threaten enemies, enemies
shoot at and avoid them, and collisions damage enemies (`rocksStrikeEnemies`, called from
`resolveRockContacts`). No tier is immune beyond the armored Carrier's force field. Rocks never
deflect off a hull and always fly straight on. A rock already on course to hit a ship still hits
it. The #3131 fix only changes how the Carrier, Elites and Guardians _choose_ a path when they
commit a move (see _Attack run_ and _Enemy AI: asteroid response_). It never changes whether a rock
hurts them.

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

**Never steer into a passing rock (#3131).** The protected feature above stands: rocks threaten,
hit and damage every tier. On top of it, a ship holding station never _commits_ to a move straight
into a rock that would have passed it by:

- **Carrier attack run:** vetted when the brace ends. See _Attack run_ for the alternatives, the
  hold and the stand-down.
- **Elite and Guardian dives:** vetted at launch, when the wiggle ends. The dive's single `rng()`
  jitter is drawn exactly as before. The ship then tries rng-free variants in a fixed order
  (`diveCandidates`): the planned dive, the mirrored opening sweep, then the `LATE_NUDGE_PX` nudges
  (+60 px, then −60 px). All of them share the same endpoint. A variant is rejected only if
  `pathStrikesRock` says it strikes an on-screen rock that holding station would not have met by
  then (the same rule and hitbox circle as the Carrier's run). Only the part of the dive the ship
  actually flies is vetted: down to the depth where it hands over to Returning or Circling (60% of
  the canvas height for the shallow dives, 85% otherwise). **Known limit:** the return or circle
  that follows the dive is not vetted. If every
  variant is blocked, the wiggle continues, with `wiggleTimer` running below zero and a re-check
  each tick. The planned path is kept in `path` so nothing is redrawn. After `DIVE_HOLD_MAX_MS`
  (700 ms) the ship settles back into Formation. Seeded runs stay deterministic, and no new `Enemy`
  field is added, so saves are unaffected.
- **Grunts are unchanged**, as is everything after a path is committed (dodge, flinch, the late
  nudge). Only rocks that are already on screen are considered.

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

`frontend/tooling/starswarm/asteroidAwareness.ts` is a seeded headless sim over the real
`tick()` that measures each phase (threat, flinch, flak, dodge and hit rates, and how often a
"successful" dodge still collides) against a control run with dodge and flak disabled.
`measureAwareness()` is pure and returns plain data, so a future gate can diff it against a
baseline. Run the full sweep with
`SIM=1 npx jest tooling/starswarm/__tests__/asteroidAwareness.sim.test.ts`; the fast smoke runs
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
  cadence. The armored Carrier ignores rocks entirely. #3131: its attack run is vetted against
  on-screen rocks when it commits (see _Attack run_). Once committed, it is never steered.

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
identifies the player — once per run. Since #3251 it is supplementary: a breadcrumb is uploaded
only with an error that follows it, while every finished run's waves reach the backend as
[`wave_completed` events](#sending-wave_completed-3251). `EXPO_PUBLIC_TEST_HOOKS=1` builds also expose
`globalThis.__starswarm_getRunStats()` for an E2E driver.

## Per-wave stats

(#3245, epic #3244) The run-wide counters above say what happened in a run; the per-wave stats
say what happened in each wave, for tuning. They are observations only: nothing in play reads
them.

**Model.** `state.waveStats` (`engine/waveStats.ts`) is the current wave's accumulator, in
sections that match the `wave_completed` v1 schema pinned on epic #3244: `pacing`, `powerUps`,
`rocks`, `buddy`, `carrier`, `rout`, `combat` and `damage`, plus a `dev` flag. Every keyed table is
dense by construction — `emptyWaveStats()` builds it from the registries, so every key is present,
0 until counted. That also means a new registry value compiles without complaint and simply
counts 0: the guard that forces a real counter is the contract test (below), not the compiler.
(The compiler does hold a hand-written `Record` keyed by a registry type to list every value.)
Counters change through
`bumpWave(stats, path, n)`, copy-on-write like `bumpRun`: `path` is a typed tuple such as
`["combat", "kills", "Grunt", "shot"]` (a path that isn't a counter doesn't compile), and `n === 0`
returns the same object. Booleans and nullable fields (`rout.triggered`/`atMs`,
`carrier.stageReachedMs`) aren't counters, so they have typed setters (`markRouted`,
`markStageReached`). Every section is filled: #3245 `pacing`, #3246 `powerUps`, #3247 `rocks`,
#3248 `combat`/`damage`/`buddy` and #3249 `carrier`/`rout`.

- `pacing.durationMs` is the sum of `tick` dt over every phase of the wave, swoop-in to close
  (the screen's frozen pre-wave countdown isn't ticked, so it isn't counted).
- `pacing.start` is the ship's loadout (lives, guns, hull) when the wave opened; the snapshot adds
  `pacing.end`, the loadout when it closed. `pacing.bonusLives` counts bonus lives granted on it.
- `dev` is set when a dev-panel action touches the wave: `applyPowerUp`, `throwAsteroid` or
  `killEscorts` doing something, any dev toggle on during a tick (fire, rocks, dodge, flak, rout,
  straggler pause), or a run that opens past wave 1 (the wave jump). The dev panel's infinite
  lives is applied by the canvas, outside the engine: when it undoes a lost life the canvas flags
  the wave itself (`devRevert`, #3251; see [below](#sending-wave_completed-3251)).

**Power-ups** (#3246, `waveStats.powerUps`). Every pickup carries a `source` (`PowerUp.source`,
passed to `makePickup`), and its life is counted by type:

- `spawned[type][source]` — `kill`: the kill-count drop (`resolvePickupCollection`); `carrier`: hull
  plating from a dying Carrier (shot, rock or bomb); `rock`: salvage from a broken rock
  (`settleRocks`); `dev`: a dev-panel power-up (`applyPowerUp`, which has no falling pickup — it
  counts as spawned from `dev` and `collected` at once, so the books still balance). Some type x
  source pairs never happen (a bomb is never plating).
- `collected[type]` — the ship touched it. `missed[type]` — its despawn timer ran out or it fell
  off the bottom (`tickPowerUps`). `leftover[type]` — still on screen when the wave closed.
- `expired[type]` — a timed buff (lightning, shield) ran out. `activeMs[type]` — the ms a buff was
  live this wave. `shieldAbsorbed` — shots (bullets and rocks) the shield soaked this wave; the
  per-buff `activePowerUp.shieldAbsorbed` is unchanged.
  A buff replaced by a dev `applyPowerUp` (lightning or shield) isn't counted as `expired`: it
  didn't run out.
- **Conservation:** per wave and type, `spawned = collected + missed + leftover` (asserted over
  seeded multi-wave runs in `waveStats.powerUps.test.ts`).
- **Wave boundary.** Nothing carries across it, so there is no "carried in" case and no schema
  field for one: `buildWaveState` starts with no pickups and no active buff. Pickups on screen at
  a cleared close are `leftover` — counted where they are removed (`endPickupWait`, the #3132
  safety cap) or, failing that, at `startNextWave` just before the close; a died close counts the
  pickups on screen when the run ends. A running buff is cut off at the boundary: its ms stay in
  the wave they happened in, and it isn't `expired` (it didn't run out). A restore with fresh
  stats counts the pickups already falling as spawned.
- **Saves.** `source` is optional in a saved pickup and kept out of `SAVE_FINGERPRINT` (the
  `POWER_UP` spec omits it), so paused runs survive; a pickup without one reads as `kill`. The
  golden-replay hash leaves `source` out, like `waveStats`.
- The `[StarSwarm analytics]` `__DEV__` logs are gone; the dev panel's Run stats section shows the
  current wave's table.

**Carrier and rout (#3249).** Each counter is bumped beside its run-wide twin, so the run totals
`reinforced`, `routCaught`, `routEscaped`, `armorDeflects` and `beamHits` equal the sum of the
per-wave values (a test asserts it over a seeded multi-wave sim).

- `carrier.gruntsLaunched` — grunts a Carrier reinforcement launch sent (`reinforced`).
- `carrier.armorDeflects` — shots spent on the escorted Carrier's field, including rock strikes.
- `carrier.beamsFired` — beams actually released into play (a release held by the combat gate
  isn't counted); `carrier.beamHits` — beams that landed on the ship (plating or a life; a
  shield-absorbed beam doesn't count, as in `beamHits`).
- `carrier.attackRuns` — attack runs that left station (the brace's telegraph, or a brace that
  stands down without a clear path, isn't counted).
- `carrier.stageReachedMs[stage]` — ms into the wave (`pacing.durationMs` at that moment) when the
  Carrier was first seen at `protected`, `exposed` or `finalStand` during combat. `null` = never
  reached. On the wire a stage reached at 0 ms is sent as `0`, a `null` is left out. A boss wave's
  lone Carrier goes protected → final stand, so its `exposed` is `null`.
- `rout.triggered` / `rout.atMs` — the rout latched, and ms into the wave when it did (`null` if
  it never did). `rout.grunts` — grunts set fleeing (a reinforcement still swooping in counts when
  it lands); `rout.caught` — fleeing grunts killed by a shot or a Smart Bomb; `rout.escaped` —
  fleeing grunts that left off the top. `caught + escaped ≤ grunts`.
- A routed wave has no Carrier (the rout needs nothing but grunts left), so the two sections are
  mutually exclusive in practice. That is tested, not a schema rule.

**Registries.** `engine/registries.ts` holds the content lists as `as const` arrays, and the union
types are derived from them (`PowerUpType`, `EnemyTier`, `AsteroidKind`, `CarrierStage`), so a list
and its type can't drift. `stats.ts`'s `TIER_ORDER` is `ENEMY_TIERS` itself.

| Registry           | Values                                               |
| ------------------ | ---------------------------------------------------- |
| `POWERUP_TYPES`    | `lightning` `shield` `buddy` `bomb` `salvage` `hull` |
| `POWERUP_SOURCES`  | `kill` `rock` `carrier` `dev`                        |
| `ENEMY_TIERS`      | `Grunt` `Elite` `Guardian` `Carrier`                 |
| `ASTEROID_KINDS`   | `large` `small`                                      |
| `ROCK_BREAKERS`    | `player` `enemy` `bomb` `contact`                    |
| `HIT_CAUSES`       | `bullet` `rock` `beam` `ram` (what hit the player)   |
| `BUDDY_HIT_CAUSES` | `bullet` `beam` `rock`                               |
| `HIT_RESULTS`      | `life` `plating` `shield`                            |
| `KILL_METHODS`     | `shot` `dive` `rout` `bomb` `ram` `rock` `buddy`     |
| `CARRIER_STAGES`   | `protected` `exposed` `finalStand`                   |

The values are wire vocabulary: the backend mirrors them (`StarSwarmWaveStats`, #3250), so renaming
one is a schema change.

**Cross-checks (#3252).** `__tests__/waveStats.invariants.test.ts` plays a seeded run at every
difficulty tier and checks, per closed wave, that the sections agree with each other and with the
rest of the engine: `score.total` is the wave's `summarizeScoreLedger` total and the waves add up
to the final score; per power-up type `spawned = collected + missed + leftover`; per tier Σ kill
methods = the ships that died (escaped routed grunts excluded); `rout.caught + rout.escaped ≤
rout.grunts`; lives lost = start lives − final lives + bonus lives; `pacing.end` of a wave =
`pacing.start` of the next; the paired counters match (`rocks.playerHits` = `damage.hits.rock`,
…); and the waves sum to every run-wide `RunStats` / `TierStats` counter they share. The runs
are steered (dev-panel Smart Bombs and Buddies, thrown rocks moved onto Buddy and onto the ship
with a shield or plate armed in turn, a first wave that opens with only its grunts so it routs,
and a long Ensign run that earns a bonus life), and the test asserts that a listed set of
counters is non-zero in some run: rout grunts, caught and escaped; Buddy's shots drawn, kills,
rock hits and losses; Smart Bomb kills; rock hits on the ship for each result; bonus lives; and a
few more. Counters off that list (a ram kill, for one) may be 0 in every run, so the invariants
over them hold trivially there; the golden replay has a ram kill. The per-wave checks live in
`__tests__/helpers/waveInvariants.ts`. The golden replay (seed 42) runs them over its own closed
waves, pins each scenario's closed waves and leaderboard result in
`__fixtures__/golden-replay-seed42.waves.json`, and checks that the score, wave and gameplay hash
are those the fixture held before the per-wave stats existed.

Every number in a snapshot, and so on the wire, is an integer: `closeWave` rounds all ms and counter
values once at close (the live accumulator keeps the fractional dt), because the backend takes
`StrictInt` and drops the whole event otherwise.

**Close points.** A wave closes exactly once, into a frozen snapshot (`closeWave(state, outcome)`)
kept on `state.lastClosedWave`:

- **cleared** — when its extraction completes, before the next wave is built (`startNextWave`);
  the next wave opens with fresh `waveStats`.
- **died** — when a tick's final phase is GameOver. `tickBonusLives` can revert a same-tick
  GameOver, so the close waits for the end of the tick; GameOver is terminal, so it can't close
  twice. `damage.deathCause` holds the cause of the hit that took the last life (see the
  combat counters below).

The snapshot is `{v: 1, wave, difficulty, outcome, dev, pacing, score, …sections}`. `score` is read
from the score ledger, never counted twice: `pts` is that wave's ledger entry (`{}` if it scored
nothing), `total` its sum, and `runningTotal` the run's score at the close.
`waveJustClosed(prev, next)` returns the snapshot on the tick a wave closed (compare
`routJustStarted`). At each close the engine also appends the snapshot's wire form
(`toWirePayload`) to `state.closedWaves`, the run's list of closed waves, oldest first (#3251):
carried across waves like the score ledger, `[]` on a new run.

**Wire rules.** `toWirePayload(snapshot)` keeps every top-level section but drops zero counters
and objects left empty inside them (the backend reads a missing key as 0). `v`, `wave`,
`difficulty`, `outcome`, `dev`, `pacing`, `score`, `rout` and `damage.deathCause` are always sent
whole. `carrier.stageReachedMs` holds times, not counters: a stage never reached (null) is left out,
one reached at 0 ms is sent. A payload is at most `WAVE_STATS_MAX_BYTES` (4096) serialized; the
worst case — every counter at 99999, every score source on the wave — measures about 3.7 KB.

**Saves.** `waveStats` is saved with a paused run; `lastClosedWave` is not written to disk, and a
restore always sets it to null (`restoreSavedState`), whatever an older save holds — a restored
run has nothing to compare it with, so no close is reported after a restore. Both are
observations, so they are kept out of `SAVE_FINGERPRINT` (`ADDED_STATE` in `saveShape.ts`):
adding them didn't discard paused runs. A save without `waveStats` — or with stats that don't fit
this build (a registry key missing or extra, a negative or non-numeric counter or time, a death
cause outside `HIT_CAUSES`, guns outside 1–3, hull outside 0–2, or lives that aren't a
non-negative integer) — restores with fresh stats
seeded from the restored ship. `closedWaves` (#3251) is saved too, also in `ADDED_STATE`; it
restores as saved when every entry looks like this build's wire form (its keys, `v` 1, a known
difficulty and outcome, `wave` ≥ 1, only non-negative counts, waves in order), else as `[]` — an
older save, or one that doesn't fit, loses the waves closed before it rather than sending
anything invalid.

### Wave timeline diagnostics (#3391)

**Status: design, pending approval (#3391, epic #3390). Not implemented.** The per-wave stats
above count what happened in a wave. A proposed second, additive event, `wave_timeline`, would
record when the wave's major transitions happened, in order: plating and life damage with cause and
quantized X, the terminal entry, phase changes, Carrier stages and its death, and selected power-ups.
It would hold at most 32 small integer entries a wave, stamped with the wave's gameplay clock, and
be gated by the replay dial. It does not change `wave_completed` or anything described here. The
schema, budget, trigger points, caps and test plan are in
[Star Swarm diagnostics: the wave timeline](starswarm-diagnostics.md).

### Sending wave_completed (#3251)

Nothing is sent during play. The engine collects the run's closed waves on `state.closedWaves`
(`engine/closedWaves.ts`), and when the run ends the screen queues them all as `wave_completed`
events on the run's session, oldest first, so SyncWorker sends them with the run's other events
in one batch (`GAME_EVENT_BATCH_SIZE` 200) instead of a request per wave. A run ends one of two
ways:

- **Game over.** The waves are queued in `StarSwarmScreen`'s game-over path, before
  `syncComplete` queues `game_ended`, so their `event_index`es come first. The engine closes the
  final wave as `died` on the GameOver tick, before the canvas calls `onGameOver`, so it is
  already in the list, last.
- **Abandoned for a new run.** Every new run starts through `startRun` — the picker's Start (after
  the header's or the pause overlay's New Game, or a difficulty change), the card's Play Again
  and the dev panel's New Game. Before `startRun` restarts the session (which abandons the old
  one), it queues the old run's closed waves on the **old** run's session, ahead of the abandon.
  The wave the run was on never closed, so it isn't sent.

Details:

- **Once per run.** A per-run flag (like the run-stats breadcrumb's) means the waves are queued
  once: a second game-over call (the E2E hook's `endRun`, say) or the Play Again after a game over
  queues nothing more; a new run re-arms it.
- **Pause, restore, app kill, leaving the screen.** The list is part of the run's state, so a
  pause saves it and a restore — in the same process or after the OS killed the app — brings it
  back; the restored run sends every wave when it ends, the ones closed before the pause included.
  Leaving the screen mid-run normally pauses and saves the run (its session is abandoned, nothing
  is sent): the waves go out when the run is restored and then ends, or is abandoned for a new
  one. Nothing is sent twice, since nothing is sent before the run ends and a run ends once. A run
  that is killed (or left) and **never resumed** — its session swept as abandoned — sends none of
  its waves: that loss is accepted. **Known gap (#3270):** while the header's New Game picker
  covers a live run, Back or an app kill doesn't save it, so that run — and its waves — is lost
  today.
- **Caps.** One wave's payload is at most `WAVE_STATS_MAX_BYTES` (4096, the backend's cap; the
  event queue's own per-row cap, `MAX_EVENT_PAYLOAD_BYTES`, is 8 KB), and a run's waves together
  at most `WAVE_STATS_RUN_MAX_BYTES` (64 KB, the sum of their `JSON.stringify` lengths). Both
  are defined with the other recording caps in `game/_shared/eventQueueConfig.ts` (#3274; the
  engine re-exports them). A wave
  over the per-wave cap is never sent; the rest go oldest first until the next one would pass the
  run cap, and no later wave is sent after that. The engine already keeps the list within these
  caps (`collectClosedWave`), so memory and the pause save stay bounded however long the run: a
  wave it can't keep is counted in `state.closedWavesOverflow` (waves, bytes, largest wave's
  bytes, and whether the run cap closed the list), saved with the run like `closedWaves`
  (`ADDED_STATE`, `NO_OVERFLOW` if missing or invalid). The kept list's size is a running total,
  `state.closedWavesBytes`, so a close serializes only the new wave; a restore recomputes it from
  the restored list. **The shared recorder is the send (#3280).** The screen runs
  `useGameRecorder("starswarm", { policy: "on_session_end" })` (a `useGameSync` plus
  `game/_shared/gameRecorder.ts`, [GAME-CONTRACT §2.10](../GAME-CONTRACT.md#210-recording-gameplay))
  and, from `sendClosedWaves` (the game-over and abandon hook, never the tick or render loop),
  calls `record("wave_completed", { ...wave })` for each closed wave in order. The recorder holds
  them in memory and saves them in **one** `enqueueEvents` call when the session ends
  (`syncComplete` / `syncRestart` / unmount), ahead of `game_ended`. It applies the caps from
  `gameEventRegistry.starswarm` in `eventQueueConfig.ts` (`maxBytes` 4096 for the type,
  `sessionMaxBytes` 64 KB), so there is no Star Swarm copy of them. `wave_completed` is
  registered with `envelope: false`: the payload goes out exactly as the engine built it, with no
  `unit`, `t_ms` or `actor` added and no `v` rewritten, and the caps measure that same JSON. If a
  wave is left out the **recorder** sends one throttled Sentry warning for the session
  (`gameRecorder: recorded events over the size caps not saved`, tag `subsystem: gameRecorder`,
  `game_type: starswarm`) with counts and sizes only (`recorded`, `saved`, `dropped_oversize`,
  `dropped_session_cap`, `saved_bytes`, `largest_bytes`, ...). Waves the engine itself left off
  are reported by the screen, throttled to one per app session
  (`captureThrottledMessage`, key `starswarm.waveStats.engineDrop`, message
  `starswarm: wave_completed events over the payload caps not sent`, tag
  `subsystem: starswarm.waveStats`; `engine_dropped`, `engine_dropped_bytes`). With no game session open at the run's end, nothing is recorded (as
  `syncEnqueue` was a no-op then), so no wave is carried into the next run.
  At the measured worst case (about 3.7 KB a wave) 64 KB holds 17 waves; a typical wave is a few
  hundred bytes. Tests: `waveRecorder.test.ts` (payload identity, nothing in the frame loop),
  `waveEvents.test.ts` (the caps through the recorder), `StarSwarmScreen.waves.test.tsx`.
- **Isolated.** Queueing the waves runs inside a try/catch (a failure goes to Sentry with
  `subsystem: starswarm.waveStats`), so it can never stop `syncComplete` from recording the run or
  its leaderboard row.
- **Dev flag.** Dev-panel actions flag the wave in the engine (above). The dev panel's infinite
  lives undoes a lost life after `tick` — by then a run-ending hit has already closed the wave as
  `died` — so the canvas (native and web) flags the wave's stats `dev` and, if that tick closed a
  wave, marks that `closedWaves` entry (and `lastClosedWave`) `dev: true` too. The reverted
  `died` entry is still sent, flagged, and so is the same wave's later `cleared` close: two
  entries for one wave number, both `dev`. Filter on `dev` to leave them out.

### Rock counters (#3247)

The counter paths and the helpers that bump related counters together live in
`engine/waveCounters.ts`; the scenarios are in `__tests__/waveStats.rocks.test.ts`.

- `rocks.spawned[kind]` — every rock that entered play: timed spawns (`tickAsteroids`) and dev
  throws (`throwAsteroid`). **Dev-throw rule:** a dev throw counts in `spawned[kind]` _and_ in
  `rocks.devSpawned`, so `spawned` is everything that entered play and `devSpawned` the subset the
  dev panel threw. The two halves a broken large rock splits into are not spawns (the run-wide
  `rocksSpawned` doesn't count them either), but their own breaks do count in `broken`, so
  `broken` can exceed `spawned`. Σ `spawned` over a run's waves = `runStats.rocksSpawned`.
- `rocks.broken[breaker]` — each rock counts once, when its HP reaches 0, by what did it:
  - `player`: player-owned shots that finished it (`absorbBulletsIntoRocks` in
    `resolveRockContacts`) — Buddy's burst shots are player-owned and included, as they are in
    `runStats.rocksBrokenByPlayer`;
  - `enemy`: enemy shots, flak included (= `runStats.rocksBrokenByEnemy`);
  - `bomb`: every rock still whole when a Smart Bomb goes off, collected or from the dev panel (a
    rock a shot already broke earlier in the same pass is the shot's);
  - `contact`: a rock that shattered on impact — a rock on the player's hull (absorbed by the
    shield or not), a small rock on an enemy ship, any rock on the escorted Carrier's force field,
    and a small rock on Buddy. A large rock that strikes a ship or Buddy flies on and isn't broken.
- `rocks.enemiesStruck[tier]` — strikes that damaged a ship (the run-wide `tierStats[tier].struck`
  for the wave); `rocks.enemiesDestroyed[tier]` — the strikes that took its last HP, which are
  also `combat.kills[tier].rock`. A rock shattering on the escorted Carrier's field is a deflect
  (`carrier.armorDeflects`), not a strike. `rocksStrikeEnemies` reports the kills and shatters for
  counting only; what a strike does is unchanged (the #3131 PROTECTED FEATURE).
- `rocks.playerHits[result]` — the same events as `damage.hits.rock[result]` (see the multi-hit
  rule below).
- `rocks.buddyHits` / `rocks.buddyDestroyed` — the same events as `buddy.hits.rock` /
  `buddy.destroyed.rock`.
- `rocks.dodge[tier]` — `rolls`, `dodged`, `pathRolls`, `pathDodged` and `flak`, bumped beside
  every run-wide `tierStats` bump (`tickAsteroidThreats`, and the Carrier's diverted flak volley in
  `tickEnemies`), so Σ over a run's waves = `tierStats`.

### Combat, damage and Buddy counters (#3248)

The scenarios are in `__tests__/waveStats.combat.test.ts`, with the seeded multi-wave invariants.

- `combat.spawned[tier]` — the roster the wave was built with (counted at open), plus the
  Carrier's reinforcements as `Grunt` (the same launches `carrier.gruntsLaunched` counts).
- `combat.kills[tier][method]` — one per ship death. The method is `killMethod(mod, by)` in
  `scoreLedger.ts`, next to `scoreSource`: the kill's ledger modifier where it has one (`dive`,
  `rout`, `bomb`, `ram` — `KillModifier` is a subset of `KillMethod`, so they can't disagree),
  `shot` for a plain shot kill, and `rock` / `buddy` for the killers the modifier doesn't name. A
  Buddy shot's kill is `buddy` whatever phase the ship was in, though it still scores under the
  shot's ledger source. For each tier, Σ methods = ships of that tier that died on the wave; a
  routed Grunt that escapes didn't die, and the dev panel's `killEscorts` isn't counted (its wave
  is flagged `dev`). Combinations that can't happen: Carrier × `dive` / `rout` / `ram`, and
  Elite / Guardian × `rout` (the contract rows list them as `UNREACHABLE`).
- `combat.shotsFired` — the player's bullets as each trigger pull spawns them (`tickPlayer`);
  `combat.shotsHit` — those bullets that damaged a ship, once per bullet on the first ship it
  damages (a piercing shot through three ships is one hit; a shot the Carrier's field deflects is
  none), so `shotsHit ≤ shotsFired`; `combat.shotsOnRocks` — those bullets spent on rocks. Buddy's
  shots are not the player's and count in none of the three. The three don't partition
  `shotsFired`: a piercing shot that hits a ship and is then absorbed by a rock counts in both
  `shotsHit` and `shotsOnRocks`, so only `shotsHit ≤ shotsFired` holds.
- After a restore, wave stats that start fresh (an older save, or stats that don't fit this build)
  — and kept stats from a build before #3248, whose `combat.spawned` is all 0 — take the saved
  roster, every ship of the wave alive or dead, as `combat.spawned`, so the kills still to come
  have spawns to match (`restoreSavedState`).
- `damage.hits[cause][result]` — hits on the player as `resolvePlayerHit` resolves them.
  **Multi-hit rule:** the shield takes every projectile, and each counts — one `shield` hit per
  bullet, rock and beam it absorbed. Anything that gets through costs one plate or one life for the
  whole tick however much landed, so it is one hit, charged to one cause: the ram (a ram only
  lands alone or beside absorbed projectiles), else `beam` > `rock` > `bullet`. The other
  projectiles that landed on that tick are spent but count no hit (a rock among them still counts
  as a `contact` break). The shield never takes a ram, so `ram` × `shield` can't happen.
  (`powerUps.shieldAbsorbed` counts bullets and rocks only, so it is Σ `shield` less the beams.)
- `damage.deathCause` — the cause of the hit that took the last life, set when it lands; a
  same-tick bonus life that rescues the ship clears it again. Null on a wave closed `cleared`.
- `buddy.launched` — pickups collected and dev-panel launches (= `runStats.buddyLaunched`).
- `buddy.hits[cause]` — every enemy shot, Carrier beam and rock that landed on a Buddy, the fatal
  ones included; `buddy.destroyed[cause]` — each Buddy lost, charged to the cause whose damage
  brought it to 0 HP in resolution order (shots, then beams, then rocks). `resolveBuddyHits`
  returns both; Σ `destroyed` = `runStats.buddyLost`.
- `buddy.shotsDrawn` — enemy shots diverted at Buddy (= `runStats.buddyShotsDrawn`);
  `buddy.kills[tier]` — the same kills as `combat.kills[tier].buddy`.

### Adding content

This checklist is for the `wave_completed` payload vocabulary. A new Star Swarm event _type_ is a
different change: see [Adding an event type](../GAME-CONTRACT.md#adding-an-event-type) (the app's
`gameEventRegistry`, a seeding migration and a validation decision, held together by
`backend/tests/test_event_registry_contract.py`).

**Checklist: adding a power-up, enemy tier or hit cause** (or any other registry value). Each step
has a test that fails until it is done:

1. **Registry entry** — add the value to its array in `engine/registries.ts`. The stats tables pick
   it up on their own (at 0), so the build passes; only hand-written `Record`s keyed by that type
   fail to compile until they list it. The values are wire vocabulary, pinned by the "hold the v1
   schema's values" test in `__tests__/waveStats.test.ts`: update it in the same change.
2. **Counter** — count it where it happens with `bumpWave` (on a hot path, hoist the path as a
   `const` tuple; see `engine/waveCounters.ts`). A power-up needs its spawn (with a `source`) and
   collect / miss / leftover counted, an enemy tier its spawns and kills, a hit cause its hits.
   Where a run-wide `RunStats` / `TierStats` twin exists, bump both together:
   `__tests__/waveStats.invariants.test.ts` checks that the waves sum to it, and that the other
   cross-section invariants (power-up conservation, kills = deaths, lives, score, pacing) still
   hold at every difficulty tier.
3. **Contract row** — this is the guard. `__tests__/waveStats.contract.test.ts` fails, naming the
   value and the row file (`__tests__/waveStatsContract/<section>.ts`) that needs a row proving the
   new value is counted (an enemy tier needs one in each of `rocks`, `buddy` and `combat`). A
   section's `pending` list spells out values one by one (it is never derived from the
   registries), so a value added later is never silently pending. A new section field needs a row
   too.
4. **Backend Literal** — add the value to its `Literal` in `backend/starswarm/models.py`
   (`StarSwarmWaveStats`, #3250), or the server logs it as unknown.
5. **Registry fixture** — add it to `backend/tests/fixtures/starswarm_wave_stats_v1_registries.json`.
   Two parity tests read that file (#3252): the app's `__tests__/waveStats.parity.test.ts` fails
   until it equals `registries.ts` exactly, and the backend's
   `tests/test_starswarm_wave_stats_parity.py` fails until the `Literal` sets cover it — so a value
   added on one side only fails CI, with a message naming the file to edit. Also add the value to
   the sample payload, `backend/tests/fixtures/starswarm_wave_stats_v1.json`, in the table its
   registry is read from (e.g. `powerUps.collected`, `combat.spawned`, `damage.hits`): the
   backend's `test_the_fixture_has_a_key_from_every_registry` requires each of those key sets to
   equal its `Literal`.
6. **Golden fixtures** — re-record the golden replay (`UPDATE_GOLDEN=1`, see
   `goldenReplay.test.ts`) if the change moves a counter in it
   (`__fixtures__/golden-replay-seed42.waves.json`, the replay's closed waves and leaderboard
   result) or alters play (`golden-replay-seed42.json`), and say which in the PR.
7. **`v` bump — only if the shape changes.** A new value in an existing keyed table is not a shape
   change (the backend keeps unknown table keys). A new section, field or table, a rename, or a
   changed meaning is: bump `WAVE_STATS_VERSION` on both sides in the same release (see
   [wave_completed event (backend)](#wave_completed-event-backend)).

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
- **Tie-break:** none declared. Equal scores go to the entry the server received first (`received_at`), the last tie-break on every board.
- **Partitions:** `difficulty_tier`: each of the ten tiers in `DIFFICULTY_TIERS` (`backend/starswarm/models.py`) is its own board, and only those tiers have one (`partition_values`). A row with no tier counts as `LieutenantJG` (`partition_defaults`). A row with any other tier is stored but never ranks.
- **Recorded, not partitioned:** result (`StarSwarmResult`): `outcome`, `wave_reached` and `score_breakdown` (#2837, [above](#per-wave-score-breakdown-2837)) (`difficulty_tier` is repeated there too). The owner reads them back in `metadata` from `GET /games/{id}`.
- **Max value:** none (#2519 decision 14).
- **Outcomes:** `has_winner = False`: a run ends when the ship is lost. Game over records `completed` (score-only, no win) with `final_score` and the result `{outcome, wave_reached, difficulty_tier, score_breakdown}` (#2626, #2837). Starting another run while one is open, or leaving the screen, records `abandoned` with no result and no score.
- **Duration:** `useGameSync`'s active-play window. The screen sends no `durationMs` of its own (never `0`): the engine keeps no run clock (the per-wave `pacing.durationMs`, [above](#per-wave-stats), is for the wave stats only). The window restarts when a run begins (`beginRun`), so time on the difficulty picker is not counted.
- **How it reaches the server:** since #2626 the run's own `useGameSync("starswarm")` session row is its leaderboard entry. The row opens when the run begins, with `difficulty_tier` as creation metadata. `SyncWorker` sends `POST /games` and `PATCH /games/{id}/complete`. If the player has a display name (`PUT /players/me`), the row ranks with no further step. Each tier's board shows each named player's best run on that tier once. The legacy `POST /starswarm/score` was removed in #2644. Shared rules: [Leaderboard routes](../GAME-CONTRACT.md#leaderboard-routes-2618).
- **Where the player sees it:** the result card reads the run's rank on its tier's board through `lookupGameRank` (`GET /games/{id}/rank`). It asks for a display name only when the player has none. The card's "View leaderboard" link and the ⋯ menu open the Leaderboard screen (#2633) on the finished run's tier, else the current tier. Stats (#2635) are in the ⋯ menu. The device keeps the best score (`game/starswarm/bestScore.ts`) for the card's "Best" and "New best". Store builds hide Star Swarm (`HIDDEN_GAMES`, `frontend/src/entitlements/gameVisibility.ts`), so there it has no leaderboard or stats entry point.

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
- The run's closed waves (`closedWaves`) are saved with it and sent when the run ends, at game
  over or when a new run abandons it (#3251, [Sending wave_completed](#sending-wave_completed-3251)).
- New Game / finish / abandon clears the saved run as appropriate.

This replaces the old, incorrect statement that Star Swarm had no local resume state.

## Client-Side Engine

- Location: `frontend/src/game/starswarm/engine.ts`, a barrel over the `engine/` package ([ARCHITECTURE.md §3.4](../ARCHITECTURE.md#34-star-swarm-engine-layout-2988)); determinism and the engine counters are in [§3.2](../ARCHITECTURE.md#32-determinism-rng-and-counters-2985-2999)
- Screen: [`frontend/src/screens/StarSwarmScreen.tsx`](../../frontend/src/screens/StarSwarmScreen.tsx) (its header lists the screen's concerns; see [GAMEPLAY_STANDARDS §8](../GAMEPLAY_STANDARDS.md#8-screen-layer))
- Rendering: `@shopify/react-native-skia` on native, Canvas 2D on web (`GameCanvas.web.tsx`)

### Native rendering pipeline (epic #2562)

The engine (`engine.ts`, a re-export barrel over the `engine/` package — see
[ARCHITECTURE.md §3.4](../ARCHITECTURE.md#34-star-swarm-engine-layout-2988)) is pure and ticks
on the JS thread in the canvas's RAF loop. Every
drawing decision for the native canvas lives in `render/frame.ts`: `buildFrame(state, { loaded,
width, height })` returns a flat, back-to-front display list of primitive ops (`fill`, `rect`,
`circle`, `image`, `poly`) — plain data, no Skia objects. Colours are packed `0xAARRGGBB`
numbers, and op keys are built only for tests (#2963). Sprite-vs-fallback choices, the
Carrier's armor ring, hit-flash bursts, the Carrier's beams and telegraphs (`render/carrier.ts`,
shared with the web canvas), the invincibility
blink and the #2334 hidden-ship-at-game-over rule are all decided there and unit-tested in
`__tests__/frame.test.ts`. `render/drawFrame.ts` replays the ops and decides nothing (see below).

`render/publish.ts` gates when a frame is published at all (#2563): only when something drawn
changed, so a paused or finished game does not re-render.

The background and starfield are not in the display list (#2963). The star layout is fixed for a
canvas size, so `render/starfieldPictures.ts` records it once — the background plus one Picture
per depth layer — and `components/starswarm/StarfieldLayers.tsx` draws them under the scene,
sliding each layer by its own offset (`layerOffset`) from a scroll clock the loop writes to a
shared value. Each layer is drawn twice, a canvas-height apart, so stars wrap at the bottom. A
frame where only the stars move is therefore never published.

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
and its dev switch after the side-by-side device measurement in `PERFORMANCE.md`. The web renderer (secondary platform) still
derives the same rules itself.

The dev panel's _Frame readout_ switch (#2567) shows frame-time average and p95 and the canvas's
React commits per second over the game. See
[`TESTING.md`](../TESTING.md#star-swarm-reading-the-frame-readout-2567) for how to read it and
[`PERFORMANCE.md`](../PERFORMANCE.md#star-swarm-native-renderer-2567) for the measured numbers.

## Backend

- Module: `backend/starswarm/module.py`, registered in `backend/games/registry.py` (#2623)
- Metadata model: `StarSwarmMetadata` in `backend/starswarm/models.py` — `difficulty_tier` only (extra keys forbidden)
- Result model: `StarSwarmResult` — `outcome`, `wave_reached`, `difficulty_tier`, `score_breakdown` (`StarSwarmScoreBreakdown`, #2837), all optional; unknown keys are ignored. A `score_breakdown` that doesn't validate (over 64 waves or 48 sources a wave, a source over 32 characters, a non-integer) is dropped to `null` and the run still completes and ranks
- Tiers: only a `difficulty_tier` in `DIFFICULTY_TIERS` (`backend/starswarm/models.py`) has a board — `Ensign`, `LieutenantJG`, `Lieutenant`, `LieutenantCommander`, `Commander`, `Captain`, `RearAdmiral`, `ViceAdmiral`, `Admiral`, `FleetAdmiral`, the client's `DIFFICULTY_TIERS` (`frontend/src/game/starswarm/engine/tuning.ts`). Creation and completion accept any other string up to 32 characters (`captain`, a forged tier) and store it, so the run is never dead-lettered; that row never ranks, and naming it or requesting its board is a 400. `tests/test_starswarm_module.py` parses the client list and fails if the two drift, so **a tier added to the app must be added to the backend in the same release**, or its runs stay off the leaderboard. A missing or `null` tier is allowed
- Board: `final_score` desc, one board per `difficulty_tier` (`GET /games/leaderboard/starswarm?difficulty_tier=Captain`), no cap. A row with no tier counts as `LieutenantJG` (`DEFAULT_DIFFICULTY_TIER`), and a request without `difficulty_tier` is the `LieutenantJG` board; an unknown tier is a 400. `has_winner = False`
- Stats: default pass-through `stats_shape` (inherited from `GameModuleBase`, `default_stats_shape`)
- Endpoints: none of its own — the generic `/games` routes. The legacy `POST /starswarm/score` (unused since #2626) and `GET /starswarm/leaderboard` (unused since #2633, when the Ranks tab moved to the shared `LeaderboardScreen`; the tab itself was retired in #2634) were removed in #2644
- Scoring: each run's session row (`useGameSync("starswarm")`) completes with its `final_score` and is the leaderboard entry on its tier's board (#2626); see [Scoring](#scoring)

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

## wave_completed event (backend)

Star Swarm sends one `wave_completed` gameplay event per wave, all queued when the run ends (epic
#3244; event type seeded by migration `0034`; client side:
[Sending wave_completed](#sending-wave_completed-3251)). The backend validates it through the module's `validate_event` hook
(`backend/starswarm/models.py`, `StarSwarmWaveStats`); a sample payload is
`backend/tests/fixtures/starswarm_wave_stats_v1.json`, and the registry vocabulary both sides are
checked against is `backend/tests/fixtures/starswarm_wave_stats_v1_registries.json` (#3252, see
[Adding content](#adding-content)).

- **Schema version.** `v` must be `1`. A breaking change to the shape bumps `v` and the backend
  must learn the new version in the same release; an unknown `v` is dropped.
- **Sparse wire form.** Zero counters are omitted; a missing key means 0. The stored `data` is the
  wire form as sent (nothing is densified).
- **Unknown keys.** Inside a keyed table (a new power-up type, say) they are kept and logged.
  Unknown top-level or section keys are dropped.
- **Size cap.** 4096 bytes of compact JSON (`json.dumps(data, separators=(",", ":"))`).
- **Drop.** An oversize payload or a schema violation (wrong type, negative or oversized counter,
  missing `v`/`wave`/required section, `wave` < 1, bad `outcome`) drops that event only. It is
  logged and sent to Sentry (field paths and error types, never values); the rest of the batch is
  stored and the response is 2xx, so the client's queue drains.
- **Flag.** An inconsistent but well-formed event is kept with a top-level `_flags` list:
  `score_mismatch` (`score.total` != sum of `score.pts`) or `powerup_collected_exceeds_spawned`.
  A client-sent `_flags` is discarded. Readers that ignore unknown keys are unaffected.

## wave_timeline event (backend)

The critical-event timeline (epic #3390, design in [starswarm-diagnostics.md](starswarm-diagnostics.md))
is sent as one `wave_timeline` event per kept wave close, after the run's `wave_completed` events.
Event type seeded by migration `0046_starswarm_wave_timeline`. The module's `validate_event` routes it to
`validate_wave_timeline` (`backend/starswarm/timeline.py`). The contract fixture, read by the backend
and (from #3392) by the app, is `backend/tests/fixtures/starswarm_wave_timeline_v1.json`: the code
table, index lists, limits, the three worked examples, a worst case and one `invalid` case per check.

**Deploy order: backend before app.** `append_events` answers `400 unknown_event_type` for a type that is
not seeded, and the app's queue then holds the batch. So the release that carries
`0046_starswarm_wave_timeline` must be live before any app build that sends `wave_timeline`. Older apps
never send it and are unaffected: `wave_completed`, `game_ended` and the leaderboard are untouched, and the
migration is additive (its downgrade deletes only `wave_timeline` rows).

- **Schema.** `v` 1, `ev` 1..65535 (stored, not interpreted), `wave` 1..65535, `outcome` `cleared` or `died`,
  `dev` bool, `ovf` three ints in 0..65535, `e` 1..32 entries `[t, code, ...params]` of plain ints
  (a bool or float is refused). Known codes have a fixed arity and parameter ranges; `t` is 0..65535 and
  non-decreasing; there is exactly one terminal entry (code 8 for `cleared`, 9 for `died`), and it is last.
- **Size cap.** 1,024 bytes of compact JSON per event.
- **Drop** (that event only; the batch is 2xx and the other rows are stored): oversize, any schema
  violation, a known code with the wrong arity or range, `t` decreasing, more than 32 entries, a missing,
  repeated, non-final or mismatched terminal entry. Logged per event. Sent to Sentry **at most once an hour
  per reason** (`oversize`, `invalid`), with a field path (`outcome`, `e.2.3`) and the reason, never values.
- **Keep and flag** (a top-level `_flags` list): `unknown_code` (a code this build does not know, 2 to 6
  ints in 0..65535, so an app ahead of the backend loses nothing), `quota` (more than 8 power-up or 8
  transition entries, or 31 ordinary entries without a lethal `LIFE_LOST`), `duplicate_entry` (two
  identical consecutive entries). A client-sent `_flags` and unknown top-level keys are not stored.
- **Storage.** An ordinary replay row. The server enforces `replay_enabled` and the
  `REPLAY_RECORDING_ENABLED` kill switch; `replay_sample_rate` is applied on the client (from
  `/games/catalog`), as for every replay type. No new switch. Counted in `STARSWARM_CAP` (264 events / 149,500 B), pruned after
  `REPLAY_RETENTION_DAYS` (30). It is **not** on the retention keep-list, so `wave_completed` stays.
- **A refused timeline ends the stored replay at its index**, like any refused replay row. The app
  sends every `wave_completed` first, so only later timelines are lost.
