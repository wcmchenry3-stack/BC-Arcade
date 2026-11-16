/**
 * The celebration clock (#3699). It is stepped on the UI thread one frame at a time, each frame
 * moving it at most MAX_FRAME_STEP_MS: on the iOS simulator the first celebration frame stalled the
 * UI thread, and the wall-clock `withTiming` it replaced ran on through the stall, so the first
 * frame shown was already past the rise (#3924). It is no Reanimated animation, so the OS Reduce
 * Motion setting cannot jump it to its end (Codex on #3924).
 *
 * Jest's Reanimated mock (`jest.setup.ts`) runs an active frame callback every 10 ms of fake time.
 */
import React from "react";
import { act, create } from "react-test-renderer";
import * as Reanimated from "react-native-reanimated";
import CascadeCelebration, { FALLBACK_SLACK_MS } from "../CascadeCelebration";
import {
  CELEBRATION_START_MS,
  LIFT_SCALE,
  MAX_FRAME_STEP_MS,
  celebrationPose,
  createCelebrationPose,
} from "../../../game/cascade/celebration";

function makeClock(init = -1) {
  return {
    value: init,
    get() {
      return this.value;
    },
    set(v: number) {
      this.value = v;
    },
  };
}

type FrameInfo = { timeSincePreviousFrame: number | null };

describe("CascadeCelebration clock", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function mount(props: {
    reduceMotion?: boolean;
    ready?: boolean;
    clock?: ReturnType<typeof makeClock>;
  }) {
    const clock = props.clock ?? makeClock();
    const onDone = jest.fn();
    let renderer!: ReturnType<typeof create>;
    const el = (ready: boolean, reduceMotion: boolean) => (
      <CascadeCelebration
        clock={clock as never}
        reduceMotion={reduceMotion}
        ready={ready}
        onDone={onDone}
      />
    );
    act(() => {
      renderer = create(el(props.ready ?? true, props.reduceMotion ?? false));
    });
    return {
      clock,
      onDone,
      update: (ready: boolean, reduceMotion = props.reduceMotion ?? false) =>
        act(() => renderer.update(el(ready, reduceMotion))),
      advance: (ms: number) =>
        act(() => {
          jest.advanceTimersByTime(ms);
        }),
    };
  }

  it.each([false, true])(
    "is stepped frame by frame from 0 to the card's time (reduceMotion=%s), never animated",
    (reduceMotion) => {
      const timing = jest.spyOn(Reanimated, "withTiming");
      const sequence = jest.spyOn(Reanimated, "withSequence");
      const { clock, onDone, advance } = mount({ reduceMotion });
      expect(clock.value).toBe(0);
      advance(500);
      expect(clock.value).toBe(500);
      const cardMs = reduceMotion ? 1600 : 2100;
      advance(cardMs - 500 - 1);
      expect(onDone).not.toHaveBeenCalled();
      advance(1);
      expect(onDone).toHaveBeenCalledTimes(1);
      expect(clock.value).toBe(cardMs);
      // No Reanimated animation: the OS Reduce Motion setting has nothing to shorten.
      expect(timing).not.toHaveBeenCalled();
      expect(sequence).not.toHaveBeenCalled();
      advance(5000);
      expect(onDone).toHaveBeenCalledTimes(1);
    }
  );

  // The root cause on iOS (#3924): a stalled frame must not skip the front-loaded rise.
  it("a late frame moves the clock one capped step: the rise is still seen after a stall", () => {
    const frames: ((info: FrameInfo) => void)[] = [];
    jest
      .spyOn(Reanimated, "useFrameCallback")
      .mockImplementation((cb: (info: FrameInfo) => void) => {
        frames.push(cb);
        return { setActive: jest.fn(), isActive: false, callbackId: 1 } as never;
      });
    const { clock, onDone } = mount({});
    expect(clock.value).toBe(0);
    const step = frames.at(-1)!;
    // Up to the rise, then the first celebration frame takes 500 ms (textures, shaders).
    clock.set(CELEBRATION_START_MS);
    step({ timeSincePreviousFrame: 500 });
    expect(clock.value).toBeCloseTo(CELEBRATION_START_MS + MAX_FRAME_STEP_MS);
    // The pose that frame draws: early in the rise, not finished.
    const pose = createCelebrationPose();
    celebrationPose(clock.value, false, pose);
    expect(pose.lift).toBeLessThan(0.75);
    expect(pose.scale).toBeLessThan(LIFT_SCALE - 0.05);
    expect(pose.dim).toBeLessThan(0.2);
    // A first frame (no previous one) does not move it.
    const before = clock.value;
    step({ timeSincePreviousFrame: null });
    expect(clock.value).toBe(before);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("does not start until the board is ready, then starts at the time since the win, at most 400 ms", () => {
    const { clock, onDone, update, advance } = mount({ ready: false });
    advance(3000);
    expect(clock.value).toBe(-1);
    expect(onDone).not.toHaveBeenCalled();
    update(true);
    // Ready 3 s after the win (its style built late): the grow-in is long over, start there.
    expect(clock.value).toBe(CELEBRATION_START_MS);
    advance(2100 - CELEBRATION_START_MS - 1);
    expect(onDone).not.toHaveBeenCalled();
    advance(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("ready soon after the win starts at that time", () => {
    const { clock, update, advance } = mount({ ready: false });
    advance(150);
    update(true);
    expect(clock.value).toBe(150);
  });

  it("calls onDone from a JS fallback if the frames never get there", () => {
    jest
      .spyOn(Reanimated, "useFrameCallback")
      .mockImplementation(
        () => ({ setActive: jest.fn(), isActive: false, callbackId: 1 }) as never
      );
    const { onDone, advance } = mount({});
    advance(2100 + FALLBACK_SLACK_MS - 1);
    expect(onDone).not.toHaveBeenCalled();
    advance(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("Reduce Motion switched on past the calm end: the next frame ends it", () => {
    const { clock, onDone, update, advance } = mount({});
    advance(1800);
    update(true, true);
    advance(MAX_FRAME_STEP_MS);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(clock.value).toBe(1600);
  });
});
