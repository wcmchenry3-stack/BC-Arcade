/**
 * TrickArea on the card table (#3587): cards at the geometry's size and spots with a small
 * tilt per seat, no dashed outlines, and the completion callback that resolves the AI loop
 * (HeartsScreen.handleCardPress) still firing at the sweep's end (#3574's clock).
 */
import React from "react";
import { StyleSheet } from "react-native";
import { act, render } from "@testing-library/react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import TrickArea from "../TrickArea";
import { computeHeartsGeometry } from "../../../game/hearts/layout";
import type { Card, TrickCard } from "../../../game/hearts/types";
import { SWEEP_MS, TRICK_HOLD_MS } from "../trickMotion";
import { timeReanimatedEnds } from "./helpers/animationFixtures";

const GEOMETRY = computeHeartsGeometry({ width: 390, height: 708 }).trick;

const c = (suit: Card["suit"], rank: Card["rank"]): Card => ({ suit, rank });
const FULL: TrickCard[] = [
  { card: c("spades", 10), playerIndex: 0 },
  { card: c("hearts", 3), playerIndex: 1 },
  { card: c("clubs", 8), playerIndex: 2 },
  { card: c("diamonds", 5), playerIndex: 3 },
];

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe("TrickArea geometry", () => {
  it("sizes the area from the geometry", async () => {
    const { getByLabelText } = await wrap(
      <TrickArea trick={FULL} playerIndex={0} geometry={GEOMETRY} />
    );
    const area = StyleSheet.flatten(getByLabelText("Current trick").props.style);
    expect(area.width).toBe(GEOMETRY.area.w);
    expect(area.height).toBe(GEOMETRY.area.h);
  });

  it("draws each seat's card at the geometry's 66 dp with that seat's own tilt", async () => {
    const { getByLabelText } = await wrap(
      <TrickArea trick={FULL} playerIndex={0} geometry={GEOMETRY} />
    );
    const cards = [
      { label: "10 of Spades", pos: "bottom" },
      { label: "3 of Hearts", pos: "left" },
      { label: "8 of Clubs", pos: "top" },
      { label: "5 of Diamonds", pos: "right" },
    ] as const;
    expect(GEOMETRY.cardW).toBe(66);
    const tilts = new Set<number>();
    for (const { label, pos } of cards) {
      const style = StyleSheet.flatten(getByLabelText(label).props.style);
      expect(style.width).toBe(66);
      expect(style.height).toBe(GEOMETRY.cardH);
      const tilt = parseFloat(
        (style.transform as { rotate?: string }[]).find((t) => t.rotate !== undefined)!.rotate!
      );
      expect(tilt).toBeCloseTo(GEOMETRY.slots[pos].rotation, 5);
      tilts.add(tilt);
    }
    expect(tilts.size).toBe(4);
  });

  it("names an empty slot for the seat that has yet to play, and draws no outline for it", async () => {
    const { getByLabelText, toJSON } = await wrap(
      <TrickArea
        trick={[FULL[0]!]}
        playerIndex={0}
        playerLabels={["You", "West", "North", "East"]}
        geometry={GEOMETRY}
      />
    );
    expect(getByLabelText("Empty slot — West")).toBeTruthy();
    expect(JSON.stringify(toJSON())).not.toContain("dashed");
  });

  describe("sweep", () => {
    beforeEach(() => {
      jest.useFakeTimers();
      timeReanimatedEnds();
    });
    afterEach(() => {
      jest.restoreAllMocks();
      jest.useRealTimers();
    });
    // A trick on the table at mount does not fly in: the 300 ms hold, then the 200 ms sweep.
    const DONE_MS = TRICK_HOLD_MS + SWEEP_MS;

    it("still completes at the sweep's end, so the AI loop is resolved", async () => {
      const onComplete = jest.fn();
      await wrap(
        <TrickArea
          trick={FULL}
          playerIndex={0}
          winnerIndex={2}
          onAnimationComplete={onComplete}
          geometry={GEOMETRY}
        />
      );
      await act(async () => {
        jest.advanceTimersByTime(DONE_MS - 1);
      });
      expect(onComplete).not.toHaveBeenCalled();
      await act(async () => {
        jest.advanceTimersByTime(1);
      });
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it("sends the winner's card to the winner's plate, past the middle of the table", async () => {
      // North (seat 2) wins; its own card sits at the top spot and ends on the plate's centre.
      const ui = () => (
        <TrickArea
          trick={FULL}
          playerIndex={0}
          winnerIndex={2}
          playerLabels={["You", "West", "North", "East"]}
          geometry={GEOMETRY}
        />
      );
      const { getByLabelText, rerender } = await wrap(ui());
      await act(async () => {
        jest.advanceTimersByTime(DONE_MS);
      });
      // The sweep runs on a Reanimated shared value: the Jest mock shows a write on the next render.
      await rerender(<ThemeProvider>{ui()}</ThemeProvider>);
      const target = GEOMETRY.plateCentres.top;
      const own = GEOMETRY.slots.top;
      const style = StyleSheet.flatten(getByLabelText("North won the trick").props.style);
      const moves = style.transform as { translateX?: number; translateY?: number }[];
      const tx = moves.find((t) => t.translateX !== undefined)!.translateX!;
      const ty = moves.find((t) => t.translateY !== undefined)!.translateY!;
      expect(tx).toBeCloseTo(target.x - (own.x + GEOMETRY.cardW / 2), 0);
      expect(ty).toBeCloseTo(target.y - (own.y + GEOMETRY.cardH / 2), 0);
      expect(ty).toBeLessThan(0);
    });
  });
});
