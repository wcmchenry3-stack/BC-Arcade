/**
 * #3577: the Arcade, Parlor and Synthwave decks. react-native-svg is replaced by stubs that
 * keep each element's raw props (testID `svg-<element>`), so a test reads what is drawn.
 */
import React from "react";
import { render, screen } from "@testing-library/react-native";
import type { TestInstance } from "test-renderer";

import ArcadeDeck from "../arcade";
import ParlorDeck from "../parlor";
import SynthwaveDeck from "../synthwave";
import { OUTLINE_MIN_WIDTH, pipSpots } from "../bc/geometry";
import { BC_DECK_ART } from "../../../../theme/theme.cards";
import type { CanonicalSuit, CardFaceProps, DeckTheme } from "../types";

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
    Ellipse: host("ellipse"),
    Text: host("text", Text),
    Defs: host("defs"),
    ClipPath: host("clip-path"),
    LinearGradient: host("linear-gradient"),
    Stop: host("stop"),
    Filter: host("filter"),
    FeGaussianBlur: host("fe-gaussian-blur"),
    FeMerge: host("fe-merge"),
    FeMergeNode: host("fe-merge-node"),
  };
});

const THEMES: Record<
  "light" | "dark",
  Omit<CardFaceProps, "suit" | "rank" | "width" | "height" | "faceDown">
> = {
  light: {
    cardBg: "#fffdf7",
    cardBgBack: "#1e3a8a",
    border: "#d8c9a6",
    borderHighlight: "#facc15",
    textColor: "#1a1412",
    redSuitColor: "#c8312b",
  },
  dark: {
    cardBg: "#f4f1ea",
    cardBgBack: "#1e3a8a",
    border: "#2e2e38",
    borderHighlight: "#facc15",
    textColor: "#16161c",
    redSuitColor: "#d0342c",
  },
};

const DECKS: Array<[string, DeckTheme]> = [
  ["arcade", ArcadeDeck],
  ["parlor", ParlorDeck],
  ["synthwave", SynthwaveDeck],
];
const SUITS: CanonicalSuit[] = ["spades", "hearts", "diamonds", "clubs"];
const RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
const LABEL: Record<number, string> = { 1: "A", 11: "J", 12: "Q", 13: "K" };

const all = (el: string): TestInstance[] => screen.queryAllByTestId(`svg-${el}`);

let current: Awaited<ReturnType<typeof render>> | undefined;
async function clear() {
  await current?.unmount();
  current = undefined;
}

async function draw(
  deck: DeckTheme,
  suit: CanonicalSuit,
  rank: number,
  extra: Partial<CardFaceProps> = {},
  theme: "light" | "dark" = "light"
) {
  const Face = deck.CardFace;
  current = await render(
    <Face
      suit={suit}
      rank={rank}
      width={60}
      height={84}
      faceDown={false}
      {...THEMES[theme]}
      {...extra}
    />
  );
}

describe.each(DECKS)("%s deck", (id, deck) => {
  it("is registered under its id and display name", () => {
    expect(deck.id).toBe(id);
    expect(deck.name).toBe(id.charAt(0).toUpperCase() + id.slice(1));
  });

  it.each(SUITS.flatMap((s) => RANKS.map((r) => [s, r] as const)))(
    "renders %s %i face-up: index, pips and no throw",
    async (suit, rank) => {
      await draw(deck, suit, rank);
      const texts = all("text").map((t) => t.props.children);
      // The index is drawn twice (top-left and rotated bottom-right).
      expect(texts.filter((t) => t === (LABEL[rank] ?? String(rank)))).toHaveLength(2);
      if (rank >= 2 && rank <= 10) {
        // pips + two corner suits
        expect(all("path")).toHaveLength(pipSpots(rank).length + 2);
      }
      if (rank >= 11) {
        // two clipped halves of the figure inside the frame
        expect(all("clip-path")).toHaveLength(1);
        expect(all("g").filter((g) => g.props.clipPath)).toHaveLength(1);
      }
    }
  );

  it("renders the back for face-down cards, with the BC monogram and no index", async () => {
    await draw(deck, "spades", 1, { faceDown: true });
    expect(all("text").map((t) => t.props.children)).toEqual(["BC"]);
    expect(all("svg")[0]!.props.viewBox).toBe("0 0 250 350");
  });

  it("draws in a 250 x 350 box scaled to the requested size", async () => {
    await draw(deck, "hearts", 5, { width: 36, height: 50 });
    const svg = all("svg")[0]!;
    expect(svg.props).toMatchObject({ width: 36, height: 50, viewBox: "0 0 250 350" });
  });

  it.each(["light", "dark"] as const)("is legible at 36 px wide in %s mode", async (theme) => {
    await draw(deck, "hearts", 10, { width: 36, height: 50 }, theme);
    const index = all("text").filter((t) => t.props.children === "10");
    expect(index).toHaveLength(2);
    // 40 card units x (36 / 250) = 5.8 px minimum; the single-character index is larger.
    expect(Number(index[0]!.props.fontSize)).toBeGreaterThanOrEqual(40);
  });
});

describe("Arcade and Parlor take colours from the theme props", () => {
  it.each([
    ["arcade", ArcadeDeck],
    ["parlor", ParlorDeck],
  ] as Array<[string, DeckTheme]>)("%s", async (_id, deck) => {
    for (const theme of ["light", "dark"] as const) {
      const { cardBg, textColor, redSuitColor } = THEMES[theme];
      await draw(deck, "spades", 7, {}, theme);
      expect(all("rect")[0]!.props.fill).toBe(cardBg);
      expect(all("text")[0]!.props.fill).toBe(textColor);
      await clear();
      await draw(deck, "hearts", 7, {}, theme);
      expect(all("text")[0]!.props.fill).toBe(redSuitColor);
      await clear();
    }
  });
});

describe("Synthwave", () => {
  const S = BC_DECK_ART.synthwave;

  it("keeps its own dark face and cyan/pink suits in both themes", async () => {
    for (const theme of ["light", "dark"] as const) {
      await draw(SynthwaveDeck, "clubs", 4, {}, theme);
      expect(all("rect")[0]!.props.fill).toBe(S.face);
      expect(all("text")[0]!.props.fill).toBe(S.black);
      await clear();
      await draw(SynthwaveDeck, "diamonds", 4, {}, theme);
      expect(all("text")[0]!.props.fill).toBe(S.red);
      await clear();
    }
  });

  it("applies a glow filter to the pips", async () => {
    await draw(SynthwaveDeck, "spades", 3);
    expect(all("filter")).toHaveLength(1);
    expect(all("g").some((g) => g.props.filter === "url(#synthwave-glow)")).toBe(true);
  });

  const numberPips = () => all("path").filter((p) => p.props.fill !== undefined);

  it("draws solid pips below 48 px wide", async () => {
    expect(OUTLINE_MIN_WIDTH).toBe(48);
    await draw(SynthwaveDeck, "spades", 6, { width: 47, height: 66 });
    for (const p of numberPips()) {
      expect(p.props.fill).toBe(S.black);
      expect(p.props.stroke).toBeUndefined();
    }
    await clear();
    // Court suit mark too.
    await draw(SynthwaveDeck, "spades", 12, { width: 36, height: 50 });
    expect(all("path").some((p) => p.props.fill === S.black && p.props.stroke === undefined)).toBe(
      true
    );
  });

  it("draws outlined pips from 48 px wide", async () => {
    await draw(SynthwaveDeck, "spades", 6, { width: 48, height: 67 });
    const pips = all("path").filter((p) => p.props.fill === "none");
    // 6 pips; the two corner suits stay solid.
    expect(pips).toHaveLength(6);
    for (const p of pips) expect(p.props.stroke).toBe(S.black);
  });

  it("does not draw the glow or outlines on the other decks", async () => {
    await draw(ArcadeDeck, "spades", 6, { width: 80, height: 112 });
    expect(all("filter")).toHaveLength(0);
    expect(all("path").some((p) => p.props.fill === "none")).toBe(false);
  });
});
