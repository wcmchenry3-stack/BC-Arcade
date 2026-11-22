/**
 * Review of #3608: with Reduce Motion on, a hand card stands at its height at once (no spring);
 * with it off, the lift springs as before.
 */
import React from "react";
import { render } from "@testing-library/react-native";
import * as Reanimated from "react-native-reanimated";
import { ThemeProvider } from "../../../theme/ThemeContext";
import PlayerHand from "../PlayerHand";
import { computeHeartsGeometry } from "../../../game/hearts/layout";
import type { Card } from "../../../game/hearts/types";

let mockReduceMotion = false;
jest.mock("../../shared/useReduceMotion", () => ({
  ...jest.requireActual("../../shared/useReduceMotion"),
  useReduceMotion: () => mockReduceMotion,
}));

const HAND: Card[] = [
  { suit: "clubs", rank: 2 },
  { suit: "clubs", rank: 9 },
  { suit: "hearts", rank: 4 },
];
const GEOMETRY = computeHeartsGeometry({ width: 390, height: 708 }).hand;

async function renderHand() {
  return render(
    <ThemeProvider>
      <PlayerHand
        hand={HAND}
        geometry={GEOMETRY}
        onCardPress={jest.fn()}
        validCards={[HAND[0]!, HAND[1]!]}
      />
    </ThemeProvider>
  );
}

describe("PlayerHand lift and Reduce Motion", () => {
  let springSpy: jest.SpyInstance;
  beforeEach(() => {
    springSpy = jest.spyOn(Reanimated, "withSpring");
  });
  afterEach(() => {
    springSpy.mockRestore();
    mockReduceMotion = false;
  });

  it("springs the lift when Reduce Motion is off", async () => {
    mockReduceMotion = false;
    await renderHand();
    expect(springSpy).toHaveBeenCalled();
  });

  it("sets the lift at once, with no spring, when Reduce Motion is on", async () => {
    mockReduceMotion = true;
    await renderHand();
    expect(springSpy).not.toHaveBeenCalled();
  });
});
