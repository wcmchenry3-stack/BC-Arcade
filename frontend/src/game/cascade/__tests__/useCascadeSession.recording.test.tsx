/**
 * Cascade's session records its play on the shared recorder (#3858), through the real
 * `useGameRecorder` and the real `gameEventClient`:
 *  - `game_started` carries the seeds, the tuning and `engine_version`;
 *  - drops and merges stay in memory, and a unit of `CASCADE_DROPS_PER_UNIT` (30, #3967) drops is
 *    saved in one `enqueueEvents`
 *    call at the next idle moment, never one write per drop;
 *  - going to the background saves the unit waiting, synchronously;
 *  - the end saves the last unit before `game_ended`, which adds the end and capstone steps;
 *  - with the replay dial off for the session, nothing is recorded at all;
 *  - a restored game numbers its units after the save's;
 *  - a Sentry event raised during the game carries `game.id` and `game.type` (#3277);
 *  - leaving the screen mid-game (the abandon) carries the end and lid steps and the danger
 *    moment still running (review S1, S2);
 *  - nothing gameplay is uploaded while a two-unit game is open in the foreground (S4);
 *  - a test seam's reseed before the first drop restarts the game with the new seeds.
 */
import * as Sentry from "@sentry/react-native";
import { act, renderHook } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";

import { gameEventClient } from "../../_shared/gameEventClient";
import { NO_GAME, taggedSessionGameId, clearSessionTags } from "../../_shared/sessionTags";
import { CASCADE_TUNING_ID } from "../constants";
import type { EngineEvent } from "../engine";
import { useCascadeSession } from "../useCascadeSession";
import { eventStore } from "../../_shared/eventStore";
import { pendingGamesStore } from "../../_shared/pendingGamesStore";
import { SyncWorker } from "../../_shared/syncWorker";
import { MockSyncApi, asSyncApi, ok } from "../../_shared/__tests__/helpers/syncWorkerFixtures";
import { CascadeEngine } from "../engine";
import {
  FIXED_STEP_MS,
  FLOOR_THICKNESS,
  OVERFLOW_IGNORE_MERGE_TICKS,
  WORLD_HEIGHT,
} from "../constants";
import { CASCADE_DROPS_PER_UNIT } from "../replay";
import { tierRadius } from "../tiers";

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

async function mount(engine: { steps: number } = { steps: 0 }) {
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
      }
    );
  });

  it("keeps drops and merges in memory, and saves a full unit of drops in one call at idle", async () => {
    const { result, engine } = await mount();
    await act(() => result.current.startSession("fruits"));
    const { rec } = result.current;
    const last = CASCADE_DROPS_PER_UNIT - 1;
    for (let i = 0; i < last; i += 1) {
      engine.steps = i * 90;
      expect(rec.drop(i % 6, 100.04 + i)).toBe(Math.round((100.04 + i) * 10) / 10);
      rec.events([merge(i * 90 + 40, 0)]);
    }
    await act(() => jest.advanceTimersByTime(5000));
    expect(gameEventClient.enqueueEvents).not.toHaveBeenCalled();
    engine.steps = last * 90 + 90;
    rec.drop(2, 250);
    expect(gameEventClient.enqueueEvents).not.toHaveBeenCalled(); // saved at idle, not in the tap
    await act(() => jest.advanceTimersByTime(5000));
    expect(saves()).toHaveLength(1);
    const [drop, mergeEvent] = saves()[0]!;
    expect(drop!.type).toBe("drop");
    expect((drop!.data.d as number[][]).length).toBe(CASCADE_DROPS_PER_UNIT);
    expect((drop!.data.d as number[][])[last]).toEqual([last * 90 + 90, 2500, 2]);
    expect(mergeEvent!.data.m).toHaveLength(last);
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
    result.current.rec.events([merge(400, 10), { type: "win", x: 0, y: 0, id: 5 }]);
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
    await act(() => result.current.rec.resume({ unit: 4, danger: 0, unitsCut: 0, dangerCut: 0 }));
    expect(result.current.rec.saveState().unit).toBe(5);
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

  it("leaving the screen mid-game: the abandon's game_ended carries the end step (S1)", async () => {
    const { result, engine, unmount } = await mount();
    await act(() => result.current.startSession("fruits"));
    result.current.sync.markStarted();
    engine.steps = 40;
    result.current.rec.drop(2, 200);
    engine.steps = 500;
    await unmount();
    const [, summary, payload] = (gameEventClient.completeGame as jest.Mock).mock.calls.at(-1)!;
    expect(summary.outcome).toBe("abandoned");
    expect(summary.result).not.toHaveProperty("end_step"); // analytics only, never the PATCH result
    expect(payload).toEqual(expect.objectContaining({ outcome: "abandoned", end_step: 500 }));
  });

  it("a pile held over the lid for 150 steps, then abandoned: lid_step and the danger moment (S2)", async () => {
    // engine.lid.test.ts's COLUMN: the top edge over the lid; restore's grace, then the count.
    const engine = new CascadeEngine({ seed: 1 });
    const pieces: { tier: number; x: number; y: number }[] = [];
    let bottom = WORLD_HEIGHT - FLOOR_THICKNESS;
    for (const tier of [11, 10, 8, 4]) {
      pieces.push({ tier, x: 121, y: bottom - tierRadius(tier) });
      bottom -= 2 * tierRadius(tier);
    }
    const { result, unmount } = await mount(engine);
    await act(() => result.current.startSession("fruits"));
    result.current.sync.markStarted();
    engine.restore(pieces, 0);
    for (let i = 0; i < 150; i += 1) result.current.rec.events(engine.step(FIXED_STEP_MS).events);
    await unmount();
    const start = OVERFLOW_IGNORE_MERGE_TICKS + 1;
    const [, , payload] = (gameEventClient.completeGame as jest.Mock).mock.calls.at(-1)!;
    expect(payload).toEqual(expect.objectContaining({ end_step: 150, lid_step: start }));
    const drop = saves()
      .flat()
      .find((e) => e.type === "drop");
    expect(drop!.data.z).toEqual([[start, 150 - start + 1]]);
    engine.destroy();
  });

  it("no gameplay row is uploaded while a two-unit game is open in the foreground (S4)", async () => {
    const api = new MockSyncApi();
    api.defaultResponse = ok();
    const fetchSpy = jest.spyOn(globalThis, "fetch");
    const worker = new SyncWorker(eventStore, pendingGamesStore, asSyncApi(api));
    worker.start();
    try {
      const { result, engine } = await mount();
      await act(() => result.current.startSession("fruits"));
      const gid = (gameEventClient.startGame as jest.Mock).mock.results.at(-1)!.value as string;
      result.current.sync.markStarted();
      const drops = 2 * CASCADE_DROPS_PER_UNIT; // 40 when a unit was 20 drops (#3967: 30)
      for (let i = 0; i < drops; i += 1) {
        engine.steps = i * 120;
        result.current.rec.drop(i % 6, 100 + i);
        result.current.rec.events([merge(i * 120 + 60, i % 5)]);
        // a drop every 2 s, the worker's 30 s tick in between
        await act(() => jest.advanceTimersByTimeAsync(2000));
      }
      await act(() => worker.flush());
      const gameplay = (c: { path: string; body: unknown }) =>
        c.path === `/games/${gid}/events` &&
        (c.body as { events: { event_type: string }[] }).events.some(
          (e) => e.event_type === "drop" || e.event_type === "merge"
        );
      expect(saves().flat().length).toBe(4); // two units were saved on the device
      expect(api.calls.filter(gameplay)).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled(); // and nothing reached the network but the mock
      // The end releases them.
      engine.steps = drops * 120;
      await act(() => result.current.endSession("loss"));
      await act(() => jest.advanceTimersByTimeAsync(100));
      await act(() => worker.flush());
      expect(api.calls.filter(gameplay).length).toBeGreaterThan(0);
    } finally {
      worker.stop();
    }
  });

  it("a test seam's reseed before the first drop restarts the game with the new seeds", async () => {
    const { result, inputs } = await mount();
    await act(() => result.current.startSession("fruits"));
    inputs.seedsRef.current = { queue: 77, engine: 77 };
    await act(() => result.current.rec.reseeded());
    expect(gameEventClient.startGame).toHaveBeenLastCalledWith(
      "cascade",
      {},
      expect.objectContaining({ seed: 77, engine_seed: 77 })
    );
    // After the first drop a reseed cannot rename the seeds: the next unit says it is not replayable.
    inputs.dropCountRef.current = 1;
    result.current.rec.drop(1, 100);
    await act(() => result.current.rec.reseeded());
    await act(() => result.current.endSession("loss"));
    expect(
      saves()
        .flat()
        .find((e) => e.type === "drop")!.data
    ).toMatchObject({ rs: 1 });
  });
});
