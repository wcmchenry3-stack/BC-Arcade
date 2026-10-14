/**
 * Star Swarm per-wave stats (#3245): the dense record, copy-on-write bumps, the wave's open and
 * close points, the snapshot, the wire format and its size cap. The registry-driven coverage
 * check is `waveStats.contract.test.ts`.
 */
import * as path from "path";
import ts from "typescript";
import {
  ASTEROID_KINDS,
  BUDDY_HIT_CAUSES,
  CARRIER_STAGES,
  CANVAS_H,
  CANVAS_W,
  ENEMY_TIERS,
  HIT_CAUSES,
  HIT_RESULTS,
  KILL_METHODS,
  POWERUP_SOURCES,
  POWERUP_TYPES,
  REGISTRIES,
  ROCK_BREAKERS,
  WAVE_STATS_MAX_BYTES,
  _resetIds,
  applyPowerUp,
  bumpWave,
  closeWave,
  emptyWaveStats,
  initStarSwarm,
  killEscorts,
  throwAsteroid,
  tick,
  toWirePayload,
  waveJustClosed,
  type WaveStats,
  type WaveStatsSnapshot,
} from "../engine";
import { TIER_ORDER } from "../engine/stats";
import { bumpWaveIn, markWaveDev } from "../engine/waveStats";
import type { Bullet, StarSwarmState } from "../types";
import {
  NO_INPUT,
  advanceMs,
  clearWave,
  clearedSnapshot,
  closesAlong,
  diedSnapshot,
  killShip,
  shotOnShip,
  untilPlaying,
} from "./helpers/engineFixtures";

beforeEach(() => _resetIds());

const START = { lives: 3, guns: 1, hull: 0 } as const;
/** #3248: wave 1's roster by tier — `combat.spawned` as the wave opens. */
const WAVE1_ROSTER = { Grunt: 16, Elite: 16, Guardian: 4, Carrier: 1 } as const;

function run(wave = 1): StarSwarmState {
  return initStarSwarm(CANVAS_W, CANVAS_H, wave, 42, "Commander");
}

/** Every numeric leaf of `v`, with its dotted path. */
function leaves(v: unknown, at = ""): [string, unknown][] {
  if (v === null || typeof v !== "object") return [[at, v]];
  return Object.entries(v).flatMap(([k, x]) => leaves(x, at ? `${at}.${k}` : k));
}

describe("registries", () => {
  it("TIER_ORDER is the ENEMY_TIERS registry itself", () => {
    expect(TIER_ORDER).toBe(ENEMY_TIERS);
  });

  it("hold the v1 schema's values", () => {
    expect(REGISTRIES).toEqual({
      POWERUP_TYPES: ["lightning", "shield", "buddy", "bomb", "salvage", "hull"],
      POWERUP_SOURCES: ["kill", "rock", "carrier", "dev"],
      ENEMY_TIERS: ["Grunt", "Elite", "Guardian", "Carrier"],
      ASTEROID_KINDS: ["large", "small"],
      ROCK_BREAKERS: ["player", "enemy", "bomb", "contact"],
      HIT_CAUSES: ["bullet", "rock", "beam", "ram"],
      BUDDY_HIT_CAUSES: ["bullet", "beam", "rock"],
      HIT_RESULTS: ["life", "plating", "shield"],
      KILL_METHODS: ["shot", "dive", "rout", "bomb", "ram", "rock", "buddy"],
      CARRIER_STAGES: ["protected", "exposed", "finalStand"],
    });
  });

  it("a hand-written Record keyed by a registry type must list every value; paths are typed", () => {
    // Type-checks a small virtual file with the real compiler. Each `@ts-expect-error` must be
    // used: if the line under it compiled, the directive itself would be an error (TS2578).
    // (The stats tables are built from the registries, so this is not what catches a new
    // registry value — the contract test is.)
    const engineDir = path.resolve(__dirname, "../engine");
    const source = `
      import type { EnemyTier, PowerUpType } from ${JSON.stringify(`${engineDir}/registries`)};
      import { bumpWave, emptyWaveStats } from ${JSON.stringify(`${engineDir}/waveStats`)};

      // @ts-expect-error -- "hull" is missing
      export const noHull: Record<PowerUpType, number> =
        { lightning: 0, shield: 0, buddy: 0, bomb: 0, salvage: 0 };
      // @ts-expect-error -- "Carrier" is missing
      export const noCarrier: Record<EnemyTier, number> = { Grunt: 0, Elite: 0, Guardian: 0 };

      const ws = emptyWaveStats({ lives: 3, guns: 1, hull: 0 });
      export const ok = bumpWave(ws, ["combat", "kills", "Grunt", "shot"], 1);
      // @ts-expect-error -- not a kill method
      export const badKey = bumpWave(ws, ["combat", "kills", "Grunt", "laser"], 1);
      // @ts-expect-error -- a section, not a counter
      export const notLeaf = bumpWave(ws, ["combat", "kills"], 1);
      // @ts-expect-error -- a flag, not a counter
      export const flag = bumpWave(ws, ["dev"], 1);
    `;
    const file = path.join(engineDir, "__virtual_registry_check__.ts");
    const options: ts.CompilerOptions = {
      strict: true,
      noUncheckedIndexedAccess: true,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      types: [],
    };
    const host = ts.createCompilerHost(options);
    const getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (name, lang, ...rest) =>
      name === file ? ts.createSourceFile(name, source, lang) : getSourceFile(name, lang, ...rest);
    const fileExists = host.fileExists.bind(host);
    host.fileExists = (name) => name === file || fileExists(name);
    const program = ts.createProgram([file], options, host);
    const diags = ts
      .getPreEmitDiagnostics(program)
      .map(
        (d) => `${d.file?.fileName ?? ""}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`
      );
    expect(diags).toEqual([]);
  }, 60_000);
});

describe("emptyWaveStats", () => {
  const ws = emptyWaveStats(START);

  it("has every registry key, every counter at 0", () => {
    for (const t of POWERUP_TYPES) {
      for (const src of POWERUP_SOURCES) expect(ws.powerUps.spawned[t][src]).toBe(0);
      expect(ws.powerUps.collected[t]).toBe(0);
      expect(ws.powerUps.missed[t]).toBe(0);
      expect(ws.powerUps.leftover[t]).toBe(0);
      expect(ws.powerUps.expired[t]).toBe(0);
      expect(ws.powerUps.activeMs[t]).toBe(0);
    }
    for (const k of ASTEROID_KINDS) expect(ws.rocks.spawned[k]).toBe(0);
    for (const b of ROCK_BREAKERS) expect(ws.rocks.broken[b]).toBe(0);
    for (const r of HIT_RESULTS) expect(ws.rocks.playerHits[r]).toBe(0);
    for (const tier of ENEMY_TIERS) {
      expect(ws.rocks.enemiesStruck[tier]).toBe(0);
      expect(ws.rocks.enemiesDestroyed[tier]).toBe(0);
      expect(ws.rocks.dodge[tier]).toEqual({
        rolls: 0,
        dodged: 0,
        pathRolls: 0,
        pathDodged: 0,
        flak: 0,
      });
      expect(ws.buddy.kills[tier]).toBe(0);
      expect(ws.combat.spawned[tier]).toBe(0);
      for (const m of KILL_METHODS) expect(ws.combat.kills[tier][m]).toBe(0);
    }
    for (const c of BUDDY_HIT_CAUSES) {
      expect(ws.buddy.hits[c]).toBe(0);
      expect(ws.buddy.destroyed[c]).toBe(0);
    }
    for (const stage of CARRIER_STAGES) expect(ws.carrier.stageReachedMs[stage]).toBeNull();
    for (const c of HIT_CAUSES) for (const r of HIT_RESULTS) expect(ws.damage.hits[c][r]).toBe(0);
  });

  it("has no key the registries don't list", () => {
    expect(Object.keys(ws.powerUps.spawned)).toEqual([...POWERUP_TYPES]);
    expect(Object.keys(ws.powerUps.spawned.bomb)).toEqual([...POWERUP_SOURCES]);
    expect(Object.keys(ws.rocks.broken)).toEqual([...ROCK_BREAKERS]);
    expect(Object.keys(ws.combat.kills)).toEqual([...ENEMY_TIERS]);
    expect(Object.keys(ws.combat.kills.Carrier)).toEqual([...KILL_METHODS]);
    expect(Object.keys(ws.damage.hits)).toEqual([...HIT_CAUSES]);
    expect(Object.keys(ws.buddy.hits)).toEqual([...BUDDY_HIT_CAUSES]);
    expect(Object.keys(ws.carrier.stageReachedMs)).toEqual([...CARRIER_STAGES]);
  });

  it("starts the wave's pacing at 0 from the given loadout, not flagged dev", () => {
    expect(ws.pacing).toEqual({ durationMs: 0, start: START, bonusLives: 0 });
    expect(ws.dev).toBe(false);
    expect(ws.rout).toEqual({ triggered: false, atMs: null, grunts: 0, caught: 0, escaped: 0 });
    expect(ws.damage.deathCause).toBeNull();
    for (const [at, n] of leaves(ws)) {
      if (typeof n === "number" && !at.startsWith("pacing.start")) expect([at, n]).toEqual([at, 0]);
    }
  });

  it("builds fresh tables every call (nothing shared between waves)", () => {
    const other = emptyWaveStats(START);
    expect(other).toEqual(ws);
    expect(other.combat.kills.Grunt).not.toBe(ws.combat.kills.Grunt);
  });
});

describe("bumpWave", () => {
  const ws = emptyWaveStats(START);

  it("adds to one counter, copy-on-write", () => {
    const next = bumpWave(ws, ["combat", "kills", "Grunt", "shot"], 2);
    expect(next.combat.kills.Grunt.shot).toBe(2);
    expect(ws.combat.kills.Grunt.shot).toBe(0); // the input is untouched
    // the path is copied ...
    expect(next).not.toBe(ws);
    expect(next.combat).not.toBe(ws.combat);
    expect(next.combat.kills).not.toBe(ws.combat.kills);
    expect(next.combat.kills.Grunt).not.toBe(ws.combat.kills.Grunt);
    // ... everything else is shared
    expect(next.combat.kills.Elite).toBe(ws.combat.kills.Elite);
    expect(next.combat.spawned).toBe(ws.combat.spawned);
    expect(next.powerUps).toBe(ws.powerUps);
    expect(next.pacing).toBe(ws.pacing);
  });

  it("bumps a top-level section counter", () => {
    const next = bumpWave(bumpWave(ws, ["pacing", "bonusLives"], 1), ["pacing", "bonusLives"], 1);
    expect(next.pacing.bonusLives).toBe(2);
    expect(next.pacing.start).toBe(ws.pacing.start);
  });

  it("returns the same object when n === 0", () => {
    expect(bumpWave(ws, ["powerUps", "spawned", "bomb", "kill"], 0)).toBe(ws);
    const s = run();
    expect(bumpWaveIn(s, ["rocks", "buddyHits"], 0)).toBe(s);
    expect(bumpWaveIn(s, ["rocks", "buddyHits"], 1).waveStats.rocks.buddyHits).toBe(1);
  });
});

describe("the wave's accumulator", () => {
  it("opens with the ship's loadout and no closed wave", () => {
    const s = run();
    // #3248: the roster the wave was built with is counted as spawned at open
    const empty = emptyWaveStats(START);
    expect(s.waveStats).toEqual({ ...empty, combat: { ...empty.combat, spawned: WAVE1_ROSTER } });
    expect(s.lastClosedWave).toBeNull();
  });

  it("accumulates tick dt across every phase of the wave", () => {
    let s = run();
    expect(s.phase).toBe("SwoopIn");
    s = tick(s, 16, NO_INPUT);
    s = tick(s, 33, NO_INPUT);
    expect(s.waveStats.pacing.durationMs).toBe(49);
    s = untilPlaying(s);
    const swoop = s.waveStats.pacing.durationMs;
    s = tick(s, 20, NO_INPUT);
    expect(s.phase).toBe("Playing");
    expect(s.waveStats.pacing.durationMs).toBe(swoop + 20);
    // a zero-length tick doesn't touch it
    expect(tick(s, 0, NO_INPUT).waveStats).toBe(s.waveStats);
  });

  it("resets when the next wave opens", () => {
    let s = advanceMs(run(), 500);
    s = { ...s, player: { ...s.player, guns: 2, hull: 1 } };
    s = bumpWaveIn(s, ["combat", "shotsFired"], 7);
    const next = clearWave(s);
    expect(next.wave).toBe(2);
    expect(next.waveStats.combat.shotsFired).toBe(0);
    expect(next.waveStats.pacing.start).toEqual({ lives: 3, guns: 2, hull: 1 });
    // the clear tick itself was the old wave's, so the new one hasn't ticked yet
    expect(next.waveStats.pacing.durationMs).toBe(0);
    expect(next.lastClosedWave?.combat.shotsFired).toBe(7);
  });

  it("counts a bonus life against the wave it was granted on", () => {
    let s = advanceMs(initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Ensign"), 8000);
    s = { ...s, score: 29_999 };
    const enemy = s.enemies.find((e) => e.isAlive)!;
    const kill: Bullet = {
      id: 4_242,
      x: enemy.x,
      y: enemy.y,
      vx: 0,
      vy: 0,
      owner: "player",
      width: enemy.width,
      height: enemy.height,
      damage: 10,
    };
    s = tick({ ...s, playerBullets: [kill] }, 16, NO_INPUT);
    expect(s.bonusLivesAwarded).toBe(1);
    expect(s.waveStats.pacing.bonusLives).toBe(1);
  });
});

describe("closeWave", () => {
  it("closes a cleared wave into a frozen v1 snapshot", () => {
    let s = untilPlaying(run());
    s = { ...s, player: { ...s.player, guns: 3, hull: 2 } };
    const next = clearWave(s);
    const snap = next.lastClosedWave!;
    const entry = next.scoreLedger.waves.find((w) => w.wave === 1)!;
    expect(snap).toMatchObject({
      v: 1,
      wave: 1,
      difficulty: "Commander",
      outcome: "cleared",
      dev: false,
      score: { pts: entry.pts, runningTotal: next.score },
    });
    expect(snap.pacing.start).toEqual(START);
    expect(snap.pacing.end).toEqual({ lives: 3, guns: 3, hull: 2 });
    expect(snap.pacing.durationMs).toBeGreaterThan(0);
    expect(Number.isInteger(snap.pacing.durationMs)).toBe(true);
    expect(snap.score.pts.clear).toBeGreaterThan(0); // the wave-clear bonus is this wave's
    expect(snap.score.total).toBe(Object.values(entry.pts).reduce((a, b) => a + b, 0));
    expect(snap.damage.deathCause).toBeNull();
    // frozen all the way down
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.pacing.start)).toBe(true);
    expect(Object.isFrozen(snap.combat.kills.Grunt)).toBe(true);
    expect(Object.isFrozen(snap.score.pts)).toBe(true);
  });

  it("scores only the closing wave's points; a wave that scored nothing has empty pts", () => {
    const s = { ...run(2), score: 5_000 };
    const quiet = closeWave(s, "cleared");
    expect(quiet.score).toEqual({ total: 0, runningTotal: 5_000, pts: {} });
    const withEarlier: StarSwarmState = {
      ...s,
      scoreLedger: {
        waves: [
          { wave: 1, pts: { Grunt: 900 } },
          { wave: 2, pts: { Grunt: 100, "Elite:dive": 400 } },
        ],
        earlier: null,
      },
    };
    expect(closeWave(withEarlier, "died").score).toEqual({
      total: 500,
      runningTotal: 5_000,
      pts: { Grunt: 100, "Elite:dive": 400 },
    });
  });

  it("closes the wave the run ended on as died, once", () => {
    let s = advanceMs(untilPlaying(run()), 1000);
    const before = s.waveStats.pacing.durationMs;
    s = killShip(s);
    expect(s.phase).toBe("GameOver");
    const snap = s.lastClosedWave!;
    expect(snap.outcome).toBe("died");
    expect(snap.wave).toBe(1);
    expect(snap.pacing.end.lives).toBe(0);
    expect(snap.pacing.durationMs).toBe(before + 16);
    expect(snap.damage.deathCause).toBe("bullet"); // #3248: killShip's lethal shot
    // GameOver is terminal: no further tick closes anything
    expect(tick(s, 16, NO_INPUT)).toBe(s);
  });

  it("does not close a wave whose same-tick GameOver a bonus life reverts", () => {
    let s = advanceMs(initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Ensign"), 8000);
    s = { ...s, score: 29_999, player: { ...s.player, lives: 1, invincibleTimer: 0 } };
    const enemy = s.enemies.find((e) => e.isAlive)!;
    const kill: Bullet = {
      id: 77_781,
      x: enemy.x,
      y: enemy.y,
      vx: 0,
      vy: 0,
      owner: "player",
      width: enemy.width,
      height: enemy.height,
      damage: 10,
    };
    const next = tick({ ...s, playerBullets: [kill], enemyBullets: [shotOnShip(s)] }, 16, NO_INPUT);
    expect(next.phase).not.toBe("GameOver");
    expect(next.lastClosedWave).toBeNull();
    expect(waveJustClosed(s, next)).toBeNull();
    expect(next.waveStats.pacing.bonusLives).toBe(1);
  });
});

describe("waveJustClosed", () => {
  it("fires exactly once per cleared wave", () => {
    const s = untilPlaying(run());
    const cleared = { ...s, enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })) };
    // tick on until wave 2's combat is live (then the step hands back the same state)
    const step = (x: StarSwarmState) =>
      x.wave === 2 && x.phase === "Playing" ? x : tick(x, 16, NO_INPUT);
    const { end, closed } = closesAlong(cleared, step, 5000);
    expect([end.wave, end.phase]).toEqual([2, "Playing"]);
    expect(closed.map((c) => [c.wave, c.outcome])).toEqual([[1, "cleared"]]);
  });

  it("fires exactly once when the run ends", () => {
    const s = advanceMs(untilPlaying(run()), 500);
    const { closed } = closesAlong(s, (x) => (x === s ? killShip(x) : tick(x, 16, NO_INPUT)), 50);
    expect(closed.map((c) => [c.wave, c.outcome])).toEqual([[1, "died"]]);
  });

  it("is null when nothing closed", () => {
    const s = run();
    expect(waveJustClosed(s, tick(s, 16, NO_INPUT))).toBeNull();
  });
});

describe("dev flag", () => {
  const playing = () => untilPlaying(run());

  it.each([
    ["a dev power-up", (s: StarSwarmState) => applyPowerUp(s, "shield")],
    ["a dev rock", (s: StarSwarmState) => throwAsteroid(s)],
    ["killing the escorts", (s: StarSwarmState) => killEscorts(s)],
    ["a dev toggle", (s: StarSwarmState) => tick({ ...s, dodgeDisabled: true }, 16, NO_INPUT)],
    [
      "a dev toggle (straggler)",
      (s: StarSwarmState) => tick({ ...s, pauseStraggler: true }, 16, NO_INPUT),
    ],
  ])("is set by %s", (_label, act) => {
    const s = playing();
    expect(s.waveStats.dev).toBe(false);
    expect(act(s).waveStats.dev).toBe(true);
  });

  it("is set on a run that opens past wave 1 (the dev wave jump)", () => {
    expect(run(1).waveStats.dev).toBe(false);
    expect(run(4).waveStats.dev).toBe(true);
  });

  it("is carried into the snapshot and cleared for the next wave", () => {
    const s = markWaveDev(playing());
    const next = clearWave(s);
    expect(next.lastClosedWave?.dev).toBe(true);
    expect(next.waveStats.dev).toBe(false);
  });

  it("is untouched by a dev action that does nothing (not in combat)", () => {
    const s = run(); // SwoopIn
    expect(applyPowerUp(s, "shield")).toBe(s);
    expect(throwAsteroid(s)).toBe(s);
  });
});

/** Every counter set to `n` (times, flags and causes set too): the largest possible payload. */
function worstCase(n: number): WaveStatsSnapshot {
  const fill = (v: unknown): unknown => {
    if (v === null || typeof v === "number") return n;
    if (typeof v !== "object") return v;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]));
  };
  const ws = fill(emptyWaveStats(START)) as WaveStats;
  const pts: Record<string, number> = { clear: n };
  for (const tier of ENEMY_TIERS) {
    pts[tier] = n;
    for (const mod of ["dive", "rout", "bomb", "ram"]) pts[`${tier}:${mod}`] = n;
  }
  return {
    v: 1,
    wave: 999,
    difficulty: "LieutenantCommander",
    outcome: "died",
    dev: true,
    pacing: { ...ws.pacing, durationMs: 9_999_999, end: START },
    score: { total: n * Object.keys(pts).length, runningTotal: 99_999_999, pts },
    powerUps: ws.powerUps,
    rocks: ws.rocks,
    buddy: ws.buddy,
    carrier: ws.carrier,
    rout: { ...ws.rout, triggered: true },
    combat: ws.combat,
    damage: { ...ws.damage, deathCause: "beam" },
  };
}

describe("toWirePayload", () => {
  it("drops zero counters and empty objects, keeps the always-present fields", () => {
    const snap = closeWave(run(), "cleared");
    expect(toWirePayload(snap)).toEqual({
      v: 1,
      wave: 1,
      difficulty: "Commander",
      outcome: "cleared",
      dev: false,
      pacing: { durationMs: 0, start: START, end: START, bonusLives: 0 },
      score: { total: 0, runningTotal: 0, pts: {} },
      powerUps: {},
      rocks: {},
      buddy: {},
      carrier: {},
      rout: { triggered: false, atMs: null, grunts: 0, caught: 0, escaped: 0 },
      combat: { spawned: WAVE1_ROSTER }, // #3248: counted at open
      damage: { deathCause: null },
    });
  });

  it("keeps non-zero counters at their full path, and a stage reached at 0 ms", () => {
    let ws = emptyWaveStats(START);
    ws = bumpWave(ws, ["combat", "kills", "Elite", "dive"], 2);
    ws = bumpWave(ws, ["powerUps", "spawned", "salvage", "rock"], 1);
    ws = bumpWave(ws, ["damage", "hits", "beam", "plating"], 1);
    ws = {
      ...ws,
      carrier: { ...ws.carrier, stageReachedMs: { protected: 0, exposed: 1200, finalStand: null } },
    };
    const wire = toWirePayload(closeWave({ ...run(), waveStats: ws }, "cleared"));
    expect(wire.combat).toEqual({ kills: { Elite: { dive: 2 } } });
    expect(wire.powerUps).toEqual({ spawned: { salvage: { rock: 1 } } });
    expect(wire.damage).toEqual({ hits: { beam: { plating: 1 } }, deathCause: null });
    expect(wire.carrier).toEqual({ stageReachedMs: { protected: 0, exposed: 1200 } });
  });

  it(`fits ${WAVE_STATS_MAX_BYTES} bytes with every counter at its worst`, () => {
    const bytes = JSON.stringify(toWirePayload(worstCase(99_999))).length;
    expect(bytes).toBeLessThanOrEqual(WAVE_STATS_MAX_BYTES);
  });

  it("a closed snapshot from real play serializes inside the cap", () => {
    const snap = clearedSnapshot(untilPlaying(run()));
    expect(JSON.stringify(toWirePayload(snap)).length).toBeLessThanOrEqual(WAVE_STATS_MAX_BYTES);
    expect(diedSnapshot(untilPlaying(run())).outcome).toBe("died");
  });
});
