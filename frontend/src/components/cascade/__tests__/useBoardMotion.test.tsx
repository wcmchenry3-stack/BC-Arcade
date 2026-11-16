/**
 * #3701: the board's motion state. Pushed moments reach the UI side once per publish, the motion
 * clock runs only while something plays (or the danger blink runs), and stamps use that clock.
 * Jest's Reanimated mock (`jest.setup.ts`) runs an active frame callback every 10 ms of fake time.
 */
import { act, renderHook } from "@testing-library/react-native";
import { useBoardMotion } from "../useBoardMotion";
import * as Reanimated from "react-native-reanimated";
import { DANGER_IDLE_PHASE, MOTION, dangerBlinkOn } from "../../../game/cascade/motion";
import { MOTION_KIND, slotAge } from "../../../game/cascade/motionLog";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

async function mount(reduceMotion = false) {
  return renderHook((p: { rm: boolean }) => useBoardMotion(p.rm), {
    initialProps: { rm: reduceMotion },
  });
}
const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

it("an idle board runs no clock", async () => {
  const { result } = await mount();
  await advance(500);
  expect(result.current.values.clock.value).toBe(0);
});

it("publishes pushed moments once, stamps them and runs the clock until they end", async () => {
  const { result } = await mount();
  const m = result.current;
  m.push(MOTION_KIND.merge, 100, 200, 3, 7, 1);
  expect(m.values.events.value[0]).toBe(0); // nothing reaches the UI side before publish
  await act(async () => m.publish());
  expect(m.values.events.value[0]).toBe(1);
  await advance(100);
  const { events, stamps, clock } = m.values;
  expect(slotAge(events.value, stamps.value, 0, clock.value)).toBeGreaterThan(50);
  // It stops after the pop's lifetime: the clock no longer moves.
  await advance(MOTION.merge.confettiMs + 200);
  const stopped = m.values.clock.value;
  await advance(500);
  expect(m.values.clock.value).toBe(stopped);
  expect(stopped).toBeGreaterThanOrEqual(MOTION.merge.confettiMs);
});

it("the danger blink keeps the clock and phase running while the count runs, not under Reduce Motion", async () => {
  const { result, rerender } = await mount();
  await act(async () => result.current.setDanger(0.5));
  await advance(200);
  expect(result.current.values.dangerPhase.value).toBeGreaterThan(0);
  const t = result.current.values.clock.value;
  await advance(1000);
  expect(result.current.values.clock.value).toBeGreaterThan(t);
  // The count stops: a latched on-beat finishes, then the phase rests and the clock stops.
  await act(async () => result.current.setDanger(0));
  await advance(500);
  const rest = result.current.values.dangerPhase.value;
  expect(rest).toBeGreaterThanOrEqual(MOTION.danger.duty);
  const frozen = result.current.values.clock.value;
  await advance(500);
  expect(result.current.values.clock.value).toBe(frozen);
  expect(result.current.values.dangerPhase.value).toBe(rest);

  await rerender({ rm: true });
  await act(async () => result.current.setDanger(0.5));
  await advance(200);
  expect(result.current.values.dangerPhase.value).toBe(DANGER_IDLE_PHASE);
});

// Review B1: a cleared ring publishes 0 while the log keeps counting; the clock must still stop.
it("after a new game (clear) the clock goes idle again and stays frozen", async () => {
  const { result } = await mount();
  const m = result.current;
  m.push(MOTION_KIND.merge, 100, 200, 3, 7, 1);
  await act(async () => m.publish());
  await advance(MOTION.merge.confettiMs + 200);
  const idle = m.values.clock.value;
  await advance(300);
  expect(m.values.clock.value).toBe(idle);
  await act(async () => m.clear());
  await advance(200);
  const afterClear = m.values.clock.value;
  await advance(1000);
  expect(m.values.clock.value).toBe(afterClear);
  // …and the next moment still wakes it.
  m.push(MOTION_KIND.drop, 0, 0, 1, 0, 0);
  await act(async () => m.publish());
  await advance(100);
  expect(m.values.clock.value).toBeGreaterThan(afterClear);
});

it("stops its frame callback on unmount", async () => {
  const setActive = jest.fn();
  const spy = jest
    .spyOn(Reanimated, "useFrameCallback")
    .mockReturnValue({ setActive, isActive: false, callbackId: 1 });
  const view = await mount();
  view.result.current.push(MOTION_KIND.drop, 0, 0, 1, 0, 0);
  await act(async () => view.result.current.publish());
  expect(setActive).toHaveBeenLastCalledWith(true);
  await view.unmount();
  expect(setActive).toHaveBeenLastCalledWith(false);
  spy.mockRestore();
});

it("a new game clears every moment", async () => {
  const { result } = await mount();
  result.current.push(MOTION_KIND.drop, 0, 0, 1, 0, 0);
  await act(async () => result.current.publish());
  await act(async () => result.current.clear());
  expect(Array.from(result.current.values.events.value).every((v) => v === 0)).toBe(true);
  expect(result.current.values.danger.value).toBe(0);
});

// #3702 review S1: the danger tick takes its time from this callback, so the tick and the blink
// share one phase. Driven frame by frame with uneven frames, a stall and a pause.
describe("danger onsets (the tick's clock, #3702)", () => {
  /** Mounts with the frame callback captured, so the test runs each frame itself. */
  async function mountCaptured(reduceMotion = false) {
    let step: ((info: { timeSincePreviousFrame: number | null }) => void) | null = null;
    const spy = jest.spyOn(Reanimated, "useFrameCallback").mockImplementation((cb) => {
      step = cb as never;
      return { setActive: jest.fn(), isActive: true, callbackId: 1 };
    });
    const onset = jest.fn();
    const view = await renderHook((p: { rm: boolean }) => useBoardMotion(p.rm, onset), {
      initialProps: { rm: reduceMotion },
    });
    const frame = (dt: number | null) => step!({ timeSincePreviousFrame: dt });
    return { view, onset, frame, spy };
  }

  it("fire exactly when the board's blink starts an on-beat, with uneven frames and a stall", async () => {
    const { view, onset, frame, spy } = await mountCaptured();
    await act(async () => view.result.current.setDanger(0.6));
    const { dangerPhase } = view.result.current.values;
    // Uneven frames, a 600 ms stall (clamped by the board, as the blink is) and a null dt.
    const dts = [16, 8, 33, 16, 600, 16, 50, null, 16, 12, 16, 400, 16];
    let onBeats = 0;
    for (let i = 0; i < 400; i++) {
      const before = dangerPhase.value;
      onset.mockClear();
      frame(dts[i % dts.length]!);
      const startedOnBeat = !dangerBlinkOn(before) && dangerBlinkOn(dangerPhase.value);
      expect(onset.mock.calls.length).toBe(startedOnBeat ? 1 : 0);
      if (startedOnBeat) onBeats++;
    }
    expect(onBeats).toBeGreaterThan(5);
    spy.mockRestore();
  });

  it("a paused count finishes its beat silently, and the next onset follows the blink", async () => {
    const { view, onset, frame, spy } = await mountCaptured();
    await act(async () => view.result.current.setDanger(1));
    for (let i = 0; i < 30; i++) frame(16);
    const before = onset.mock.calls.length;
    await act(async () => view.result.current.setDanger(0));
    for (let i = 0; i < 100; i++) frame(16);
    expect(onset.mock.calls.length).toBe(before);
    await act(async () => view.result.current.setDanger(1));
    const { dangerPhase } = view.result.current.values;
    let fired = false;
    for (let i = 0; i < 40 && !fired; i++) {
      frame(16);
      fired = onset.mock.calls.length > before;
      if (fired) expect(dangerBlinkOn(dangerPhase.value)).toBe(true);
    }
    expect(fired).toBe(true);
    spy.mockRestore();
  });

  it("never fire under Reduce Motion (there is no blink)", async () => {
    const { view, onset, frame, spy } = await mountCaptured(true);
    await act(async () => view.result.current.setDanger(1));
    for (let i = 0; i < 200; i++) frame(16);
    expect(onset).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
