/**
 * #3534: the run's end context: the cause of the lethal hit and the phase it landed in, kept on
 * the state for the game-over card. Client-only: it is not in WaveStats.
 */
import { _resetIds, tick } from "../engine";
import { bonusLifeThreshold } from "../engine/tuning";
import type { StarSwarmState } from "../types";
import { NO_INPUT, makeBeam } from "./helpers/engineFixtures";
import { arena, collide, enemyShot, lone, rock, shot } from "./helpers/waveStatsScenarios";

beforeEach(() => _resetIds());

function lastLife(s: StarSwarmState): StarSwarmState {
  return { ...s, player: { ...s.player, lives: 1 } };
}

describe("endContext at the lethal hit (#3534)", () => {
  it.each([
    ["bullet", (s: StarSwarmState) => ({ enemyBullets: [enemyShot(s.player.x, s.player.y)] })],
    ["rock", (s: StarSwarmState) => ({ asteroids: [rock("small", s.player.x, s.player.y)] })],
    ["beam", (s: StarSwarmState) => ({ carrierBeams: [makeBeam(s.player.x, s.player.y)] })],
  ] as const)("%s: records the cause and the Playing phase", (cause, what) => {
    const s = arena();
    const over = collide(lastLife({ ...s, ...what(s) }));
    expect(over.phase).toBe("GameOver");
    expect(over.endContext).toEqual({ cause, phase: "Playing" });
  });

  it("ram: records the cause", () => {
    const { state, ship } = lone(arena(), "Grunt", { phase: "Diving" });
    const s = {
      ...state,
      guardianThresholdCrossed: true,
      guardianDeepThresholdCrossed: true,
      enemies: state.enemies.map((e) =>
        e.id === ship.id ? { ...ship, x: state.player.x, y: state.player.y } : e
      ),
    };
    const over = collide(lastLife(s));
    expect(over.endContext).toEqual({ cause: "ram", phase: "Playing" });
  });

  it.each(["ClearAwaitingPickups", "Extraction"] as const)(
    "a beam after the last kill, in %s, records that phase",
    (phase) => {
      const s = arena();
      const over = collide(
        lastLife({ ...s, phase, carrierBeams: [makeBeam(s.player.x, s.player.y)] })
      );
      expect(over.phase).toBe("GameOver");
      expect(over.endContext).toEqual({ cause: "beam", phase });
    }
  );

  it("through a full tick, a beam in flight on the last life ends the run with its cause", () => {
    const s = arena();
    const over = tick(
      lastLife({ ...s, carrierBeams: [makeBeam(s.player.x, s.player.y)] }),
      16,
      NO_INPUT
    );
    expect(over.phase).toBe("GameOver");
    expect(over.endContext).toEqual({ cause: "beam", phase: "Playing" });
  });

  it("a hit that isn't the last life records nothing", () => {
    const s = arena();
    const out = collide({ ...s, enemyBullets: [enemyShot(s.player.x, s.player.y)] });
    expect(out.endContext ?? null).toBeNull();
  });

  it("a same-tick bonus life that rescues the ship clears it", () => {
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
    expect(out.endContext ?? null).toBeNull();
  });

  it("stays out of WaveStats", () => {
    const s = arena();
    const over = collide(lastLife({ ...s, carrierBeams: [makeBeam(s.player.x, s.player.y)] }));
    expect(JSON.stringify(over.waveStats)).not.toContain("endContext");
    expect(Object.keys(over.waveStats.damage).sort()).toEqual(
      Object.keys(arena().waveStats.damage).sort()
    );
  });
});
