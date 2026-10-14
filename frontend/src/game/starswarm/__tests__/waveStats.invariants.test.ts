/**
 * Star Swarm per-wave stats: cross-cutting invariants (#3252, epic #3244).
 *
 * The counter stories (#3245–#3249) each test their own section. This file checks that the
 * sections agree with each other, with the score ledger and with the run-wide `RunStats` /
 * `TierStats`, over seeded multi-wave runs at every difficulty tier. Per closed wave:
 *
 * - `score.total` is that wave's `summarizeScoreLedger` breakdown total; the waves sum to the
 *   final score, and each wave's `runningTotal` is the sum of the waves so far.
 * - Power-ups: per type, Σ `spawned` over sources = `collected + missed + leftover`.
 * - Kills: per tier, Σ kill methods = the ships of that tier that died on the wave (a routed grunt
 *   that escaped didn't die; the dev panel's `killEscorts`, the one uncounted kill, isn't used);
 *   `rout.caught + rout.escaped ≤ rout.grunts`.
 * - Lives: `start.lives − damage.hits.*.life + bonusLives = end.lives`, so over the run the lives
 *   lost = start lives − final lives + bonus lives.
 * - `pacing.end` of wave N = `pacing.start` of wave N + 1.
 * - The paired counters agree across sections (`rocks.playerHits` = `damage.hits.rock`, …).
 * - Σ over the waves = the run-wide counter, for every counter the two share. This is the full
 *   list: it extends the Commander-only checks in `waveStats.combat.test.ts` (#3247/#3248) and
 *   `waveStats.carrier.test.ts` (#3249) to every tier and several seeds.
 *
 * See docs/games/starswarm.md#per-wave-stats.
 */
import {
  CANVAS_H,
  CANVAS_W,
  DIFFICULTY_TIERS,
  ENEMY_TIERS,
  HIT_CAUSES,
  HIT_RESULTS,
  KILL_METHODS,
  POWERUP_SOURCES,
  POWERUP_TYPES,
  _resetIds,
  applyPowerUp,
  initStarSwarm,
  throwAsteroid,
  tick,
  waveJustClosed,
  type WaveStats,
  type WaveStatsSnapshot,
} from "../engine";
import { summarizeScoreLedger, waveScorePoints } from "../scoreLedger";
import type { DifficultyTier, EnemyTier, StarSwarmState } from "../types";

/** Seeds, dealt round the tiers: every tier runs, and every seed runs on several tiers. */
const SEEDS = [3, 42, 2026];
/** Waves to close before a run stops (if it hasn't died first). */
const WAVES = 2;
const MAX_TICKS = 20_000;

/** A seeded stand-in for the engine's unseeded `Math.random` calls (pickup type, drop x). */
function stubMathRandom(seed: number): jest.SpyInstance {
  let s = seed >>> 0;
  return jest.spyOn(Math, "random").mockImplementation(() => {
    s = (Math.imul(1103515245, s) + 12345) >>> 0;
    return s / 4294967296;
  });
}

type TierCounts = Record<EnemyTier, number>;
const noDeaths = (): TierCounts => ({ Grunt: 0, Elite: 0, Guardian: 0, Carrier: 0 });

interface Run {
  readonly first: StarSwarmState;
  readonly closed: WaveStatsSnapshot[];
  readonly end: StarSwarmState;
  /** Each wave's ship deaths by tier, closed waves then the open one (if any). */
  readonly deaths: TierCounts[];
  /** Each wave's roster when it opened. */
  readonly rosters: number[];
}

/**
 * Where the pilot steers: under the lowest live ship, weaving a little, or onto a pickup while
 * the wave waits for them — so waves end quickly and pickups are both collected and missed.
 */
function aim(s: StarSwarmState, i: number): number {
  if (s.phase === "ClearAwaitingPickups" && s.powerUps[0]) return s.powerUps[0].x;
  let low: { x: number; y: number } | undefined;
  for (const e of s.enemies) if (e.isAlive && (!low || e.y > low.y)) low = e;
  return low ? low.x + Math.sin(i / 30) * 20 : CANVAS_W / 2;
}

/**
 * A seeded run on the ship's own three lives: the pilot (`aim`) fires constantly, and the dev
 * panel raises the guns to L3 (so a wave doesn't take long), launches a Buddy and throws a rock
 * now and then — dev actions flag their waves `dev` but are counted all the same. Nothing else
 * outside `tick` touches the state, so lives, score and every counter are the engine's own. The
 * frame length varies (16 / 33 ms). Stops after WAVES closes or at game over.
 */
function seededRun(seed: number, difficulty: DifficultyTier): Run {
  _resetIds();
  const random = stubMathRandom(seed);
  try {
    const first = initStarSwarm(CANVAS_W, CANVAS_H, 1, seed, difficulty);
    let s = first;
    const closed: WaveStatsSnapshot[] = [];
    const deaths: TierCounts[] = [noDeaths()];
    const rosters: number[] = [s.enemies.length];
    for (let i = 0; i < MAX_TICKS && closed.length < WAVES; i++) {
      let prev = s;
      if (s.phase === "Playing" && i % 1500 === 750) prev = applyPowerUp(prev, "buddy");
      if (s.phase === "Playing" && i % 700 === 350) prev = throwAsteroid(prev);
      if (s.phase === "Playing" && prev.player.guns < 3) prev = applyPowerUp(prev, "salvage");
      s = tick(prev, i % 3 === 2 ? 33 : 16, { playerX: aim(prev, i), fire: true });
      const snap = waveJustClosed(prev, s);
      if (snap) closed.push(snap);
      if (s.wave !== prev.wave) {
        deaths.push(noDeaths());
        rosters.push(s.enemies.length);
        continue;
      }
      const was = new Map(prev.enemies.map((e) => [e.id, e.isAlive] as const));
      const tally = deaths[deaths.length - 1]!;
      for (const e of s.enemies) if (was.get(e.id) && !e.isAlive) tally[e.tier]++;
      tally.Grunt -= s.runStats.routEscaped - prev.runStats.routEscaped;
      if (s.phase === "GameOver") break;
    }
    return { first, closed, end: s, deaths, rosters };
  } finally {
    random.mockRestore();
  }
}

const sumOf = <K extends string>(keys: readonly K[], t: Readonly<Record<K, number>>): number =>
  keys.reduce((n, k) => n + t[k], 0);

const CASES = DIFFICULTY_TIERS.map((d, i) => [d, SEEDS[i % SEEDS.length]!] as const);
const RUNS: Run[] = [];

describe.each(CASES)("per-wave invariants: %s, seed %i (#3252)", (difficulty, seed) => {
  const run = seededRun(seed, difficulty);
  RUNS.push(run);
  const { first, closed, end } = run;
  const open = end.phase === "GameOver" ? [] : [end.waveStats];
  /** Every wave of the run: the closed snapshots, then the wave still open (if any). */
  const all: WaveStats[] = [...closed, ...open];
  const sum = (f: (w: WaveStats) => number) => all.reduce((t, w) => t + f(w), 0);

  it("closes more than one wave, or dies trying", () => {
    expect(closed.length).toBeGreaterThan(0);
    expect(closed.length === WAVES || end.phase === "GameOver").toBe(true);
    closed.forEach((w, i) => {
      expect(w.wave).toBe(i + 1);
      expect(w.difficulty).toBe(difficulty);
      expect(w.outcome).toBe(
        i === closed.length - 1 && end.phase === "GameOver" ? "died" : "cleared"
      );
    });
  });

  it("score: each wave's total is its breakdown total, and the waves add up to the score", () => {
    const breakdown = summarizeScoreLedger(end.scoreLedger, end.score);
    expect(breakdown.unattributed).toBeUndefined();
    expect(breakdown.earlier).toBeUndefined();
    let running = 0;
    for (const w of closed) {
      const row = breakdown.waves.find((b) => b.wave === w.wave);
      expect(w.score.total).toBe(row?.total ?? 0);
      expect(w.score.pts).toEqual(row?.pts ?? {});
      running += w.score.total;
      expect(w.score.runningTotal).toBe(running);
    }
    const openPts = open.length ? waveScorePoints(end.scoreLedger, end.wave) : {};
    const openTotal = Object.values(openPts).reduce((t, n) => t + n, 0);
    expect(running + openTotal).toBe(end.score);
    expect(end.score).toBeGreaterThan(0);
  });

  it("power-ups: spawned = collected + missed + leftover, per type", () => {
    for (const w of closed) {
      for (const type of POWERUP_TYPES) {
        const p = w.powerUps;
        expect(`${type} ${sumOf(POWERUP_SOURCES, p.spawned[type])}`).toBe(
          `${type} ${p.collected[type] + p.missed[type] + p.leftover[type]}`
        );
      }
    }
  });

  it("kills: Σ methods = the ships of each tier that died; caught + escaped ≤ grunts", () => {
    all.forEach((w, i) => {
      for (const tier of ENEMY_TIERS) {
        expect(`${tier} ${sumOf(KILL_METHODS, w.combat.kills[tier])}`).toBe(
          `${tier} ${run.deaths[i]![tier]}`
        );
      }
      expect(w.rout.caught + w.rout.escaped).toBeLessThanOrEqual(w.rout.grunts);
    });
    expect(sum((w) => sumOf(KILL_METHODS, w.combat.kills.Grunt))).toBeGreaterThan(0);
  });

  it("lives: lost = start − end + bonus lives, per wave and over the run", () => {
    const lifeHits = (w: WaveStats) => HIT_CAUSES.reduce((t, c) => t + w.damage.hits[c].life, 0);
    for (const w of closed) {
      expect(w.pacing.start.lives - lifeHits(w) + w.pacing.bonusLives).toBe(w.pacing.end.lives);
    }
    expect(sum(lifeHits)).toBe(
      first.player.lives - end.player.lives + sum((w) => w.pacing.bonusLives)
    );
  });

  it("pacing: a wave starts with the loadout the wave before it ended with", () => {
    expect(all[0]!.pacing.start).toEqual({
      lives: first.player.lives,
      guns: first.player.guns,
      hull: first.player.hull,
    });
    closed.forEach((w, i) => {
      const next = all[i + 1];
      if (next) expect(next.pacing.start).toEqual(w.pacing.end);
    });
    const last = closed.at(-1)!;
    if (end.phase === "GameOver") {
      expect(last.pacing.end).toEqual({ lives: 0, guns: end.player.guns, hull: end.player.hull });
    }
  });

  it("the paired counters agree across sections", () => {
    for (const w of all) {
      for (const r of HIT_RESULTS) expect(w.rocks.playerHits[r]).toBe(w.damage.hits.rock[r]);
      expect(w.rocks.buddyHits).toBe(w.buddy.hits.rock);
      expect(w.rocks.buddyDestroyed).toBe(w.buddy.destroyed.rock);
      for (const tier of ENEMY_TIERS) {
        expect(w.rocks.enemiesDestroyed[tier]).toBe(w.combat.kills[tier].rock);
        expect(w.buddy.kills[tier]).toBe(w.combat.kills[tier].buddy);
      }
      expect(w.carrier.gruntsLaunched).toBeLessThanOrEqual(w.combat.spawned.Grunt);
      expect(w.combat.shotsHit).toBeLessThanOrEqual(w.combat.shotsFired);
      expect(w.rout.caught).toBe(w.combat.kills.Grunt.rout);
    }
  });

  it("Σ waves = the run-wide RunStats / TierStats, for every counter they share", () => {
    const rs = end.runStats;
    expect({
      reinforced: sum((w) => w.carrier.gruntsLaunched),
      armorDeflects: sum((w) => w.carrier.armorDeflects),
      beamHits: sum((w) => w.carrier.beamHits),
      routCaught: sum((w) => w.rout.caught),
      routEscaped: sum((w) => w.rout.escaped),
      rocksSpawned: sum((w) => sumOf(["large", "small"] as const, w.rocks.spawned)),
      rocksBrokenByPlayer: sum((w) => w.rocks.broken.player),
      rocksBrokenByEnemy: sum((w) => w.rocks.broken.enemy),
      buddyLaunched: sum((w) => w.buddy.launched),
      buddyLost: sum((w) => sumOf(["bullet", "beam", "rock"] as const, w.buddy.destroyed)),
      buddyShotsDrawn: sum((w) => w.buddy.shotsDrawn),
    }).toEqual(rs);
    for (const tier of ENEMY_TIERS) {
      const t = end.tierStats[tier];
      expect({
        rolls: sum((w) => w.rocks.dodge[tier].rolls),
        dodged: sum((w) => w.rocks.dodge[tier].dodged),
        pathRolls: sum((w) => w.rocks.dodge[tier].pathRolls),
        pathDodged: sum((w) => w.rocks.dodge[tier].pathDodged),
        struck: sum((w) => w.rocks.enemiesStruck[tier]),
        flak: sum((w) => w.rocks.dodge[tier].flak),
      }).toEqual(t);
    }
    const spawned = sum((w) => sumOf(ENEMY_TIERS, w.combat.spawned));
    expect(spawned).toBe(run.rosters.reduce((t, n) => t + n, 0) + rs.reinforced);
    expect(rs.rocksSpawned).toBeGreaterThan(0);
  });
});

describe("the seeded runs exercise what the invariants check (#3252)", () => {
  // the equalities above prove little if what they sum is always 0
  const total = (f: (w: WaveStats) => number) =>
    RUNS.reduce((t, r) => t + r.closed.reduce((n, w) => n + f(w), 0), 0);

  it("closes both outcomes, and some runs get past wave 1", () => {
    const outcomes = RUNS.flatMap((r) => r.closed.map((w) => w.outcome));
    expect(outcomes).toContain("cleared");
    expect(outcomes).toContain("died");
    expect(RUNS.filter((r) => r.closed.length === WAVES).length).toBeGreaterThan(1);
  });

  it("every summed section moves somewhere", () => {
    const lifeHits = (w: WaveStats) => HIT_CAUSES.reduce((t, c) => t + w.damage.hits[c].life, 0);
    expect(total((w) => w.buddy.launched)).toBeGreaterThan(0);
    expect(total((w) => sumOf(POWERUP_TYPES, w.powerUps.collected))).toBeGreaterThan(0);
    expect(total((w) => sumOf(POWERUP_TYPES, w.powerUps.missed))).toBeGreaterThan(0);
    expect(total(lifeHits)).toBeGreaterThan(0);
    expect(total((w) => w.rocks.broken.player)).toBeGreaterThan(0);
    expect(total((w) => w.combat.shotsHit)).toBeGreaterThan(0);
  });
});
