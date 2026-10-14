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
 *   `rout.caught + rout.escaped ≤ rout.grunts`, and the `rout` kills are among the caught.
 * - Lives: `start.lives − damage.hits.*.life + bonusLives = end.lives`, so over the run the lives
 *   lost = start lives − final lives + bonus lives.
 * - `pacing.end` of wave N = `pacing.start` of wave N + 1.
 * - The paired counters agree across sections (`rocks.playerHits` = `damage.hits.rock`, …).
 * - Σ over the waves = the run-wide counter, for every counter the two share. This is the full
 *   list: it extends the Commander-only checks in `waveStats.combat.test.ts` (#3247/#3248) and
 *   `waveStats.carrier.test.ts` (#3249) to every tier and several seeds.
 *
 * The per-wave checks live in `helpers/waveInvariants.ts`; `goldenReplay.test.ts` runs them over
 * the seed-42 replay's closed waves too. The last block makes sure the runs reach every section
 * those checks sum (a rout, Buddy drawing fire and scoring kills, Smart Bomb kills, rocks on the
 * ship, a bonus life), so an invariant can't pass on zeros.
 *
 * See docs/games/starswarm.md#per-wave-stats.
 */
import {
  CANVAS_H,
  CANVAS_W,
  DIFFICULTY_TIERS,
  ENEMY_TIERS,
  KILL_METHODS,
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
import {
  expectClosedWave,
  expectPairedCounters,
  expectRunTotals,
  lifeHits,
  sumOf,
} from "./helpers/waveInvariants";

/** Seeds, dealt round the tiers: every tier runs, and every seed runs on several tiers. */
const SEEDS = [3, 42, 2026];
/** Waves a run closes before it stops (if it hasn't died first). */
const WAVES = 2;
/**
 * The long run: Ensign, where the ship survives, plays on until the score earns a bonus life
 * (`bonusLifeThreshold`, 30 000 at Ensign).
 */
const LONG_WAVES = 4;
const MAX_TICKS = 30_000;
/** Ms into a brawl's wave (`pacing.durationMs`) when the dev panel sets off a Smart Bomb. */
const BOMB_AT_MS = 9000;

/**
 * How the pilot plays a run:
 * - `brawl` — guns raised to L3 by the dev panel, steers under the lowest ship firing all the
 *   time; the dev panel sets off a Smart Bomb each wave and every other thrown rock lands on the
 *   ship (`rockOnShip`);
 * - `rout` — guns left at L1, picks off the formation's leaders first and holds fire on grunts
 *   until they flee, then chases them: so the wave routs;
 * - `survive` — a brawl without the rocks dropped on the ship, played for LONG_WAVES at Ensign
 *   so the score earns a bonus life.
 */
type Style = "brawl" | "rout" | "survive";

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

type Target = { readonly x: number; readonly y: number };

/** The lowest live ship `pick` accepts. */
function lowest(s: StarSwarmState, pick: (tier: EnemyTier) => boolean): Target | undefined {
  let low: Target | undefined;
  for (const e of s.enemies) if (e.isAlive && pick(e.tier) && (!low || e.y > low.y)) low = e;
  return low;
}

/**
 * The dev panel's thrown rock, moved onto the ship: a thrown rock crosses the field on its own
 * line and is shot down or misses long before the ship's lane, so without this no rock would ever
 * hit the ship. Only where the rock is changes; it was already counted as spawned, and what it
 * does next (a shield hit, a plate, a life — or nothing, while the ship is invincible) is the
 * engine's to resolve and count.
 */
function rockOnShip(s: StarSwarmState): StarSwarmState {
  const rock = s.asteroids.at(-1);
  if (!rock) return s;
  const placed = { ...rock, x: s.player.x, y: s.player.y };
  return { ...s, asteroids: [...s.asteroids.slice(0, -1), placed] };
}

/** The pilot's input this tick (see `Style`). */
function pilot(s: StarSwarmState, i: number, style: Style): { playerX: number; fire: boolean } {
  if (s.phase === "ClearAwaitingPickups" && s.powerUps[0]) {
    return { playerX: s.powerUps[0].x, fire: false };
  }
  if (style === "rout") {
    const leader = lowest(s, (t) => t !== "Grunt");
    if (leader) {
      return { playerX: leader.x, fire: Math.abs(s.player.x - leader.x) < 6 };
    }
    const grunt = lowest(s, () => true);
    return { playerX: grunt ? grunt.x : CANVAS_W / 2, fire: true };
  }
  const low = lowest(s, () => true);
  return { playerX: low ? low.x + Math.sin(i / 30) * 20 : CANVAS_W / 2, fire: true };
}

/**
 * A seeded run on the ship's own three lives. Besides the pilot, the dev panel launches a Buddy
 * and throws a rock now and then (and, outside a `rout`, raises the guns and sets off a Smart
 * Bomb): dev actions flag their waves `dev` but are counted all the same. Apart from placing a
 * brawl's rocks (`rockOnShip`), nothing else outside `tick` touches the state, so lives, score and
 * every counter are the engine's own. The frame length varies (16 / 33 ms). Stops after `waves`
 * closes or at game over.
 */
function seededRun(seed: number, difficulty: DifficultyTier, style: Style, waves: number): Run {
  _resetIds();
  const random = stubMathRandom(seed);
  try {
    const first = initStarSwarm(CANVAS_W, CANVAS_H, 1, seed, difficulty);
    let s = first;
    const closed: WaveStatsSnapshot[] = [];
    const deaths: TierCounts[] = [noDeaths()];
    const rosters: number[] = [s.enemies.length];
    let bombed = 0; // the last wave the dev panel bombed
    for (let i = 0; i < MAX_TICKS && closed.length < waves; i++) {
      const before = s; // deaths are counted from here, so a dev bomb's kills are seen too
      let prev = s;
      if (s.phase === "Playing") {
        if (i % 1500 === 750) prev = applyPowerUp(prev, "buddy");
        if (i % 700 === 350) {
          const thrown = throwAsteroid(prev);
          // in a brawl, every other throw onto the ship
          const onShip = style === "brawl" && i % 1400 === 350 && thrown !== prev;
          prev = onShip ? rockOnShip(thrown) : thrown;
        }
        if (style !== "rout") {
          if (prev.player.guns < 3) prev = applyPowerUp(prev, "salvage");
          if (prev.waveStats.pacing.durationMs >= BOMB_AT_MS && bombed !== prev.wave) {
            prev = applyPowerUp(prev, "bomb");
            bombed = prev.wave;
          }
        }
      }
      s = tick(prev, i % 3 === 2 ? 33 : 16, pilot(prev, i, style));
      const snap = waveJustClosed(prev, s);
      if (snap) closed.push(snap);
      if (s.wave !== prev.wave) {
        deaths.push(noDeaths());
        rosters.push(s.enemies.length);
        continue;
      }
      const was = new Map(before.enemies.map((e) => [e.id, e.isAlive] as const));
      const tally = deaths[deaths.length - 1]!;
      for (const e of s.enemies) if (was.get(e.id) && !e.isAlive) tally[e.tier]++;
      tally.Grunt -= s.runStats.routEscaped - before.runStats.routEscaped;
      if (s.phase === "GameOver") break;
    }
    return { first, closed, end: s, deaths, rosters };
  } finally {
    random.mockRestore();
  }
}

/** Every tier, a seed dealt round them, brawl and rout alternating; Ensign plays the long run. */
const CASES = DIFFICULTY_TIERS.map((d, i) =>
  i === 0
    ? ([d, SEEDS[0]!, "survive", LONG_WAVES] as const)
    : ([d, SEEDS[i % SEEDS.length]!, i % 2 === 0 ? "brawl" : "rout", WAVES] as const)
);

/**
 * Each case's run, played the first time a test asks for it — not while the suite is collected,
 * so a `-t` filter skips the runs it doesn't need and an engine throw fails only that case.
 */
const runs = new Map<number, Run>();
function runOnce(i: number): Run {
  let r = runs.get(i);
  if (!r) {
    const [difficulty, seed, style, waves] = CASES[i]!;
    r = seededRun(seed, difficulty, style, waves);
    runs.set(i, r);
  }
  return r;
}

/** A run's waves: the closed snapshots, then the wave still open (if any). */
const wavesOf = ({ closed, end }: Run): WaveStats[] =>
  end.phase === "GameOver" ? [...closed] : [...closed, end.waveStats];

describe.each(CASES.map((c, i) => [...c, i] as const))(
  "per-wave invariants: %s, seed %i, %s, %i waves (#3252)",
  (difficulty, _seed, _style, waves, i) => {
    it("closes at least one wave: `waves` of them, or it died on the last", () => {
      const { closed, end } = runOnce(i);
      expect(closed.length).toBeGreaterThan(0);
      expect(closed.length === waves || end.phase === "GameOver").toBe(true);
      closed.forEach((w, n) => {
        expect(w.wave).toBe(n + 1);
        expect(w.difficulty).toBe(difficulty);
        const last = n === closed.length - 1 && end.phase === "GameOver";
        expect(w.outcome).toBe(last ? "died" : "cleared");
      });
    });

    it("score: each wave's total is its breakdown total; the waves add up to the score", () => {
      const { closed, end } = runOnce(i);
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
      const openPts = end.phase === "GameOver" ? {} : waveScorePoints(end.scoreLedger, end.wave);
      const openTotal = Object.values(openPts).reduce((t, n) => t + n, 0);
      expect(running + openTotal).toBe(end.score);
      expect(end.score).toBeGreaterThan(0);
    });

    it("each closed wave: power-ups conserved, lives add up, paired counters agree", () => {
      const run = runOnce(i);
      for (const w of run.closed) expectClosedWave(w);
      for (const w of wavesOf(run)) expectPairedCounters(w);
    });

    it("kills: Σ methods = the ships of each tier that died on the wave", () => {
      const run = runOnce(i);
      wavesOf(run).forEach((w, n) => {
        for (const tier of ENEMY_TIERS) {
          expect(`${tier} ${sumOf(KILL_METHODS, w.combat.kills[tier])}`).toBe(
            `${tier} ${run.deaths[n]![tier]}`
          );
        }
      });
    });

    it("lives: lost over the run = start − end + bonus lives", () => {
      const run = runOnce(i);
      const waves = wavesOf(run);
      const sum = (f: (w: WaveStats) => number) => waves.reduce((t, w) => t + f(w), 0);
      expect(sum(lifeHits)).toBe(
        run.first.player.lives - run.end.player.lives + sum((w) => w.pacing.bonusLives)
      );
    });

    it("pacing: a wave starts with the loadout the wave before it ended with", () => {
      const { first, closed, end } = runOnce(i);
      const waves = wavesOf(runOnce(i));
      expect(waves[0]!.pacing.start).toEqual({
        lives: first.player.lives,
        guns: first.player.guns,
        hull: first.player.hull,
      });
      closed.forEach((w, n) => {
        const next = waves[n + 1];
        if (next) expect(next.pacing.start).toEqual(w.pacing.end);
      });
      if (end.phase === "GameOver") {
        const last = closed.at(-1)!;
        expect(last.pacing.end).toEqual({ lives: 0, guns: end.player.guns, hull: end.player.hull });
      }
    });

    it("Σ waves = the run-wide RunStats / TierStats, for every counter they share", () => {
      const run = runOnce(i);
      const waves = wavesOf(run);
      expectRunTotals(waves, run.end);
      const spawned = waves.reduce((t, w) => t + sumOf(ENEMY_TIERS, w.combat.spawned), 0);
      expect(spawned).toBe(run.rosters.reduce((t, n) => t + n, 0) + run.end.runStats.reinforced);
    });
  }
);

describe("the seeded runs exercise what the invariants check (#3252)", () => {
  // the equalities above prove little if what they sum is always 0
  const total = (f: (w: WaveStats) => number) =>
    CASES.reduce((t, _c, i) => t + wavesOf(runOnce(i)).reduce((n, w) => n + f(w), 0), 0);

  it("closes both outcomes, and some runs get past wave 1", () => {
    const closed = CASES.map((_c, i) => runOnce(i).closed);
    const outcomes = closed.flatMap((c) => c.map((w) => w.outcome));
    expect(outcomes).toContain("cleared");
    expect(outcomes).toContain("died");
    expect(closed.filter((c) => c.length >= WAVES).length).toBeGreaterThan(1);
  });

  it.each<[string, (w: WaveStats) => number]>([
    ["buddy.launched", (w) => w.buddy.launched],
    ["buddy.shotsDrawn", (w) => w.buddy.shotsDrawn],
    ["Σ buddy.kills", (w) => sumOf(ENEMY_TIERS, w.buddy.kills)],
    ["powerUps.collected", (w) => sumOf(POWERUP_TYPES, w.powerUps.collected)],
    ["powerUps.missed", (w) => sumOf(POWERUP_TYPES, w.powerUps.missed)],
    ["rout.grunts", (w) => w.rout.grunts],
    ["rout.caught", (w) => w.rout.caught],
    ["Σ kills.*.rout", (w) => w.combat.kills.Grunt.rout],
    ["Σ kills.*.bomb", (w) => ENEMY_TIERS.reduce((t, k) => t + w.combat.kills[k].bomb, 0)],
    [
      "Σ damage.hits.rock",
      (w) => sumOf(["life", "plating", "shield"] as const, w.damage.hits.rock),
    ],
    ["damage life hits", lifeHits],
    ["pacing.bonusLives", (w) => w.pacing.bonusLives],
    ["rocks.broken.player", (w) => w.rocks.broken.player],
    ["combat.shotsHit", (w) => w.combat.shotsHit],
  ])("%s moves in some run", (_name, f) => {
    expect(total(f)).toBeGreaterThan(0);
  });
});
