import React from "react";
import { act, render } from "@testing-library/react-native";
import { PlayClockText } from "../PlayClockText";

const T0 = 1_800_000_000_000;

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(T0);
});

afterEach(() => {
  jest.useRealTimers();
});

/** Moves the wall clock and fires whatever timers are due. */
async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

describe("PlayClockText (#2747)", () => {
  it("shows the banked time of a clock that isn't running", async () => {
    const api = await render(
      <PlayClockText startedAt={null} accumulatedMs={65_400} testID="clock" />
    );
    expect(api.getByTestId("clock")).toHaveTextContent("1:05");
    await advance(10_000);
    expect(api.getByTestId("clock")).toHaveTextContent("1:05");
  });

  it("shows hours once the play passes an hour", async () => {
    const api = await render(
      <PlayClockText startedAt={null} accumulatedMs={3_723_000} testID="clock" />
    );
    expect(api.getByTestId("clock")).toHaveTextContent("1:02:03");
  });

  it("ticks once a second while the clock runs, from the banked time", async () => {
    const api = await render(
      <PlayClockText startedAt={T0} accumulatedMs={60_000} testID="clock" />
    );
    expect(api.getByTestId("clock")).toHaveTextContent("1:00");
    await advance(999);
    expect(api.getByTestId("clock")).toHaveTextContent("1:00");
    await advance(1);
    expect(api.getByTestId("clock")).toHaveTextContent("1:01");
    await advance(59_000);
    expect(api.getByTestId("clock")).toHaveTextContent("2:00");
  });

  it("ticks on the clock's own seconds when its segment began mid-second", async () => {
    // 400 ms already banked: the first second ends 600 ms after the start.
    const api = await render(<PlayClockText startedAt={T0} accumulatedMs={400} testID="clock" />);
    expect(api.getByTestId("clock")).toHaveTextContent("0:00");
    await advance(600);
    expect(api.getByTestId("clock")).toHaveTextContent("0:01");
  });

  it("freezes when the clock pauses, and runs on from there when it resumes", async () => {
    const api = await render(<PlayClockText startedAt={T0} accumulatedMs={0} testID="clock" />);
    await advance(20_000);
    expect(api.getByTestId("clock")).toHaveTextContent("0:20");

    // The game pauses its clock (the app goes to the background): the
    // running segment is banked and startedAt cleared.
    await act(async () => {
      api.rerender(<PlayClockText startedAt={null} accumulatedMs={20_000} testID="clock" />);
    });
    await advance(2 * 60 * 60_000); // two hours away
    expect(api.getByTestId("clock")).toHaveTextContent("0:20");

    // Back: the clock runs again from now, with the 20 s banked.
    const back = Date.now();
    await act(async () => {
      api.rerender(<PlayClockText startedAt={back} accumulatedMs={20_000} testID="clock" />);
    });
    expect(api.getByTestId("clock")).toHaveTextContent("0:20");
    await advance(5_000);
    expect(api.getByTestId("clock")).toHaveTextContent("0:25");
  });

  it("stops for good when the game ends", async () => {
    const api = await render(<PlayClockText startedAt={T0} accumulatedMs={0} testID="clock" />);
    await advance(90_000);
    // stopClock: banked, not running, not paused.
    await act(async () => {
      api.rerender(<PlayClockText startedAt={null} accumulatedMs={90_000} testID="clock" />);
    });
    await advance(10 * 60_000);
    expect(api.getByTestId("clock")).toHaveTextContent("1:30");
  });

  it("shows a label before the time", async () => {
    const api = await render(
      <PlayClockText startedAt={null} accumulatedMs={7_000} label="TIME" testID="clock" />
    );
    expect(api.getByTestId("clock")).toHaveTextContent("TIME 0:07");
  });

  it("labels the time for screen readers without announcing every tick", async () => {
    const label = jest.fn((time: string) => `Elapsed time ${time}`);
    const api = await render(
      <PlayClockText startedAt={T0} accumulatedMs={0} accessibilityLabel={label} testID="clock" />
    );
    await advance(3_000);
    const clock = api.getByTestId("clock");
    expect(clock.props.accessibilityLabel).toBe("Elapsed time 0:03");
    expect(clock.props.accessibilityLiveRegion).toBe("none");
  });

  it("cancels its tick when paused and when unmounted", async () => {
    const clear = jest.spyOn(global, "clearTimeout");
    try {
      const api = await render(<PlayClockText startedAt={T0} accumulatedMs={0} />);
      const before = clear.mock.calls.length;
      await act(async () => {
        api.rerender(<PlayClockText startedAt={null} accumulatedMs={0} />);
      });
      expect(clear.mock.calls.length).toBe(before + 1);
      await act(async () => {
        api.rerender(<PlayClockText startedAt={Date.now()} accumulatedMs={0} />);
      });
      const running = clear.mock.calls.length;
      await act(async () => {
        api.unmount();
      });
      expect(clear.mock.calls.length).toBeGreaterThan(running);
    } finally {
      clear.mockRestore();
    }
  });
});
