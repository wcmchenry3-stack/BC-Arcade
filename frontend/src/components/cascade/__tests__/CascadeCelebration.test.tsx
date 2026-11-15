/**
 * The celebration clock never takes Reanimated's system Reduce Motion: under the OS setting the
 * default (ReduceMotion.System) jumps an animation to its end, which would skip the capstone's
 * grow-in and the calm fade. The calm visuals come from `reduceMotion` instead (Codex on #3924).
 */
import React from "react";
import { act, create } from "react-test-renderer";
import * as Reanimated from "react-native-reanimated";
import CascadeCelebration from "../CascadeCelebration";

describe("CascadeCelebration clock", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it.each([false, true])(
    "never reduces with the OS setting (reduceMotion=%s), and still calls onDone",
    (reduceMotion) => {
      const timing = jest.spyOn(Reanimated, "withTiming");
      const sequence = jest.spyOn(Reanimated, "withSequence");
      const clock = { value: 0, get: () => 0, set: jest.fn() };
      const onDone = jest.fn();
      act(() => {
        create(
          <CascadeCelebration
            clock={clock as never}
            reduceMotion={reduceMotion}
            ready
            onDone={onDone}
          />
        );
      });
      expect(timing).toHaveBeenCalled();
      for (const call of timing.mock.calls) {
        expect((call[1] as { reduceMotion?: unknown }).reduceMotion).toBe(
          Reanimated.ReduceMotion.Never
        );
      }
      expect(sequence.mock.calls[0]?.[0]).toBe(Reanimated.ReduceMotion.Never);
      act(() => {
        jest.advanceTimersByTime(reduceMotion ? 1600 : 2100);
      });
      expect(onDone).toHaveBeenCalledTimes(1);
    }
  );

  // iOS demo on #3924: started before the board could draw the celebration, the clock ran on
  // unseen and the celebration appeared finished. It waits for `ready`.
  it.each([false, true])(
    "does not start until the board is ready, then runs its full time (reduceMotion=%s)",
    (reduceMotion) => {
      const clock = { value: -1, get: () => -1, set: jest.fn() };
      const onDone = jest.fn();
      let renderer!: ReturnType<typeof create>;
      const el = (ready: boolean) => (
        <CascadeCelebration
          clock={clock as never}
          reduceMotion={reduceMotion}
          ready={ready}
          onDone={onDone}
        />
      );
      act(() => {
        renderer = create(el(false));
      });
      act(() => {
        jest.advanceTimersByTime(3000);
      });
      expect(clock.set).not.toHaveBeenCalled();
      expect(onDone).not.toHaveBeenCalled();
      act(() => renderer.update(el(true)));
      expect(clock.set).toHaveBeenCalledTimes(1);
      const cardMs = reduceMotion ? 1600 : 2100;
      act(() => {
        jest.advanceTimersByTime(cardMs - 1);
      });
      expect(onDone).not.toHaveBeenCalled();
      act(() => {
        jest.advanceTimersByTime(1);
      });
      expect(onDone).toHaveBeenCalledTimes(1);
    }
  );
});
