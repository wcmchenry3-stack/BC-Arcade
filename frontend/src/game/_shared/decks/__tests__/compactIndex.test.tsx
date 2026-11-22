/**
 * #3622: the compact corner index a covered card in a compressed tableau column draws. For
 * every deck it must show the rank AND the suit inside the card's visible stripe. The layout
 * values the faces compute (positions, sizes) are asserted, not snapshots.
 *
 * react-native-svg is replaced by stubs that keep each element's raw props (testID
 * `svg-<element>`), as in svgCardFaces.test.tsx and bcDecks.test.tsx.
 */
import React from "react";
import { render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import type { TestInstance } from "test-renderer";

import ClassicCardFace from "../classic/ClassicCardFace";
import NeonCardFace from "../neon/NeonCardFace";
import MinimalCardFace from "../minimal/MinimalCardFace";
import ArcadeDeck from "../arcade";
import ParlorDeck from "../parlor";
import SynthwaveDeck from "../synthwave";
import {
  acePipSize,
  bcCompactCorner,
  bcStackedIndexFits,
  CARD_H,
  CARD_W,
  CORNER,
  CORNER_SUIT_SIZE,
  COURT,
  PIP_SIZE,
  pipSpots,
} from "../bc/geometry";
import {
  COMPACT_INDEX_THRESHOLD,
  compactIndexFor,
  MIN_COMPACT_STRIPE,
  compactMinimalLayout,
  compactSvgCornerLayout,
  stackedCornerIndex,
} from "../cornerIndex";
import { suitEmoji } from "../cardId";
import { NEON_DECK } from "../../../../theme/theme.cards";
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

const THEME: Omit<CardFaceProps, "suit" | "rank" | "width" | "height" | "faceDown"> = {
  cardBg: "#fffef8",
  cardBgBack: "#1e3a8a",
  cardBackInk: "#ffffff",
  border: "#999999",
  borderHighlight: "#facc15",
  textColor: "#111111",
  redSuitColor: "#dc2626",
};

/** The 36 dp felt card (Solitaire's compressed table) and a wider FreeCell card. */
const SIZES = [
  { width: 36, height: 51 },
  { width: 44, height: 63 },
];
/** FreeCell's 15 dp worst case, Klondike's 18 dp floor, and a stripe just under 24. */
const STRIPES = [15, 18, 23];
const CARDS: Array<[CanonicalSuit, number, string]> = [
  ["hearts", 1, "A"],
  ["spades", 10, "10"],
  ["diamonds", 13, "K"],
];

const all = (el: string): TestInstance[] =>
  screen.queryAllByTestId(`svg-${el}`, { includeHiddenElements: true });

describe("compactIndexFor (#3622)", () => {
  it("is the stripe only under the 24 dp full stripe", () => {
    expect(COMPACT_INDEX_THRESHOLD).toBe(24);
    // At every card width the stacked suit's baseline + 2 is at least 24 dp down, so the one
    // constant is the whole threshold.
    for (const width of [12, 31, 36, 44, 52, 60]) {
      expect(stackedCornerIndex(width).suitBaseline + 2).toBeGreaterThanOrEqual(24);
    }
    expect(compactIndexFor(23)).toBe(23);
    expect(compactIndexFor(18)).toBe(18);
    expect(compactIndexFor(15)).toBe(15);
    expect(compactIndexFor(24)).toBeUndefined();
    expect(compactIndexFor(30)).toBeUndefined();
  });

  it("is undefined without a stripe (the top card)", () => {
    expect(compactIndexFor(undefined)).toBeUndefined();
    expect(compactIndexFor(0)).toBeUndefined();
  });

  it("keeps the stacked index on a fit-floor stripe too short for any compact row", () => {
    // The smallest compact font (6) with its descent and 2 dp margin needs 9.2 dp.
    expect(MIN_COMPACT_STRIPE).toBe(10);
    expect(compactIndexFor(10)).toBe(10);
    for (const stripe of [1, 3, 5, 8, 9]) expect(compactIndexFor(stripe)).toBeUndefined();
    // The shortest stripe that gets a compact row holds it, on every deck's layout.
    for (const width of [12, 36, 44]) {
      for (const len of [1, 2]) {
        const c = compactSvgCornerLayout(width, MIN_COMPACT_STRIPE, len);
        expect(c.bottom).toBeLessThanOrEqual(MIN_COMPACT_STRIPE);
      }
    }
    expect(compactMinimalLayout(MIN_COMPACT_STRIPE).bottom).toBeLessThanOrEqual(MIN_COMPACT_STRIPE);
  });
});

describe.each([
  ["classic", ClassicCardFace],
  ["neon", NeonCardFace],
])("%s compact index (#3622)", (deck, Face) => {
  it.each(SIZES)("puts rank and suit on one line inside the stripe at $width dp", async (size) => {
    for (const stripe of STRIPES) {
      for (const [suit, rank, label] of CARDS) {
        const r = await render(
          <Face
            suit={suit}
            rank={rank}
            {...size}
            faceDown={false}
            {...THEME}
            compactIndex={stripe}
          />
        );
        const c = compactSvgCornerLayout(size.width, stripe, label.length);
        const texts = all("text");
        const rankText = texts.find((t) => t.props.children === label && t.props.y === c.baseline);
        const suitText = texts.find(
          (t) => t.props.children === suitEmoji(suit) && t.props.y === c.baseline
        );
        expect(rankText?.props).toMatchObject({ x: c.rankX, fontSize: c.fontSize });
        expect(suitText?.props).toMatchObject({ x: c.suitX, fontSize: c.fontSize });
        // Beside the rank, not under it; the whole index inside the stripe and the card.
        expect(c.suitX).toBeGreaterThanOrEqual(c.rankX + label.length * c.fontSize * 0.6);
        expect(c.bottom).toBeLessThanOrEqual(stripe);
        expect(c.right).toBeLessThanOrEqual(size.width - 2);
        // The suit carries its colour, so a white-rank deck (Neon) still shows red or black.
        const red = suit !== "spades";
        const expected =
          deck === "neon"
            ? red
              ? NEON_DECK.redSuit
              : NEON_DECK.blackSuit
            : red
              ? THEME.redSuitColor
              : THEME.textColor;
        expect(suitText?.props.fill).toBe(expected);
        // The rotated bottom corner keeps the stacked index: its suit is the only one left
        // under the rank; one rank and one suit text per corner.
        const stacked = stackedCornerIndex(size.width);
        const glyphs = texts.filter((t) => t.props.children === suitEmoji(suit));
        expect(glyphs.map((t) => t.props.y).sort()).toEqual(
          [c.baseline, stacked.suitBaseline].sort()
        );
        // (The centred J/Q/K letter is anchored in the middle; corner ranks are not.)
        expect(
          texts.filter((t) => t.props.children === label && t.props.textAnchor === undefined)
        ).toHaveLength(2);
        await r.unmount();
      }
    }
  });

  it("keeps the stacked index without compactIndex", async () => {
    await render(
      <Face suit="hearts" rank={5} width={36} height={51} faceDown={false} {...THEME} />
    );
    const stacked = stackedCornerIndex(36);
    const glyphs = all("text").filter((t) => t.props.children === "♥");
    expect(glyphs.map((t) => t.props.y)).toEqual([stacked.suitBaseline, stacked.suitBaseline]);
    expect(glyphs.map((t) => t.props.fontSize)).toEqual([
      stacked.suitFontSize,
      stacked.suitFontSize,
    ]);
  });
});

/** The nearest ancestor laid out as a row. */
function rowOf(node: TestInstance): TestInstance {
  let n: TestInstance | null = node.parent;
  while (n && StyleSheet.flatten(n.props.style)?.flexDirection !== "row") n = n.parent;
  if (!n) throw new Error("no row");
  return n;
}

describe("minimal compact index (#3622)", () => {
  it("draws one rank-and-suit row inside the stripe", async () => {
    for (const stripe of STRIPES) {
      for (const [suit, rank, label] of CARDS) {
        const r = await render(
          <MinimalCardFace
            suit={suit}
            rank={rank}
            width={36}
            height={51}
            faceDown={false}
            {...THEME}
            compactIndex={stripe}
          />
        );
        const c = compactMinimalLayout(stripe);
        const rankText = screen.getByText(label);
        const suitText = screen.getByText(suitEmoji(suit));
        for (const t of [rankText, suitText]) {
          expect(StyleSheet.flatten(t.props.style)).toMatchObject({
            fontSize: c.fontSize,
            lineHeight: c.lineHeight,
            color: suit === "spades" ? THEME.textColor : THEME.redSuitColor,
          });
        }
        // One row (side by side), at the top-left corner, ending inside the stripe.
        const row = rowOf(rankText);
        expect(row).toBe(rowOf(suitText));
        expect(StyleSheet.flatten(row.props.style)).toMatchObject({
          position: "absolute",
          flexDirection: "row",
          top: c.top,
          left: c.left,
        });
        expect(c.bottom).toBeLessThanOrEqual(stripe);
        expect(c.fontSize).toBeLessThanOrEqual(16);
        await r.unmount();
      }
    }
  });

  it("keeps the centred rank and suit without compactIndex", async () => {
    await render(
      <MinimalCardFace suit="clubs" rank={7} width={36} height={51} faceDown={false} {...THEME} />
    );
    expect(StyleSheet.flatten(screen.getByText("7").props.style).fontSize).toBe(16);
    expect(StyleSheet.flatten(screen.getByText("♣").props.style).fontSize).toBe(18);
  });
});

describe.each([
  ["arcade", ArcadeDeck],
  ["parlor", ParlorDeck],
  ["synthwave", SynthwaveDeck],
])("%s compact index (#3622)", (_name, deck) => {
  const Face = deck.CardFace;
  const stackedPips = () =>
    all("path").filter((p) =>
      String(p.props.transform).startsWith(`translate(${CORNER.suitX} ${CORNER.suitY}) `)
    );

  it("keeps its big stacked index while it fits the stripe", async () => {
    // Its suit ends 104 units down: 15.2 dp on a 51 dp card, 18.7 dp on a 63 dp one.
    expect(bcStackedIndexFits(51, 15)).toBe(false);
    expect(bcStackedIndexFits(51, 18)).toBe(true);
    expect(bcStackedIndexFits(63, 18)).toBe(false);
    expect(bcStackedIndexFits(63, 23)).toBe(true);
    for (const stripe of [16, 18, 23]) {
      const r = await render(
        <Face
          suit="hearts"
          rank={9}
          width={36}
          height={51}
          faceDown={false}
          {...THEME}
          compactIndex={stripe}
        />
      );
      // Both corners stacked: two corner pips at the stacked spot, two ranks on y 60.
      expect(stackedPips()).toHaveLength(2);
      expect(
        all("text").filter((t) => t.props.children === "9" && t.props.y === CORNER.textY)
      ).toHaveLength(2);
      expect(((CORNER.suitY + CORNER_SUIT_SIZE / 2) * 51) / CARD_H).toBeLessThanOrEqual(stripe);
      await r.unmount();
    }
  });

  it.each(SIZES)(
    "puts the suit beside the rank inside a shorter stripe at $width dp",
    async (size) => {
      for (const stripe of [10, 12, 15, 18]) {
        if (bcStackedIndexFits(size.height, stripe)) continue;
        for (const [suit, rank, label] of CARDS) {
          const r = await render(
            <Face
              suit={suit}
              rank={rank}
              {...size}
              faceDown={false}
              {...THEME}
              compactIndex={stripe}
            />
          );
          const k = bcCompactCorner(size.height, stripe, label.length);
          const rankText = all("text").find(
            (t) => t.props.children === label && t.props.y === k.baseline
          );
          expect(rankText?.props).toMatchObject({ x: k.rankX, fontSize: k.fontSize });
          const pip = all("path").filter((p) =>
            String(p.props.transform).startsWith(`translate(${k.suitX} ${k.suitY}) rotate(0) `)
          );
          expect(pip).toHaveLength(1);
          expect(pip[0]!.props.transform).toContain(`scale(${k.suitSize / 500})`);
          // In dp: the index inside the stripe and the card; the pip right of the rank.
          const sx = size.width / CARD_W;
          const sy = size.height / CARD_H;
          expect(k.bottom * sy).toBeLessThanOrEqual(stripe);
          expect(k.right * sx).toBeLessThanOrEqual(size.width);
          expect(k.suitX - k.suitSize / 2).toBeGreaterThan(
            k.rankX + (label.length * k.fontSize * 0.6) / 2
          );
          // The stacked corner suit is gone from the top-left (it stays in the rotated corner).
          expect(stackedPips()).toHaveLength(1);
          await r.unmount();
        }
      }
    }
  );
});

describe("the new decks' compact index stays clear of the art (#3622)", () => {
  interface Box {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  }
  const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  /** The compact rank and suit, in card units (a generous 0.75 advance per rank character). */
  const indexBoxes = (height: number, stripe: number, label: string): Box[] => {
    const k = bcCompactCorner(height, stripe, label.length);
    const half = (label.length * k.fontSize * 0.75) / 2;
    return [
      { x0: k.rankX - half, y0: k.top, x1: k.rankX + half, y1: k.bottom },
      {
        x0: k.suitX - k.suitSize / 2,
        y0: k.suitY - k.suitSize / 2,
        x1: k.suitX + k.suitSize / 2,
        y1: k.suitY + k.suitSize / 2,
      },
    ];
  };
  /** The art a short stripe shows: the court frame (J/Q/K) or the first pip (A-10). */
  const artBox = (rank: number): Box => {
    if (rank >= 11) {
      return { x0: COURT.x, y0: COURT.y, x1: COURT.x + COURT.w, y1: COURT.y + COURT.h };
    }
    const p = pipSpots(rank)[0]!;
    // The ace: Parlor's spade (130) is the largest; Arcade's ring (r 72) is drawn too.
    const size = rank === 1 ? Math.max(acePipSize("parlor", "spades"), 144) : PIP_SIZE;
    return { x0: p.cx - size / 2, y0: p.cy - size / 2, x1: p.cx + size / 2, y1: p.cy + size / 2 };
  };

  it("for every rank and every stripe where the compact index applies", () => {
    // 36 x 51 is also the 320-wide FreeCell felt (14 dp stripe = 96 units).
    const sizes = [...SIZES, { width: 30, height: 43 }, { width: 52, height: 74 }];
    let checked = 0;
    for (const { height } of sizes) {
      for (let stripe = MIN_COMPACT_STRIPE; stripe < COMPACT_INDEX_THRESHOLD; stripe++) {
        if (bcStackedIndexFits(height, stripe)) continue;
        for (let rank = 1; rank <= 13; rank++) {
          const label = rank === 1 ? "A" : rank >= 11 ? "JQK"[rank - 11]! : String(rank);
          const art = artBox(rank);
          for (const box of indexBoxes(height, stripe, label)) {
            expect(overlaps(box, art)).toBe(false);
            expect(box.y1).toBeLessThanOrEqual(Math.min(COURT.y, art.y0));
            // Inside the stripe as well.
            expect((box.y1 * height) / CARD_H).toBeLessThanOrEqual(stripe);
          }
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(13 * 10);
    // The 320-wide FreeCell felt's case from the review: compact, and under the art.
    expect(bcStackedIndexFits(51, 14)).toBe(false);
    expect(bcCompactCorner(51, 14, 2).bottom).toBeLessThanOrEqual(COURT.y - 4);
  });
});
