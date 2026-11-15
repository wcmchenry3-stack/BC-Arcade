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
          <CascadeCelebration clock={clock as never} reduceMotion={reduceMotion} onDone={onDone} />
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
});
