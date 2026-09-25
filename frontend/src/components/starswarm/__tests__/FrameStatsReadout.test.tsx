/** #2567: the on-screen "Frame" readout polls the canvas itself, at 4 Hz. */
import React from "react";
import { act, render, screen } from "@testing-library/react-native";
import FrameStatsReadout, { FRAME_STATS_POLL_MS } from "../FrameStatsReadout";
import type { FrameStatsSummary } from "../../../game/starswarm/render/frameStats";

describe("FrameStatsReadout", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("shows the latest summary, refreshed on its own timer", async () => {
    let current: FrameStatsSummary | null = null;
    const read = jest.fn(() => current);
    await render(<FrameStatsReadout read={read} />);
    expect(screen.getByText("frame: no samples")).toBeTruthy();

    current = { avgMs: 16.7, p95Ms: 17.9, frames: 60, commitsPerSec: 0 };
    await act(async () => {
      jest.advanceTimersByTime(FRAME_STATS_POLL_MS);
    });
    expect(screen.getByText("16.7 ms avg · 17.9 p95 · 60 f · 0 commits/s")).toBeTruthy();
  });

  it("stops polling when unmounted", async () => {
    const read = jest.fn(() => null);
    const { unmount } = await render(<FrameStatsReadout read={read} />);
    await unmount();
    const calls = read.mock.calls.length;
    await act(async () => {
      jest.advanceTimersByTime(FRAME_STATS_POLL_MS * 4);
    });
    expect(read.mock.calls.length).toBe(calls);
  });
});
