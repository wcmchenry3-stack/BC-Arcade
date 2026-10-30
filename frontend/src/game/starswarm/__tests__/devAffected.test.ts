/**
 * #3510: the run-level dev flag (`StarSwarmState.devAffected`) and the per-wave Guns high
 * (`waveStats.pacing.gunsPeak`): how the engine sets them, that a clean run never sets the flag,
 * and that both survive a paused-run save (and an older save without them still restores).
 */
import {
  CANVAS_H,
  CANVAS_W,
  applyPowerUp,
  initStarSwarm,
  killEscorts,
  throwAsteroid,
  tick,
} from "../engine";
import {
  closeWave,
  emptyWaveStats,
  markWaveDev,
  noteGunsPeak,
  toWirePayload,
  withSavedGunsPeak,
} from "../engine/waveStats";
import { devAffectedResult } from "../devAffected";
import { wireBytes } from "../engine/closedWaves";
import { WAVE_STATS_MAX_BYTES } from "../../_shared/eventQueueConfig";
import { GameRecorder } from "../../_shared/gameRecorder";
import { __resetReplayDialForTests } from "../../_shared/replayDial";
import { WAVE_COMPLETED_EVENT, devRevert } from "../waveEvents";
import { fitsSaveShape, restoreSavedState } from "../saveShape";
import type { StarSwarmState } from "../types";
import { NO_INPUT, advanceMs, clearWave, killShip, untilPlaying } from "./helpers/engineFixtures";
import { onShip, playingWave } from "./helpers/powerUpFixtures";

const run = (wave = 1, opts = {}) =>
  initStarSwarm(CANVAS_W, CANVAS_H, wave, 42, "Commander", undefined, undefined, opts);

/** A state as a paused-run save writes it and reads it back. */
const roundTrip = (s: StarSwarmState): StarSwarmState => {
  const saved: unknown = JSON.parse(JSON.stringify(s));
  if (!fitsSaveShape(saved)) throw new Error("the save doesn't fit");
  return restoreSavedState(saved);
};

describe("devAffected — set by dev-panel actions only (#3510)", () => {
  it("a run opens clean", () => {
    expect(run().devAffected).toBe(false);
  });

  it("the dev panel's New Game opens it dev-affected, even on wave 1 with no wave flagged", () => {
    const s = run(1, { devAffected: true });
    expect(s.devAffected).toBe(true);
    expect(s.waveStats.dev).toBe(false);
  });

  it("a dev wave jump flags the run with its wave", () => {
    const s = run(5);
    expect(s.waveStats.dev).toBe(true);
    expect(s.devAffected).toBe(true);
  });

  it.each([
    ["a dev power-up", (s: StarSwarmState) => applyPowerUp(s, "shield")],
    ["a thrown asteroid", (s: StarSwarmState) => throwAsteroid(s)],
    ["killed escorts", (s: StarSwarmState) => killEscorts(s)],
    ["a live switch", (s: StarSwarmState) => tick({ ...s, pauseStraggler: true }, 16, NO_INPUT)],
    ["markWaveDev", (s: StarSwarmState) => markWaveDev(s)],
  ])("%s flags the run", (_label, act) => {
    const s = untilPlaying(run());
    expect(s.devAffected).toBe(false);
    expect(act(s).devAffected).toBe(true);
  });

  it("the infinite-lives revert flags the run", () => {
    const s = untilPlaying(run());
    const hit = killShip(s);
    const reverted = devRevert(s, { ...hit, phase: s.phase, player: { ...hit.player, lives: 1 } });
    expect(reverted.devAffected).toBe(true);
  });

  it("is latched across waves, while each new wave's own `dev` starts over", () => {
    const flagged = markWaveDev(untilPlaying(run()));
    const next = clearWave(flagged);
    expect(next.wave).toBe(2);
    expect(next.waveStats.dev).toBe(false);
    expect(next.devAffected).toBe(true);
  });

  it("a clean run played through waves to its game over never sets it", () => {
    let s = untilPlaying(run());
    s = clearWave(s);
    s = clearWave(untilPlaying(s));
    expect(s.wave).toBe(3);
    const over = killShip(untilPlaying(s));
    expect(over.phase).toBe("GameOver");
    expect(over.devAffected).toBe(false);
    expect(over.closedWaves.every((w) => !w.dev)).toBe(true);
  });

  it("markWaveDev is a no-op once both the wave and the run are flagged", () => {
    const once = markWaveDev(untilPlaying(run()));
    expect(markWaveDev(once)).toBe(once);
  });
});

describe("devAffected across a paused-run save (#3510)", () => {
  it("a flagged run restores flagged", () => {
    const s = advanceMs(run(1, { devAffected: true }), 500);
    expect(roundTrip(s).devAffected).toBe(true);
  });

  it("a clean run restores clean", () => {
    expect(roundTrip(advanceMs(run(), 500)).devAffected).toBe(false);
  });

  it("an older save without the field restores from its dev waves", () => {
    const flagged = clearWave(markWaveDev(untilPlaying(run()))); // wave 1 closed dev
    const { devAffected: _d, ...older } = JSON.parse(JSON.stringify(flagged)) as StarSwarmState;
    expect(restoreSavedState(older as StarSwarmState).devAffected).toBe(true);

    const devWave = markWaveDev(untilPlaying(run())); // only the live wave is dev
    const { devAffected: _e, ...older2 } = JSON.parse(JSON.stringify(devWave)) as StarSwarmState;
    expect(restoreSavedState(older2 as StarSwarmState).devAffected).toBe(true);

    const clean = untilPlaying(run());
    const { devAffected: _f, ...older3 } = JSON.parse(JSON.stringify(clean)) as StarSwarmState;
    expect(restoreSavedState(older3 as StarSwarmState).devAffected).toBe(false);
  });

  it("a value that isn't a boolean true is read from the waves instead", () => {
    const clean = untilPlaying(run());
    const odd = { ...clean, devAffected: "yes" } as unknown as StarSwarmState;
    expect(restoreSavedState(odd).devAffected).toBe(false);
  });
});

describe("devAffectedResult (#3510)", () => {
  it("is { dev_affected: true } for a flagged run and empty otherwise", () => {
    expect(devAffectedResult({ devAffected: true })).toEqual({ dev_affected: true });
    expect(devAffectedResult({ devAffected: false })).toEqual({});
    expect(devAffectedResult({})).toEqual({});
    expect(devAffectedResult(null)).toEqual({});
    expect(devAffectedResult(undefined)).toEqual({});
  });
});

describe("pacing.gunsPeak (#3510)", () => {
  const START = { lives: 3, guns: 2, hull: 0 } as const;

  it("opens at the wave's starting Guns level", () => {
    expect(emptyWaveStats(START).pacing.gunsPeak).toBe(2);
  });

  it("noteGunsPeak raises it, and hands back the same stats when it isn't a new high", () => {
    const ws = emptyWaveStats(START);
    expect(noteGunsPeak(ws, 1)).toBe(ws);
    expect(noteGunsPeak(ws, 2)).toBe(ws);
    expect(noteGunsPeak(ws, 3).pacing.gunsPeak).toBe(3);
  });

  it("a collected Salvage crate raises it", () => {
    const s = playingWave();
    const next = tick({ ...s, powerUps: [onShip(s, "salvage")] }, 16, NO_INPUT);
    expect(next.player.guns).toBe(2);
    expect(next.waveStats.pacing.gunsPeak).toBe(2);
  });

  it("the dev panel's Salvage raises it too", () => {
    const s = applyPowerUp(playingWave(), "salvage");
    expect(s.player.guns).toBe(2);
    expect(s.waveStats.pacing.gunsPeak).toBe(2);
  });

  it("the close counts the ship's own level, so it is never below `end.guns`", () => {
    const s = playingWave();
    // a level the pickup paths never saw (a hand-set state)
    const snap = closeWave({ ...s, player: { ...s.player, guns: 3 } }, "cleared");
    expect(snap.pacing.gunsPeak).toBe(3);
    expect(toWirePayload(snap).pacing.gunsPeak).toBe(3);
  });

  it("the death that ends the run lowers the guns but not the wave's high", () => {
    let s = playingWave();
    for (let i = 0; i < 2; i++) s = tick({ ...s, powerUps: [onShip(s, "salvage")] }, 16, NO_INPUT);
    const over = killShip(s); // on its last life: the run ends on this wave
    expect(over.player.guns).toBe(2);
    expect(over.lastClosedWave?.pacing.end.guns).toBe(2);
    expect(over.lastClosedWave?.pacing.gunsPeak).toBe(3);
  });

  it("is restored with the paused run", () => {
    let s = playingWave();
    s = tick({ ...s, powerUps: [onShip(s, "salvage")] }, 16, NO_INPUT);
    expect(roundTrip(s).waveStats.pacing.gunsPeak).toBe(2);
  });

  it("an older save's wave stats without it are kept, the field filled from start and ship", () => {
    let s = playingWave();
    s = advanceMs(tick({ ...s, powerUps: [onShip(s, "salvage")] }, 16, NO_INPUT), 300);
    const saved = JSON.parse(JSON.stringify(s)) as StarSwarmState;
    const { gunsPeak: _g, ...olderPacing } = saved.waveStats.pacing;
    const older = { ...saved, waveStats: { ...saved.waveStats, pacing: olderPacing } };
    const restored = restoreSavedState(older as unknown as StarSwarmState);
    // kept, not started over: the wave's clock and counters are the saved ones
    expect(restored.waveStats.pacing.durationMs).toBe(s.waveStats.pacing.durationMs);
    expect(restored.waveStats.powerUps.collected.salvage).toBe(1);
    expect(restored.waveStats.pacing.gunsPeak).toBe(2);
  });

  it("withSavedGunsPeak leaves anything it can't fill for isWaveStats to judge", () => {
    expect(withSavedGunsPeak(null, 1)).toBeNull();
    expect(withSavedGunsPeak([], 1)).toEqual([]);
    const has = { pacing: { start: { guns: 1 }, gunsPeak: 3 } };
    expect(withSavedGunsPeak(has, 1)).toBe(has);
    const badStart = { pacing: { start: { guns: 9 } } };
    expect(withSavedGunsPeak(badStart, 1)).toBe(badStart);
    expect(withSavedGunsPeak({ pacing: { start: { guns: 1 } } }, 3)).toEqual({
      pacing: { start: { guns: 1 }, gunsPeak: 3 },
    });
  });
});

/**
 * #3510 fail-safes (epic #3273): `gunsPeak` rides `wave_completed`, so the bounds and the dial
 * that already govern that event govern it too. Pinned here so a change to any of them shows.
 */
describe("gunsPeak's volume, cap and dial (#3510)", () => {
  const wire = () => toWirePayload(closeWave(playingWave(), "cleared"));

  it("costs 13 bytes of JSON per wave", () => {
    const w = wire();
    const { gunsPeak: _g, ...pacing } = w.pacing;
    const without = { ...w, pacing } as unknown as typeof w;
    expect(wireBytes(w) - wireBytes(without)).toBe(',"gunsPeak":1'.length); // 13
  });

  it("a wave with it still fits the per-wave cap", () => {
    const w = wire();
    expect(wireBytes({ ...w, pacing: { ...w.pacing, gunsPeak: 3 } })).toBeLessThanOrEqual(
      WAVE_STATS_MAX_BYTES
    );
  });

  /** Records `n` waves under the screen's recorder policy; how many reached the sink. */
  function recordWaves(n: number): number {
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
    for (let i = 0; i < n; i++) recorder.record(WAVE_COMPLETED_EVENT, { ...wire() });
    recorder.endSession();
    return saved;
  }

  afterEach(() => __resetReplayDialForTests());

  it("the replay dial's kill switch turns it off with the rest of the wave, no release", () => {
    __resetReplayDialForTests({ fallback: { enabled: false, rate: 1 } });
    expect(recordWaves(3)).toBe(0);
  });

  it("with the dial on, the waves (and the field) go out", () => {
    __resetReplayDialForTests({ fallback: { enabled: true, rate: 1 } });
    expect(recordWaves(3)).toBe(3);
  });
});
