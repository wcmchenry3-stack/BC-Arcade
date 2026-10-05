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

describe("ElapsedText (#2964)", () => {
  it("shows 0 before the clock starts and ticks once it has", async () => {
    let startedAt: number | null = null;
    const getElapsedS = () =>
      startedAt === null ? null : Math.floor((Date.now() - startedAt) / 1000);
    const api = await render(
      <ElapsedText getElapsedS={getElapsedS} running format={format} testID="t" />
    );
    expect(api.getByTestId("t")).toHaveTextContent("0s");
    await advance(3000);
    expect(api.getByTestId("t")).toHaveTextContent("0s");

    startedAt = Date.now();
    await advance(1000);
    expect(api.getByTestId("t")).toHaveTextContent("1s");
    await advance(2000);
    expect(api.getByTestId("t")).toHaveTextContent("3s");
  });

  it("stops ticking when it is not running", async () => {
    const start = Date.now();
    const getElapsedS = () => Math.floor((Date.now() - start) / 1000);
    const api = await render(
      <ElapsedText getElapsedS={getElapsedS} running format={format} testID="t" />
    );
    await advance(2000);
    expect(api.getByTestId("t")).toHaveTextContent("2s");
    await api.rerender(
      <ElapsedText getElapsedS={getElapsedS} running={false} format={format} testID="t" />
    );
    await advance(5000);
    expect(api.getByTestId("t")).toHaveTextContent("2s");
  });

  it("shows a frozen time instead of the live one", async () => {
    const getElapsedS = () => 99;
    const api = await render(
      <ElapsedText
        getElapsedS={getElapsedS}
        running={false}
        frozenS={65}
        format={format}
        testID="t"
      />
    );
    expect(api.getByTestId("t")).toHaveTextContent("65s");
  });

  it("re-reads the clock at once when resetKey changes", async () => {
    let value: number | null = 7;
    const getElapsedS = () => value;
    const api = await render(
      <ElapsedText getElapsedS={getElapsedS} running resetKey={0} format={format} testID="t" />
    );
    expect(api.getByTestId("t")).toHaveTextContent("7s");
    value = null; // a new puzzle: the clock has not started
    await api.rerender(
      <ElapsedText getElapsedS={getElapsedS} running resetKey={1} format={format} testID="t" />
    );
    expect(api.getByTestId("t")).toHaveTextContent("0s");
  });

  it("labels the time for a screen reader", async () => {
    const label = (time: string) => `Elapsed time ${time}`;
    const api = await render(
      <ElapsedText getElapsedS={() => 5} running format={format} accessibilityLabel={label} />
    );
    expect(api.getByLabelText("Elapsed time 5s")).toBeTruthy();
  });
});
