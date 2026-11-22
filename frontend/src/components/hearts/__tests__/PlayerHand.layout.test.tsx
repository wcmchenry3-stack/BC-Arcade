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

// The tilt is on the card's own box, which holds the pressable strip.
function tiltOf(el: { props: { style?: unknown }; parent: unknown }): number {
  let node = el as { props: { style?: unknown }; parent: unknown } | null;
  while (node) {
    const t = StyleSheet.flatten(node.props.style as never)?.transform as
      { rotate?: string }[] | undefined;
    if (t?.some((e) => e.rotate !== undefined)) return rotationOf(node.props.style);
    node = node.parent as typeof node;
  }
  return 0;
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
    expect(tiltOf(getByTestId("hearts-hand-playable-0"))).toBeCloseTo(-14, 5);
    expect(tiltOf(getByTestId("hearts-hand-playable-6"))).toBeCloseTo(0, 5);
    expect(tiltOf(getByTestId("hearts-hand-playable-12"))).toBeCloseTo(14, 5);
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

describe("PlayerHand touch targets (#3587, Maestro hearts/ai-hand)", () => {
  async function mountHand() {
    const api = await render(
      <ThemeProvider>
        <PlayerHand hand={fullHand()} geometry={GEOMETRY} onCardPress={jest.fn()} />
      </ThemeProvider>
    );
    return api;
  }
  const widthOf = (el: { props: { style?: unknown } }) =>
    StyleSheet.flatten(el.props.style as never).width as number;
  const poses = computeHandPoses(GEOMETRY, 13);

  it("gives every card but the last only its visible strip, and the last its full width", async () => {
    const { getByTestId } = await mountHand();
    for (let i = 0; i < 12; i++) {
      const w = widthOf(getByTestId(`hearts-hand-playable-${i}`));
      expect(w).toBeCloseTo(poses[i + 1]!.x - poses[i]!.x, 5);
      expect(w).toBeLessThan(GEOMETRY.cardW);
    }
    expect(widthOf(getByTestId("hearts-hand-playable-12"))).toBe(GEOMETRY.cardW);
  });

  it("puts the centre of each target in its own strip, not under the next card", async () => {
    // Maestro taps an element's centre: it must not land on a card drawn above this one.
    const { getByTestId } = await mountHand();
    for (let i = 0; i < 12; i++) {
      const w = widthOf(getByTestId(`hearts-hand-playable-${i}`));
      expect(poses[i]!.x + w / 2).toBeLessThan(poses[i + 1]!.x);
    }
  });

  it("keeps the strip at least 22 dp wide, at 320 dp with 13 cards, and 24 dp from 360 dp", () => {
    const strip = (width: number, height: number) => {
      const h = computeHeartsGeometry({ width, height }).hand;
      const p = computeHandPoses(h, 13);
      return p[1]!.x - p[0]!.x;
    };
    expect(strip(320, 432)).toBeGreaterThanOrEqual(22);
    expect(strip(360, 504)).toBeGreaterThanOrEqual(24);
    expect(strip(390, 708)).toBeGreaterThanOrEqual(24);
  });

  it("is one button per card, each with the card's own label, and the card still draws full size", async () => {
    const { getAllByRole, getByTestId } = await mountHand();
    expect(getAllByRole("button")).toHaveLength(13);
    expect(getByTestId("hearts-hand-playable-0").props.accessibilityLabel).toMatch(/^2 of Clubs/);
    expect(StyleSheet.flatten(getByTestId("hearts-hand-card-0").props.style).width).toBe(
      GEOMETRY.cardW
    );
  });
});
