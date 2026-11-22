/**
 * #3535: `damage.deathPhase` on the `wave_completed` event — when the lethal hit landed
 * (`combat`, `pickupWait`, `extraction`), taken from the client-only end context (#3534) at the
 * lethal hit. Null on a cleared wave and left out of its wire form; cleared with `deathCause` by a
 * same-tick bonus-life rescue.
 */
import {
  DEATH_PHASES,
  WAVE_STATS_MAX_BYTES,
  WAVE_STATS_VERSION,
  _resetIds,
  tick,
  toWirePayload,
  type DeathPhase,
} from "../engine";
import { bonusLifeThreshold } from "../engine/tuning";
import { GameRecorder } from "../../_shared/gameRecorder";
import { __resetReplayDialForTests } from "../../_shared/replayDial";
import { WAVE_COMPLETED_EVENT } from "../waveEvents";
import { withSavedDeathPhase } from "../engine/waveStats";
import { fitsSaveShape, restoreSavedState } from "../saveShape";
import { deathPhaseOf } from "../engine/waveCounters";
import type { GamePhase, StarSwarmState } from "../types";
import { NO_INPUT, advanceMs, makeBeam } from "./helpers/engineFixtures";
import { onShip, parked, playingWave } from "./helpers/powerUpFixtures";
import { arena, enemyShot, lone, rock, shot } from "./helpers/waveStatsScenarios";

beforeEach(() => _resetIds());

const lastLife = (s: StarSwarmState): StarSwarmState => ({
  ...s,
  player: { ...s.player, lives: 1 },
});

/** The arena after its last kill, settled into the pickup wait (a pickup falling) or extraction. */
function afterLastKill(held: boolean): StarSwarmState {
  const s = arena();
  const cleared = {
    ...s,
    enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })),
    powerUps: held ? [parked("salvage")] : [],
  };
  return tick(cleared, 16, NO_INPUT);
}

/** A died wave's snapshot (a lethal beam in combat). */
function closeWaveDied() {
  const s = arena();
  const over = tick(
    lastLife({ ...s, carrierBeams: [makeBeam(s.player.x, s.player.y)] }),
    16,
    NO_INPUT
  );
  return over.lastClosedWave!;
}

/** Ticks until the run ends (or `max` ticks pass). */
function untilOver(s: StarSwarmState, max = 200): StarSwarmState {
  let out = s;
  for (let i = 0; i < max && out.phase !== "GameOver"; i++) out = tick(out, 16, NO_INPUT);
  return out;
}

function expectDied(over: StarSwarmState, cause: string, phase: DeathPhase): void {
  expect(over.phase).toBe("GameOver");
  const snap = over.lastClosedWave!;
  expect(snap.outcome).toBe("died");
  expect(snap.damage.deathCause).toBe(cause);
  expect(snap.damage.deathPhase).toBe(phase);
  // the event the screen sends: the run's last closed wave, in wire form
  const wire = over.closedWaves.at(-1)!;
  expect(wire.outcome).toBe("died");
  expect(wire.damage.deathPhase).toBe(phase);
}

describe("damage.deathPhase (#3535)", () => {
  it("holds the three phases", () => {
    expect(DEATH_PHASES).toEqual(["combat", "pickupWait", "extraction"]);
  });

  it.each<[GamePhase, DeathPhase | null]>([
    ["Playing", "combat"],
    ["ClearAwaitingPickups", "pickupWait"],
    ["Extraction", "extraction"],
    ["SwoopIn", null],
    ["GameOver", null],
  ])("engine phase %s maps to %s", (phase, want) => {
    expect(deathPhaseOf(phase)).toBe(want);
  });

  it("a fresh wave holds null", () => {
    expect(arena().waveStats.damage.deathPhase).toBeNull();
  });

  it.each([
    ["bullet", (s: StarSwarmState) => ({ enemyBullets: [enemyShot(s.player.x, s.player.y)] })],
    ["rock", (s: StarSwarmState) => ({ asteroids: [rock("small", s.player.x, s.player.y)] })],
    ["beam", (s: StarSwarmState) => ({ carrierBeams: [makeBeam(s.player.x, s.player.y)] })],
  ] as const)("a lethal %s in combat, through a full tick, is combat", (cause, what) => {
    const s = arena();
    expectDied(tick(lastLife({ ...s, ...what(s) }), 16, NO_INPUT), cause, "combat");
  });

  it("a lethal hit in the pickup wait is pickupWait", () => {
    const waiting = afterLastKill(true);
    expect(waiting.phase).toBe("ClearAwaitingPickups");
    const { x, y } = waiting.player;
    const over = tick(lastLife({ ...waiting, carrierBeams: [makeBeam(x, y)] }), 16, NO_INPUT);
    expectDied(over, "beam", "pickupWait");
  });

  it("a rock in the pickup wait is pickupWait", () => {
    const waiting = afterLastKill(true);
    expect(waiting.phase).toBe("ClearAwaitingPickups");
    const { x, y } = waiting.player;
    const over = tick(lastLife({ ...waiting, asteroids: [rock("small", x, y)] }), 16, NO_INPUT);
    expectDied(over, "rock", "pickupWait");
  });

  it("a lethal hit in the extraction is extraction", () => {
    const leaving = afterLastKill(false);
    expect(leaving.phase).toBe("Extraction");
    const { x, y } = leaving.player;
    const over = tick(lastLife({ ...leaving, carrierBeams: [makeBeam(x, y)] }), 16, NO_INPUT);
    expectDied(over, "beam", "extraction");
  });

  it("a beam released before the Carrier died, killing the ship after, is pickupWait", () => {
    // the Carrier's last hit point and a shot on it; its beam already falling toward the ship
    const { state, ship } = lone(arena(5), "Carrier", { hp: 1 });
    const { x, y } = state.player;
    const s = lastLife({
      ...state,
      playerBullets: [shot(ship.x, ship.y)],
      carrierBeams: [makeBeam(x, y - 60)],
    });
    const killed = tick(s, 16, NO_INPUT);
    expect(killed.enemies.some((e) => e.isAlive)).toBe(false);
    // the Carrier's drop is still falling: the pickup wait
    expect(killed.phase).toBe("ClearAwaitingPickups");
    expectDied(untilOver(killed), "beam", "pickupWait");
  });

  it("a same-tick bonus life that rescues the ship clears it with deathCause", () => {
    const { state, ship } = lone(arena(), "Grunt", { hp: 1 });
    const s: StarSwarmState = {
      ...state,
      score: bonusLifeThreshold(state.difficulty) - 1,
      bonusLivesAwarded: 0,
      player: { ...state.player, lives: 1 },
      playerBullets: [shot(ship.x, ship.y)],
      enemyBullets: [enemyShot(state.player.x, state.player.y)],
    };
    const out = tick(s, 16, NO_INPUT);
    expect(out.phase).not.toBe("GameOver");
    expect(out.waveStats.damage.hits.bullet.life).toBe(1); // the lethal hit did land
    expect(out.waveStats.damage.deathCause).toBeNull();
    expect(out.waveStats.damage.deathPhase).toBeNull();
  });

  it("a life lost that isn't the last leaves it null", () => {
    const s = arena();
    const out = tick({ ...s, enemyBullets: [enemyShot(s.player.x, s.player.y)] }, 16, NO_INPUT);
    expect(out.phase).not.toBe("GameOver");
    expect(out.waveStats.damage.deathPhase).toBeNull();
  });
});

describe("damage.deathPhase on the wire (#3535)", () => {
  it("is left out of a cleared wave's payload (sparse)", () => {
    let s = afterLastKill(false);
    for (let i = 0; i < 2000 && s.closedWaves.length === 0; i++) s = tick(s, 16, NO_INPUT);
    const wire = s.closedWaves[0]!;
    expect(wire.outcome).toBe("cleared");
    expect(wire.v).toBe(WAVE_STATS_VERSION);
    expect("deathPhase" in wire.damage).toBe(false);
    expect(wire.damage.deathCause).toBeNull();
  });

  it("is sent on a died wave, and the payload stays inside the per-event cap", () => {
    const s = arena();
    const over = tick(
      lastLife({ ...s, carrierBeams: [makeBeam(s.player.x, s.player.y)] }),
      16,
      NO_INPUT
    );
    const wire = toWirePayload(over.lastClosedWave!);
    expect(wire.damage).toMatchObject({ deathCause: "beam", deathPhase: "combat" });
    expect(JSON.stringify(wire).length).toBeLessThanOrEqual(WAVE_STATS_MAX_BYTES);
  });

  it("is version 2", () => {
    expect(WAVE_STATS_VERSION).toBe(2);
  });
});

describe("damage.deathPhase fail-safes (#3535): it rides wave_completed's dial", () => {
  /** A died wave's event, recorded as the screen does at the run's end; how many were saved. */
  function recordDiedWave(): number {
    const s = arena();
    const over = tick(
      lastLife({ ...s, carrierBeams: [makeBeam(s.player.x, s.player.y)] }),
      16,
      NO_INPUT
    );
    const wire = over.closedWaves.at(-1)!;
    expect(wire.damage.deathPhase).toBe("combat");
    let saved = 0;
    const recorder = new GameRecorder({
      gameType: "starswarm",
      policy: "on_session_end",
      sink: {
        canAccept: () => true,
        enqueueMany: (events) => {
          saved += events.length;
          return true;
        },
      },
      schedule: () => undefined,
      report: () => undefined,
    });
    recorder.startSession();
    recorder.record(WAVE_COMPLETED_EVENT, { ...wire });
    recorder.endSession();
    return saved;
  }

  afterEach(() => __resetReplayDialForTests());

  it("replay_enabled false: the event (and the field) is not recorded", () => {
    __resetReplayDialForTests({ fallback: { enabled: false, rate: 1 } });
    expect(recordDiedWave()).toBe(0);
  });

  it("replay_enabled true: it goes out", () => {
    __resetReplayDialForTests({ fallback: { enabled: true, rate: 1 } });
    expect(recordDiedWave()).toBe(1);
  });
});

describe("damage.deathPhase and the paused-run save (#3535)", () => {
  it("an older save's wave stats without it are kept, the field restored as null", () => {
    let s = playingWave();
    s = advanceMs(tick({ ...s, powerUps: [onShip(s, "salvage")] }, 16, NO_INPUT), 300);
    const saved = JSON.parse(JSON.stringify(s)) as StarSwarmState;
    const { deathPhase: _p, ...olderDamage } = saved.waveStats.damage;
    const older = { ...saved, waveStats: { ...saved.waveStats, damage: olderDamage } };
    expect(fitsSaveShape(older)).toBe(true);
    const restored = restoreSavedState(older as unknown as StarSwarmState);
    // kept, not started over: the wave's clock and counters are the saved ones
    expect(restored.waveStats.pacing.durationMs).toBe(s.waveStats.pacing.durationMs);
    expect(restored.waveStats.powerUps.collected.salvage).toBe(1);
    expect(restored.waveStats.damage.deathPhase).toBeNull();
  });

  it("a current save round-trips it", () => {
    const s = playingWave();
    const saved: unknown = JSON.parse(JSON.stringify(s));
    expect(fitsSaveShape(saved)).toBe(true);
    expect(restoreSavedState(saved as StarSwarmState).waveStats.damage.deathPhase).toBeNull();
  });

  it("a saved wave stats with an unknown phase starts the wave's stats over", () => {
    let s = playingWave();
    s = advanceMs(s, 300);
    const saved = JSON.parse(JSON.stringify(s)) as StarSwarmState;
    const bad = {
      ...saved,
      waveStats: { ...saved.waveStats, damage: { ...saved.waveStats.damage, deathPhase: "warp" } },
    };
    const restored = restoreSavedState(bad as unknown as StarSwarmState);
    expect(restored.waveStats.pacing.durationMs).toBe(0);
    expect(restored.waveStats.damage.deathPhase).toBeNull();
  });

  it.each([
    ["a known phase restores as saved", "pickupWait", 1],
    ["an unknown phase drops the saved list", "warp", 0],
    ["a null phase (never on the wire) drops the saved list", null, 0],
  ] as const)("a saved closed wave's deathPhase: %s", (_label, phase, kept) => {
    const s = playingWave();
    const died = {
      ...toWirePayload(closeWaveDied()),
      damage: { deathCause: "beam", deathPhase: phase },
    };
    const saved = JSON.parse(JSON.stringify({ ...s, closedWaves: [died] })) as StarSwarmState;
    expect(restoreSavedState(saved).closedWaves).toHaveLength(kept);
  });

  it("withSavedDeathPhase leaves anything it can't fill for isWaveStats to judge", () => {
    expect(withSavedDeathPhase(null)).toBeNull();
    expect(withSavedDeathPhase([])).toEqual([]);
    const has = { damage: { deathCause: null, deathPhase: null } };
    expect(withSavedDeathPhase(has)).toBe(has);
    const noDamage = { pacing: {} };
    expect(withSavedDeathPhase(noDamage)).toBe(noDamage);
    expect(withSavedDeathPhase({ damage: { deathCause: null } })).toEqual({
      damage: { deathCause: null, deathPhase: null },
    });
  });
});
