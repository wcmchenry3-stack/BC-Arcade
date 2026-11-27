/**
 * #4091: Cascade's HUD timer. It follows the screen's play clock (not started, running, paused,
 * stopped, restored) and ticks without re-rendering anything around it (#2964).
 */
import React, { useMemo } from "react";
import { act, render, renderHook, screen } from "@testing-library/react-native";
import { Dimensions } from "react-native";
import CascadeTimer from "../CascadeTimer";
import ScoreDisplay, { STACK_TIMER_BELOW_W } from "../ScoreDisplay";
import { ThemeProvider } from "../../../theme/ThemeContext";
import { createScoreStore } from "../../../game/cascade/scoreStore";
import { useCascadeClock } from "../../../game/cascade/useCascadeClock";
import * as statsDisplay from "../../../api/statsDisplay";
import { formatClock } from "../../../game/_shared/formatMs";

jest.mock("../../../game/_shared/monotonicNow", () => ({ monotonicNow: () => Date.now() }));

type Clock = ReturnType<typeof useCascadeClock>;

const wait = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));
const time = () => screen.getByTestId("cascade-hud-time-value");

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

/** Mounts the timer on a real clock, which the test drives like the screen does. */
async function mountTimer() {
  let clock!: Clock;
  function Host() {
    clock = useCascadeClock();
    return (
      <ThemeProvider>
        <CascadeTimer clock={clock} />
      </ThemeProvider>
    );
  }
  await render(<Host />);
  return clock;
}

describe("formatClock", () => {
  it("is mm:ss, and h:mm:ss from an hour", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(277)).toBe("04:37");
    expect(formatClock(3599)).toBe("59:59");
    expect(formatClock(3600)).toBe("1:00:00");
    expect(formatClock(3725)).toBe("1:02:05");
  });
});

describe("CascadeTimer", () => {
  it("reads 00:00 before the first piece, however long the player waits", async () => {
    await mountTimer();
    expect(screen.getByText("Time")).toBeTruthy();
    await wait(30_000);
    expect(time()).toHaveTextContent("00:00");
  });

  it("ticks while playing, from the first piece", async () => {
    const clock = await mountTimer();
    await wait(10_000);
    await act(async () => clock.start());
    await wait(5_000);
    expect(time()).toHaveTextContent("00:05");
    await wait(62_000);
    expect(time()).toHaveTextContent("01:07");
  });

  it("holds while paused and runs on at resume", async () => {
    const clock = await mountTimer();
    await act(async () => clock.start());
    await wait(4_000);
    await act(async () => clock.pause());
    await wait(120_000);
    expect(time()).toHaveTextContent("00:04");
    await act(async () => clock.resume());
    await wait(3_000);
    expect(time()).toHaveTextContent("00:07");
  });

  it("freezes at the game's end, on the time the clock reports", async () => {
    const clock = await mountTimer();
    await act(async () => clock.start());
    await wait(9_000);
    await act(async () => clock.stop());
    await wait(60_000);
    expect(time()).toHaveTextContent("00:09");
    expect(formatClock(clock.elapsed() / 1000)).toBe("00:09");
  });

  it("shows a restored game's banked time at once, and runs on from it", async () => {
    const clock = await mountTimer();
    await act(async () => clock.restore(277_000));
    expect(time()).toHaveTextContent("04:37");
    await wait(2_000);
    expect(time()).toHaveTextContent("04:39");
  });

  it("shows a restored game's time while away (paused), without ticking", async () => {
    const clock = await mountTimer();
    await act(async () => clock.pause());
    await act(async () => clock.restore(61_000));
    expect(time()).toHaveTextContent("01:01");
    await wait(10_000);
    expect(time()).toHaveTextContent("01:01");
  });

  it("goes back to 00:00 for a new game after a finished one", async () => {
    const clock = await mountTimer();
    await act(async () => clock.start());
    await wait(3_000);
    await act(async () => clock.stop());
    await act(async () => clock.reset());
    expect(time()).toHaveTextContent("00:00");
  });

  it("shows h:mm:ss past an hour", async () => {
    const clock = await mountTimer();
    await act(async () => clock.restore(3_599_000));
    await wait(2_000);
    expect(time()).toHaveTextContent("1:00:01");
  });

  it("has an accessibility label like the other games' elapsed time", async () => {
    const clock = await mountTimer();
    await act(async () => clock.restore(65_000));
    expect(time()).toHaveProp("accessibilityLabel", "Elapsed time 01:05");
  });
});

describe("the HUD row with the timer", () => {
  const setWidth = (width: number) =>
    jest.spyOn(Dimensions, "get").mockReturnValue({ width, height: 800, scale: 2, fontScale: 1 });

  async function mountRow(width: number) {
    setWidth(width);
    const clock = (await renderHook(() => useCascadeClock())).result.current;
    await render(
      <ThemeProvider>
        <ScoreDisplay store={createScoreStore(0)} timer={<CascadeTimer clock={clock} />}>
          <></>
        </ScoreDisplay>
      </ThemeProvider>
    );
  }

  afterEach(() => jest.restoreAllMocks());

  it("sits beside the score on a wide screen", async () => {
    await mountRow(STACK_TIMER_BELOW_W);
    expect(screen.getByTestId("cascade-hud-time")).toBeTruthy();
    const left = screen.getByTestId("cascade-hud-left");
    expect(left).toHaveStyle({ flexDirection: "row" });
  });

  it("stacks under the score on a narrow screen", async () => {
    await mountRow(STACK_TIMER_BELOW_W - 1);
    const left = screen.getByTestId("cascade-hud-left");
    expect(left).not.toHaveStyle({ flexDirection: "row" });
    expect(screen.getByTestId("cascade-hud-time")).toBeTruthy();
  });
});

describe("a tick re-renders only the timer (#2964)", () => {
  it("does not re-render the screen or the score row", async () => {
    // ScoreDisplay formats the score on every render of its own; the timer never does.
    const formatNumber = jest.spyOn(statsDisplay, "formatNumber");
    let screenRenders = 0;
    let clock!: Clock;
    function Screen() {
      screenRenders++;
      clock = useCascadeClock();
      const timer = useMemo(() => <CascadeTimer clock={clock} />, []);
      return (
        <ThemeProvider>
          <ScoreDisplay store={createScoreStore(7)} timer={timer} />
        </ThemeProvider>
      );
    }
    await render(<Screen />);
    await act(async () => clock.start());
    await wait(1_000);
    expect(time()).toHaveTextContent("00:01");
    const screenBefore = screenRenders;
    const rowBefore = formatNumber.mock.calls.length;

    await wait(5_000);
    expect(time()).toHaveTextContent("00:06");
    // The pause and the resume reach the timer through the clock, not the screen.
    await act(async () => clock.pause());
    await act(async () => clock.resume());
    await wait(2_000);
    expect(time()).toHaveTextContent("00:08");

    expect(screenRenders).toBe(screenBefore);
    expect(formatNumber.mock.calls.length).toBe(rowBefore);
    expect(screen.getByText("7")).toBeTruthy();
    formatNumber.mockRestore();
  });
});
