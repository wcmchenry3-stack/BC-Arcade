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
 * the seed-42 replay's closed waves too. The last block asserts that the runs reach, somewhere,
 * each counter it lists: a rout with grunts both caught and escaped, Buddy drawing fire, scoring
 * kills, taking rocks and being lost, Smart Bomb kills, rocks on the ship costing a life, a plate
 * and a shield hit, and a bonus life — so the invariants over those can't pass on zeros. Counters
 * not on that list may be 0 in every run (a ram kill, say, shows up only in the golden replay),
 * and then the invariants over them hold trivially here.
 *
 * See docs/games/starswarm.md#per-wave-stats.
 */
import {
  BUDDY_HIT_CAUSES,
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
  runWaves,
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
/** Ms into every wave by which the dev panel has thrown a rock (and every 700 ticks after). */
const THROW_AT_MS = 3000;
/** Ticks between the rocks the dev panel drops on a brawl's Buddy. */
const BUDDY_ROCK_EVERY = 60;
/**
 * Ms into a brawl's wave (`pacing.durationMs`) when the dev panel launches a Buddy, drops a rock
 * on the ship and sets off a Smart Bomb (`bomb` also in the long Ensign run). Timed by the wave,
 * not the tick count, so every wave gets each one however long it lasts.
 */
const BRAWL_AT_MS = { buddy: 1500, rock: 5000, bomb: 9000 } as const;

/**
 * How the pilot plays a run:
 * - `brawl` — guns raised to L3 by the dev panel, steers under the lowest ship firing all the
 *   time. Each wave the dev panel launches a Buddy and drops rocks on it until it is lost, drops
 *   a rock on the ship (with a shield or a plate armed first, in turn) and sets off a Smart Bomb
 *   (`BRAWL_AT_MS`, `throwOnto`);
 * - `rout` — the first wave opens with only its grunts (`withoutLeaders`), so it routs: the pilot
 *   holds fire for ESCAPE_HOLD_MS, so some grunts escape, then chases the rest. Later waves it
 *   plays with guns at L1, shooting at the lowest leader when lined up with it;
 * - `survive` — a brawl's pilot, guns and Smart Bomb, without its Buddy and rock drops, played
 *   for LONG_WAVES at Ensign so the score earns a bonus life.
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
 * The dev panel throws a rock, and the test moves it onto `at` (the ship, or a Buddy): a thrown
 * rock crosses the field on its own line and is shot down or misses long before it reaches
 * either, so without this no rock would ever hit them. Only where the rock is changes; the throw
 * counted it as spawned, and what it does next (a shield hit, a plate, a life, damage to Buddy —
 * or nothing, while the ship is invincible) is the engine's to resolve and count. A throw the
 * engine refuses (rocks at the cap, combat not live) moves nothing.
 */
function throwOnto(s: StarSwarmState, at: { readonly x: number; readonly y: number }) {
  const thrown = throwAsteroid(s);
  const rock = thrown.asteroids.at(-1);
  if (thrown === s || !rock) return thrown;
  const placed = { ...rock, x: at.x, y: at.y };
  return { ...thrown, asteroids: [...thrown.asteroids.slice(0, -1), placed] };
}

/**
 * `s` with every ship but the grunts gone before the wave starts — so the wave routs once it is
 * in combat. They were counted in `combat.spawned` when the wave opened, and they never die in a
 * tick, so they are in no kill count and no death tally: every invariant still balances.
 */
function withoutLeaders(s: StarSwarmState): StarSwarmState {
  return {
    ...s,
    enemies: s.enemies.map((e) => (e.tier === "Grunt" ? e : { ...e, isAlive: false, hp: 0 })),
  };
}

/**
 * Ms after a rout starts that a `rout` pilot holds fire, so the quickest grunts get away
 * (`rout.escaped`) before it chases the rest down (`rout.caught`).
 */
const ESCAPE_HOLD_MS = 1800;

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
    const { rout, pacing } = s.waveStats;
    const holding = rout.atMs !== null && pacing.durationMs - rout.atMs < ESCAPE_HOLD_MS;
    return { playerX: grunt ? grunt.x : CANVAS_W / 2, fire: !holding };
  }
  const low = lowest(s, () => true);
  return { playerX: low ? low.x + Math.sin(i / 30) * 20 : CANVAS_W / 2, fire: true };
}

/**
 * A seeded run on the ship's own three lives. Besides the pilot, the dev panel launches a Buddy
 * and throws a rock every wave (and, outside a `rout`, raises the guns and sets off a Smart
 * Bomb): dev actions flag their waves `dev` but are counted all the same. Apart from placing a
 * brawl's thrown rocks (`throwOnto`) and a rout run's opening roster (`withoutLeaders`), nothing
 * outside `tick` touches the state, so lives, score and every counter are the engine's own. The
 * frame length varies (16 / 33 ms). Stops after `waves` closes or at game over.
 */
function seededRun(seed: number, difficulty: DifficultyTier, style: Style, waves: number): Run {
  _resetIds();
  const random = stubMathRandom(seed);
  try {
    const first = initStarSwarm(CANVAS_W, CANVAS_H, 1, seed, difficulty);
    // a `rout` run's first wave opens with its leaders already gone (see `Style`)
    let s = style === "rout" ? withoutLeaders(first) : first;
    const closed: WaveStatsSnapshot[] = [];
    const deaths: TierCounts[] = [noDeaths()];
    const rosters: number[] = [s.enemies.length];
    /** Per-wave dev actions already taken: action → the wave it was last taken on. */
    const taken = new Map<string, number>();
    for (let i = 0; i < MAX_TICKS && closed.length < waves; i++) {
      const before = s; // deaths are counted from here, so a dev bomb's kills are seen too
      let prev = s;
      /** True once per wave, the first tick `atMs` into it (`pacing.durationMs`). */
      const due = (action: string, atMs: number): boolean => {
        if (prev.waveStats.pacing.durationMs < atMs || taken.get(action) === prev.wave)
          return false;
        taken.set(action, prev.wave);
        return true;
      };
      if (s.phase === "Playing") {
        if (i % 1500 === 750) prev = applyPowerUp(prev, "buddy");
        if (i % 700 === 350 || due("throw", THROW_AT_MS)) prev = throwAsteroid(prev);
        if (style !== "rout") {
          if (prev.player.guns < 3) prev = applyPowerUp(prev, "salvage");
          if (due("bomb", BRAWL_AT_MS.bomb)) prev = applyPowerUp(prev, "bomb");
        }
        if (style === "brawl") {
          if (due("buddy", BRAWL_AT_MS.buddy)) prev = applyPowerUp(prev, "buddy");
          // a rock onto Buddy every BUDDY_ROCK_EVERY ticks while one is up, so Buddies are hit
          // and lost (BUDDY_HP 9, BUDDY_ROCK_DAMAGE 2)
          const buddy = prev.buddyShips[0];
          if (buddy && i % BUDDY_ROCK_EVERY === 0) prev = throwOnto(prev, buddy);
          // a rock onto the ship, taken in turn (by wave and seed) by a life, the shield and a
          // plate, the dev panel arming the ship first; not while the ship is invincible, when
          // the rock would pass through and count nothing
          if (prev.player.invincibleTimer <= 0 && due("rock", BRAWL_AT_MS.rock)) {
            const guard = (prev.wave + seed) % 3;
            if (guard === 1) prev = applyPowerUp(prev, "shield");
            if (guard === 2) prev = applyPowerUp(prev, "hull");
            prev = throwOnto(prev, prev.player);
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

/**
 * Every tier, a seed dealt round them, brawl and rout alternating; Ensign plays the long run.
 * #3512: the long run plays seed 42. Faster post-clear pickups shift every later tick, and on
 * seed 3 the ship now dies on wave 3, before the score earns its bonus life.
 */
const CASES = DIFFICULTY_TIERS.map((d, i) =>
  i === 0
    ? ([d, SEEDS[1]!, "survive", LONG_WAVES] as const)
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
const wavesOf = ({ closed, end }: Run): WaveStats[] => runWaves(closed, end);

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
      // the run must reach what these sum, or the equalities prove little
      expect(run.end.runStats.rocksSpawned).toBeGreaterThan(0);
      expect(
        waves.reduce((t, w) => t + sumOf(KILL_METHODS, w.combat.kills.Grunt), 0)
      ).toBeGreaterThan(0);
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
    ["buddy.hits.rock", (w) => w.buddy.hits.rock],
    ["Σ buddy.destroyed", (w) => sumOf(BUDDY_HIT_CAUSES, w.buddy.destroyed)],
    ["powerUps.collected", (w) => sumOf(POWERUP_TYPES, w.powerUps.collected)],
    ["powerUps.missed", (w) => sumOf(POWERUP_TYPES, w.powerUps.missed)],
    ["rout.grunts", (w) => w.rout.grunts],
    ["rout.caught", (w) => w.rout.caught],
    ["rout.escaped", (w) => w.rout.escaped],
    ["Σ kills.*.rout", (w) => w.combat.kills.Grunt.rout],
    ["Σ kills.*.bomb", (w) => ENEMY_TIERS.reduce((t, k) => t + w.combat.kills[k].bomb, 0)],
    ["damage.hits.rock.life", (w) => w.damage.hits.rock.life],
    ["damage.hits.rock.plating", (w) => w.damage.hits.rock.plating],
    ["damage.hits.rock.shield", (w) => w.damage.hits.rock.shield],
    ["damage life hits", lifeHits],
    ["pacing.bonusLives", (w) => w.pacing.bonusLives],
    ["rocks.broken.player", (w) => w.rocks.broken.player],
    ["combat.shotsHit", (w) => w.combat.shotsHit],
  ])("%s moves in some run", (_name, f) => {
    expect(total(f)).toBeGreaterThan(0);
  });
});
