/**
 * Cascade's session records its play on the shared recorder (#3858), through the real
 * `useGameRecorder` and the real `gameEventClient`:
 *  - `game_started` carries the seeds, the tuning and `engine_version`;
 *  - drops and merges stay in memory, and a unit of 20 drops is saved in one `enqueueEvents`
 *    call at the next idle moment, never one write per drop;
 *  - going to the background saves the unit waiting, synchronously;
 *  - the end saves the last unit before `game_ended`, which adds the end and capstone steps;
 *  - with the replay dial off for the session, nothing is recorded at all;
 *  - a restored game numbers its units after the save's;
 *  - a Sentry event raised during the game carries `game.id` and `game.type` (#3277).
 */
import * as Sentry from "@sentry/react-native";
import { act, renderHook } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";

import { gameEventClient } from "../../_shared/gameEventClient";
import { NO_GAME, taggedSessionGameId, clearSessionTags } from "../../_shared/sessionTags";
import { CASCADE_TUNING_ID } from "../constants";
import type { EngineEvent } from "../engine";
import { useCascadeSession } from "../useCascadeSession";

const setTag = Sentry.setTag as jest.Mock;

function fakeClock() {
  return {
    reset: jest.fn(),
    restore: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
    elapsed: () => 61_000,
  };
}

const merge = (step: number, tierA: number): EngineEvent => ({
  type: "merge",
  tierA,
  tierB: tierA,
  result: tierA + 1,
  x: 0,
  y: 0,
  id: step,
  parentIds: [1, 2],
  step,
});

async function mount() {
  const engine = { steps: 0 };
  const inputs = {
    scoreRef: { current: 0 },
    dropCountRef: { current: 0 },
    maxTierRef: { current: 0 },
    themeIdRef: { current: "fruits" },
    clock: fakeClock(),
    engineRef: { current: engine as never },
    seedsRef: { current: { queue: 11, engine: 22 } },
  };
  const view = await renderHook(() => useCascadeSession(inputs));
  return { ...view, engine, inputs };
}

/** What `enqueueEvents` was handed, one entry per call. */
const saves = () =>
  (gameEventClient.enqueueEvents as jest.Mock).mock.calls.map(
    ([, events]: [string, { type: string; data: Record<string, unknown> }[]]) => events
  );

let appStateListener: ((s: AppStateStatus) => void) | null = null;

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(gameEventClient, "startGame");
  jest.spyOn(gameEventClient, "enqueueEvents");
  jest.spyOn(gameEventClient, "completeGame");
  setTag.mockClear();
  appStateListener = null;
  jest.spyOn(AppState, "addEventListener").mockImplementation((type, cb) => {
    if (type === "change") appStateListener = cb as (s: AppStateStatus) => void;
    return { remove: jest.fn() } as never;
  });
});

afterEach(() => {
  const open = taggedSessionGameId();
  if (open) clearSessionTags(open);
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("Cascade session recording (#3858)", () => {
  it("game_started carries the seeds, the tuning and engine_version", async () => {
    const { result } = await mount();
    await act(() => result.current.startSession("cosmos"));
    expect(gameEventClient.startGame).toHaveBeenLastCalledWith(
      "cascade",
      {},
      {
        fruit_set: "cosmos",
        theme: "cosmos",
        seed: 11,
        engine_seed: 22,
        tuning: CASCADE_TUNING_ID,
        engine_version: 1,
        app_version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
      }
    );
  });

  it("keeps drops and merges in memory, and saves a unit of 20 drops in one call at idle", async () => {
    const { result, engine } = await mount();
    await act(() => result.current.startSession("fruits"));
    const { rec } = result.current;
    for (let i = 0; i < 19; i += 1) {
      engine.steps = i * 90;
      expect(rec.drop(i % 6, 100.04 + i)).toBe(Math.round((100.04 + i) * 10) / 10);
      rec.events([merge(i * 90 + 40, 0)]);
    }
    await act(() => jest.advanceTimersByTime(5000));
    expect(gameEventClient.enqueueEvents).not.toHaveBeenCalled();
    engine.steps = 1800;
    rec.drop(2, 250);
    expect(gameEventClient.enqueueEvents).not.toHaveBeenCalled(); // saved at idle, not in the tap
    await act(() => jest.advanceTimersByTime(5000));
    expect(saves()).toHaveLength(1);
    const [drop, mergeEvent] = saves()[0]!;
    expect(drop!.type).toBe("drop");
    expect((drop!.data.d as number[][]).length).toBe(20);
    expect((drop!.data.d as number[][])[19]).toEqual([1800, 2500, 2]);
    expect(mergeEvent!.data.m).toHaveLength(19);
    expect(drop!.data.unit).toBe(1);
  });

  it("going to the background saves the unit waiting, at once", async () => {
    const { result, engine } = await mount();
    await act(() => result.current.startSession("fruits"));
    engine.steps = 30;
    result.current.rec.drop(1, 200);
    expect(appStateListener).not.toBeNull();
    await act(() => appStateListener!("inactive"));
    expect(gameEventClient.enqueueEvents).not.toHaveBeenCalled(); // not for the app switcher
    await act(() => appStateListener!("background"));
    expect(saves()).toEqual([
      [{ type: "drop", data: { d: [[30, 2000, 1]], v: 1, unit: 1, t_ms: expect.any(Number) } }],
    ]);
  });

  it("the end saves the last unit before game_ended, which adds the end and capstone steps", async () => {
    const { result, engine } = await mount();
    await act(() => result.current.startSession("fruits"));
    engine.steps = 10;
    result.current.rec.drop(4, 200);
    result.current.rec.events([merge(400, 9), { type: "win", x: 0, y: 0, id: 5 }]);
    engine.steps = 402;
    const order: string[] = [];
    (gameEventClient.enqueueEvents as jest.Mock).mockImplementation(() => order.push("units"));
    (gameEventClient.completeGame as jest.Mock).mockImplementation(() => order.push("game_ended"));
    await act(() => result.current.endSession("win"));
    expect(order).toEqual(["units", "game_ended"]);
    const [, summary, payload] = (gameEventClient.completeGame as jest.Mock).mock.calls[0]!;
    expect(summary.outcome).toBe("win");
    expect(payload).toEqual(
      expect.objectContaining({
        outcome: "win",
        end_step: 402,
        capstone_step: 400,
        replay: expect.objectContaining({ u: 1, n: 2 }),
      })
    );
    // Nothing more is recorded once the game has ended.
    result.current.rec.drop(1, 100);
    await act(() => jest.advanceTimersByTime(5000));
    expect(saves()).toHaveLength(1);
  });

  it("with the replay dial off for the session, nothing is recorded; game_ended still has its end step", async () => {
    jest.spyOn(gameEventClient, "replayMode").mockReturnValue("off");
    const { result, engine } = await mount();
    await act(() => result.current.startSession("fruits"));
    for (let i = 0; i < 45; i += 1) {
      engine.steps = i * 60;
      result.current.rec.drop(1, 120);
      result.current.rec.events([merge(i * 60 + 20, 1)]);
    }
    await act(() => appStateListener!("background"));
    await act(() => result.current.endSession("loss"));
    expect(gameEventClient.enqueueEvents).not.toHaveBeenCalled();
    const [, , payload] = (gameEventClient.completeGame as jest.Mock).mock.calls[0]!;
    expect(payload).toEqual(expect.objectContaining({ end_step: 44 * 60 }));
    expect(payload).not.toHaveProperty("capstone_step");
  });

  it("a restored game continues the killed session, its units after the save's", async () => {
    jest.spyOn(gameEventClient, "resumeGame").mockReturnValue("killed-game");
    const { result, engine } = await mount();
    await act(() => result.current.startSession("fruits"));
    await act(() => result.current.rec.resume(4));
    expect(result.current.rec.unitForSave()).toBe(5);
    engine.steps = 7;
    result.current.rec.drop(0, 150);
    await act(() => result.current.endSession("loss"));
    const [drop] = saves()[0]!;
    expect(drop!.data).toEqual({
      d: [[7, 1500, 0]],
      rs: 1,
      v: 1,
      unit: 5,
      t_ms: expect.any(Number),
    });
    expect((gameEventClient.enqueueEvents as jest.Mock).mock.calls[0]![0]).toBe("killed-game");
  });

  it("a Sentry event during a Cascade game carries game.id and game.type; none after it ends", async () => {
    const { result } = await mount();
    await act(() => result.current.startSession("fruits"));
    const id = (gameEventClient.startGame as jest.Mock).mock.results.at(-1)!.value as string;
    expect(setTag).toHaveBeenCalledWith("game.id", id);
    expect(setTag).toHaveBeenCalledWith("game.type", "cascade");
    expect(taggedSessionGameId()).toBe(id);
    await act(() => result.current.endSession("loss"));
    expect(setTag).toHaveBeenLastCalledWith(expect.stringMatching(/^game\./), NO_GAME);
    expect(taggedSessionGameId()).toBeNull();
  });

  it("an unmount mid-game saves the unit waiting before the abandon", async () => {
    const { result, engine, unmount } = await mount();
    await act(() => result.current.startSession("fruits"));
    result.current.sync.markStarted();
    engine.steps = 50;
    result.current.rec.drop(3, 300);
    const order: string[] = [];
    (gameEventClient.enqueueEvents as jest.Mock).mockImplementation(() => order.push("units"));
    (gameEventClient.completeGame as jest.Mock).mockImplementation((_, s) =>
      order.push(`game_ended:${(s as { outcome: string }).outcome}`)
    );
    await unmount();
    expect(order).toEqual(["units", "game_ended:abandoned"]);
  });
});
