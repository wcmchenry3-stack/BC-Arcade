import React from "react";
import { render } from "@testing-library/react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import PlayerHand, { computeHandLayout, MIN_CARD_OFFSET } from "../PlayerHand";
import type { Card } from "../../../game/hearts/types";

const SUITS: Card["suit"][] = ["clubs", "diamonds", "spades", "hearts"];
function fullHand(): Card[] {
  const out: Card[] = [];
  for (let i = 0; i < 13; i++) {
    out.push({ suit: SUITS[i % 4]!, rank: (2 + Math.floor(i / 4)) as Card["rank"] });
  }
  return out;
}

describe("computeHandLayout (#2209)", () => {
  it("floors the offset at 24dp and scrolls on a 320dp device with 13 cards", () => {
    const l = computeHandLayout(320, 13);
    expect(l.offset).toBeGreaterThanOrEqual(MIN_CARD_OFFSET);
    expect(l.scrollable).toBe(true);
    expect(l.containerWidth).toBe(l.offset * 12 + 52);
  });

  it("keeps today's fitted offset on wide screens", () => {
    const l = computeHandLayout(414, 13);
    expect(l.offset).toBeCloseTo((414 - 16 - 52) / 12, 5);
    expect(l.scrollable).toBe(false);
  });

  it("handles one card and an empty hand", () => {
    expect(computeHandLayout(320, 1)).toEqual({ offset: 0, containerWidth: 52, scrollable: false });
    expect(computeHandLayout(320, 0).scrollable).toBe(false);
  });
});

describe("PlayerHand narrow layout (#2209)", () => {
  let dims: jest.SpyInstance | undefined;
  afterEach(() => dims?.mockRestore());

  function mockWidth(width: number) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const RN = require("react-native");
    dims = jest.spyOn(RN, "useWindowDimensions").mockReturnValue({
      width,
      height: 700,
      scale: 2,
      fontScale: 1,
    });
  }

  it("renders a horizontal scroll container with all 13 cards pressable at 320dp", async () => {
    mockWidth(320);
    const { getByTestId, getAllByRole } = await render(
      <ThemeProvider>
        <PlayerHand hand={fullHand()} onCardPress={jest.fn()} />
      </ThemeProvider>
    );
    expect(getByTestId("hearts-hand-scroll")).toBeTruthy();
    expect(getAllByRole("button")).toHaveLength(13);
    expect(getByTestId("hearts-hand-card-12")).toBeTruthy();
  });

  it("does not render the scroll container on a wide screen", async () => {
    mockWidth(414);
    const { queryByTestId } = await render(
      <ThemeProvider>
        <PlayerHand hand={fullHand()} onCardPress={jest.fn()} />
      </ThemeProvider>
    );
    expect(queryByTestId("hearts-hand-scroll")).toBeNull();
  });
});
