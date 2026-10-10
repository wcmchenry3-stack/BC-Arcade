import { renderHook } from "@testing-library/react-native";
import { useGameEvents } from "../useGameEvents";
import type { GameEvent } from "../../hearts/types";

describe("useGameEvents", () => {
  it("fires the correct callback for each event type in the array", async () => {
    const onMoonShot = jest.fn();
    const onHeartsBroken = jest.fn();
    const onQueenOfSpades = jest.fn();
    const onClear = jest.fn();

    const events: GameEvent[] = [
      { type: "moonShot", shooter: 0 },
      { type: "heartsBroken" },
      { type: "queenOfSpades", takerSeat: 2 },
    ];

    await renderHook(() =>
      useGameEvents(
        events,
        { moonShot: onMoonShot, heartsBroken: onHeartsBroken, queenOfSpades: onQueenOfSpades },
        onClear
      )
    );

    expect(onMoonShot).toHaveBeenCalledWith({ type: "moonShot", shooter: 0 });
    expect(onHeartsBroken).toHaveBeenCalledWith({ type: "heartsBroken" });
    expect(onQueenOfSpades).toHaveBeenCalledWith({ type: "queenOfSpades", takerSeat: 2 });
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("does not re-fire events that have already been processed", async () => {
    const onMoonShot = jest.fn();
    const onClear = jest.fn();
    const events: GameEvent[] = [{ type: "moonShot", shooter: 1 }];

    const { rerender } = await renderHook(
      ({ evts }: { evts: readonly GameEvent[] }) =>
        useGameEvents(evts, { moonShot: onMoonShot }, onClear),
      { initialProps: { evts: events } }
    );

    // Same array reference — must not re-fire.
    await rerender({ evts: events });

    expect(onMoonShot).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("processes a new events array after the previous one was cleared", async () => {
    const onMoonShot = jest.fn();
    const onClear = jest.fn();
    const first: GameEvent[] = [{ type: "moonShot", shooter: 0 }];
    const second: GameEvent[] = [{ type: "moonShot", shooter: 3 }];

    const { rerender } = await renderHook(
      ({ evts }: { evts: readonly GameEvent[] }) =>
        useGameEvents(evts, { moonShot: onMoonShot }, onClear),
      { initialProps: { evts: first } }
    );

    await rerender({ evts: second });

    expect(onMoonShot).toHaveBeenCalledTimes(2);
    expect(onClear).toHaveBeenCalledTimes(2);
  });

  it("is a no-op when events is undefined", async () => {
    const onMoonShot = jest.fn();
    const onClear = jest.fn();

    await renderHook(() => useGameEvents(undefined, { moonShot: onMoonShot }, onClear));

    expect(onMoonShot).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
  });

  it("is a no-op when events is empty", async () => {
    const onMoonShot = jest.fn();
    const onClear = jest.fn();

    await renderHook(() => useGameEvents([], { moonShot: onMoonShot }, onClear));

    expect(onMoonShot).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
  });

  it("dispatches bare string events on the string itself, in array order", async () => {
    const calls: string[] = [];
    const events: readonly ("win2048" | "gameOver")[] = ["win2048", "gameOver"];

    await renderHook(() =>
      useGameEvents(events, {
        gameOver: (e) => calls.push(e),
        win2048: (e) => calls.push(e),
      })
    );

    expect(calls).toEqual(["win2048", "gameOver"]);
  });

  it("works without onClear: the events stay, and the same array never re-fires", async () => {
    const onMoonShot = jest.fn();
    const events: GameEvent[] = [{ type: "moonShot", shooter: 1 }];

    const { rerender } = await renderHook(
      ({ evts }: { evts: readonly GameEvent[] | undefined }) =>
        useGameEvents(evts, { moonShot: onMoonShot }),
      { initialProps: { evts: events as readonly GameEvent[] | undefined } }
    );

    await rerender({ evts: events });
    await rerender({ evts: undefined });
    await rerender({ evts: events });
    expect(onMoonShot).toHaveBeenCalledTimes(1);

    await rerender({ evts: [{ type: "moonShot", shooter: 2 }] });
    expect(onMoonShot).toHaveBeenCalledTimes(2);
  });

  it("silently skips events with no registered handler", async () => {
    const onClear = jest.fn();
    const events: GameEvent[] = [{ type: "moonShot", shooter: 0 }];

    // No moonShot handler registered — should not throw.
    await renderHook(() => useGameEvents(events, { heartsBroken: jest.fn() }, onClear));

    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
