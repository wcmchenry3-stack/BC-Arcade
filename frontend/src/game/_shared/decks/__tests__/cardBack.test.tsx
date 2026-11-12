/**
 * #3740: the card back through the decks, as PlayingCard injects it. Classic and Neon draw the
 * lattice, Minimal the frame; one back in light and dark; the outer edge follows the `border` prop.
 */
import React from "react";
import { render, screen } from "@testing-library/react-native";

import ClassicCardFace from "../classic/ClassicCardFace";
import NeonCardFace from "../neon/NeonCardFace";
import MinimalCardFace from "../minimal/MinimalCardFace";
import CardBack from "../CardBack";
import { dark, light, type Colors } from "../../../../theme/ThemeContext";
import type { CardFaceProps } from "../types";

jest.mock("react-native-svg", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createElement } = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  const host = (name: string) => {
    const Host = ({ children, ...props }: { children?: React.ReactNode }) =>
      createElement(View, { testID: `svg-${name}`, ...props }, children);
    Host.displayName = `Svg(${name})`;
    return Host;
  };
  return {
    __esModule: true,
    default: host("svg"),
    Svg: host("svg"),
    G: host("g"),
    Rect: host("rect"),
    Path: host("path"),
    Defs: host("defs"),
    Filter: host("filter"),
    FeGaussianBlur: host("fe-gaussian-blur"),
    FeMerge: host("fe-merge"),
    FeMergeNode: host("fe-merge-node"),
    Text: host("text"),
  };
});

/** The props PlayingCard injects for a theme. */
function themeProps(c: Colors): Omit<CardFaceProps, "suit" | "rank" | "width" | "height"> {
  return {
    faceDown: true,
    cardBg: c.cardFace,
    cardBgBack: c.cardBack,
    cardBackInk: c.cardBackInk,
    border: c.border,
    borderHighlight: c.accent,
    textColor: c.cardInk,
    redSuitColor: c.cardRedSuit,
  };
}

/** Every drawn rect and path's props, in order. */
function drawn() {
  return screen.queryAllByTestId(/^svg-(rect|path)$/).map((n) => ({
    testID: n.props.testID,
    ...n.props,
  }));
}

describe("card back", () => {
  it("Classic: the lattice in the card tokens, 6 elements at 60 x 84", async () => {
    await render(
      <ClassicCardFace suit="spades" rank={1} width={60} height={84} {...themeProps(dark)} />
    );
    const els = drawn();
    expect(els.map((e) => e.testID)).toEqual([
      "svg-rect",
      "svg-rect",
      "svg-path",
      "svg-rect",
      "svg-path",
      "svg-rect",
    ]);
    expect(els[0]!.fill).toBe(dark.cardFace);
    expect(els[1]!.fill).toBe(dark.cardBack);
    expect(els[2]!.stroke).toBe(dark.cardBackInk);
  });

  it("Classic: the same drawing in light and dark apart from the border colour", async () => {
    await render(
      <ClassicCardFace suit="spades" rank={1} width={60} height={84} {...themeProps(dark)} />
    );
    const inDark = drawn().map((e) => ({
      ...e,
      stroke: e.stroke === dark.border ? "edge" : e.stroke,
    }));
    await screen.unmount();
    await render(
      <ClassicCardFace suit="spades" rank={1} width={60} height={84} {...themeProps(light)} />
    );
    const inLight = drawn().map((e) => ({
      ...e,
      stroke: e.stroke === light.border ? "edge" : e.stroke,
    }));
    expect(inLight).toEqual(inDark);
  });

  it("Classic: the outer edge is the border prop, so hint and selection borders show face-down", async () => {
    await render(
      <ClassicCardFace
        suit="spades"
        rank={1}
        width={60}
        height={84}
        {...themeProps(dark)}
        border="#facc15"
      />
    );
    const edge = drawn().at(-1)!;
    expect(edge).toMatchObject({ x: 0.5, y: 0.5, stroke: "#facc15", fill: "none" });
  });

  it("Neon: a cyan margin, navy field and cyan lattice, the same in both themes", async () => {
    await render(
      <NeonCardFace suit="spades" rank={1} width={60} height={84} {...themeProps(light)} />
    );
    const els = drawn();
    expect(els[0]!.fill).toBe("#22d3ee");
    expect(els[1]!.fill).toBe("#0b1b3a");
    expect(els[2]!.stroke).toBe("#22d3ee");
    expect(screen.queryAllByTestId("svg-filter")).toHaveLength(0);
  });

  it("Minimal: the frame only (margin, field, inset line), no pattern and no mark", async () => {
    await render(
      <MinimalCardFace suit="spades" rank={1} width={60} height={84} {...themeProps(dark)} />
    );
    expect(screen.getByTestId("minimal-back").props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ backgroundColor: dark.cardFace })])
    );
    expect(screen.getByTestId("minimal-back-field").props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ backgroundColor: dark.cardBack })])
    );
    expect(screen.getByTestId("minimal-back-line")).toBeTruthy();
    expect(screen.queryByText("?")).toBeNull();
  });

  it("Minimal: the outer edge is the border prop", async () => {
    await render(
      <MinimalCardFace
        suit="spades"
        rank={1}
        width={60}
        height={84}
        {...themeProps(dark)}
        border="#facc15"
      />
    );
    expect(screen.getByTestId("minimal-back").props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ borderColor: "#facc15" })])
    );
  });

  it("CardBack is memoised (React.memo) so an unchanged card does not redraw", () => {
    expect((CardBack as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for("react.memo"));
  });
});
