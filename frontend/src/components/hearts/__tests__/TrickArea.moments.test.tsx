/**
 * TrickArea during the Queen of Spades moment (#3588): a completed trick waits on the table
 * while the moment holds it, then sweeps on the usual clock.
 */
import React from "react";
import { act, render } from "@testing-library/react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import TrickArea from "../TrickArea";
import { computeHeartsGeometry } from "../../../game/hearts/layout";
import type { Card, TrickCard } from "../../../game/hearts/types";
import { SWEEP_MS, TRICK_HOLD_MS } from "../trickMotion";
import { timeReanimatedEnds } from "./helpers/animationFixtures";

const GEOMETRY = computeHeartsGeometry({ width: 390, height: 708 }).trick;
const c = (suit: Card["suit"], rank: Card["rank"]): Card => ({ suit, rank });
const QUEEN_LAST: TrickCard[] = [
  { card: c("spades", 10), playerIndex: 0 },
  { card: c("spades", 3), playerIndex: 1 },
  { card: c("spades", 8), playerIndex: 2 },
  { card: c("spades", 12), playerIndex: 3 },
];
// From the hold's release: the 300 ms hold again, then the 200 ms sweep (#3574).
const RELEASE_TO_DONE_MS = TRICK_HOLD_MS + SWEEP_MS;

describe("TrickArea and the Queen of Spades moment", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    timeReanimatedEnds();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  const ui = (hold: boolean, onDone: () => void) => (
    <ThemeProvider>
      <TrickArea
        trick={QUEEN_LAST}
        playerIndex={0}
        winnerIndex={3}
        geometry={GEOMETRY}
        holdSweep={hold}
        nudge={hold}
        onAnimationComplete={onDone}
      />
    </ThemeProvider>
  );

  it("holds the sweep while the moment plays, then sweeps on the usual clock", async () => {
    const onDone = jest.fn();
    const view = await render(ui(true, onDone));
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(onDone).not.toHaveBeenCalled();
    // The cards are still on the table.
    expect(view.getByLabelText(/^Q of Spades/)).toBeTruthy();

    await view.rerender(ui(false, onDone));
    await act(async () => {
      jest.advanceTimersByTime(RELEASE_TO_DONE_MS - 50);
    });
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
