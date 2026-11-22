/**
 * #2956: the Classic and Neon SVG card faces, pinned before #2983 folds them into one
 * SvgCardFace. react-native-svg is replaced by stubs that keep each element's raw props
 * (testID `svg-<element>`), so a test reads what is drawn: how many rects, texts, paths and
 * circles a face has, their fills and strokes, the corner text, the suit path, the back grid and
 * (Neon) the glow filter. Elements are picked by their props, never by position, and grouping
 * (`G`, `Defs`) is not part of the contract: #2983 may reorder or regroup the drawing, but it
 * has to keep these primitives and colours.
 */
import { LATTICE_OPACITY } from "../cardBackShapes";
import React from "react";
import { render, screen } from "@testing-library/react-native";
import type { TestInstance } from "test-renderer";

import ClassicCardFace from "../classic/ClassicCardFace";
import NeonCardFace from "../neon/NeonCardFace";
import { SUIT_PATHS } from "../classic/suitPaths";
import type { CanonicalSuit, CardFaceProps } from "../types";

jest.mock("react-native-svg", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createElement } = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text, View } = require("react-native");
  const host = (name: string, As: unknown = View) => {
    const Host = ({ children, ...props }: { children?: React.ReactNode }) =>
      createElement(As, { testID: `svg-${name}`, ...props }, children);
    Host.displayName = `Svg(${name})`;
    return Host;
  };
  const Svg = host("svg");
  return {
    __esModule: true,
    default: Svg,
    Svg,
    G: host("g"),
    Rect: host("rect"),
    Path: host("path"),
    Circle: host("circle"),
    Text: host("text", Text),
    Defs: host("defs"),
    Filter: host("filter"),
    FeGaussianBlur: host("fe-gaussian-blur"),
    FeMerge: host("fe-merge"),
    FeMergeNode: host("fe-merge-node"),
  };
});

// Theme colours PlayingCard injects (distinct values, so a test can tell which one is used).
const THEME: Omit<CardFaceProps, "suit" | "rank" | "width" | "height" | "faceDown"> = {
  cardBg: "#fffef8",
  cardBgBack: "#1e3a8a",
  cardBackInk: "#ffffff",
  border: "#999999",
  borderHighlight: "#facc15",
  textColor: "#111111",
  redSuitColor: "#dc2626",
};

const GLYPH: Record<CanonicalSuit, string> = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

type Face = typeof ClassicCardFace;

async function draw(
  Face: Face,
  suit: CanonicalSuit,
  rank: number,
  extra: Partial<CardFaceProps> = {}
) {
  await render(
    <Face suit={suit} rank={rank} width={60} height={84} faceDown={false} {...THEME} {...extra} />
  );
}

const all = (el: string): TestInstance[] => screen.queryAllByTestId(`svg-${el}`);

/** The single `el` whose props include `props`. */
function one(el: string, props: Record<string, unknown>): TestInstance {
  const hits = all(el).filter((n) => Object.entries(props).every(([k, v]) => n.props[k] === v));
  expect(hits).toHaveLength(1);
  return hits[0]!;
}

/** `text|fill` for every text, sorted: what is written and in which colour, in any order. */
const texts = () =>
  all("text")
    .map((t) => `${t.props.children}|${t.props.fill}`)
    .sort();

/** The nearest value of `prop` on the node or an ancestor. */
function inherited(node: TestInstance, prop: string): unknown {
  for (let n: TestInstance | null = node; n; n = n.parent) {
    if (n.props[prop] !== undefined) return n.props[prop];
  }
  return undefined;
}

/** Counts of the visual primitives — what a consolidated SvgCardFace must still draw. */
function primitives() {
  return {
    rect: all("rect").length,
    text: all("text").length,
    path: all("path").length,
    circle: all("circle").length,
  };
}

const background = () => one("rect", { x: 0, y: 0 });
const cardBorder = () => one("rect", { x: 1, y: 1 });
const centreLetter = () => one("text", { textAnchor: "middle" });
const cornerTexts = () => all("text").filter((t) => t.props.x === 5);

describe("ClassicCardFace", () => {
  it("face-down: margin, teal field, lattice, inset line, medallion and the border edge, no text", async () => {
    await draw(ClassicCardFace, "spades", 1, { faceDown: true, cardBackInk: "#ffffff" });
    // rim + field + inset line + edge; lattice + medallion
    expect(primitives()).toEqual({ rect: 4, text: 0, path: 2, circle: 0 });
    expect(background().props).toMatchObject({
      width: 60,
      height: 84,
      rx: 6,
      fill: THEME.cardBg,
    });
    expect(one("rect", { x: 4, y: 4 }).props.fill).toBe(THEME.cardBgBack);
    const [lattice, medallion] = all("path");
    expect(lattice!.props).toMatchObject({ stroke: "#ffffff", opacity: LATTICE_OPACITY });
    expect(medallion!.props).toMatchObject({ fill: THEME.cardBgBack, stroke: "#ffffff" });
    expect(one("rect", { x: 0.5, y: 0.5 }).props).toMatchObject({
      stroke: THEME.border,
      fill: "none",
    });
  });

  it("face-down: the same drawing with only the border prop changed (hint/selection edge)", async () => {
    await draw(ClassicCardFace, "spades", 1, { faceDown: true, border: "#facc15" });
    expect(one("rect", { x: 0.5, y: 0.5 }).props.stroke).toBe("#facc15");
    expect(one("rect", { x: 4, y: 4 }).props.fill).toBe(THEME.cardBgBack);
  });

  it("face-up red pip card: corner rank + suit twice in the red suit colour, one centre path", async () => {
    await draw(ClassicCardFace, "hearts", 1);
    expect(primitives()).toEqual({ rect: 2, text: 4, path: 1, circle: 0 });
    const red = THEME.redSuitColor;
    expect(texts()).toEqual([`A|${red}`, `A|${red}`, `♥|${red}`, `♥|${red}`]);
    expect(one("path", { d: SUIT_PATHS.hearts }).props.fill).toBe(red);
    expect(background().props.fill).toBe(THEME.cardBg);
    expect(cardBorder().props.stroke).toBe(THEME.border);
  });

  it("face-up black cards use the theme text colour; 10 is '10'", async () => {
    await draw(ClassicCardFace, "spades", 10);
    const ink = THEME.textColor;
    expect(texts()).toEqual([`10|${ink}`, `10|${ink}`, `♠|${ink}`, `♠|${ink}`]);
    expect(one("path", { d: SUIT_PATHS.spades }).props.fill).toBe(ink);
  });

  it.each(["spades", "hearts", "diamonds", "clubs"] as const)(
    "draws the %s glyph in both corners",
    async (suit) => {
      await draw(ClassicCardFace, suit, 5);
      const corner = cornerTexts().map((t) => t.props.children);
      expect(corner.sort()).toEqual(["5", "5", GLYPH[suit], GLYPH[suit]].sort());
    }
  );

  it.each([
    [11, "J"],
    [12, "Q"],
    [13, "K"],
  ])("face card %i: a framed centre letter %s instead of a pip", async (rank, letter) => {
    await draw(ClassicCardFace, "diamonds", rank);
    expect(primitives()).toEqual({ rect: 3, text: 5, path: 0, circle: 0 });
    expect(centreLetter().props).toMatchObject({
      children: letter,
      fill: THEME.redSuitColor,
      x: 30,
    });
    expect(one("rect", { x: 6 }).props).toMatchObject({ width: 48, stroke: THEME.border });
  });

  it("sizes the corner text from the card width, with minimums", async () => {
    await draw(ClassicCardFace, "clubs", 7);
    const at60 = cornerTexts().map((t) => [t.props.children, t.props.fontSize, t.props.y]);
    expect(at60.sort()).toEqual([
      ["7", 14, 16],
      ["7", 14, 16],
      ["♣", 11, 29],
      ["♣", 11, 29],
    ]);
    await draw(ClassicCardFace, "clubs", 7, { width: 30 });
    const at30 = cornerTexts().map((t) => [t.props.children, t.props.fontSize]);
    expect(at30.sort()).toEqual([
      ["7", 10],
      ["7", 10],
      ["♣", 8],
      ["♣", 8],
    ]);
  });

  it("repeats the corner rotated 180 degrees about the card centre", async () => {
    await draw(ClassicCardFace, "clubs", 7);
    const rotated = cornerTexts().filter((t) => inherited(t, "rotation") === 180);
    expect(rotated.map((t) => t.props.children).sort()).toEqual(["7", "♣"]);
    expect(inherited(rotated[0]!, "origin")).toBe("30, 42");
    // Centre pip: 52% of the short side, centred, scaled from the 500-unit path box.
    const pip = one("path", { d: SUIT_PATHS.clubs });
    expect(inherited(pip, "transform")).toBe("translate(14.5, 26.5) scale(0.062)");
  });
});

describe("NeonCardFace", () => {
  const NEON = {
    bg: "#0f172a",
    field: "#0b1b3a",
    border: "#334155",
    rim: "#22d3ee",
    rank: "#f1f5f9",
    red: "#f43f5e",
    light: "#e2e8f0",
  };

  it("face-down: a cyan margin, navy field and cyan lattice, ignoring the theme colours", async () => {
    await draw(NeonCardFace, "spades", 1, { faceDown: true });
    expect(primitives()).toEqual({ rect: 4, text: 0, path: 2, circle: 0 });
    expect(background().props).toMatchObject({ fill: NEON.rim, rx: 8 });
    expect(one("rect", { x: 4, y: 4 }).props.fill).toBe(NEON.field);
    expect(all("path")[0]!.props.stroke).toBe(NEON.rim);
    expect(one("rect", { x: 0.5, y: 0.5 }).props.stroke).toBe(NEON.border);
    expect(all("filter")).toHaveLength(0);
  });

  it("face-up: defines the neon-glow filter (blur merged under the source)", async () => {
    await draw(NeonCardFace, "hearts", 4);
    expect(primitives()).toEqual({ rect: 2, text: 4, path: 1, circle: 0 });
    expect(one("filter", { id: "neon-glow" }).props).toMatchObject({ x: "-30%", width: "160%" });
    expect(screen.getByTestId("svg-fe-gaussian-blur").props).toMatchObject({
      in: "SourceGraphic",
      stdDeviation: "1.5",
      result: "blur",
    });
    // Merge order is paint order: the blur halo first, the sharp source on top.
    expect(all("fe-merge-node").map((n) => n.props.in)).toEqual(["blur", "SourceGraphic"]);
  });

  it("ranks are always light; the suit glyph and pip are red or light by suit, and glow", async () => {
    await draw(NeonCardFace, "hearts", 4);
    expect(texts()).toEqual([`4|${NEON.rank}`, `4|${NEON.rank}`, `♥|${NEON.red}`, `♥|${NEON.red}`]);
    expect(one("path", { d: SUIT_PATHS.hearts }).props).toMatchObject({
      fill: NEON.red,
      filter: "url(#neon-glow)",
    });
    expect(background().props.fill).toBe(NEON.bg);
  });

  it.each([
    ["diamonds", "#f43f5e"],
    ["spades", "#e2e8f0"],
    ["clubs", "#e2e8f0"],
  ] as const)("%s glyphs are %s", async (suit, color) => {
    await draw(NeonCardFace, suit, 9);
    const g = GLYPH[suit];
    expect(texts()).toEqual(
      [`9|${NEON.rank}`, `9|${NEON.rank}`, `${g}|${color}`, `${g}|${color}`].sort()
    );
    expect(one("path", { d: SUIT_PATHS[suit] }).props.fill).toBe(color);
  });

  it("face cards: a framed glowing letter", async () => {
    await draw(NeonCardFace, "clubs", 11);
    expect(primitives()).toEqual({ rect: 3, text: 5, path: 0, circle: 0 });
    expect(centreLetter().props).toMatchObject({
      children: "J",
      filter: "url(#neon-glow)",
      fill: NEON.light,
    });
    expect(one("rect", { x: 6 }).props.stroke).toBe(NEON.border);
  });

  it("borders in the highlight colour when given, else its own border", async () => {
    await draw(NeonCardFace, "clubs", 2);
    expect(cardBorder().props.stroke).toBe(THEME.borderHighlight);
    await draw(NeonCardFace, "clubs", 2, {
      borderHighlight: undefined as unknown as string,
    });
    expect(cardBorder().props.stroke).toBe(NEON.border);
  });
});
