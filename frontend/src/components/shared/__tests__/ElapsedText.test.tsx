import React from "react";
import { act, render } from "@testing-library/react-native";
import { ElapsedText, createClockActivity } from "../ElapsedText";

const T0 = 1_800_000_000_000;

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(T0);
});

afterEach(() => {
  jest.useRealTimers();
});

const format = (s: number) => `${s}s`;

/** Moves the wall clock and fires whatever timers are due. */
async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

/** A clock that started `startedAt` ms ago-or-later in wall time. */
const clockFrom = (startedAt: number) => () => Date.now() - startedAt;

describe("ElapsedText (#2964)", () => {
  it("idles before the clock starts, then ticks on the clock's own seconds", async () => {
    let startedAt: number | null = null;
    const getElapsedMs = jest.fn(() => (startedAt === null ? null : Date.now() - startedAt));
    const activity = createClockActivity();
    const api = await render(
      <ElapsedText
        getElapsedMs={getElapsedMs}
        running
        activity={activity}
        format={format}
        testID="t"
      />
    );
    expect(api.getByTestId("t")).toHaveTextContent("0s");
    // Not started: the label never wakes to look, however long the player thinks.
    const readsAtMount = getElapsedMs.mock.calls.length;
    await advance(3100);
    expect(api.getByTestId("t")).toHaveTextContent("0s");
    expect(getElapsedMs).toHaveBeenCalledTimes(readsAtMount);

    // The first move: the label flips exactly one second after it.
    startedAt = Date.now();
    await act(async () => {
      activity.set(true);
    });
    await advance(999);
    expect(api.getByTestId("t")).toHaveTextContent("0s");
    await advance(1);
    expect(api.getByTestId("t")).toHaveTextContent("1s");
    await advance(2000);
    expect(api.getByTestId("t")).toHaveTextContent("3s");
  });

  it("clears its timer while paused and re-aligns on resume", async () => {
    let startedAt: number = T0;
    const getElapsedMs = jest.fn(() => Date.now() - startedAt);
    const activity = createClockActivity();
    activity.set(true);
    const api = await render(
      <ElapsedText
        getElapsedMs={getElapsedMs}
        running
        activity={activity}
        format={format}
        testID="t"
      />
    );
    await advance(2000);
    expect(api.getByTestId("t")).toHaveTextContent("2s");

    // Paused 2.4 s in: the label stops waking, and the display holds.
    await advance(400);
    await act(async () => {
      activity.set(false);
    });
    const readsAtPause = getElapsedMs.mock.calls.length;
    await advance(5000);
    expect(api.getByTestId("t")).toHaveTextContent("2s");
    expect(getElapsedMs).toHaveBeenCalledTimes(readsAtPause);

    // Resumed: the pause is taken out of the clock (the start moves forward),
    // and the next second lands 600 ms later.
    startedAt += 5000;
    await act(async () => {
      activity.set(true);
    });
    expect(api.getByTestId("t")).toHaveTextContent("2s");
    await advance(599);
    expect(api.getByTestId("t")).toHaveTextContent("2s");
    await advance(1);
    expect(api.getByTestId("t")).toHaveTextContent("3s");
  });

  it("flips exactly at the clock's second boundary when it started mid-second", async () => {
    // 400 ms already on the clock: the first second ends 600 ms from now.
    const api = await render(
      <ElapsedText getElapsedMs={clockFrom(T0 - 400)} running format={format} testID="t" />
    );
    expect(api.getByTestId("t")).toHaveTextContent("0s");
    await advance(599);
    expect(api.getByTestId("t")).toHaveTextContent("0s");
    await advance(1);
    expect(api.getByTestId("t")).toHaveTextContent("1s");
    await advance(999);
    expect(api.getByTestId("t")).toHaveTextContent("1s");
    await advance(1);
    expect(api.getByTestId("t")).toHaveTextContent("2s");
  });

  it("stops ticking when it is not running", async () => {
    const api = await render(
      <ElapsedText getElapsedMs={clockFrom(T0)} running format={format} testID="t" />
    );
    await advance(2000);
    expect(api.getByTestId("t")).toHaveTextContent("2s");
    await api.rerender(
      <ElapsedText getElapsedMs={clockFrom(T0)} running={false} format={format} testID="t" />
    );
    await advance(5000);
    expect(api.getByTestId("t")).toHaveTextContent("2s");
  });

  it("shows a frozen time instead of the live one", async () => {
    const api = await render(
      <ElapsedText
        getElapsedMs={() => 99_000}
        running={false}
        frozenS={65}
        format={format}
        testID="t"
      />
    );
    expect(api.getByTestId("t")).toHaveTextContent("65s");
  });

  it("re-reads and re-aligns the clock at once when resetKey changes", async () => {
    let elapsed: number | null = 7000;
    const getElapsedMs = () => elapsed;
    const api = await render(
      <ElapsedText getElapsedMs={getElapsedMs} running resetKey={0} format={format} testID="t" />
    );
    expect(api.getByTestId("t")).toHaveTextContent("7s");
    elapsed = null; // a new puzzle: the clock has not started
    await api.rerender(
      <ElapsedText getElapsedMs={getElapsedMs} running resetKey={1} format={format} testID="t" />
    );
    expect(api.getByTestId("t")).toHaveTextContent("0s");
  });

  it("labels the time for a screen reader", async () => {
    const label = (time: string) => `Elapsed time ${time}`;
    const api = await render(
      <ElapsedText getElapsedMs={() => 5000} running format={format} accessibilityLabel={label} />
    );
    expect(api.getByLabelText("Elapsed time 5s")).toBeTruthy();
  });
});
