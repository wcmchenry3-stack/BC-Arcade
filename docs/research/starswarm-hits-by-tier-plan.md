# Star Swarm: record which enemy tier hit the player (#3710), plan

> **Research / design record.** Investigation and implementation plan for story #3710. Nothing
> here is implemented; the prototype used to measure the replay impact was reverted and is not in
> any commit. Current behavior lives in [starswarm.md](../games/starswarm.md#per-wave-stats).

**Status:** plan, waiting on the owner decisions in [section 7](#7-owner-decisions). Evidence is
from `origin/dev` as of 2026-11-13.

## 0. Summary

- **Feasible, small, and cheap per event.** Hits are already counted at one place
  (`resolvePlayerHit`, `engine/collisions.ts`). Rams, beams and rocks already know their source.
  Only enemy **bullets** do not: they carry no shooter. One optional field, `Bullet.tier`, stamped at
  the two places an enemy shot enters play, closes the gap.
- **`SAVE_FINGERPRINT` does not move** if the field follows the `PowerUp.source` pattern (left out
  of the spec with `Omit`). Verified in a prototype: `pauseStore.test.ts` passes.
- **Golden replay hashes DO move** if the field is simply added to the bullet: the golden `sha()`
  hashes enemy bullets. Verified: every `sha256` in all three scenarios changes, while every
  summary field, every counter and the rng stream stay identical. This is the owner decision
  (D1). Recommendation: keep the field out of the hash in `sha()`, like pickup `source`.
- **The wave fixture changes either way** (`golden-replay-seed42.waves.json` gains
  `damage.hitsByTier`). That is an additive re-record.
- **Data cost is small but not free, and it is permanent.** `wave_completed` is a keep-list type
  (never pruned, uploaded from every session regardless of the sample rate). The grid adds about
  **30 B a wave on average, about 0.25 KB a run, about 0.25 MB a day per 1,000 runs, and about 7.5
  MB a month that is never pruned** (assumptions in [section 4](#4-data-cost-estimate)). The
  worst case is bounded by the existing 4 KB per-wave and 64 KB per-run caps and does not raise
  them.
- **The backend would silently drop the field** (`_WaveBlock` is `extra="ignore"`), so a backend
  change must ship first.
- **The existing dial is all-or-nothing.** `game_types.replay_enabled = false` stops the whole
  `wave_completed`. There is no per-field dial. The plan adds a server-side env var that strips the
  field at validation (no app release).

## 1. Where hits are accounted, and what each cause knows

All player-hit accounting is in `resolvePlayerHit` (`engine/collisions.ts`, around lines 740-890),
through `countPlayerHit(ws, cause, result, n)` in `engine/waveCounters.ts`, which bumps
`damage.hits[cause][result]` (and mirrors rocks into `rocks.playerHits`). Hits happen at hit time,
never per frame.

Three call patterns, one per result:

| Result    | Where                                          | Counted as                                                                              |
| --------- | ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| `shield`  | the `absorbed` branch (collisions.ts ~810-813) | one per projectile soaked: `bulletHits.length` bullets, 1 rock, `beamHitIds.size` beams |
| `plating` | the `w.hull > 0` branch (collisions.ts ~873)   | **once per tick**, charged to one `cause`                                               |
| `life`    | after it (collisions.ts ~882)                  | **once per tick**, charged to one `cause`; `withDeathCause` records the last one        |

The single cause for plating and life is chosen by priority
`ram > beam > rock > bullet` (collisions.ts ~795). A ram is never shield-absorbed.

What each cause knows about its source today:

| Cause    | Source known?                                                                                                                                                                                                                                              | How the tier can be known                                                                                                                                                                                          | Engine change                            |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| `ram`    | **Yes, in scope.** The loop that finds `hitByShip` already captures `rammingEnemyId` and has the enemy `e`; it uses `e.tier` for `countKill` a few lines later.                                                                                            | `e.tier`. Possible values: Grunt (diving or circling), Elite (after `guardianThresholdCrossed`), Guardian (after `guardianDeepThresholdCrossed`). **Never Carrier** (`e.tier === "Carrier"` returns false, #2484). | Capture `e.tier` beside the id (1 line). |
| `beam`   | **Yes, by construction.** `CarrierBeam` is released only by a Carrier (`carrier.ts` `releaseBeam`).                                                                                                                                                        | Always `"Carrier"`.                                                                                                                                                                                                | None (constant).                         |
| `rock`   | Tierless by design (`rocks.playerHits`).                                                                                                                                                                                                                   | None.                                                                                                                                                                                                              | None.                                    |
| `bullet` | **Partly.** `Bullet` (`types.ts`) has `owner`, `source?: "buddy" \| "carrier"`, `flak?`, `target?`, `postClear?`. Carrier twin lasers carry `source: "carrier"` (#3594, `carrier.ts` ~252, ~282). Grunt/Elite/Guardian bullets carry **no** shooter field. | Carrier: `source === "carrier"`. Others: **not derivable** from the bullet (speed and aim depend on wave, evade state and phase; the shooter may be dead by impact time, #2842).                                   | **A new optional field.**                |

Enemy bullets are created in five places: `enemyPhases.ts` (4: formation shot, `guardianBurstFire`,
diving shot, circling shot), `asteroids.ts` ~962 (flak at a rock, fired by a non-Carrier ship `e`),
and `carrier.ts` (3 shapes: Buddy-aimed, flak-diverted, player-aimed). All but the flak in
`asteroids.ts` then pass the same funnel in `engine/enemies.ts` (~line 640, the loop over
`result.bullet` / `result.bullets` that calls `divertShotToBuddy` and then pushes into
`fw.enemyBullets`). That loop has the firing `enemy` in scope. So **two stamp sites** cover every
enemy shot: the `enemies.ts` funnel (which also covers Carrier flak) and `asteroids.ts` flak.

### Minimal engine change

1. `types.ts`: `Bullet.tier?: EnemyTier` ("the ship that fired it; render-only observation, a
   label for the stats, never read by play").
2. `enemies.ts` funnel: stamp `tier: enemy.tier` on the shot (spread into the object passed to
   `divertShotToBuddy`). `asteroids.ts` flak: add `tier: e.tier`.
3. `collisions.ts`: a helper `bulletTier(b) = b.source === "carrier" ? "Carrier" : (b.tier ?? null)`;
   capture `rammerTier` beside `rammingEnemyId`; pass the tier into `countPlayerHit`.
4. `waveCounters.ts`: `countPlayerHit(..., tier)` also bumps `damage.hitsByTier[tier][result]`.

No new rng draw, no `nextId()` call, no branch that changes play.

### Attribution rules the plan needs (not specified by the issue)

- **Shield:** attribute per projectile: each soaked bullet to its own tier, the beam to Carrier,
  the rock to nobody.
- **Plating and life:** the tick costs one plate or one life, charged to one cause (existing rule).
  For `bullet`, when several bullets land the same tick from different tiers, charge the **first
  in `bulletHits` order** (the engine's array order, which is firing order; deterministic). For
  `ram`, the rammer; for `beam`, Carrier; for `rock`, nobody.
- **Invariant (the issue's AC):** for each result `r`,
  `Σ_tier hitsByTier[tier][r] + damage.hits.rock[r] = Σ_cause damage.hits[cause][r]`.
  By construction every non-rock `countPlayerHit` call passes a tier, so it holds exactly for runs
  made on this build. See D6 for bullets restored from an older save.

## 2. Proposed data shape

`damage.hitsByTier: Record<EnemyTier, Counts<HitResult>>`, in the same dense shape and registries
as `damage.hits` (`ENEMY_TIERS` x `HIT_RESULTS`, so no new registry and no new vocabulary):

```ts
interface WaveDamage {
  readonly hits: Readonly<Record<HitCause, Counts<HitResult>>>;
  readonly hitsByTier: Readonly<Record<EnemyTier, Counts<HitResult>>>; // #3710
  readonly deathCause: HitCause | null;
  readonly deathPhase: DeathPhase | null;
}
```

- Built dense by `emptyWaveStats` (`table(ENEMY_TIERS, () => zeros(HIT_RESULTS))`), bumped through
  `bumpWave` (`CounterPath` picks it up automatically), sparse on the wire like every other table
  (`toWirePayload` -> `sparseSection(damageCounts)`): a wave with no hits sends nothing.
- It sits **inside `damage`**, next to the table it refines, rather than as a new top-level
  section (`damageByTier`): that adds no top-level wire key and no `WIRE` spec change in
  `saveShape.ts`.
- **Schema version:** additive, so `WAVE_STATS_VERSION` stays 2 (the `gunsPeak` precedent, #3510).
  The backend must learn the field first (see [section 6](#6-recommended-implementation-plan)).

## 3. The key questions

### 3.1 Does an optional field change `SAVE_FINGERPRINT` or the save shape?

`SAVE_FINGERPRINT = JSON.stringify(SPECS)` (`saveShape.ts` ~400), and `SPECS.BULLET` is a
`KeySpec<Bullet>`. Two facts:

1. **The compiler forces the spec to list every key of `Bullet`**, optional or not. Measured: adding
   `tier?` to `Bullet` makes `npm run typecheck` fail at `saveShape.ts(114,7): Property 'tier' is
missing in type ... but required in type 'KeySpec<Bullet>'`. Adding `tier: "optional"` would
   change the fingerprint and discard every paused run.
2. **The repo already has the exclusion pattern**: `PowerUp.source` (#3246) and `Explosion.kind` /
   `srcId` (#3597, #3596) are left out with `KeySpec<Omit<..., "source">>`, plus a `fits*` helper
   that allows the key as optional. Applying the same to `Bullet.tier` keeps the fingerprint string
   byte-identical (the key is simply absent from the spec).

Prototype check: with `BULLET: KeySpec<Omit<Bullet, "tier">>` and `fits(b, { ...BULLET, tier:
"optional" })` for enemy and player bullets, typecheck is clean for Star Swarm and
`pauseStore.test.ts` passes (it asserts the fingerprint and that a long run's every object fits).

Also needed on the **save** side (not the fingerprint):

- `waveStats` is in `ADDED_STATE`, so changing its shape does not change the fingerprint either
  (`pauseStore.test.ts` asserts `SAVE_FINGERPRINT` does not contain `waveStats`). But
  `isWaveStats(v)` requires the exact shape (`sameShape` against `emptyWaveStats`), so **a save
  from before the field would fail it and the restore would throw away that wave's stats**. Fix with
  a `withSavedHitsByTier(v)` migration like `withSavedDeathPhase` (#3535): fill the table with
  zeros. Exact, not a guess, for the counters it can recover (nothing was tiered before).
- `closedWaves` (wire form) in a save: `fitsDamage` / the wire checks accept only `counts` plus
  `deathCause` / `deathPhase`; verify it accepts the new nested counts (it is a counts-only tree
  via `countsOnly`, so it should; a test proves it).

### 3.2 Would any golden replay hash change? (measured on a scratch prototype)

`__tests__/helpers/goldenRuns.ts` `sha()` hashes `canonical(JSON.stringify(state))` minus a list of
observation fields (`waveStats`, `closedWaves`, `waveTimeline`, `devAffected`, and the pickup
`source`). **It does not strip bullet fields**, and `enemyBullets` is part of the hashed state, so a
stamped `tier` enters the hash. Precedent: #3594 (`source: "carrier"` on a bullet) re-recorded 19
checkpoints for exactly this reason.

Prototype (in this worktree, reverted afterwards; nothing committed): the minimal change above
(`Bullet.tier`, the two stamp sites, `damage.hitsByTier`, `countPlayerHit` with a tier, rammer and
beam tiers).

Variant P1: field stamped, nothing else (the naive version). Run:
`npx jest goldenReplay goldenTimelines pauseStore waveStats.contract waveStats.invariants`.

| Test (file)                                                                                                                                                                             | Result   | Why                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `goldenReplay.test.ts` `wave1-lieutenantJG`, `wave3-lieutenant-actions`, `wave5-boss-carrier` `replays byte-identically`                                                                | **FAIL** | Only `sha256` differs (33 lines in wave1; every summary field, `phase/wave/score/lives/enemies/...`, and `counters` identical) |
| same file, `... score, wave and gameplay hash are unchanged by the per-wave stats (#3252)` (x3)                                                                                         | **FAIL** | its premise is "the gameplay hash equals the one before epic #3244"; the new bullet field breaks it                            |
| same file, `... per-wave stats and leaderboard result match the waves fixture (#3252)` (x3)                                                                                             | **FAIL** | `closedWaves` gain `damage.hitsByTier` (pure additions, nothing else differs)                                                  |
| `goldenTimelines.test.ts`: 3 `the golden replay with the timeline on` cases and 11 targeted scenarios                                                                                   | **FAIL** | same additions in the waves comparison (timelines themselves unchanged in the diff seen)                                       |
| `waveStats.contract.test.ts`: `every registry value and snapshot field has a contract row or is pending`, `a value added to a real registry fails, naming it and its row files (#3252)` | **FAIL** | the new snapshot field has no contract row (`waveStatsContract/damage.ts`): expected, add one                                  |
| `pauseStore.test.ts` `fits through a long run with every kind of object on screen`                                                                                                      | **FAIL** | `fits(b, BULLET)` rejects the unknown key (compiler error too). Fixed by the `Omit` pattern, see 3.1                           |
| `goldenTimelines.pipeline.test.ts`, `waveStats.invariants.test.ts`                                                                                                                      | pass     |                                                                                                                                |

Variant P2: P1 plus the `Omit` spec in `saveShape.ts` and `sha()` stripping `tier` from
`enemyBullets` (the `PowerUp.source` pattern). Run: `npx jest goldenReplay pauseStore`.

| Test                                                                                 | Result                                                           |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `goldenReplay.test.ts` `... replays byte-identically` (x3): **hashes unchanged**     | pass                                                             |
| `... score, wave and gameplay hash are unchanged by the per-wave stats (#3252)` (x3) | pass                                                             |
| `pauseStore.test.ts` (all, incl. the fingerprint and long-run fit)                   | pass                                                             |
| `... per-wave stats and leaderboard result match the waves fixture (#3252)` (x3)     | **FAIL** (additive `hitsByTier`; needs a re-record, unavoidable) |

I did not re-run `goldenTimelines.test.ts` and `waveStats.contract.test.ts` under P2; their P1
failures are the waves-fixture additions and the missing contract row, neither of which P2 changes.

So: **golden hashes move with the naive field, and stay put if `sha()` leaves the field out.** The
waves fixture changes in both.

### 3.3 Determinism and the rng stream

Not affected. The change adds a key to an object that is created anyway, no `rng()` call, no
`Math.random` call, no `nextId()`; no branch reads `tier` for play. P1's summaries and `counters`
(`engineCounters()`, which includes id and rng counters) were identical to the fixture, and only
the state hash differed. That also confirms no gameplay change.

## 4. Data cost estimate (CLAUDE.md: Cost > Performance > Data)

### 4.1 Where wave stats go (traced)

1. The engine builds `closedWaves` (wire form, `toWirePayload`) in memory and in the pause save
   (device only).
2. At game over or abandon, `sendClosedWaves` (`waveEvents.ts`, never in the tick or render loop)
   calls `record("wave_completed", ...)`; `GameRecorder` saves them in **one** `enqueueEvents` call
   at session end; `SyncWorker` uploads. Not during play.
3. Server: `game_events`, validated by `backend/starswarm/models.py` `StarSwarmWaveStats`
   (`_WaveBlock`: `extra="ignore"`, so **an unknown key such as `damage.hitsByTier` is silently
   dropped today**).
4. **Retention: keep-list.** `wave_completed` is never pruned (decision #3317,
   [DATA-INVENTORY 2b](../DATA-INVENTORY.md#2b-game_events-retention-decision)) and uploads from
   **every** session whatever `replay_sample_rate` is
   ([2a](../DATA-INVENTORY.md#2a-replay-storage-budget)).
5. Not in Sentry (only count-and-size warnings when a cap bites), not in replay frames.

### 4.2 Bytes

Wire form, sparse, measured by serializing:

| Case                                   | Compact   | As `jsonb::text` (server) |
| -------------------------------------- | --------- | ------------------------- |
| no hits in the wave (key absent)       | 0 B       | 0 B                       |
| 1 hit (`Grunt.life`)                   | 34 B      | 37 B                      |
| 3 hits, 2 tiers                        | 56 B      | 62 B                      |
| 5 cells (typical heavily damaged wave) | 97 B      | 110 B                     |
| **worst case: all 12 cells at 99,999** | **236 B** | **264 B**                 |

Per game and per day. **Assumptions** (not measurable offline, in the style of the timeline
estimate in DATA-INVENTORY 2a): 8 waves a run (the design's run), half the waves take a hit
(that doc's damaged share), the average damaged wave sends about 60 B; 1,000 Star Swarm runs a day
(the doc's illustration; its D2 trigger is 446 runs a day).

| Figure                             | Value                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| Per wave, average                  | about 30 B (0.5 x 60 B)                                                                     |
| Per run (8 waves)                  | about 240 B compact, about 265 B stored (jsonb separators); no new rows, so no row overhead |
| Per day at 1,000 runs              | about 0.25 MB                                                                               |
| Per month at 1,000 runs (unpruned) | about 7.5 MB; about 90 MB a year = **18% of the 500 MB Free plan a year** at that volume    |
| Upload                             | same single batch at session end; +0.25 KB a run                                            |
| On device                          | `closedWaves` and the pause save grow by at most 236 B a wave; inside the 64 KB run cap     |

That last row of the monthly figure is the one to weigh: it is small, but **it is the only part of
this feature that is never pruned**. At today's volume (about 11 MB total DB) it is negligible; it
matters only if Star Swarm reaches hundreds of runs a day. Compare: a typical wave is already "a few
hundred bytes", so the grid is roughly +10%.

### 4.3 The cap that bounds it

- Per wave: `WAVE_STATS_MAX_BYTES` = 4096 (`eventQueueConfig.ts`). Today's measured worst case is
  about 3.7 KB; adding 236 B gives about 3.94 KB, **about 150 B of headroom** (estimate: confirm
  with the existing test, below). A wave over the cap is dropped, and the engine keeps it out of
  the list.
- Per run: `WAVE_STATS_RUN_MAX_BYTES` = 64 KB on the device; server `STARSWARM_CAP` 264 events or
  146 KB. The new field **does not raise the ceiling**; at the worst case it displaces about one wave
  (64 KB / 3.94 KB = 16 waves instead of 17). So the worst case per day is the existing one:
  runs x 64 KB.
- Counting is at hit time, a handful per wave, so no frame-path cost.

### 4.4 The dial or kill switch

Existing patterns found:

- **Replay dial** (`_shared/replayDial.ts`, `replayDialSync.ts`, catalog `replay` block;
  `game_types.replay_enabled`, `replay_sample_rate`; env `REPLAY_RECORDING_ENABLED`). It covers
  `wave_completed` **only as a whole**: `replay_enabled = false` for `starswarm` stops
  `wave_completed` (and the timelines) with no app release (starswarm.md, DATA-INVENTORY 2a).
  `replay_sample_rate` does **not** touch `wave_completed` (keep-list). Builds before the dial ignore
  both.
- `sentryDial` (`utils/sentryDial.ts`, backend `client_sentry_dial.py`) is for Sentry volume. Not
  relevant: this data does not go to Sentry.
- The 90% storage turn-down (`BUDGET_TURN_DOWN_RATE`) lowers `replay_sample_rate` only, which
  `wave_completed` ignores.

So **no existing dial turns this one field down.** The coarse switch (`replay_enabled=false`) also
kills the whole wave summary, which is too blunt for a +10% field. Recommendation (D4): add a
server-side switch, `STARSWARM_HITS_BY_TIER` (env, default on), read in
`validate_wave_completed`: when off, drop `damage.hitsByTier` before storage. That is a Render env
change, no app release, and it stops growth in the unpruned table (the upload bytes still arrive
but are tiny and capped). If the owner wants the field stopped on the wire too, the alternative is a
catalog flag next to the existing `replay` block that the app reads once per run (more work: backend
catalog, `replayDialSync`, a cached default); list it as the heavier option.

### 4.5 Fail-safe tests needed (epic #3273)

1. **Cap:** the existing `waveStats.test.ts` "fits 4096 bytes with every counter at its worst"
   already fills every counter from `emptyWaveStats`, so it covers `hitsByTier` automatically. Keep
   it unchanged and add an assertion with the measured worst-case size of the new key (236 B).
   `waveEvents.test.ts` "a worst-case dense wave ... fits the per-wave cap" also covers it.
2. **Run cap:** a test that a run of worst-case waves still keeps within `WAVE_STATS_RUN_MAX_BYTES`
   (existing `closedWaves.test.ts` behavior; add the 16-versus-17 expectation only if it is pinned
   there; do not edit existing expectations).
3. **Dial:** backend test that with the env var off a payload with `damage.hitsByTier` stores
   without it and the rest of the event unchanged; with it on, stores it; and that
   `replay_enabled = false` still stops everything (existing dial tests).
4. **Backend accept:** a payload with `hitsByTier` is stored (today it would be dropped), and an
   unknown tier key inside it is logged by `validate_wave_completed`, not rejected (the existing
   `_KEYED_TABLES` behavior).
5. **Old build compatibility:** a payload without `hitsByTier` is valid (it is optional).

## 5. Where it is surfaced

- **Dev panel run stats** (`components/starswarm/StarSwarmDevPanel.tsx`, the "Run stats" `DevSection`): it
  shows the current wave from `snapshotStats`; add a `hitsByTier` slice and one monospace table
  like `POWERUP_TABLE_HEADER` (`tier   life plat shld`, 4 rows). Dev-panel text is hardcoded English
  monospace today (`TIER_TABLE_HEADER`, `RUN_STAT_LINES`), and the panel is gated by `DEV_TOOLS`, so
  **no i18n cost** for it. UI cost: 5 lines in a 180 px panel; polled at 4 Hz already.
- **End-of-run report: it does not show wave stats.** The card shows one cause line from
  `endContext` (`StarSwarmScreen.tsx` ~199: `t("result.end.<cause>")`, keys in
  `i18n/locales/en/starswarm.json`: "Hit by enemy fire", "Hit by a Carrier beam", ...). Surfacing the
  tier there ("Hit by a Guardian") would need new keys in all 13 locale directories
  (`ar de en es fr-CA he hi ja ko nl pt ru zh`) and a tier on `endContext`; the issue says "if wave
  stats appear there", and they do not, so **out of scope**. Offer it as a follow-up.
- **Analytics:** the data is read back by SQL over `game_events` (`wave_completed`), leaving out
  `dev_affected` runs and per-wave `dev` as documented.

## 6. Recommended implementation plan

Order matters: the backend change first (the app's new key is dropped until it ships).

1. **Backend** (`backend/starswarm/models.py`): `WaveDamage.hitsByTier: NestedCounts = Field(default_factory=dict)`;
   `_KEYED_TABLES["damage.hitsByTier"] = (ENEMY_TIERS, HIT_RESULTS)`; the optional strip switch (D4).
   Tests: `backend/tests/` (accept, absent, unknown key logged, switch off). `black`, `ruff`, `pytest`.
2. **Engine types and registries:** `types.ts` `Bullet.tier?: EnemyTier`; `waveStats.ts` `WaveDamage`
   - `emptyWaveStats`; comment-pin that `v` stays 2.
3. **Counting:** `waveCounters.ts` `TIER_HITS` paths and `countPlayerHit(..., tier)`; `collisions.ts`
   `bulletTier`, `rammerTier`, the three call sites (shield per bullet, plating, life); stamp sites
   `enemies.ts` funnel and `asteroids.ts` flak.
4. **Save:** `saveShape.ts` `BULLET: KeySpec<Omit<Bullet, "tier">>` plus `tier: "optional"` in the two
   bullet fit checks; `withSavedHitsByTier` in `waveStats.ts` and its call in `restoreSavedState`
   (beside `withSavedDeathPhase`); confirm the closed-wave wire check accepts the new counts.
5. **Tests (new files or additions only):**
   - invariant: Σ tiers + rock = per-cause totals (`helpers/waveInvariants.ts` + `waveStats.invariants.test.ts`);
   - attribution unit tests: bullet per tier (Grunt, Elite, Guardian, Carrier via `source`), flak,
     ram per tier, beam = Carrier, rock tierless, multi-bullet tick (first wins), shield per bullet;
   - save: `SAVE_FINGERPRINT` unchanged (assert the key is absent); a save with and without
     `Bullet.tier` fits; an old `waveStats` restores via `withSavedHitsByTier`;
   - wire: sparse form, cap test, backend tests from 4.5;
   - `waveStatsContract/damage.ts`: a contract row for `damage.hitsByTier.*`.
6. **Fixtures (D1):** re-record `golden-replay-seed42.waves.json` with
   `UPDATE_GOLDEN=1 npx jest goldenReplay` (additive). With D1-B, also `sha()` change; with D1-A,
   re-record `golden-replay-seed42.json` and update the "#3252 hash unchanged" test's premise.
7. **Dev panel** table (section 5).
8. **Docs:** `docs/games/starswarm.md` (per-wave stats: the field, the attribution rules, the
   dial, the volume; the `goldenReplay.test.ts` header contract note), `docs/DATA-INVENTORY.md`
   (2c `wave_completed` row: size, the new key; 2a: the volume line and the dial),
   `docs/games/starswarm.md#adding-content` if a checklist line applies.
9. **Checks:** `cd frontend && npx eslint <files> && npx prettier --check <files> && npm run typecheck
&& npx jest src/game/starswarm`; backend `black --check . && ruff check . && python -m pytest tests/ -q`.

**Effort:** about one day (backend 2 h, engine and counting 2 h, save and migration 1 h, tests
3 h, dev panel and docs 1.5 h). Risk: low. The deploy order (backend first) is the one thing to get
right.

## 7. Owner decisions

**D1. Golden replay hashes (the issue's question).** The new bullet field enters the gameplay hash.
Options:

- **A. Re-record the hashes** (`golden-replay-seed42.json`, sha only; every summary and counter
  unchanged, proven by the prototype). Precedent: #3594, #3596, #3597, #3709 did this for
  render-only fields. Consequence: the test "score, wave and gameplay hash are unchanged by the
  per-wave stats (#3252)" asserts equality with a hash that predates epic #3244, so its premise
  breaks and its expectation would have to change; the "gameplay hash" guard gets weaker.
- **B. Keep the hashes: leave the tier out of the hash in `sha()`**, as pickup `source` already is
  (#3246). Consequence: the main fixture and the #3252 premise stay byte-identical; only the waves
  fixture is re-recorded (additive). It edits a test helper (`helpers/goldenRuns.ts`), not any
  expectation, which is why it needs your approval. The tier is a label for the stats that no play
  code reads, which is the condition under which that helper already excludes fields.
- **C. Carry the tier outside the hashed state** (a side table keyed by bullet id in the state):
  also needs the state to hold it, so it moves the hash anyway unless stripped; more machinery for
  no gain. Not recommended.

**Recommendation: B.** It keeps "adding observations does not alter play" provable and re-records
only what must change (the additive waves fixture).

**D2. Fingerprint.** No decision needed: use the `Omit` pattern (3.1); fingerprint unchanged, paused
runs survive.

**D3. Schema version.** Recommend additive on v2 (precedent: `gunsPeak`), with the backend deployed
first. Alternative: bump to v3, which is a breaking change for the backend parity fixture
(`starswarm_wave_stats_v2_registries.json`, `v == WAVE_STATS_VERSION`); not recommended for an
additive field.

**D4. Dial.** Recommend the server-side env switch (4.4) on top of the existing
`replay_enabled` kill switch. Alternative: a catalog flag the app reads (stops the bytes on the
wire; heavier). Or accept `replay_enabled` as the only switch (no new work, but it removes the
whole summary). Because the data is unpruned, a switch is worth having.

**D5. Multi-bullet tick.** Recommend first-in-array-order (deterministic, firing order). Alternative:
highest tier. Either is arbitrary, the existing rule already charges the tick to one cause.

**D6. Bullets restored from an older save have no tier.** Recommend: count them in no tier (the
grid undercounts for that one paused run that spans the update; the invariant test holds for fresh
runs). Alternative: an extra `unknown` pseudo-tier, which changes `ENEMY_TIERS` vocabulary and the
backend parity fixture; not recommended.

**D7. End-of-run card.** Out of scope; confirm a follow-up for "Hit by a Guardian" with 13 locales.

## 8. Evidence index

- `frontend/src/game/starswarm/engine/waveStats.ts`: `WaveDamage`, `emptyWaveStats`, `toWirePayload`, `isWaveStats`, `withSavedDeathPhase`
- `frontend/src/game/starswarm/engine/waveCounters.ts`: `DAMAGE`, `countPlayerHit`
- `frontend/src/game/starswarm/engine/collisions.ts`: `resolvePlayerHit`
- `frontend/src/game/starswarm/engine/enemies.ts` (~640), `enemyPhases.ts`, `asteroids.ts` (~962), `carrier.ts` (~247-282)
- `frontend/src/game/starswarm/types.ts`: `Bullet`
- `frontend/src/game/starswarm/saveShape.ts`: `BULLET`, `POWER_UP` / `EXPLOSION` `Omit` pattern, `ADDED_STATE`, `SAVE_FINGERPRINT`
- `frontend/src/game/starswarm/__tests__/helpers/goldenRuns.ts` `sha()`; `goldenReplay.test.ts`, `goldenTimelines.test.ts`
- `backend/starswarm/models.py` (`_WaveBlock`, `WaveDamage`, `_KEYED_TABLES`)
- `docs/DATA-INVENTORY.md` 2a, 2b, 2c; `docs/games/starswarm.md` per-wave stats and Caps
- `frontend/src/components/starswarm/StarSwarmDevPanel.tsx`; `frontend/src/screens/StarSwarmScreen.tsx` ~199, ~392
