# Star Swarm diagnostics: the wave timeline

**Status: design approved (#3391, owner decisions D1-D10 in #3409, epic #3390). Backend implemented (#3394);
the engine, recorder, reader and benchmarks are not yet.** The
stories that build it are #3392 (engine capture), #3393 (recording, pause and resume), #3394
(backend validation and event-type migration), #3395 (timeline reader) and #3396 (benchmarks,
goldens and docs). Every byte and volume figure below is an **estimate**, computed from the
worked examples in this page, and #3396 replaces it with measured numbers. The choices that need
the owner's sign-off are listed in [Open decisions for the owner](#open-decisions-for-the-owner).

## Purpose and non-goals

`wave_completed` ([per-wave stats](starswarm.md#per-wave-stats), epic #3244) says **how much**
happened in a wave: counts by cause, tier and type. It cannot say **in what order** or **when**.
Did the ship lose its plating before or after the shield ran out? Was the fatal ram during combat
or during the AI extraction? Did the Carrier's final stand start before the life was lost? The
wave timeline answers those questions. It is a short, fixed-capacity list of the wave's major
transitions, each stamped with the wave's own gameplay clock.

This is the epic's tier B. Tier A is `wave_completed`, which this design leaves unchanged. Tier C,
deterministic frame replay, is dev-only and out of scope.

Non-goals:

- **Not a replay.** You cannot rebuild a wave from its timeline. It has no input stream, no rng
  state and no per-frame positions.
- No per-shot, per-kill, per-AI-action or per-drag-sample entries. Anything `wave_completed`
  already counts is left out unless its timing is the point (see
  [What is not recorded](#what-is-not-recorded)).
- No near-death movement trace in v1. That is a separate, deferred path:
  [Near-death movement context](#near-death-movement-context-deferred).
- No change to gameplay, scoring, the `wave_completed` schema, `game_ended`, the leaderboard or
  the replay UI.

## Summary

| Item             | Design                                                                                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Event type       | `wave_timeline`, schema `v` 1, registered with `envelope: false` and `tier: Priority.REPLAY`                                                                                             |
| One per          | kept wave close (same `wave` and `outcome` as its `wave_completed`). Recommended: the terminal wave plus every damaged cleared wave (D1)                                                 |
| Entries          | arrays of small non-negative ints `[t, code, ...params]`; the arity is fixed per code; 12 codes in v1                                                                                    |
| Time base        | `t` = gameplay time into the wave in **deciseconds** (100 ms), from `waveStats.pacing.durationMs`. Never wall clock                                                                      |
| Capacity         | 32 entries a wave: 30 ordinary slots (power-ups at most 8, transitions at most 8, damage the rest), one slot held for the lethal blow and one for the terminal entry                     |
| Overflow         | `ovf: [damage, transition, powerUp]`: counts of the entries refused, always present                                                                                                      |
| Size             | typical wave 169-182 B of compact JSON (~420 B stored with row overhead); worst case 690-694 B at the widest realistic values; per-event cap 1,024 B (the real bound)                    |
| Per run (device) | at most 16 KB of JSON and 64 timelines (`TIMELINE_RUN_MAX_BYTES` / `TIMELINE_RUN_MAX_WAVES`), with room held for one `died` timeline                                                     |
| Gate             | the existing replay dial: per-game `replay_enabled` and `replay_sample_rate`. Not on the retention keep-list                                                                             |
| Server retention | ordinary replay rows: pruned after `REPLAY_RETENTION_DAYS` (30)                                                                                                                          |
| Sent             | at run end, in the same recorder session and the same single enqueue as `wave_completed`, after all of the run's `wave_completed` events (the `died` timeline first among the timelines) |

## Relation to wave_completed

- **Same close points, same key.** The engine closes a timeline exactly when it closes the wave's
  stats ([close points](starswarm.md#per-wave-stats)): `cleared` in `startNextWave`
  (`engine/wave.ts:483-517`), `died` at the end of a tick whose final phase is GameOver
  (`engine/wave.ts:327-332`). A timeline carries the same `wave`, `outcome` and `dev` as the
  `wave_completed` from the same close, so `(game_id, wave, outcome)` joins the two. The dev
  panel's infinite lives can give one wave number several closes (a `died` close for every lethal
  hit it reverts, then a `cleared` one, all `dev`; `saveShape.ts:501`). The device keeps at most one
  `died` timeline per wave number, the latest
  ([run-level collection](#run-level-collection-and-retention-on-the-device)). For such a dev wave
  the join also matches the terminal entry's `t` against `min(65535, floor(pacing.durationMs / 100))` of each
  `died` `wave_completed` of that wave. That identity holds for every close, and the times of one
  wave's closes differ, so the timeline pairs with the close it came from even when a replacement
  did not fit and an earlier timeline was kept. The other `died` rows have no timeline. Infinite lives reverts every
  lives decrement (`GameCanvas.tsx:612`), so a real death in such a wave needs the toggle turned
  off first, and that death is the latest close.
- **Sent after, never before.** The screen records every `wave_completed` first and then the
  timelines, the `died` one first ([Sending](#sending-order-and-caps)). So any cap that bites, on
  the device or on the server (which keeps a prefix by `event_index`), drops timelines before it
  can touch a wave summary, and drops cleared-wave timelines before the death's.
- **`envelope: false`, like `wave_completed`.** The payload goes out exactly as the engine built
  it. No recorder `unit`, `actor`, rewritten `v`, or `t_ms` is added. `t_ms` is ms since the
  recorder session started, on the recorder's `Date.now()`-based clock (`gameRecorder.ts:613-614`).
  Since everything is recorded at run end, it would carry nothing but wall-clock noise.
- **No overlap in meaning.** The timeline never restates a count. Where an entry's time is also in
  `wave_completed` (`carrier.stageReachedMs`, `rout.atMs`, `pacing.durationMs`), the two are
  computed from the same raw value and must agree exactly ([reconciliation](#reader-and-reconciliation-3395)).
- **`wave_completed` is untouched.** `WaveStatsSnapshot` / `WaveStatsWire`, `WAVE_STATS_VERSION`,
  `WAVE_STATS_MAX_BYTES` (4,096), the engine's `WAVE_STATS_RUN_MAX_BYTES` (64 KB), the retention
  keep-list, `game_ended`, `score_breakdown` and the leaderboard all stay as they are.

## Wire format

### Fields

```json
{
  "v": 1,
  "ev": 1,
  "wave": 7,
  "outcome": "died",
  "dev": false,
  "ovf": [0, 0, 0],
  "e": [
    [20, 10, 1],
    [301, 2, 3, 29, 0],
    [301, 9, 3]
  ]
}
```

| Field     | Type                    | Rule                                                                                                                                                                                                                                                       |
| --------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v`       | int                     | schema version, exactly `1`. A change to the shape or to an existing code's meaning bumps it                                                                                                                                                               |
| `ev`      | int 1..65535            | `TIMELINE_ENGINE_VERSION`: the engine-rules version the entries describe. #3392 starts it at 1, and it is bumped when a trigger's meaning changes while the wire shape does not (for example a new damage order). Stored, never interpreted by the backend |
| `wave`    | int 1..65535            | the wave number, equal to its `wave_completed.wave`                                                                                                                                                                                                        |
| `outcome` | `"cleared"` \| `"died"` | equal to its `wave_completed.outcome`                                                                                                                                                                                                                      |
| `dev`     | bool                    | equal to its `wave_completed.dev` (a dev-panel action touched the wave). Filter on it                                                                                                                                                                      |
| `ovf`     | int[3], each 0..65535   | entries refused by the capacity rules, by class: `[damage, transition, powerUp]`. Always present, `[0,0,0]` when nothing was refused. The terminal entry is never refused                                                                                  |
| `e`       | entry[], 1..32          | the entries in engine order (append order), `t` non-decreasing; exactly one terminal entry (code 8 or 9), and it is last                                                                                                                                   |

There is no `difficulty`, score, canvas size, device field, identifier or free text. The only
string is the fixed `outcome` literal. The game id comes from the row's game, as for every event.

### Entries

An entry is `[t, code, p1, p2, ...]`: all JSON integers, all non-negative, with the arity (the
array length) fixed by the code.

- **`t`, deciseconds into the wave:** `t = min(65535, floor(round(durationMs) / 100))`, where
  `durationMs` is `waveStats.pacing.durationMs` at the moment of capture. This is the wave clock
  `wave_completed` already uses: the sum of `tick` dt since the wave opened (`engine/wave.ts:298`,
  real dt, not slow-motion-scaled). It stops while the game is paused and during the screen's
  pre-wave countdown, so it is gameplay time and never contains wall clock. The engine has no tick
  counter, and dt varies (16 or 33 ms), so ticks are not a usable unit. 100 ms is fine enough to
  order a hit against a buff expiry. Within one decisecond, array order is engine order. Rounding
  first and then dividing makes `t` agree exactly with the integer times in `wave_completed`,
  which `closeWave` rounds (`engine/waveStats.ts:414-420`): for the same raw value,
  `t == floor(stageReachedMs / 100)`. 65,535 ds is 109 minutes, and a longer wave saturates there.
- **`x`, quantized player X:** `x = clamp(round(player.x / canvasW * 63), 0, 63)`, which is 64
  columns, about 5.6 px each on the 360 px logical canvas. It is normalized by the run's own
  `canvasW`, so the device's width is never sent.
- **Registry indices.** A cause, type, stage or kill method is sent as its index in the
  `engine/registries.ts` array (`HIT_CAUSES`: bullet 0, rock 1, beam 2, ram 3; `POWERUP_TYPES`:
  lightning 0, shield 1, buddy 2, bomb 3, salvage 4, hull 5; `CARRIER_STAGES`: protected 0,
  exposed 1, finalStand 2; `KILL_METHODS`: shot 0, dive 1, rout 2, bomb 3, ram 4, rock 5,
  buddy 6). The phase uses a new `TIMELINE_PHASES` list in `GamePhase` order: SwoopIn 0, Playing 1,
  ClearAwaitingPickups 2, Extraction 3. Appending a registry value keeps every index, so it needs
  no `v` bump. Reordering or removing a value is a `v` bump. The
  [shared fixture](#contract-test-plan) pins the index lists on both sides.

### Code table (v1)

Classes: **D** is damage and defensive state, admitted into any free ordinary slot. **T** is the
terminal entry, which always has its own reserved slot. **C** is transitions, at most 8 a wave.
**P** is power-ups, at most 8 a wave.

| Code | Name            | Class | Arity | Entry                          | Parameters (range)                                                                                                         |
| ---- | --------------- | ----- | ----- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| 1    | `HULL_HIT`      | D     | 5     | `[t, 1, cause, x, hullAfter]`  | cause `HIT_CAUSES` index (0..3); x 0..63; hullAfter 0..1 (the hull before is hullAfter + 1, lives unchanged)               |
| 2    | `LIFE_LOST`     | D     | 5     | `[t, 2, cause, x, livesAfter]` | cause 0..3; x 0..63; livesAfter 0..255 (0 = the lethal blow; the hull is always 0 here)                                    |
| 3    | `BONUS_LIFE`    | D     | 4     | `[t, 3, awarded, livesAfter]`  | awarded 1..255 (lives granted this tick); livesAfter 1..255                                                                |
| 4    | `PLATING_UP`    | D     | 3     | `[t, 4, hullAfter]`            | hullAfter 1..2 (a hull pickup; at `HULL_MAX` it is still collected, so hullAfter can equal the level before)               |
| 8    | `WAVE_CLEARED`  | T     | 2     | `[t, 8]`                       | (none)                                                                                                                     |
| 9    | `RUN_LOST`      | T     | 3     | `[t, 9, cause]`                | cause 0..3, equal to `wave_completed.damage.deathCause`                                                                    |
| 10   | `PHASE`         | C     | 3     | `[t, 10, phase]`               | phase `TIMELINE_PHASES` index 1..3 (the phase entered; SwoopIn is implicit at t 0, GameOver is the terminal entry)         |
| 11   | `CARRIER_STAGE` | C     | 3     | `[t, 11, stage]`               | stage 1..2 (exposed, finalStand: the stage first reached; protected is implicit from combat start)                         |
| 12   | `CARRIER_DOWN`  | C     | 3     | `[t, 12, method]`              | method `KILL_METHODS` index 0..6                                                                                           |
| 13   | `ROUT`          | C     | 2     | `[t, 13]`                      | (none)                                                                                                                     |
| 20   | `PICKUP`        | P     | 3     | `[t, 20, type]`                | type `POWERUP_TYPES` index in {0, 1, 2, 3}: lightning, shield, buddy, bomb (salvage is not recorded; hull is `PLATING_UP`) |
| 21   | `BUFF_END`      | P     | 3     | `[t, 21, type]`                | type in {0, 1}: a timed buff (lightning or shield) that ran out                                                            |

Codes 5-7, 14-19 and 22 and above are unassigned. The gaps let a later build add a code inside its
class. Codes are never reused.

## Trigger points

Each entry is captured where the engine makes the change, inside the same pure step that already
bumps the matching counter. The engine never finds a change by diffing or walking state per
frame. Line numbers are as of `origin/dev` when this was written.

| Code               | Where (`frontend/src/game/starswarm/...`)                                                                                                                                                                                     | Exactly when                                                                                                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 `HULL_HIT`       | `engine/collisions.ts` `resolvePlayerHit`, plating branch (`:705-709`, beside `countPlayerHit(..., "plating")`)                                                                                                               | plating took the hit. `cause` is the tick's single charged cause (ram, else beam, else rock, else bullet; `:674`). `x` is `state.player.x`, the position the hit was resolved at                              |
| 2 `LIFE_LOST`      | `engine/collisions.ts` `resolvePlayerHit`, life branch (`:712-718`, beside `countPlayerHit(..., "life")`)                                                                                                                     | a life went. `livesAfter = player.lives - 1`, recorded before `tickBonusLives` can rescue the ship                                                                                                            |
| 3 `BONUS_LIFE`     | `engine/wave.ts` `tickBonusLives` (`:373-403`, beside the `BONUS_LIVES_PATH` bump)                                                                                                                                            | `awarded > 0`. A same-tick rescue from a lethal hit reads as `LIFE_LOST` with `livesAfter` 0, then `BONUS_LIFE` at the same `t`                                                                               |
| 4 `PLATING_UP`     | `engine/collisions.ts` `resolvePickupCollection`, the `hull` branch (`:512-513`); `engine/powerups.ts` `injectPowerUp` (dev, `:175-178`)                                                                                      | a hull pickup was collected (or applied from the dev panel)                                                                                                                                                   |
| 8 `WAVE_CLEARED`   | `engine/wave.ts` `startNextWave` (`:486`, before `closeWave(..., "cleared")`)                                                                                                                                                 | the extraction completed. `t` equals `min(65535, floor(pacing.durationMs / 100))` of the snapshot                                                                                                             |
| 9 `RUN_LOST`       | `engine/wave.ts` `tick`, the GameOver close (`:327-332`, before `closeWave(..., "died")`)                                                                                                                                     | the tick's final phase is GameOver (after `tickBonusLives`, so a rescued tick never records it)                                                                                                               |
| 10 `PHASE`         | `engine/wave.ts` `checkPhaseTransitions`: SwoopIn to Playing (`:459`), `beginWaveClear` (`:465`, `engine/extraction.ts:244`), `endPickupWait` (`:470`, `extraction.ts:295`), `resumePickupWait` (`:477`, `extraction.ts:324`) | the branch returns a different phase. Not recorded: the move into the next wave's SwoopIn (that is a wave close), GameOver (`RUN_LOST`), or a bonus-life revert of a GameOver (the net phase does not change) |
| 11 `CARRIER_STAGE` | `engine/enemies.ts` `tickEnemies` (`:613-616`, `markStageReached`)                                                                                                                                                            | `markStageReached` sets a stage for the first time and the stage is not `protected`. Combat ticks only, as for `stageReachedMs`. A boss wave's lone Carrier records only stage 2                              |
| 12 `CARRIER_DOWN`  | `engine/collisions.ts` at each `countKill` with `tier === "Carrier"`: `resolvePlayerShots` (`:323`), `resolveRockContacts` (`:414-415`), `applyBombBlast` (`:453`, also the dev bomb through `injectPowerUp`)                 | the Carrier died. A Carrier cannot be rammed (`:660`). `method` is the `countKill` method                                                                                                                     |
| 13 `ROUT`          | `engine/enemies.ts` `tickEnemies` (`:575-578`, `markRouted`)                                                                                                                                                                  | the rout latched (at most once a wave)                                                                                                                                                                        |
| 20 `PICKUP`        | `engine/collisions.ts` `resolvePickupCollection`: bomb (`:514`), buddy (`:537`), lightning or shield (`:543-544`); `engine/powerups.ts` `applyPowerUp` (dev, `:150`)                                                          | the power-up was collected or applied. A lightning pickup while shielded replaces the shield: this entry is how a reader sees the shield go                                                                   |
| 21 `BUFF_END`      | `engine/powerups.ts` `tickPowerUps` (`:122-127`, beside the `expired` bump)                                                                                                                                                   | a timed buff ran out. A buff replaced by another pickup, or cut off at the wave boundary, is not a `BUFF_END` (the same rule as `powerUps.expired`)                                                           |

`resolvePlayerHit` works on the collision scratch (`CollisionWork`). #3392 adds the live timeline to
that scratch next to `waveStats` (`collisions.ts:169-196`) and writes it back in
`assembleCollisionState`, the same way the counters travel.

### What is not recorded

Each of these is either already aggregated by `wave_completed` or too frequent to be worth a slot:

- Shield absorptions (`damage.hits.*.shield`, `powerUps.shieldAbsorbed`). Several can land in one
  tick, so they would spam the buffer, and the counts say enough. The timeline shows that the shield
  was up (`PICKUP` 1 without a `BUFF_END` yet).
- Shots fired or hit, kills other than the Carrier's, dives, flak, dodge rolls, rock spawns, breaks
  and strikes, Buddy hits, losses and kills, reinforcement launches, beams fired, attack runs,
  armor deflects (`combat`, `rocks`, `buddy`, `carrier.*` counters).
- Salvage pickups (`powerUps.collected.salvage`): they are frequent, they change only the guns,
  and they are offensive, not defensive. Power-up spawns, misses and leftovers are also counts.
- The guns level. It is not defensive state, and it follows from `pacing.start.guns`, the salvage
  count and the documented one-level drop per life lost.
- The `protected` Carrier stage (the first combat tick of every wave: every wave has a Carrier; `stageReachedMs.protected`
  has it).
- Player movement between events (see [the deferred path](#near-death-movement-context-deferred)).
- The wave in progress when a run is abandoned. It never closed, so it has no `wave_completed`
  either.

## Capacity and priority

The per-wave buffer has a fixed capacity, `TIMELINE_MAX_ENTRIES` = 32. Admission is decided entry
by entry, in append order, and nothing is ever evicted. Because the outcome depends only on the
sequence of transitions, it is deterministic and seeded runs reproduce it exactly.

1. **The terminal slot.** Slot 32 is reserved for the terminal entry (code 8 or 9), which is
   always admitted and always last. A buffer holds at most one terminal entry (see the dev revert
   below).
2. **The lethal slot.** Slot 31 is held for the lethal blow: a `LIFE_LOST` with `livesAfter` 0
   takes an ordinary slot if one is free, and slot 31 if not. Only a lethal `LIFE_LOST` may use slot
   31, and only once a wave. So the fatal cause and `x` are never refused unless an earlier, rescued lethal blow in the same
   wave used the slot. (A rescued
   lethal blow can use the slot first; a second lethal blow in the same wave with the ordinary
   slots full is then refused and counted. That needs a bonus-life rescue and 30 earlier entries in
   one wave.)
3. **Ordinary slots.** Every other entry takes one of the first 30 slots, if one is free and its
   class quota allows it:
   - class P (power-ups): admitted while the wave holds fewer than `TIMELINE_POWERUP_MAX` = 8 P
     entries;
   - class C (transitions): admitted while it holds fewer than `TIMELINE_TRANSITION_MAX` = 8 C
     entries;
   - class D (damage): no quota of its own. Because P and C together take at most 16 slots, damage
     always has at least 14 ordinary slots in any wave, plus the lethal slot.
4. **Refused entries** are counted in `ovf` by class (`[D, C, P]`, each saturating at 65,535) and
   leave no other trace. A refused entry never displaces a kept one, and in particular a low-priority
   entry can never displace a damage or terminal entry.
5. **Duplicates.** The triggers fire on transitions, so the obvious duplicates cannot happen by
   construction:
   - several projectiles plus a ram in one tick cost at most one plate or one life
     (`resolvePlayerHit` returns one result), so there is at most one hit entry (`HULL_HIT` or
     `LIFE_LOST`) a tick. Other class D entries can share its tick: a `PLATING_UP` collected the
     same tick (`resolvePickupCollection` runs before `resolvePlayerHit`, `collisions.ts:736-737`),
     or the `BONUS_LIFE` of a same-tick rescue;
   - several bonus lives in one tick make one `BONUS_LIFE` entry with `awarded > 1`;
   - `markStageReached` and `markRouted` are no-ops once set, so each stage and the rout appear at
     most once;
   - `PHASE` is recorded only when the phase actually changes. A pickup wait that hands back and
     forth with the extraction (`resumePickupWait`) does record each change, and the C quota bounds
     it.

   Identical consecutive entries are therefore a bug. The backend flags them and does not drop the
   event ([backend contract](#backend-contract-3394)).

6. **Dev-panel waves.** Dev actions are recorded like any others, and the wave carries `dev: true`
   exactly as `wave_completed` does. The dev panel's infinite lives (`devRevert`,
   `waveEvents.ts:33-52`, applied by `GameCanvas.tsx:610-618`) undoes a lost life after the engine
   has already closed the wave as `died`, and at 1 life every lethal hit closes the same wave as
   `died` again. #3392 extends `devRevert` to do two things: flag the just-closed timeline `dev` (as it
   flags the closed wave), and **pop the trailing `RUN_LOST` from the live buffer**, so the wave
   carries on with its terminal slot free. The `died` snapshot keeps it. With infinite lives a dev
   wave can fill its damage slots, and `ovf[0]` shows that it did. The run-level rules below keep
   one `died` timeline per wave, the latest that fits.

Typical waves use 8-10 entries (see the [worked examples](#worked-examples)). The cap matters only
for long, messy waves and dev waves.

## Run-level collection and retention on the device

Like `closedWaves`, the engine keeps the run's closed timelines on its state, bounded:

- `state.waveTimeline`: the live buffer, or `null` when this wave is not recorded.
  `state.timelineOn`: a run-level flag set when the run is created. A wave opens a fresh buffer only
  when the flag is on. `state.timelineLost`: a second run-level flag, true only when a restore
  turned recording off (a save from an older build, below). It tells "the dial was off from the
  start" (`timelineOn` false, `timelineLost` false: nothing is counted) apart from "recording was
  lost on restore" (`timelineOn` false, `timelineLost` true: every later close is `unrecorded`).
- `state.closedTimelines`: the kept timelines in wire form, oldest first, with
  `closedTimelinesBytes` as a running total, and `closedTimelinesOverflow` holding the counts
  `waves` and `bytes` (refused by the run budget), `clean` (cleared waves with no damage, not kept
  by policy), `devRepeats` (repeated `died` closes of one wave, dev only), `unrecorded` (waves that
  closed with no live buffer) and the flag `full`.

When a wave closes, its timeline is kept or counted:

1. **No buffer.** A wave that closes with `waveTimeline` `null` while `timelineOn` is true (its
   buffer was dropped on restore), or any wave that closes while `timelineLost` is true (see
   [pause and resume](#pause-resume-abandonment-process-death-duplicates-3393)), is counted in
   `closedTimelinesOverflow.unrecorded`. A run whose dial was off from the start (`timelineOn` and
   `timelineLost` both false) counts nothing: it records nothing at all.
2. **The retention scope (decision D1, recommendation C).** A `died` timeline is always a
   candidate. If a `died` timeline of the same wave number is already kept (a dev revert closed the
   wave as `died` before), the new one **replaces** it when the replacement still fits the hard caps
   below (the kept total minus the old timeline's length plus the new one's); either way
   `closedTimelinesOverflow.devRepeats` counts one, and a replacement that does not fit counts only
   there, not in `waves`, so it does not fire the engine-drop report. So the kept `died` timeline of
   a wave is its latest one that fit, which is the real death when the dev panel's infinite lives
   was turned off before it. This happens only in dev and internal builds. A `cleared` timeline is a
   candidate only if the wave took damage, judged from the wave's own counters, not the buffer:
   the sum of `waveStats.damage.hits[*].plating` and `.life` is greater than 0. A refused damage
   entry therefore cannot change whether the wave is kept. A clean cleared wave's timeline is never
   kept: `closedTimelinesOverflow.clean` counts it, and no memory, save space or upload is spent on
   it. That matches `wave_completed` exactly: a cleared wave has a timeline when, and only when, its
   `damage.hits[*].plating` plus `.life` is greater than 0, unless `waves` (the run budget) or
   `unrecorded` counts it.
3. **The run budget, with room held for one death.** `TIMELINE_RUN_MAX_BYTES` = 16 KB of JSON
   and `TIMELINE_RUN_MAX_WAVES` = 64 timelines are hard caps that nothing exceeds. A cleared
   candidate is kept only if the kept list stays within `16 KB - TIMELINE_MAX_BYTES` and `64 - 1`,
   so one worst-case `died` timeline always still fits. After the first cleared candidate that does
   not fit, the list is closed to cleared waves (`full: true`, the same rule as
   `collectClosedWave`). A `died` candidate is kept if it fits the hard caps (else counted in
   `waves`). Outside the dev panel a run has at most one `died` close (none when it is abandoned),
   its last close, and the held room guarantees it fits. A dev run whose reverted deaths fall in
   several waves uses that room for the first of them, and later ones are kept only while the hard
   caps allow.
4. **Bytes without serializing in the tick.** The engine keeps each buffer's JSON length as
   arithmetic, so a close needs no `JSON.stringify` (whereas `wireBytes` in `closedWaves.ts`
   stringifies). `closedTimelines` holds wire form, which has no room for a length field, so the
   engine keeps a parallel array, `closedTimelinesLens`: one length per kept timeline, in the same
   order. `closedTimelinesBytes` is its sum. A replacement changes the total by the new length minus
   `closedTimelinesLens[i]` and stores the new length; `devRevert`'s `dev` flip on a closed
   timeline lowers its entry by 1. The count changes on every edit to the wire form: an appended entry (its digits,
   commas and brackets), an `ovf` count gaining a digit (9 to 10, 99 to 100, ...), the `dev` flag
   flipping (`true` is one byte shorter than `false`, as `devRevert` already accounts for
   `closedWavesBytes`, `waveEvents.ts:42-43`), the popped `RUN_LOST` (minus the entry and its
   comma), and a `died` replacement. A test asserts that each buffer's count, each
   `closedTimelinesLens` entry and `closedTimelinesBytes` equal the stringified lengths after each
   of those edits over seeded runs.

Pause saves: `waveTimeline`, `timelineOn`, `timelineLost`, `closedTimelines`,
`closedTimelinesLens`, `closedTimelinesOverflow` and `closedTimelinesBytes` join `ADDED_STATE` in
`saveShape.ts`. They are kept out of `SAVE_FINGERPRINT`, so existing saves still restore.
`closedTimelinesLens` and `closedTimelinesBytes` are recomputed on restore (one `JSON.stringify`
per kept timeline, at restore, never in a tick), never trusted from the save. The golden-replay hash leaves them out the way it leaves out
`waveStats` and `closedWaves` (`goldenReplay.test.ts:147-160`). How a restore treats them:
[pause and resume](#pause-resume-abandonment-process-death-duplicates-3393).

## Budget arithmetic

All figures are estimates until #3396 measures them. "Compact" means `JSON.stringify` (what the
device and the per-event cap count). "jsonb" means the stored `jsonb::text` with `", "` and `": "`
separators (what the server's caps and storage count; `payload_size.jsonb_bytes`). "Stored" adds
`ROW_OVERHEAD_BYTES` = 200.

**Per entry**, at the widest values (`t` = 65535), including the separating comma:

| Arity | Example              | Compact | jsonb |
| ----- | -------------------- | ------- | ----- |
| 5     | `[65535,2,3,63,255]` | 19      | 24    |
| 4     | `[65535,3,5,255]`    | 16      | 20    |
| 3     | `[65535,12,6]`       | 13      | 16    |
| 2     | `[65535,8]`          | 10      | 12    |

In a typical wave `t` has 2-3 digits, so entries are 8-15 B compact.

**Per wave.**

| Case                                                                                                                                                                                                                             | Entries | Compact       | jsonb         | Stored            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------- | ------------- | ----------------- |
| Header only (wave 7, `ovf` zero)                                                                                                                                                                                                 | 0       | 73            | 88            | n/a               |
| Smallest wire-valid (`died`, wave 1, `[[5,9,0]]`; a `cleared` `[[5,8]]` is 81 B)                                                                                                                                                 | 1       | 80            | 97            | 297               |
| [Ordinary cleared wave](#cleared-wave-2)                                                                                                                                                                                         | 10      | 182           | 226           | 426               |
| [Carrier final stand](#carrier-final-stand-wave-6)                                                                                                                                                                               | 9       | 173           | 215           | 415               |
| [Wave-7 death](#wave-7-death-after-plating-then-life-damage)                                                                                                                                                                     | 8       | 169           | 213           | 413               |
| Widest realistic: wave 9999999, `ovf` all 65535, 30 widest arity-5 entries, the lethal `LIFE_LOST` (`livesAfter` 0) and a `cleared` terminal entry (`ev` 1 / `ev` 65535; a `died` terminal is 689 / 693 compact, the same jsonb) | 32      | **690 / 694** | **861 / 865** | **1,061 / 1,065** |

The widest realistic case uses 67% of the per-event cap, `TIMELINE_MAX_BYTES` = 1,024 B compact,
which is the issue's 1 KB target. `wave` has no upper bound on the wire, so this row is an
illustration, not a bound: **the 1,024 B cap is the real bound** on one timeline, and every
per-run and server figure below is derived from the caps, not from this row. The cap is a
backstop for a bad build, not a limit honest data meets. It is far
under the client queue's 8 KB per row (`MAX_EVENT_PAYLOAD_BYTES`) and the server's 8 KiB
`MAX_EVENT_DATA_BYTES`. The widest case's jsonb is 1.25 times its compact size (861 / 690). The
ratio is highest for one-digit entries of the most ints: 1.42 for the v1 codes (`[0,1,0,0,0],` is 12 B
compact and 17 B as jsonb) and 1.43 for a 6-int unknown-code entry the backend keeps
(`[0,1,0,0,0,0],` is 14 B and 20 B). So any stored timeline's jsonb is at most 1.43 times its
compact size. That bounds the per-event cap at about 1,463 B of jsonb and the 16 KB run budget at
about 23,400 B of jsonb. The server figures below use 24 KB. One exception: a stored `_flags` adds
to the row (`models.py:555-558`): 28 B for `["unknown_code"]`, up to 56 B with all three flags. A
flagged worst case is then about 1,519 B of jsonb a row (1,719 B stored with row overhead), and a
run of 64 flagged timelines at the cap about 23,400 + 64 × 56 ≈ 27,000 B, over the 24 KB figure. Only a newer or misbehaving build sends flagged timelines,
and the prefix rule then cuts the last timelines, never a wave.

**Per run.** Assume N = 8 waves with half of the cleared waves damaged. That is an assumption, and
#3396 measures it from real runs. At about 420 B stored per kept timeline:

| Retention scope (D1)                            | Timelines a run | Stored a run | Worst case a run                         |
| ----------------------------------------------- | --------------- | ------------ | ---------------------------------------- |
| A: every closed wave                            | 8               | ~3.4 KB      | 64 rows: 24 KB jsonb + 12.8 KB = ~37 KB  |
| B: the terminal wave only                       | 1               | ~0.42 KB     | 1 row: 1,024 B x 1.43 + 200 B = ~1.66 KB |
| **C: terminal + damaged cleared (recommended)** | ~4.5            | ~1.9 KB      | 64 rows: ~37 KB                          |

The worst case is bounded on the device: 16 KB compact is at most 24 KB jsonb, plus at most 64
rows of overhead (12,800 B).

**Per day and steady state**, per 1,000 Star Swarm runs a day, at sample rate `r` (pruned at 30
days):

| Scope | Per day     | 30-day steady state | Share of the 250 MB replay budget at r = 1 |
| ----- | ----------- | ------------------- | ------------------------------------------ |
| A     | 3.4 MB x r  | 101 MB x r          | 40%                                        |
| B     | 0.42 MB x r | 13 MB x r           | 5%                                         |
| **C** | 1.9 MB x r  | 57 MB x r           | 23%                                        |

The Star Swarm sample rate is currently 1.0 (migration 0045). Today it changes nothing for Star
Swarm, because `wave_completed` is on the keep-list. `wave_timeline` would be the first Star Swarm
type it gates (see [the dial](#the-dial-sampling-and-the-kill-switch)).

**Fitting the existing caps.**

| Cap                                                                                     | Today                              | With timelines                                             | Change?                                                                               |
| --------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Per event, client queue (`MAX_EVENT_PAYLOAD_BYTES`)                                     | 8 KB                               | <= 1,024 B                                                 | no                                                                                    |
| Per event, server (`MAX_EVENT_DATA_BYTES`)                                              | 8 KiB jsonb                        | <= ~1,463 B jsonb                                          | no                                                                                    |
| `wave_completed`, engine (`WAVE_STATS_RUN_MAX_BYTES`)                                   | 64 KB                              | 64 KB                                                      | no                                                                                    |
| Recorder session (`gameEventRegistry.starswarm.sessionMaxBytes`)                        | 64 KB (`WAVE_STATS_RUN_MAX_BYTES`) | 64 KB of waves + 16 KB of timelines                        | **yes: 80 KB** (D4)                                                                   |
| Server per game (`STARSWARM_CAP`, `games/replay_caps.py`)                               | 200 events / 105,536 B             | + 64 events, + 24 KB jsonb + 64 x 200 B (37,376 B)         | **yes: 264 events / 149,500 B** (D4 said 142,912 B; #3394's jsonb re-check raised it) |
| Recorder raw events held at once (`RECORDER_MAX_RAW_EVENTS`, `gameRecorder.ts:605-613`) | 256                                | closed waves + at most 64 timelines, recorded in one burst | no (see below)                                                                        |
| Per game, server (`MAX_EVENTS_PER_GAME` 5,000 / `MAX_EVENT_BYTES_PER_GAME` 1 MiB)       | holds                              | holds                                                      | no                                                                                    |
| Per session per 24 h (16 MiB)                                                           | holds                              | holds                                                      | no                                                                                    |

The two changes are needed. If the recorder session cap stays at 64 KB, a run whose waves are near
64 KB records no timelines: that would be safe, because the waves are recorded first, but it would
silently lose the death timeline on exactly the long runs. If `STARSWARM_CAP` stays as it is, the
server cuts the timelines of a long run, and again the waves are safe. The cost of the change is
bounded by the per-run device caps above. Since honest runs today are far under `STARSWARM_CAP`,
the realistic cost is the per-run figure, not the cap.

The `STARSWARM_CAP` arithmetic adds jsonb timelines to a wave part that today's figure sizes as
device compact JSON (64 KB + 200 x 200 B). Waves are about 1.14 times larger as `jsonb::text` (the
golden waves measure 1.13-1.14), so the wave part alone may not hold a 64 KB run of many small
waves as stored. #3394's worst-case test must measure the waves as `jsonb::text` too (the `_wave`
dummy in `test_replay_caps.py:151-157` hides this today), size the wave part from that, and add
the timeline part (+64 events, +37,376 B) on top.

**Measured by #3394** (`test_replay_caps.py`, every row as `jsonb::text` plus 200 B): the worst run the
device caps allow is 200 waves in 64,092 B of compact JSON, which is 112,950 B stored (jsonb is
1.13-1.14 times compact, and the 200 rows add 40,000 B), plus 64 timelines in 16,373 B, which is
33,333 B stored (1.25 times compact and 12,800 B of rows): 146,283 B in 264 rows. The D4 figure
(142,912 B) was 3,400 B short, because it took the waves' compact bytes as stored and the timelines
at 24 KB. `STARSWARM_CAP` is therefore 264 events / **149,500 B** = 75,400 B (waves, budgeted at 1.15 times
64 KB) + 21,300 B (timelines, 1.30 times 16 KB) + 264 x 200 B. The recorder session cap and the
device caps are unchanged.

The recorder holds at most `RECORDER_MAX_RAW_EVENTS` = 256 unmeasured events, and its idle
`measure()` is the only thing that releases them (`gameRecorder.ts:727`). `sendClosedWaves`
records synchronously, so in a run with more than 256 closed waves and kept timelines the excess is
dropped as `dropped_memory`, which the recorder already reports. Recording the `died` timeline
first among the timelines keeps it whenever the run has fewer than 256 closed waves. A typical run
records about 8 waves and 5 timelines. The cap is not raised.

The new constants live with the other recording caps in `game/_shared/eventQueueConfig.ts`:
`TIMELINE_MAX_BYTES`, `TIMELINE_RUN_MAX_BYTES` and `TIMELINE_RUN_MAX_WAVES`. The registry entry
reads `sessionMaxBytes: WAVE_STATS_RUN_MAX_BYTES + TIMELINE_RUN_MAX_BYTES`, and the type entry
`wave_timeline: { tier: Priority.REPLAY, maxBytes: TIMELINE_MAX_BYTES, envelope: false }`, as
`wave_completed` names `maxBytes: WAVE_STATS_MAX_BYTES` (`eventQueueConfig.ts:543`). Without
`maxBytes` the type falls back to the game's default per-event cap. The backend mirrors
`TIMELINE_MAX_BYTES` as `MAX_WAVE_TIMELINE_BYTES`, and a parity test holds the two equal.

Device cost: at most ~1 KB live plus 16 KB of closed timelines in memory and in the pause save.
There is no extra AsyncStorage write and no extra request: the timelines go out in the same
`enqueueEvents` call and the same sync batches as the waves.

## Sending, retention and the dial

### Sending order and caps

The contract for #3393 is in `StarSwarmScreen.sendClosedWaves` (`screens/StarSwarmScreen.tsx:276`),
the one game-over and abandon hook. It never runs in the tick or the render loop. The same
once-per-run flag and the same open-session check cover both types:

1. `record("wave_completed", ...)` for each `state.closedWaves` entry, in order (unchanged);
2. then `record("wave_timeline", { ...tl })` for the kept `died` timeline of the highest wave
   number, if there is one: the run's last death (only a dev run can have more than one);
3. then the other kept timelines, oldest first.

The recorder saves them in its one `on_session_end` enqueue, ahead of `game_ended`. Timelines get
higher `event_index`es than every wave, and the death's timeline the lowest among them, so a
recorder or server cap that bites cuts cleared-wave timelines first, then the death's, and never a
wave summary. A reader orders timelines by `wave`, not by `event_index`.

Engine-side counts (`closedTimelinesOverflow`) join the existing throttled
`starswarm.waveStats.engineDrop` message as extra counts (`timeline_dropped`, `timeline_bytes`,
`timeline_clean`, `timeline_dev_repeats`, `timeline_unrecorded`). Today that message fires only
when `over.waves > 0` (`StarSwarmScreen.tsx:293-305`). It will fire when waves or timelines were
dropped by a cap (`over.waves > 0` or `closedTimelinesOverflow.waves > 0` or `.full`). It never
fires on `timeline_clean`, `timeline_dev_repeats` or `timeline_unrecorded` alone: those are the
policy working (a clean wave, a dev revert, a restore), not a cap loss. There is no
new Sentry fingerprint, and counts only.

### The dial: sampling and the kill switch

`wave_timeline` is registered with `tier: Priority.REPLAY` and is **not** added to
`RETENTION_KEEP_TYPES` / `RETENTION_KEEP_NAMES`. So the existing per-game replay dial
(`replayDial.ts`; `game_types.replay_enabled` and `replay_sample_rate`, served by
`GET /games/catalog`) governs it with no new mechanism:

- **`off`** (`replay_enabled` false, or `REPLAY_RECORDING_ENABLED=false`): the recorder records
  nothing. The screen also starts the run with `timelineOn = isRecordingEnabled("starswarm")`
  false, so the engine never allocates a buffer. Each capture site costs one null check. On the
  server, the kill switch drops any timeline rows from older or misbehaving clients.
- **`full`** (sampled in): the timelines upload with the run.
- **`local`** (sampled out): they are recorded and saved on the device like any replay row, then
  deleted there before the completion is sent (`LATE_UPGRADE_GRACE_MS`). An error, a bug report or
  a crash upgrades the session to `full`, and then they upload. Those are exactly the runs the
  timeline is for, which is why the engine records them even in sampled-out sessions.
- The **90% budget turn-down** (`BUDGET_TURN_DOWN_RATE` = 0) turns them down along with every
  other replay type, while `wave_completed` keeps uploading as a keep-list summary. Rate 0 does not
  stop them at once: new sessions are no longer sampled in and no new upgrades are allowed
  (`gameEventClient.ts:207-211`), but sessions already decided `full` or upgraded before the app saw
  the new rate (the catalog is refetched at most hourly) still upload. That is what
  `replay_storage.py:17-18` means by "error-upgraded sessions". Only `replay_enabled` false or
  `REPLAY_RECORDING_ENABLED=false` stops them on the server at once.

Lowering `starswarm`'s `replay_sample_rate` turns the timeline down with SQL and no release, and
it affects nothing else Star Swarm sends today.

### Server retention

`wave_timeline` rows are ordinary replay rows. They are pruned after `REPLAY_RETENTION_DAYS`
(default 30) by `games/replay_storage.py`, counted against `STARSWARM_CAP`, and cut by the prefix
rule like any other replay row. They are not on the keep-list (decision D5): they are diagnostics,
not a per-game summary, and an unpruned row a run would grow with free play without bound.

## Privacy

- No identifiers of any kind: no player, session, device, locale, display name or game id in the
  payload (the game id is the row's own foreign key, as for every event).
- No wall clock. `t` is gameplay time into the wave (paused time and the countdown excluded). The
  envelope's `t_ms` is suppressed by `envelope: false`. The server's `occurred_at` (receipt time) is
  the only time on the row, as for every event.
- No free text. Every value is an integer except `outcome` (a two-value literal) and `dev` (a
  boolean). The backend validator rejects any other string.
- The X position is quantized to 64 columns and normalized by the canvas width, so the screen width
  is never sent.
- The data inventory (`docs/DATA-INVENTORY.md`, the `game_events` row and §2a) is updated when the
  type ships (#3393 / #3394), not by this design.

## Versioning and compatibility

- **`v`** is the shape and the meaning of existing codes. The backend accepts only `v == 1`. A
  breaking change bumps `v`, and the backend learns the new version in the same release, as for
  `wave_completed`.
- **New codes** are additive within `v` 1. The backend keeps an event with an unknown code: it
  stores it with a top-level `_flags: ["unknown_code"]` and checks only that the entry is an array
  of 2-6 ints in 0..65535. So a newer app never loses data on an older backend (decision D7).
- **`ev`** lets a reader separate timelines recorded under different engine rules without guessing
  from dates.
- **Older clients** never send `wave_timeline`, and nothing on the server expects it. A save from
  an older build restores with `timelineOn` false and `timelineLost` true for the rest of that run
  (see below).
- **Deployment order:** the backend migration that seeds the event type (#3394, the next Alembic
  revision after `0045`, modelled on `0034_starswarm_wave_event.py`) ships **before** the app sends
  the type. An unseeded type is refused with a 400 `unknown_event_type`, and it would hold back the
  same batch's `wave_completed` rows behind the 24 h `UNKNOWN_EVENT_TYPE_BACKOFF_MS`.

## Pause, resume, abandonment, process death, duplicates (#3393)

| Situation                                             | Contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pause, background, OS kill, then restore              | the live buffer, `timelineOn`, `timelineLost`, the closed list and its overflow counts are saved with the run (`ADDED_STATE`). The live buffer is restored only when the wave's `waveStats` restored as saved (`saveShape.ts:535-540`), the buffer fits this build's wire form, and its last `t` is at most `floor(round(durationMs) / 100)` of the restored stats. Then `t` carries on without a jump. Otherwise the buffer is `null` for that wave (counted in `unrecorded` when the wave closes): a `waveStats` restored fresh restarts `durationMs` at 0, so the saved entries' `t` would run backwards and the backend would drop the timeline. The next wave opens a fresh buffer if `timelineOn`. The closed list is restored as saved when every entry fits **and** `closedWaves` restored as saved; if `closedWaves` falls back to `[]`, the closed timelines are cleared with it, so a restore never sends timelines whose summaries it dropped. (A timeline can still have no summary: `collectClosedWave` closes `closedWaves` at 64 KB with no room held for the death, `closedWaves.ts:58`, while the timelines hold room for one. The reader prints such an orphan.) `closedTimelinesOverflow` restores as saved when it fits, else as all zeros, like `closedWavesOverflow` (`saveShape.ts:551-553`). `closedTimelinesLens` and `closedTimelinesBytes` are recomputed from the restored list, as `closedWavesBytes` is (`saveShape.ts:517-518, 550`). `timelineOn` and `timelineLost` restore as saved when they are booleans; a non-boolean value restores as the older-build case below (`timelineOn` false, `timelineLost` true) |
| Restore of a save without the fields (an older build) | `timelineOn` is restored false and `timelineLost` true, with no live buffer, `[]` and zero counts: that run records no further timelines, and each wave it closes from then on is counted in `unrecorded`. `timelineLost` is saved, so a later pause and restore keeps counting. A partial timeline is never sent, so every sent timeline is complete from t 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Game over                                             | the final wave closes as `died` on the GameOver tick, so its timeline (ending `RUN_LOST`) is already the last kept entry when `sendClosedWaves` runs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Abandoned for a new run (`startRun`)                  | as for waves: the closed timelines are recorded on the **old** session ahead of the abandon. The wave in progress never closed, so it sends nothing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Killed or left and never resumed                      | nothing is sent (the same accepted loss as `wave_completed`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Duplicates                                            | the engine closes each wave once, except that the dev panel's infinite lives can close one wave as `died` again and again (`saveShape.ts:501`: "a dev revert can repeat one"). The device keeps one `died` timeline per wave number, the latest that fit, counting the repeats in `devRepeats` ([run-level collection](#run-level-collection-and-retention-on-the-device)). `sendClosedWaves` runs once a run (`wavesSentRef`), covering both types, and nothing is sent before the run ends. So a repeated `wave` number in `wave_completed` is a `dev` wave's several `died` rows and its `cleared` row; the reader pairs a `died` timeline with the `died` row whose `min(65535, floor(pacing.durationMs / 100))` equals the timeline's terminal `t`, and flags any repeat of `(wave, outcome)` among timelines                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Dial changes mid-run                                  | none: the session's mode is decided once at `startGame`, and `timelineOn` once when the run is created                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## Engine contract (#3392)

- Capture only at the [trigger points](#trigger-points), inside the step that already bumps the
  counter. Do no per-frame scan, no diff of `prev`/`next`, no `JSON.stringify`, no network or
  storage call and no Sentry call in `tick`.
- Copy-on-write like the rest of the engine: an append returns a new buffer, and a tick with no
  transition returns the same `waveTimeline` object (the frame gate compares by identity). An append
  copies at most 31 references plus a 2-5 int entry, at most 32 times a wave (one per admitted
  entry), never per frame. A refusal copies nothing from the entry list: the new buffer shares the
  same `e` array and replaces only `ovf` (three ints). Refusals are rare in honest play, but a dev
  infinite-lives wave can make many.
- Bounded by construction: at most 32 entries a wave, at most 16 KB and 64 timelines a run. Nothing
  grows with run length beyond those.
- Disabled (`timelineOn` false): `waveTimeline` stays `null` and each site costs one branch.
- Gameplay is untouched: the golden replay's score, wave and gameplay hash do not change.

## Backend contract (#3394)

`StarSwarmModule.validate_event` (`backend/starswarm/module.py:43-48`) routes `wave_timeline` to a
new `validate_wave_timeline(data)` in `backend/starswarm/models.py`, which follows
`validate_wave_completed` (`models.py:512-559`): return the dict to store, or `None` to drop that
event only (2xx for the batch), with a log line and a Sentry report of reasons and field paths,
never values (fingerprint `starswarm-wave-timeline-dropped` + reason). Unlike
`_report_dropped_wave` (`models.py:562-569`), which reports every drop, the report is throttled:
at most one per reason (`oversize`, `invalid`) per hour per process. `observability.report.Throttle`
takes only a window (`report.py:56`), so keep one `Throttle(CAP_REPORT_WINDOW_S)` per reason in a
dict, as `games/replay_caps.py` keeps `_throttles` keyed by kind and game type (`:210`,
`:353-358`). Without it, a bad build
could send up to 64 Sentry events per run per player. The log line stays per event. Flags
(`unknown_code`, `quota`, `duplicate_entry`) are logged, not reported.

| Check                                                                                                                      | On failure                   |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| compact JSON (`separators=(",", ":")`) <= `MAX_WAVE_TIMELINE_BYTES` (1,024)                                                | drop `oversize`              |
| `v` is a `StrictInt` equal to 1; `ev` `StrictInt` 1..65535; `wave` `StrictInt` 1..65535; `outcome` literal; `dev` `StrictBool` | drop `invalid`               |
| `ovf` is a list of exactly 3 `StrictInt` in 0..65535                                                                       | drop `invalid`               |
| `e` is a list of 1..32 entries; each entry a list of `StrictInt` (no bool, no float)                                       | drop `invalid`               |
| a known code: the exact arity and each parameter's range from the code table; `t` in 0..65535                              | drop `invalid`               |
| an unknown code: 2..6 ints in 0..65535                                                                                     | keep, flag `unknown_code`    |
| `t` non-decreasing across `e`                                                                                              | drop `invalid`               |
| exactly one terminal entry, last, and code 8 for `cleared` / 9 for `died`                                                  | drop `invalid`               |
| at most 8 class P and 8 class C entries; at most 31 non-terminal, and 31 only with a lethal `LIFE_LOST` among them         | keep, flag `quota`           |
| two identical consecutive entries                                                                                          | keep, flag `duplicate_entry` |
| unknown top-level keys; a client-sent `_flags`                                                                             | dropped from what is stored  |

Stored as validated (compact ints, nothing expanded). The same story seeds the type by migration
(`0046_starswarm_wave_timeline`), changes `STARSWARM_CAP` (D4), and documents it under
[wave_timeline event (backend)](starswarm.md#wave_timeline-event-backend) and in
`DATA-INVENTORY.md`. Adding the type to the app's `gameEventRegistry.starswarm` is #3393's.

**As built (#3394).** The validator is hand-written in `backend/starswarm/timeline.py` (not a pydantic
model: the strict-int rule and the per-code table are simpler there, and `models.py` stays under its
line cap). `StarSwarmModule.validate_event` routes to it. A reported path is a field name or `e.<i>` /
`e.<i>.<j>` (entry and position), never a value or a client key. A refused row is a refused replay
row, so it also ends the stored replay at its index (`replay_cut.lower_cut`): the app sends every
`wave_completed` before the timelines, so a bad timeline can only cost the timelines after it.

## Reader and reconciliation (#3395)

`backend/scripts/replay_game.py` gains a Star Swarm section. Per wave it prints the
`wave_completed` line, then the decoded timeline (for example `30.1s LIFE_LOST ram x=29/63
lives 0`), then any reconciliation failures. Each check below holds exactly for honest data
unless `ovf` shows the class overflowed. A `dev` wave is decoded but not checked, because the dev
panel's revert changes lives outside the engine:

- count of `HULL_HIT` = sum over causes of `damage.hits[cause].plating`; count of `LIFE_LOST` =
  sum of `damage.hits[cause].life`; and the counts agree per cause.
- `RUN_LOST.cause` = `damage.deathCause`; a `died` wave's last hit entry is `LIFE_LOST` with
  `livesAfter` 0 (the lethal slot keeps it unless a rescued lethal blow took the slot and `ovf[0]`
  is greater than 0).
- the sum of `BONUS_LIFE.awarded` = `pacing.bonusLives`.
- lives: `pacing.start.lives` minus the count of `LIFE_LOST` plus the sum of `BONUS_LIFE.awarded`
  = `pacing.end.lives`,
  and each `livesAfter` matches the running value. Hull: starting from `pacing.start.hull`,
  `HULL_HIT.hullAfter` and `PLATING_UP.hullAfter` give `pacing.end.hull`.
- `CARRIER_STAGE` `t` = `floor(carrier.stageReachedMs[stage] / 100)`; `ROUT` `t` =
  `floor(rout.atMs / 100)`; the terminal `t` = `min(65535, floor(pacing.durationMs / 100))`. (All `t`
  values clamp at 65535, about 109 minutes; past that the identities are checked clamped too.)
- `CARRIER_DOWN` appears at most once, and only if `combat.kills.Carrier` has a kill.
- count of `PICKUP[type]` = `powerUps.collected[type]` and count of `BUFF_END[type]` =
  `powerUps.expired[type]`, each "at most" when `ovf[2] > 0` (class P); count of `PLATING_UP` =
  `powerUps.collected.hull`, "at most" when `ovf[0] > 0` (it is class D).
- presence (scope C) is **advisory** on the server: a `died` wave or a damaged cleared wave with no
  timeline prints `no timeline` as information, not a failure. The device-side reasons
  (`closedTimelinesOverflow`: `waves`, `full`, `unrecorded`, `devRepeats`; the recorder's caps; a
  sampled-out session, `game_ended.replay.m == "s"` with no upgrade) are not on the stored rows. The
  frontend invariant in #3396 checks presence exactly, with every count in hand: each `died` and
  damaged cleared wave has a timeline unless one of those counts accounts for it.

An **orphan timeline**, one with no matching `wave_completed` (same `wave` and `outcome` and, for
`died`, the terminal `t` identity), is decoded and printed, not reconciled: its summary was refused
by the waves' own cap or by the server, or arrived in a batch still on the device.

A failed check is printed, not fatal. #3396 runs the same checks as a frontend invariant over
seeded runs (`__tests__/helpers/waveInvariants.ts` style).

## Near-death movement context (deferred)

Not in v1, and not routine. If it is ever wanted, it is a **separate** event type (for example
`near_death_track`) with its own story, budget and dial:

- **Opt-in and sampled:** dev and internal builds first, then at most a small share of `full`
  sessions. It is never part of `wave_timeline`'s budget.
- **Content:** quantized X (0..63) at 10 Hz for the 2-3 s before each `LIFE_LOST`, from a small
  fixed ring of bytes the input path already updates, copied only when a life is lost. About 30
  bytes a death.
- **Why deferred:** it needs a write on the frame path (the ring) and a privacy review of movement
  data. Cost and performance come first, and v1's `x` at the moment of impact answers most "where
  was I" questions.

## Contract test plan

**A shared fixture**, `backend/tests/fixtures/starswarm_wave_timeline_v1.json`. It follows the
`starswarm_wave_stats_v1_registries.json` pattern: one file that both sides read, so a drift fails
CI on both. It holds:

- the code table: code, name, class, arity, each parameter's name and range, or the registry
  whose indices it takes;
- the index lists (`HIT_CAUSES`, `POWERUP_TYPES`, `CARRIER_STAGES`, `KILL_METHODS`,
  `TIMELINE_PHASES`);
- the limits (32 entries, the 8 / 8 quotas, the lethal and terminal slots, 1,024 B, 16 KB, 64 rows, t max
  65535, x max 63);
- `valid`: the three [worked examples](#worked-examples) and the worst case, each with its compact
  byte count;
- `invalid`: one case per backend check, each with the expected outcome (`drop:<reason>` or
  `flag:<name>`).

**Frontend (#3392, #3393)**

- `waveTimeline.parity.test.ts`: the TS code table, quotas, limits and index lists equal the
  fixture, and the registries' order equals the fixture's index lists.
- `waveTimeline.contract.test.ts`, in the `waveStatsContract` style: a harness that requires one
  scenario row per code in the code table (a code without a row fails). Each row plays a seeded
  scenario and asserts the exact entry, including the same-tick cases: a bullet and a rock in one
  tick give one entry; a lethal hit rescued by a bonus life gives `LIFE_LOST` 0 then `BONUS_LIFE`
  at the same `t`; a boss wave records only stage 2.
- Capacity: the 9th power-up and the 9th transition are refused and counted in `ovf`; damage fills
  the 30 ordinary slots, a non-lethal hit is then refused while a lethal `LIFE_LOST` still takes
  slot 31 (once a wave); a cleared wave whose damage entries were all refused is still kept (the
  counters decide); a terminal entry is admitted into a full buffer; nothing is ever evicted; `ovf`
  saturates at 65,535.
- Time and position: `t` is non-decreasing and equals `floor(round(durationMs)/100)`, with the
  65,535 clamp; `x` is clamped to 0..63 at both edges.
- Bytes: the engine's arithmetic count equals `JSON.stringify(wire).length` over seeded multi-wave
  runs at every difficulty, after every edit (append, `ovf` digit growth, `dev` flip, `RUN_LOST`
  pop, `died` replacement), and `closedTimelinesBytes` equals the sum of `closedTimelinesLens`, which
  equals the stringified lengths; the per-event cap is never reached by honest runs.
- Run policy: a clean cleared wave is not kept (`clean` counts it); the budget closes the list to
  cleared waves (`full`) while the `died` reserve still fits; the 64-timeline cap.
- Identity and cost: a tick with no transition returns the same `waveTimeline`; with `timelineOn`
  false `waveTimeline` is `null` all run; the gameplay hash of the golden replay is unchanged.
  #3396 adds the timelines to the golden fixture, and `tick.bench.test.ts` with the timeline on and
  off (GC passes and µs a tick recorded in `docs/PERFORMANCE.md`).
- Reconciliation: every check in [the reader section](#reader-and-reconciliation-3395) holds over
  the seeded invariant runs (`waveStats.invariants.test.ts` style).
- Saves: a round trip restores as saved, with `closedTimelinesLens` and `closedTimelinesBytes`
  recomputed; a non-boolean `timelineOn` or `timelineLost` restores as the older-build case; a save without
  the fields restores with `timelineOn` false and `timelineLost` true, no live buffer, `[]` and zero
  counts, and later waves (across a second pause and restore too)
  count in `unrecorded`; a `closedWaves` that falls back to `[]` clears the closed timelines too; a
  corrupt overflow object restores as zeros; a corrupt live buffer (`t`
  decreasing, a wrong arity, a string), or a valid one whose `waveStats` restored fresh, restores
  with no live buffer for that wave, and the next wave opens one; a corrupt closed list restores as
  `[]`; a run with the dial off from the start (`timelineOn` and `timelineLost` false, saved and
  restored) counts nothing in `unrecorded`.
- `devRevert`: it pops the trailing `RUN_LOST` from the live buffer and flags the closed timeline
  `dev`; at 1 life with infinite lives, repeated lethal hits in one wave keep one `died` timeline (the
  latest that fits), count the rest in `devRepeats` (a replacement that does not fit included), keep
  `closedTimelinesBytes` equal to the stringified sum after each replacement, stay within 16 KB and
  64 timelines, and do not
  fire the engine-drop report; turning infinite lives off before the last hit keeps that real
  death's timeline.
- Sending (#3393): every `wave_completed` is recorded before any `wave_timeline`, and the `died`
  timeline first among the timelines; once a run; on the old session at an abandon; after a
  restore; with the dial `off`, nothing is recorded; with `local`, the rows are saved and then
  deleted, and an upgrade uploads them. The recorder session cap is 80 KB: a 64 KB run of waves plus
  16 KB of timelines, at most 256 events in all (`RECORDER_MAX_RAW_EVENTS`), is saved whole; past
  256 events the excess is dropped as `dropped_memory` and the `died` timeline is still saved.
  The engine-drop report fires on wave or timeline drops by a cap, and not on `timeline_clean`,
  `timeline_dev_repeats` or `timeline_unrecorded` alone.

**Backend (#3394)**

- `test_starswarm_wave_timeline.py`: every `valid` case of the fixture is stored as sent; every
  `invalid` case drops or flags exactly as the fixture says, including bool-as-int, float, negative,
  out of range, wrong arity, a missing or non-final terminal, a mismatched outcome, `t` decreasing,
  33 entries, an oversize payload, `ovf` of the wrong length, and unknown top-level keys removed.
  Sentry reports carry paths and reasons only.
- `test_starswarm_wave_timeline_parity.py`: the backend's code table and limits equal the fixture.
- `test_event_registry_contract.py`: the type is registered and seeded; `test_replay_dial.py`: the
  keep-lists are unchanged; `test_replay_caps.py`: the new `STARSWARM_CAP` holds the worst-case
  run, the waves and 64 worst-case timelines both measured as `jsonb::text` (not the `_wave` dummy);
  the drop report is throttled per reason; retention prunes `wave_timeline`
  after 30 days and keeps `wave_completed`.
- The migration's upgrade and downgrade (the downgrade deletes the type's rows first, as `0034`
  does).

**Reader (#3395):** a fixture game with all three worked examples prints the decoded lines and no
reconciliation failures; a corrupted copy prints each expected failure.

## Worked examples

Each payload is shown exactly as it is sent (compact JSON). Byte counts were computed with
`JSON.stringify`-equivalent compact JSON and with Python's default separators (the `jsonb::text`
form), plus 200 B of row overhead for stored.

### Cleared wave 2

The ship opened wave 2 with one plate. Combat began at 2.1 s. A shield was picked up at 14.8 s and
ran out at 19.8 s. The last Guardian died at 23.3 s (the Carrier exposed), and a bullet took the
plate at 26.3 s at column 40. A shot killed the Carrier at 30.1 s, and its plating drop was
collected at 31.8 s. The grunts routed at 34.2 s. The last kill at 37.1 s went straight to the
extraction (nothing was left on screen), which finished at 40.2 s.

```text
{"v":1,"ev":1,"wave":2,"outcome":"cleared","dev":false,"ovf":[0,0,0],"e":[[21,10,1],[148,20,1],[198,21,1],[233,11,1],[263,1,0,40,0],[301,12,0],[318,4,1],[342,13],[371,10,3],[402,8]]}
```

10 entries, 182 B compact, 226 B jsonb, 426 B stored. It is kept under scope C because the wave took
damage (`damage.hits.bullet.plating` 1).

### Carrier final stand, wave 6

The last Guardian died at 21.2 s (exposed). A beam cost a life at 25.1 s at column 33 (2 lives
left). The final stand began at 29.8 s. A shot killed the Carrier at 33.4 s, and that was the last
kill, with its plating drop on screen, so the pickup wait began. The plating was collected at
35.1 s. That was the last pickup on screen, so the extraction began in the same tick
(`pickupWaitOver`, `extraction.ts:284-288`) and ran until 38.9 s.

```text
{"v":1,"ev":1,"wave":6,"outcome":"cleared","dev":false,"ovf":[0,0,0],"e":[[19,10,1],[212,11,1],[251,2,2,33,2],[298,11,2],[334,12,0],[334,10,2],[351,4,1],[351,10,3],[389,8]]}
```

9 entries, 173 B compact, 215 B jsonb, 415 B stored.

### Wave 7 death after plating then life damage

The ship opened with 2 lives and 1 plate. A Smart Bomb was collected at 9.5 s. A bullet took the
plate at 16.0 s at column 12, a rock took a life at 18.7 s at column 50 (1 left), a shield was
collected at 21.4 s and ran out at 26.4 s, and a diving ship rammed the ship at 30.1 s at column 29,
taking the last life.

```text
{"v":1,"ev":1,"wave":7,"outcome":"died","dev":false,"ovf":[0,0,0],"e":[[20,10,1],[95,20,3],[160,1,0,12,0],[187,2,1,50,1],[214,20,1],[264,21,1],[301,2,3,29,0],[301,9,3]]}
```

8 entries, 169 B compact, 213 B jsonb, 413 B stored. Its `wave_completed` has
`damage.hits.bullet.plating` 1, `damage.hits.rock.life` 1, `damage.hits.ram.life` 1,
`deathCause` `"ram"`, `pacing.start` `{lives: 2, hull: 1}` and `pacing.end` `{lives: 0, hull: 0}`,
and every [reconciliation check](#reader-and-reconciliation-3395) holds.

## Open decisions for the owner

Each decision has a recommendation. The design above assumes the recommendation, and the
implementing story changes only the named constant or rule if the owner picks otherwise.

1. **D1: retention scope.** (A) every closed wave; (B) the terminal wave only; (C) the terminal
   wave plus every cleared wave that took plating or life damage. **Recommendation: C.** At about
   1.9 KB a run it is a little over half the cost of A, and it keeps every wave where something went
   wrong. B (0.42 KB) loses the damage history of the waves before the death. The rule is exact and
   checkable against `wave_completed`: "took damage" is read from the wave's damage counters. Under
   any option, at most one `died` timeline is kept per wave number (the latest that fits, so a real death
   after dev reverts in the same wave is the one kept), which bounds dev infinite-lives runs.
2. **D2: the dial and its default.** Gate it by the existing Star Swarm `replay_sample_rate` (REPLAY
   tier, not keep-list), with no new switch. **Recommendation:** leave the rate at today's 1.0
   while Star Swarm volume is low, and lower it to 0.25 by SQL once the timelines' 30-day steady
   state would pass 10% of the replay budget (25 MB): under scope C that is about 440 runs a day at
   rate 1.0. #3396 adds this trigger to `DATA-INVENTORY.md` §2a.
3. **D3: per-wave capacity.** **Recommendation: 32 entries**: 30 ordinary (power-ups at most 8,
   transitions at most 8, damage the rest, at least 14), one slot held for the lethal blow and one
   for the terminal entry. Typical waves use 8-10. Fewer, such as 16, would bite on busy waves with a few hits, and more buys nothing
   honest.
4. **D4: cap changes.** **Recommendation: yes** to two increases. Raise the recorder session cap for
   Star Swarm from 64 KB to 80 KB (`WAVE_STATS_RUN_MAX_BYTES + TIMELINE_RUN_MAX_BYTES`, new 16 KB
   and 64-timeline device caps). Raise `STARSWARM_CAP` from 200 events / 105,536 B to 264 events /
   142,912 B (+ 64 events and 37,376 B: 24 KB of jsonb and 64 rows of overhead). #3394 re-checks
   the existing wave part as `jsonb::text` (about 1.14 times its compact size) and raises it too if
   needed. The cost is bounded by the device caps: ~37 KB more a run at the worst case, ~1.9 KB
   typical, within 30-day retention. Both leave `wave_completed`'s own caps unchanged. The recorder's
   256-raw-event limit is not raised.
5. **D5: server retention.** **Recommendation:** ordinary replay rows, pruned at 30 days, not on
   the keep-list.
6. **D6: dev waves.** Send dev-flagged timelines, as `wave_completed` does, or drop them on the
   device. **Recommendation: send, flagged.** They occur only in dev and internal builds, cost
   nothing in production, and help debug the capture itself.
7. **D7: unknown codes on the backend.** **Recommendation: keep and flag `unknown_code`**, so codes
   can be added without a `v` bump and an app that is ahead of the backend loses nothing.
8. **D8: time quantum.** **Recommendation: 100 ms** (deciseconds; 2-4 digits for real waves). 10 ms
   adds a digit to every entry for no diagnostic gain; 1 s cannot order a hit against a buff
   expiry.
9. **D9: power-up selection.** **Recommendation:** record lightning, shield, buddy and bomb
   pickups, hull as `PLATING_UP`, and timed-buff expiry. Leave out salvage (frequent, offensive,
   already counted).
10. **D10: the abandoned in-progress wave.** **Recommendation: not sent**, consistent with
    `wave_completed` (the wave never closed). Giving it a terminal code would need a third outcome
    in both schemas.

## Story map

| Story        | Delivers                                                                                                                                                                                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #3392        | `engine/waveTimeline.ts` (code table, buffer, admission, byte arithmetic, wire form), the capture at every [trigger point](#trigger-points), `closedTimelines`, `closedTimelinesLens`, `devRevert` changes, `timelineOn`, `timelineLost`; the engine tests above |
| #3393        | `sendClosedWaves` recording order, registry entry and session cap, save and restore (`ADDED_STATE`), the engine-drop report extras, the `DATA-INVENTORY.md` row                                                                                                  |
| #3394 (done) | `validate_wave_timeline`, the event-type migration, `STARSWARM_CAP`, the shared fixture and backend tests, the backend doc section                                                                                                                               |
| #3395        | the `replay_game.py` Star Swarm decoder and reconciliation                                                                                                                                                                                                       |
| #3396        | measured sizes and volumes replacing every estimate here, the golden timelines, the benchmark on and off, `PERFORMANCE.md`, the D2 trigger in §2a, and this page's status changed to implemented                                                                 |
