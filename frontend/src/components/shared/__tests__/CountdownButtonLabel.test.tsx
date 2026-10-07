import React from "react";
import { act, render } from "@testing-library/react-native";
import { CountdownButtonLabel, formatCountdown } from "../CountdownButtonLabel";

const T0 = 1_800_000_000_000;

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(T0);
});

afterEach(() => {
  jest.useRealTimers();
});

const renderLabel = (time: string) => `Next word in ${time}`;

/** Moves the wall clock and fires whatever timers are due. */
async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

describe("formatCountdown", () => {
  it("formats HH:MM:SS and never goes below zero", () => {
    expect(formatCountdown(6 * 3600_000 + 12 * 60_000 + 40_000)).toBe("06:12:40");
    expect(formatCountdown(999)).toBe("00:00:00");
    expect(formatCountdown(-5000)).toBe("00:00:00");
  });
});

describe("CountdownButtonLabel (#2964)", () => {
  it("counts down once a second", async () => {
    const api = await render(
      <CountdownButtonLabel
        untilMs={T0 + 65_000}
        renderLabel={renderLabel}
        onReady={jest.fn()}
        testID="c"
      />
    );
    expect(api.getByTestId("c")).toHaveTextContent("Next word in 00:01:05");
    await advance(1000);
    expect(api.getByTestId("c")).toHaveTextContent("Next word in 00:01:04");
    await advance(4000);
    expect(api.getByTestId("c")).toHaveTextContent("Next word in 00:01:00");
  });

  it("calls onReady exactly once when the countdown reaches zero", async () => {
    const onReady = jest.fn();
    const api = await render(
      <CountdownButtonLabel
        untilMs={T0 + 3000}
        renderLabel={renderLabel}
        onReady={onReady}
        testID="c"
      />
    );
    await advance(2000);
    expect(onReady).not.toHaveBeenCalled();
    await advance(1000);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(api.getByTestId("c")).toHaveTextContent("Next word in 00:00:00");
    await advance(10_000);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("calls onReady at once when the time has already passed", async () => {
    const onReady = jest.fn();
    await render(
      <CountdownButtonLabel untilMs={T0 - 1} renderLabel={renderLabel} onReady={onReady} />
    );
    expect(onReady).toHaveBeenCalledTimes(1);
    await advance(5000);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("does not restart on a new onReady identity, and restarts on a new untilMs", async () => {
    const first = jest.fn();
    const second = jest.fn();
    const api = await render(
      <CountdownButtonLabel
        untilMs={T0 + 2000}
        renderLabel={renderLabel}
        onReady={first}
        testID="c"
      />
    );
    await advance(1000);
    await api.rerender(
      <CountdownButtonLabel
        untilMs={T0 + 2000}
        renderLabel={renderLabel}
        onReady={second}
        testID="c"
      />
    );
    await advance(1000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    await api.rerender(
      <CountdownButtonLabel
        untilMs={T0 + 4000}
        renderLabel={renderLabel}
        onReady={second}
        testID="c"
      />
    );
    expect(api.getByTestId("c")).toHaveTextContent("Next word in 00:00:02");
    await advance(2000);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("stops ticking when unmounted", async () => {
    const onReady = jest.fn();
    const api = await render(
      <CountdownButtonLabel untilMs={T0 + 2000} renderLabel={renderLabel} onReady={onReady} />
    );
    await api.unmount();
    await advance(5000);
    expect(onReady).not.toHaveBeenCalled();
  });
});
