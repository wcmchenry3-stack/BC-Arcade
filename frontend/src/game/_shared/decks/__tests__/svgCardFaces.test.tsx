/**
 * #2956: the Classic and Neon SVG card faces, pinned before #2983 folds them into one
 * SvgCardFace. react-native-svg is replaced by stubs that keep each element's raw props
 * (testID `svg-<element>`), so a test reads the drawn structure directly: how many rects, texts,
 * paths and groups a face has, their fills and strokes, the corner text, the suit path, the back
 * grid and (Neon) the glow filter. Element counts per case are the structural contract a merged
 * renderer has to reproduce.
 */
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
const texts = () => all("text").map((t) => ({ text: t.props.children, fill: t.props.fill }));

/** Element counts — the structure a consolidated SvgCardFace must keep. */
function structure() {
  return {
    rect: all("rect").length,
    text: all("text").length,
    path: all("path").length,
    g: all("g").length,
    defs: all("defs").length,
  };
}

describe("ClassicCardFace", () => {
  it("face-down: the back colour, an inset border and a 16-line diamond grid, no text", async () => {
    await draw(ClassicCardFace, "spades", 1, { faceDown: true });
    expect(structure()).toEqual({ rect: 2, text: 0, path: 16, g: 1, defs: 0 });
    const [bg, frame] = all("rect");
    expect(bg!.props).toMatchObject({ width: 60, height: 84, rx: 6, fill: THEME.cardBgBack });
    expect(frame!.props).toMatchObject({ x: 1, y: 1, rx: 5, stroke: THEME.border, fill: "none" });
    expect(all("g")[0]!.props.opacity).toBe(0.25);
    for (const p of all("path")) expect(p.props.stroke).toBe(THEME.border);
    expect(all("path")[0]!.props.d).toBe("M -28 0 L 28 84");
    expect(all("path")[8]!.props.d).toBe("M 0 -28 L 60 28");
  });

  it("face-up red pip card: corner rank + suit twice in the red suit colour, one centre path", async () => {
    await draw(ClassicCardFace, "hearts", 1);
    expect(structure()).toEqual({ rect: 2, text: 4, path: 1, g: 2, defs: 0 });
    expect(texts()).toEqual([
      { text: "A", fill: THEME.redSuitColor },
      { text: "♥", fill: THEME.redSuitColor },
      { text: "A", fill: THEME.redSuitColor },
      { text: "♥", fill: THEME.redSuitColor },
    ]);
    const [pip] = all("path");
    expect(pip!.props).toMatchObject({ d: SUIT_PATHS.hearts, fill: THEME.redSuitColor });
    expect(all("rect")[0]!.props.fill).toBe(THEME.cardBg);
    expect(all("rect")[1]!.props.stroke).toBe(THEME.border);
  });

  it("face-up black cards use the theme text colour; 10 is '10'", async () => {
    await draw(ClassicCardFace, "spades", 10);
    expect(texts().map((t) => t.fill)).toEqual(Array(4).fill(THEME.textColor));
    expect(texts()[0]!.text).toBe("10");
    expect(all("path")[0]!.props).toMatchObject({ d: SUIT_PATHS.spades, fill: THEME.textColor });
  });

  it.each(["spades", "hearts", "diamonds", "clubs"] as const)(
    "draws the %s glyph in both corners",
    async (suit) => {
      await draw(ClassicCardFace, suit, 5);
      expect(texts().map((t) => t.text)).toEqual(["5", GLYPH[suit], "5", GLYPH[suit]]);
    }
  );

  it.each([
    [11, "J"],
    [12, "Q"],
    [13, "K"],
  ])("face card %i: a framed centre letter %s instead of a pip", async (rank, letter) => {
    await draw(ClassicCardFace, "diamonds", rank);
    expect(structure()).toEqual({ rect: 3, text: 5, path: 0, g: 1, defs: 0 });
    const centre = all("text")[2]!;
    expect(centre.props).toMatchObject({
      children: letter,
      textAnchor: "middle",
      fill: THEME.redSuitColor,
      x: 30,
    });
    expect(all("rect")[2]!.props).toMatchObject({ x: 6, width: 48, stroke: THEME.border });
  });

  it("sizes the corner text from the card width, with minimums", async () => {
    await draw(ClassicCardFace, "clubs", 7);
    expect(all("text")[0]!.props).toMatchObject({ fontSize: 14, x: 5, y: 16 });
    expect(all("text")[1]!.props).toMatchObject({ fontSize: 11, y: 29 });
    await draw(ClassicCardFace, "clubs", 7, { width: 30 });
    expect(all("text")[0]!.props.fontSize).toBe(10);
    expect(all("text")[1]!.props.fontSize).toBe(8);
  });

  it("repeats the corner rotated 180 degrees about the card centre", async () => {
    await draw(ClassicCardFace, "clubs", 7);
    const corner = all("g").find((g) => g.props.rotation === 180)!;
    expect(corner.props.origin).toBe("30, 42");
    // Centre pip: 52% of the short side, centred, scaled from the 500-unit path box.
    const pip = all("g").find((g) => typeof g.props.transform === "string")!;
    expect(pip.props.transform).toBe("translate(14.5, 26.5) scale(0.062)");
  });
});

describe("NeonCardFace", () => {
  const NEON = {
    bg: "#0f172a",
    back: "#070d1a",
    border: "#334155",
    grid: "#06b6d4",
    rank: "#f1f5f9",
    red: "#f43f5e",
    light: "#e2e8f0",
  };

  it("face-down: its own dark back with a cyan grid, ignoring the theme colours", async () => {
    await draw(NeonCardFace, "spades", 1, { faceDown: true });
    expect(structure()).toEqual({ rect: 2, text: 0, path: 16, g: 1, defs: 0 });
    expect(all("rect")[0]!.props).toMatchObject({ fill: NEON.back, rx: 8 });
    expect(all("rect")[1]!.props).toMatchObject({ stroke: NEON.border, rx: 7 });
    expect(all("g")[0]!.props.opacity).toBe(0.35);
    for (const p of all("path")) expect(p.props.stroke).toBe(NEON.grid);
  });

  it("face-up: defines the neon-glow filter (blur merged under the source)", async () => {
    await draw(NeonCardFace, "hearts", 4);
    expect(structure()).toEqual({ rect: 2, text: 4, path: 1, g: 2, defs: 1 });
    const filter = screen.getByTestId("svg-filter");
    expect(filter.props).toMatchObject({ id: "neon-glow", x: "-30%", width: "160%" });
    expect(screen.getByTestId("svg-fe-gaussian-blur").props).toMatchObject({
      in: "SourceGraphic",
      stdDeviation: "1.5",
      result: "blur",
    });
    expect(all("fe-merge-node").map((n) => n.props.in)).toEqual(["blur", "SourceGraphic"]);
  });

  it("ranks are always light; the suit glyph and pip are red or light by suit, and glow", async () => {
    await draw(NeonCardFace, "hearts", 4);
    expect(texts()).toEqual([
      { text: "4", fill: NEON.rank },
      { text: "♥", fill: NEON.red },
      { text: "4", fill: NEON.rank },
      { text: "♥", fill: NEON.red },
    ]);
    expect(all("path")[0]!.props).toMatchObject({
      d: SUIT_PATHS.hearts,
      fill: NEON.red,
      filter: "url(#neon-glow)",
    });
    expect(all("rect")[0]!.props.fill).toBe(NEON.bg);
  });

  it.each([
    ["diamonds", "#f43f5e"],
    ["spades", "#e2e8f0"],
    ["clubs", "#e2e8f0"],
  ] as const)("%s glyphs are %s", async (suit, color) => {
    await draw(NeonCardFace, suit, 9);
    expect(texts().map((t) => t.text)).toEqual(["9", GLYPH[suit], "9", GLYPH[suit]]);
    expect(texts()[1]!.fill).toBe(color);
    expect(all("path")[0]!.props.fill).toBe(color);
  });

  it("face cards: a framed glowing letter", async () => {
    await draw(NeonCardFace, "clubs", 11);
    expect(structure()).toEqual({ rect: 3, text: 5, path: 0, g: 1, defs: 1 });
    expect(all("text")[2]!.props).toMatchObject({
      children: "J",
      filter: "url(#neon-glow)",
      fill: NEON.light,
      textAnchor: "middle",
    });
  });

  it("borders in the highlight colour when given, else its own border", async () => {
    await draw(NeonCardFace, "clubs", 2);
    expect(all("rect")[1]!.props.stroke).toBe(THEME.borderHighlight);
    await draw(NeonCardFace, "clubs", 2, {
      borderHighlight: undefined as unknown as string,
    });
    expect(all("rect")[1]!.props.stroke).toBe(NEON.border);
  });
});
