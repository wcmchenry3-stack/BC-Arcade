/**
 * #3701: the board's motion state. Pushed moments reach the UI side once per publish, the motion
 * clock runs only while something plays (or the danger blink runs), and stamps use that clock.
 * Jest's Reanimated mock (`jest.setup.ts`) runs an active frame callback every 10 ms of fake time.
 */
import { act, renderHook } from "@testing-library/react-native";
import { useBoardMotion } from "../useBoardMotion";
import * as Reanimated from "react-native-reanimated";
import { DANGER_IDLE_PHASE, MOTION } from "../../../game/cascade/motion";
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
