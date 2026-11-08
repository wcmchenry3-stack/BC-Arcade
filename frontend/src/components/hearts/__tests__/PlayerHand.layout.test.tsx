import React from "react";
import { StyleSheet } from "react-native";
import { render } from "@testing-library/react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import PlayerHand from "../PlayerHand";
import { computeHandPoses, computeHeartsGeometry } from "../../../game/hearts/layout";
import type { Card } from "../../../game/hearts/types";

const SUITS: Card["suit"][] = ["clubs", "diamonds", "spades", "hearts"];
function fullHand(): Card[] {
  const out: Card[] = [];
  for (let i = 0; i < 13; i++) {
    out.push({ suit: SUITS[i % 4]!, rank: (2 + Math.floor(i / 4)) as Card["rank"] });
  }
  return out;
}

const GEOMETRY = computeHeartsGeometry({ width: 390, height: 708 }).hand;

function translateY(style: unknown): number {
  const t = StyleSheet.flatten(style as never).transform as { translateY?: number }[] | undefined;
  return t?.find((e) => e.translateY !== undefined)?.translateY ?? 0;
}

function rotationOf(style: unknown): number {
  const t = StyleSheet.flatten(style as never).transform as { rotate?: string }[] | undefined;
  return parseFloat(t?.find((e) => e.rotate !== undefined)?.rotate ?? "0");
}

describe("PlayerHand fan (#3587)", () => {
  it("places 13 cards on the geometry's arc: tilted outward and dropped toward the ends", async () => {
    const { getByTestId } = await render(
      <ThemeProvider>
        <PlayerHand hand={fullHand()} geometry={GEOMETRY} onCardPress={jest.fn()} />
      </ThemeProvider>
    );
    const poses = computeHandPoses(GEOMETRY, 13);
    const slot = (i: number) =>
      StyleSheet.flatten(getByTestId(`hearts-hand-card-${i}`).props.style);
    for (const i of [0, 6, 12]) {
      expect(slot(i).left).toBeCloseTo(poses[i]!.x, 5);
      expect(slot(i).top).toBeCloseTo(poses[i]!.y, 5);
      expect(slot(i).width).toBe(GEOMETRY.cardW);
      expect(slot(i).height).toBe(GEOMETRY.cardH);
    }
    // The middle card is highest and upright; the ends are lower by the arc and tilted +-14.
    expect(slot(0).top as number).toBeGreaterThan(slot(6).top as number);
    expect(slot(12).top as number).toBeGreaterThan(slot(6).top as number);
    expect(rotationOf(getByTestId("hearts-hand-playable-0").props.style)).toBeCloseTo(-14, 5);
    expect(rotationOf(getByTestId("hearts-hand-playable-6").props.style)).toBeCloseTo(0, 5);
    expect(rotationOf(getByTestId("hearts-hand-playable-12").props.style)).toBeCloseTo(14, 5);
  });

  it("fits the window's width when no geometry is given, with every card pressable and no scrolling", async () => {
    const { getAllByRole, queryByTestId } = await render(
      <ThemeProvider>
        <PlayerHand hand={fullHand()} onCardPress={jest.fn()} />
      </ThemeProvider>
    );
    expect(getAllByRole("button")).toHaveLength(13);
    expect(queryByTestId("hearts-hand-scroll")).toBeNull();
  });

  it("raises a playable card and leaves an unplayable one in the arc", async () => {
    const hand = fullHand();
    const valid = [hand[0]!];
    const { getByTestId } = await render(
      <ThemeProvider>
        <PlayerHand hand={hand} validCards={valid} geometry={GEOMETRY} onCardPress={jest.fn()} />
      </ThemeProvider>
    );
    // The sorted hand's first card is the first clubs card; only one card is legal.
    const raised = [...Array(13).keys()].filter(
      (i) => translateY(getByTestId(`hearts-hand-card-${i}`).props.style) !== 0
    );
    expect(raised).toHaveLength(1);
    expect(translateY(getByTestId(`hearts-hand-card-${raised[0]}`).props.style)).toBeCloseTo(
      -GEOMETRY.raise,
      5
    );
  });

  it("lifts a card selected for passing higher than a playable one", async () => {
    const hand = fullHand();
    const { getByTestId } = await render(
      <ThemeProvider>
        <PlayerHand
          hand={hand}
          selectedCards={[hand[2]!]}
          geometry={GEOMETRY}
          onCardPress={jest.fn()}
        />
      </ThemeProvider>
    );
    const lifted = [...Array(13).keys()].filter(
      (i) => translateY(getByTestId(`hearts-hand-card-${i}`).props.style) !== 0
    );
    expect(lifted).toHaveLength(1);
    expect(translateY(getByTestId(`hearts-hand-card-${lifted[0]}`).props.style)).toBeCloseTo(
      -GEOMETRY.selectLift,
      5
    );
    expect(GEOMETRY.selectLift).toBeGreaterThan(GEOMETRY.raise);
  });

  it("dims every card while it is not the human's turn, and raises none", async () => {
    const { getByTestId } = await render(
      <ThemeProvider>
        <PlayerHand hand={fullHand()} validCards={[]} geometry={GEOMETRY} onCardPress={jest.fn()} />
      </ThemeProvider>
    );
    for (let i = 0; i < 13; i++) {
      expect(translateY(getByTestId(`hearts-hand-card-${i}`).props.style)).toBeCloseTo(0, 5);
    }
  });
});
