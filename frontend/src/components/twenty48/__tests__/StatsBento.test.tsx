import React from "react";
import { render } from "@testing-library/react-native";
import StatsBento, { formatTime, highestTile } from "../StatsBento";
import { ThemeProvider } from "../../../theme/ThemeContext";
import { Twenty48State } from "../../../game/twenty48/types";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("formatTime", () => {
  it("formats zero as 00:00", () => {
    expect(formatTime(0)).toBe("00:00");
  });

  it("formats 61 000 ms as 01:01", () => {
    expect(formatTime(61_000)).toBe("01:01");
  });

  it("formats 3599 000 ms as 59:59", () => {
    expect(formatTime(3_599_000)).toBe("59:59");
  });

  it("pads single-digit minutes and seconds", () => {
    expect(formatTime(9_000)).toBe("00:09");
    expect(formatTime(60_000)).toBe("01:00");
  });
});

describe("highestTile", () => {
  it("returns 0 for an empty board", () => {
    expect(
      highestTile([
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ])
    ).toBe(0);
  });

  it("returns the max value on the board", () => {
    expect(
      highestTile([
        [2, 4, 8, 16],
        [32, 64, 128, 256],
        [512, 1024, 0, 0],
        [0, 0, 0, 0],
      ])
    ).toBe(1024);
  });
});

// ---------------------------------------------------------------------------
// Component rendering
// ---------------------------------------------------------------------------

function makeState(overrides: Partial<Twenty48State> = {}): Twenty48State {
  return {
    board: [
      [2, 4, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    tiles: [],
    score: 0,
    scoreDelta: 0,
    game_over: false,
    has_won: false,
    startedAt: null,
    accumulatedMs: 0,
    ...overrides,
  };
}

async function renderBento(state: Twenty48State) {
  return await render(
    <ThemeProvider>
      <StatsBento state={state} />
    </ThemeProvider>
  );
}

describe("StatsBento — rendering", () => {
  it("renders Highest Tile label", async () => {
    const { getByText } = await renderBento(makeState());
    expect(getByText("Highest Tile")).toBeTruthy();
  });

  it("renders Time Played label", async () => {
    const { getByText } = await renderBento(makeState());
    expect(getByText("Time Played")).toBeTruthy();
  });

  it("displays the correct highest tile value", async () => {
    const { getByLabelText } = await renderBento(makeState());
    // Board has max value 4.
    expect(getByLabelText("Highest tile: 4")).toBeTruthy();
  });

  it("shows — when board is all zeros", async () => {
    const state = makeState({
      board: [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
    });
    const { getByText } = await renderBento(state);
    expect(getByText("—")).toBeTruthy();
  });

  it("displays elapsed time from accumulatedMs when startedAt is null", async () => {
    const state = makeState({ accumulatedMs: 125_000, startedAt: null });
    // 125 000 ms = 2 min 5 s → "02:05"
    const { getByText } = await renderBento(state);
    expect(getByText("02:05")).toBeTruthy();
  });

  it("time accessibility label includes formatted time", async () => {
    const state = makeState({ accumulatedMs: 61_000, startedAt: null });
    const { getByLabelText } = await renderBento(state);
    expect(getByLabelText("Time played: 01:01")).toBeTruthy();
  });
});
