/**
 * Per-wave Carrier and rout counters (#3249, epic #3244): `carrier.*` and `rout.*` in the
 * wave's accumulator, and their agreement with the run-wide `RunStats`.
 */
import {
  CANVAS_H,
  CANVAS_W,
  closeWave,
  emptyWaveStats,
  initStarSwarm,
  seedRng,
  tick,
  toWirePayload,
  waveJustClosed,
  _resetIds,
} from "../engine";
import type { StarSwarmState } from "../types";
import {
  ASIDE,
  attackRunWave,
  beamFiredWave,
  beamHitWave,
  bombedSnapshot,
  carrierOf,
  caughtAndEscapedSnapshot,
  deflectWave,
  fleeing,
  preRout,
  quietWave,
  reinforcedWave,
  routGruntCount,
  routTick,
  stagesSnapshot,
} from "./helpers/carrierRoutScenarios";

describe("carrier counters (#3249)", () => {
  it("counts reinforcements, matching the wave's own counter and the run total", () => {
    const s = reinforcedWave();
    expect(s.reinforcedThisWave).toBeGreaterThan(0);
    expect(s.waveStats.carrier.gruntsLaunched).toBe(s.reinforcedThisWave);
    expect(s.runStats.reinforced).toBe(s.reinforcedThisWave);
  });

  it("beam fired vs beam hit are separate counters", () => {
    const fired = beamFiredWave();
    expect(fired.waveStats.carrier.beamsFired).toBe(1);
    expect(fired.waveStats.carrier.beamHits).toBe(0);
    const hit = beamHitWave();
    expect(hit.waveStats.carrier.beamHits).toBe(1);
    expect(hit.waveStats.carrier.beamsFired).toBe(0);
    expect(hit.runStats.beamHits).toBe(1);
  });

  it("counts armor deflects and attack runs", () => {
    const d = deflectWave();
    expect(d.waveStats.carrier.armorDeflects).toBe(1);
    expect(d.runStats.armorDeflects).toBe(1);
    const r = attackRunWave();
    expect(r.waveStats.carrier.attackRuns).toBe(1);
    // the run is one run, however many ticks it lasts
    expect(tick(r, 16, ASIDE).waveStats.carrier.attackRuns).toBe(1);
  });

  it("stage times: each stage once, in order, in ms into the wave", () => {
    const { snapshot } = stagesSnapshot();
    const t = snapshot.carrier.stageReachedMs;
    expect(t.protected).toBeGreaterThan(0);
    expect(t.exposed).toBeGreaterThan(t.protected!);
    expect(t.finalStand).toBeGreaterThan(t.exposed!);
    expect(t.finalStand).toBeLessThanOrEqual(snapshot.pacing.durationMs);
  });

  it("a wave with no Carrier leaves every stage null", () => {
    // (the Carrier is gone and the accumulator restarted, as on a wave that never had one)
    const prev = preRout();
    const s = tick({ ...prev, waveStats: emptyWaveStats(prev.waveStats.pacing.start) }, 16, ASIDE);
    expect(Object.values(s.waveStats.carrier.stageReachedMs)).toEqual([null, null, null]);
  });

  it("a stage reached at 0 ms is sent on the wire; one never reached is not", () => {
    const s = quietWave(1);
    const stageReachedMs = { protected: 0, exposed: null, finalStand: null };
    const snap = closeWave(
      { ...s, waveStats: { ...s.waveStats, carrier: { ...s.waveStats.carrier, stageReachedMs } } },
      "cleared"
    );
    expect(toWirePayload(snap).carrier.stageReachedMs).toEqual({ protected: 0 });
  });
});

describe("held and repeated events are not counted (#3249)", () => {
  it("a beam released while the weapons-free gate is shut isn't a beam fired", () => {
    // enemy fire off (the dev toggle) holds the release: the charge ends, nothing enters play
    let s = quietWave(1);
    const c = carrierOf(s);
    s = {
      ...s,
      player: { ...s.player, invincibleTimer: 1e9 },
      enemies: s.enemies.map((e) =>
        e.id === c.id ? { ...e, beamTimer: 100 } : { ...e, shootTimer: 1e9 }
      ),
    };
    expect(s.enemyFireDisabled).toBe(true);
    for (let i = 0; i < 125; i++) s = tick(s, 16, ASIDE);
    expect(s.carrierBeams).toHaveLength(0);
    expect(s.waveStats.carrier.beamsFired).toBe(0);
  });

  it("a fleeing grunt isn't counted again, and a swooping one only when it lands", () => {
    const prev = preRout();
    const swooper = prev.enemies.find((e) => e.isAlive && e.tier === "Grunt")!;
    const withSwooper = {
      ...prev,
      enemies: prev.enemies.map((e) =>
        e.id === swooper.id ? { ...e, phase: "SwoopIn" as const } : e
      ),
    };
    const total = routGruntCount(prev);
    let s = routTick(withSwooper);
    expect(s.waveStats.rout.grunts).toBe(total - 1); // the swooper hasn't been set fleeing
    s = tick(s, 16, ASIDE);
    expect(s.waveStats.rout.grunts).toBeLessThanOrEqual(total);
    expect(s.waveStats.rout.grunts).toBeGreaterThanOrEqual(total - 1);
    for (let i = 0; i < 400; i++) s = tick(s, 16, ASIDE);
    expect(s.wave).toBe(prev.wave); // still the same wave's accumulator
    // everyone who ran is counted exactly once: caught + escaped + still fleeing
    const stillFleeing = fleeing(s).length;
    const { grunts, caught, escaped } = s.waveStats.rout;
    expect(grunts).toBeLessThanOrEqual(total);
    expect(caught + escaped + stillFleeing).toBe(grunts);
  });
});

describe("rout counters (#3249)", () => {
  it("triggers once, with atMs and grunts", () => {
    const prev = preRout();
    expect(prev.waveStats.rout.triggered).toBe(false);
    const s = routTick(prev);
    expect(s.waveStats.rout).toEqual({
      triggered: true,
      atMs: s.waveStats.pacing.durationMs,
      grunts: routGruntCount(prev),
      caught: 0,
      escaped: 0,
    });
    const again = tick(s, 16, ASIDE);
    expect(again.waveStats.rout.atMs).toBe(s.waveStats.rout.atMs);
    expect(again.waveStats.rout.grunts).toBe(s.waveStats.rout.grunts);
    expect(fleeing(s)).toHaveLength(s.waveStats.rout.grunts);
  });

  it("caught by a shot, the rest escaped off the top", () => {
    const { base, snapshot } = caughtAndEscapedSnapshot();
    const r = snapshot.rout;
    expect(r.grunts).toBe(base.waveStats.rout.grunts);
    expect(r.caught).toBe(1);
    expect(r.escaped).toBe(r.grunts - 1);
    expect(r.caught + r.escaped).toBeLessThanOrEqual(r.grunts);
  });

  it("caught by a bomb", () => {
    const { base, snapshot } = bombedSnapshot();
    expect(snapshot.rout.caught).toBe(base.waveStats.rout.grunts);
    expect(snapshot.rout.escaped).toBe(0);
  });

  it("a routed wave has no Carrier, and a Carrier wave doesn't rout", () => {
    const routed = routTick(preRout());
    expect(routed.enemies.some((e) => e.isAlive && e.tier === "Carrier")).toBe(false);
    const carrier = tick(quietWave(1), 16, ASIDE);
    expect(carrierOf(carrier)).toBeDefined();
    expect(carrier.waveStats.rout.triggered).toBe(false);
  });
});

describe("run totals equal the sum of the waves (#3249)", () => {
  it("reinforced, routCaught, routEscaped, armorDeflects, beamHits over a seeded sim", () => {
    seedRng(7);
    _resetIds();
    let s: StarSwarmState = initStarSwarm(CANVAS_W, CANVAS_H, 1, 7, "LieutenantJG");
    const sum = { reinforced: 0, routCaught: 0, routEscaped: 0, armorDeflects: 0, beamHits: 0 };
    const add = (c: StarSwarmState["waveStats"]) => {
      sum.reinforced += c.carrier.gruntsLaunched;
      sum.routCaught += c.rout.caught;
      sum.routEscaped += c.rout.escaped;
      sum.armorDeflects += c.carrier.armorDeflects;
      sum.beamHits += c.carrier.beamHits;
    };
    let closed = 0;
    for (let i = 0; i < 60_000 && s.phase !== "GameOver" && closed < 4; i++) {
      // sweep the ship under the fleet, firing; keep it alive so waves keep closing
      const x = CANVAS_W / 2 + Math.sin(i / 40) * (CANVAS_W / 2 - 20);
      const prev = s;
      s = tick({ ...s, player: { ...s.player, lives: 3 } }, 16, { playerX: x, fire: true });
      const snap = waveJustClosed(prev, s);
      if (snap) {
        closed++;
        add(snap);
        expect(snap.rout.caught + snap.rout.escaped).toBeLessThanOrEqual(snap.rout.grunts);
      }
    }
    expect(closed).toBeGreaterThan(0);
    add(s.waveStats); // the wave still open
    expect(sum).toEqual({
      reinforced: s.runStats.reinforced,
      routCaught: s.runStats.routCaught,
      routEscaped: s.runStats.routEscaped,
      armorDeflects: s.runStats.armorDeflects,
      beamHits: s.runStats.beamHits,
    });
    // the sim must exercise the counters, or the equality above proves little
    expect(
      sum.reinforced + sum.routCaught + sum.routEscaped + sum.armorDeflects + sum.beamHits
    ).toBeGreaterThan(0);
  });
});
