/**
 * #3632: divers launched in the same scheduler tick split up — each gets its own aim point and a
 * staggered launch — and a lone diver flies exactly the dive it always did.
 */
import { initStarSwarm, tick, seedRng, _resetIds, CANVAS_W, CANVAS_H, diveCap } from "../engine";
import { clampSway } from "../engine/enemies";
import { evalCubic } from "../engine/geometry";
import {
  DIVE_SPREAD_MARGIN_PX,
  DIVE_SPREAD_PX,
  DIVE_STAGGER_MS,
  WIGGLE_DURATION,
  SHOOT_INTERVAL_BASE,
  BURST_INTERVAL,
} from "../engine/tuning";
import type { Enemy, StarSwarmState } from "../types";
import { NO_INPUT, advanceMs } from "./helpers/engineFixtures";

beforeEach(() => {
  seedRng(7);
  _resetIds();
});

/** A settled wave `wave` with no rocks, every ship on station, the dive timer about to fire. */
function readyWave(wave: number): StarSwarmState {
  let s = initStarSwarm(CANVAS_W, CANVAS_H);
  s = advanceMs(s, 8000);
  return {
    ...s,
    wave,
    asteroids: [],
    nextDiveTimer: 1,
    enemies: s.enemies.map((e) =>
      e.isAlive && e.phase !== "Formation"
        ? { ...e, phase: "Formation" as const, x: e.formationX, y: e.formationY, path: null }
        : e
    ),
  };
}

const wiggling = (s: StarSwarmState): Enemy[] =>
  s.enemies.filter((e) => e.isAlive && e.phase === "Wiggling");

/** Tick until every ship of the batch has a launched path (Diving), returning them by id. */
function launchBatch(s: StarSwarmState, ids: readonly number[]): Enemy[] {
  let cur = s;
  for (let i = 0; i < 200; i++) {
    const out = cur.enemies.filter((e) => ids.includes(e.id));
    if (out.every((e) => e.phase === "Diving")) return out;
    cur = tick(cur, 16, NO_INPUT);
  }
  throw new Error("batch never launched");
}

describe("dive batch split (#3632)", () => {
  it("fans the aim points of a batch DIVE_SPREAD_PX apart around the player", () => {
    const s = tick(readyWave(5), 16, NO_INPUT);
    const batch = wiggling(s);
    expect(batch.length).toBe(diveCap(5));
    const xs = batch.map((e) => e.diveTargetX).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(DIVE_SPREAD_PX - 1e-6);
    }
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean).toBeCloseTo(s.player.x, 3);
    // the fan keeps its order: nobody crosses
    const byFormation = [...batch].sort((a, b) => a.formationX - b.formationX);
    expect(byFormation.map((e) => e.diveTargetX)).toEqual(xs);
  });

  it.each([320, 360, 430])("fans inside the margin on a %i px canvas, at both edges", (w) => {
    const s0 = { ...readyWave(5), canvasW: w };
    const n = diveCap(5);
    const half = ((n - 1) / 2) * DIVE_SPREAD_PX;
    for (const px of [0, 2, w / 2, w - 2, w]) {
      const s = tick(s0, 16, { playerX: px, fire: false });
      const at = s.player.x; // where the engine put the ship (it clamps to the canvas)
      const xs = wiggling(s)
        .map((e) => e.diveTargetX)
        .sort((a, b) => a - b);
      expect(xs).toHaveLength(n);
      expect(xs[0]!).toBeGreaterThanOrEqual(DIVE_SPREAD_MARGIN_PX - 1e-6);
      expect(xs[n - 1]!).toBeLessThanOrEqual(w - DIVE_SPREAD_MARGIN_PX + 1e-6);
      for (let i = 1; i < n; i++) expect(xs[i]! - xs[i - 1]!).toBeCloseTo(DIVE_SPREAD_PX, 6);
      // centred on the player whenever the whole fan fits around it
      const centre = (xs[0]! + xs[n - 1]!) / 2;
      if (at - half >= DIVE_SPREAD_MARGIN_PX && at + half <= w - DIVE_SPREAD_MARGIN_PX) {
        expect(centre).toBeCloseTo(at, 6);
      }
    }
  });

  it("keeps the batch's flown paths apart for most of the dive", () => {
    const s = tick(readyWave(5), 16, NO_INPUT);
    const ids = wiggling(s).map((e) => e.id);
    const dive = launchBatch(s, ids);
    expect(dive.length).toBeGreaterThanOrEqual(2);
    const ends = dive.map((e) => e.path!.p3.x).sort((a, b) => a - b);
    for (let i = 1; i < ends.length; i++) {
      expect(ends[i]! - ends[i - 1]!).toBeGreaterThanOrEqual(DIVE_SPREAD_PX - 1e-6);
    }
    let minSep = 1e9;
    for (let t = 0.3; t <= 1.0001; t += 0.05) {
      for (let i = 0; i < dive.length; i++) {
        for (let j = i + 1; j < dive.length; j++) {
          const a = evalCubic(dive[i]!.path!, t);
          const b = evalCubic(dive[j]!.path!, t);
          minSep = Math.min(minSep, Math.hypot(a.x - b.x, a.y - b.y));
        }
      }
    }
    expect(minSep).toBeGreaterThanOrEqual(24);
  });

  it("leaves a lone diver's aim, sweep and wait untouched", () => {
    const s0 = readyWave(1); // cap 1
    expect(diveCap(1)).toBe(1);
    const s = tick(s0, 16, NO_INPUT);
    const [e] = wiggling(s);
    expect(wiggling(s)).toHaveLength(1);
    expect(e!.diveTargetX).toBe(s.player.x);
    expect(e!.wiggleTimer).toBeGreaterThan(0);
    expect(e!.wiggleTimer).toBeLessThanOrEqual(WIGGLE_DURATION);
  });

  it("keeps the dive cap and cadence", () => {
    const s = tick(readyWave(5), 16, NO_INPUT);
    expect(wiggling(s).length).toBeLessThanOrEqual(diveCap(5));
    expect(s.nextDiveTimer).toBeGreaterThan(1000);
  });
});

describe("dive stagger (#3632)", () => {
  it("defaults to 350 ms", () => {
    expect(DIVE_STAGGER_MS).toBe(350);
  });

  it("the k-th ship of a batch waits k x DIVE_STAGGER_MS longer", () => {
    const s = tick(readyWave(5), 16, NO_INPUT);
    const batch = wiggling(s).sort((a, b) => a.formationX - b.formationX);
    expect(batch.length).toBeGreaterThanOrEqual(2);
    const base = batch[0]!.wiggleTimer;
    batch.forEach((e, k) => expect(e.wiggleTimer).toBeCloseTo(base + k * DIVE_STAGGER_MS, 6));
  });

  it("with DIVE_STAGGER_MS 0 the whole batch launches together", () => {
    jest.resetModules();
    try {
      jest.doMock("../engine/tuning", () => ({
        ...jest.requireActual("../engine/tuning"),
        DIVE_STAGGER_MS: 0,
      }));
      const eng = jest.requireActual<typeof import("../engine")>("../engine");
      eng.seedRng(7);
      eng._resetIds();
      let s = eng.initStarSwarm(CANVAS_W, CANVAS_H);
      for (let t = 0; t < 8000; t += 16) s = eng.tick(s, 16, NO_INPUT);
      s = { ...s, wave: 5, asteroids: [], nextDiveTimer: 1 };
      s = {
        ...s,
        enemies: s.enemies.map((e) =>
          e.isAlive && e.phase !== "Formation"
            ? { ...e, phase: "Formation" as const, x: e.formationX, y: e.formationY, path: null }
            : e
        ),
      };
      s = eng.tick(s, 16, NO_INPUT);
      expect(new Set(wiggling(s).map((e) => e.wiggleTimer)).size).toBe(1);
    } finally {
      jest.dontMock("../engine/tuning");
      jest.resetModules();
    }
  });

  it("launches each ship k x stagger after the first", () => {
    let s = tick(readyWave(5), 16, NO_INPUT);
    const batch = wiggling(s).sort((a, b) => a.formationX - b.formationX);
    const launchedAt = new Map<number, number>();
    for (let ms = 0; ms < 3000 && launchedAt.size < batch.length; ms += 16) {
      s = tick(s, 16, NO_INPUT);
      for (const e of s.enemies) {
        if (batch.some((b) => b.id === e.id) && e.phase === "Diving" && !launchedAt.has(e.id)) {
          launchedAt.set(e.id, ms);
        }
      }
    }
    const times = batch.map((e) => launchedAt.get(e.id)!);
    times.forEach((t, k) => expect(Math.abs(t - times[0]! - k * DIVE_STAGGER_MS)).toBeLessThan(40));
  });

  it("a waiting ship holds its swayed station, tracking the formation's sway", () => {
    let s = tick(readyWave(5), 16, NO_INPUT);
    const ids = wiggling(s)
      .filter((e) => e.wiggleTimer > WIGGLE_DURATION)
      .map((e) => e.id);
    expect(ids.length).toBeGreaterThan(0);
    const offsets = new Set<number>();
    for (let i = 0; i < 12; i++) {
      s = tick({ ...s, nextDiveTimer: 99999 }, 16, NO_INPUT);
      for (const id of ids) {
        const e = s.enemies.find((x) => x.id === id)!;
        if (e.phase !== "Wiggling" || e.wiggleTimer <= WIGGLE_DURATION) continue;
        expect(e.x).toBeCloseTo(e.formationX + clampSway(e.tier, s.formationSwayX), 6);
        offsets.add(Math.round((e.x - e.formationX) * 1000));
      }
    }
    expect(offsets.size).toBeGreaterThan(1); // the sway really moved while they waited
  });

  it("a waiting ship still holds a dive slot, so the cap is respected", () => {
    let s = tick(readyWave(5), 16, NO_INPUT);
    expect(wiggling(s).filter((e) => e.wiggleTimer > WIGGLE_DURATION).length).toBeGreaterThan(0);
    const first = new Set(wiggling(s).map((e) => e.id));
    const waitingCount = wiggling(s).filter((e) => e.wiggleTimer > WIGGLE_DURATION).length;
    s = tick({ ...s, nextDiveTimer: 1 }, 16, NO_INPUT); // the next batch fires while they wait
    const extra = wiggling(s).filter((e) => !first.has(e.id)).length;
    expect(extra).toBeLessThanOrEqual(Math.max(0, diveCap(5) - waitingCount));
  });

  it("a ship that dies while waiting never launches", () => {
    let s = tick(readyWave(5), 16, NO_INPUT);
    const waiting = wiggling(s).find((e) => e.wiggleTimer > WIGGLE_DURATION)!;
    s = {
      ...s,
      enemies: s.enemies.map((e) => (e.id === waiting.id ? { ...e, isAlive: false, hp: 0 } : e)),
    };
    for (let i = 0; i < 120; i++) s = tick({ ...s, nextDiveTimer: 99999 }, 16, NO_INPUT);
    const after = s.enemies.find((e) => e.id === waiting.id)!;
    expect(after.isAlive).toBe(false);
    expect(after.phase).not.toBe("Diving");
  });

  it("does not launch while the game is not in combat", () => {
    let s = tick(readyWave(5), 16, NO_INPUT);
    const waiting = wiggling(s).find((e) => e.wiggleTimer > WIGGLE_DURATION)!;
    s = { ...s, phase: "GameOver" };
    for (let i = 0; i < 120; i++) s = tick(s, 16, NO_INPUT);
    expect(s.enemies.find((e) => e.id === waiting.id)!.phase).not.toBe("Diving");
  });

  describe("fire while waiting", () => {
    /** The batch just launched, every other ship's gun silenced; `id` is set to `mut`'s shape. */
    function withWaiter(tier: Enemy["tier"], wiggleTimer: number, guardian = false) {
      const s = tick(readyWave(5), 16, NO_INPUT);
      const waiter = wiggling(s).find((e) => e.wiggleTimer > WIGGLE_DURATION)!;
      const state: StarSwarmState = {
        ...s,
        nextDiveTimer: 99999,
        guardianThresholdCrossed: guardian,
        enemyBullets: [],
        enemies: s.enemies.map((e) =>
          e.id === waiter.id
            ? { ...e, tier, wiggleTimer, shootTimer: 5, burstShotsLeft: 0 }
            : { ...e, shootTimer: 1e9 }
        ),
      };
      return { state, id: waiter.id };
    }
    const get = (s: StarSwarmState, id: number) => s.enemies.find((e) => e.id === id)!;

    it("an Elite waiting out its stagger fires like one in Formation", () => {
      const { state, id } = withWaiter("Elite", WIGGLE_DURATION + 400);
      const s = tick(state, 16, NO_INPUT);
      expect(s.enemyBullets).toHaveLength(1);
      expect(get(s, id).phase).toBe("Wiggling");
      expect(get(s, id).shootTimer).toBeGreaterThanOrEqual(SHOOT_INTERVAL_BASE);
    });

    it("a Guardian waiting out its stagger fires a burst at the Formation cadence", () => {
      const { state, id } = withWaiter("Guardian", WIGGLE_DURATION + 600, true);
      const s = tick(state, 16, NO_INPUT);
      expect(s.enemyBullets).toHaveLength(1);
      expect(get(s, id).burstShotsLeft).toBeGreaterThan(0);
      expect(get(s, id).shootTimer).toBe(BURST_INTERVAL);
    });

    it("the real wiggle stays silent", () => {
      const { state } = withWaiter("Elite", WIGGLE_DURATION - 100);
      const s = tick(state, 16, NO_INPUT);
      expect(s.enemyBullets).toHaveLength(0);
    });
  });

  it("never exceeds diveCap simultaneous divers, even with the dive timer firing every tick", () => {
    // Codex's scenario: a settled wave-20 Ensign run, no rocks. A ship that is scheduled keeps
    // its slot through its whole wait and wiggle until it actually launches.
    seedRng(7);
    _resetIds();
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 20, 3, "Ensign");
    s = advanceMs(s, 8000);
    s = { ...s, asteroids: [] };
    const cap = diveCap(20);
    let peak = 0;
    for (let i = 0; i < 400 && s.phase === "Playing"; i++) {
      s = tick({ ...s, nextDiveTimer: 1 }, 16, NO_INPUT);
      peak = Math.max(peak, s.enemies.filter((e) => e.isAlive && e.phase === "Diving").length);
      expect(s.enemies.filter((e) => e.isAlive && e.phase === "Diving").length).toBeLessThanOrEqual(
        cap
      );
    }
    expect(peak).toBeGreaterThan(0);
  });

  it("the straggler rule bypasses the fan and the stagger: survivors wiggle together", () => {
    const s0 = readyWave(5);
    const guardians = s0.enemies.filter((e) => e.isAlive && e.tier === "Guardian").slice(0, 3);
    expect(guardians).toHaveLength(3);
    const keep = new Set(guardians.map((e) => e.id));
    const s = tick(
      {
        ...s0,
        guardianThresholdCrossed: true,
        enemies: s0.enemies.map((e) =>
          e.tier === "Carrier" || keep.has(e.id) ? e : { ...e, isAlive: false, hp: 0 }
        ),
      },
      16,
      NO_INPUT
    );
    const w = wiggling(s);
    expect(w).toHaveLength(3);
    expect(new Set(w.map((e) => e.wiggleTimer)).size).toBe(1);
    expect(w.every((e) => e.wiggleTimer <= WIGGLE_DURATION)).toBe(true);
  });
});
