import React from "react";
import { act, render } from "@testing-library/react-native";
import { ElapsedText } from "../ElapsedText";

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
  it("shows 0 before the clock starts, then ticks on the clock's own seconds", async () => {
    let startedAt: number | null = null;
    const getElapsedMs = () => (startedAt === null ? null : Date.now() - startedAt);
    const api = await render(
      <ElapsedText getElapsedMs={getElapsedMs} running format={format} testID="t" />
    );
    expect(api.getByTestId("t")).toHaveTextContent("0s");
    await advance(3100);
    expect(api.getByTestId("t")).toHaveTextContent("0s");

    // The first move lands mid-way through the ticker's polling interval; the
    // label flips exactly one second after the move, not one second after mount.
    startedAt = Date.now();
    await advance(999);
    expect(api.getByTestId("t")).toHaveTextContent("0s");
    await advance(1);
    expect(api.getByTestId("t")).toHaveTextContent("1s");
    await advance(2000);
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
