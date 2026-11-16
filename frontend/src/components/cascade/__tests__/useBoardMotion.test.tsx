/**
 * #3701: the board's motion state. Pushed moments reach the UI side once per publish, the motion
 * clock runs only while something plays (or the danger blink runs), and stamps use that clock.
 * Jest's Reanimated mock (`jest.setup.ts`) runs an active frame callback every 10 ms of fake time.
 */
import { act, renderHook } from "@testing-library/react-native";
import { useBoardMotion } from "../useBoardMotion";
import { MOTION } from "../../../game/cascade/motion";
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
  await act(async () => result.current.setDanger(0));
  await advance(100);
  expect(result.current.values.dangerPhase.value).toBe(0);

  await rerender({ rm: true });
  await act(async () => result.current.setDanger(0.5));
  await advance(200);
  expect(result.current.values.dangerPhase.value).toBe(0);
});

it("a new game clears every moment", async () => {
  const { result } = await mount();
  result.current.push(MOTION_KIND.drop, 0, 0, 1, 0, 0);
  await act(async () => result.current.publish());
  await act(async () => result.current.clear());
  expect(Array.from(result.current.values.events.value).every((v) => v === 0)).toBe(true);
  expect(result.current.values.danger.value).toBe(0);
});
