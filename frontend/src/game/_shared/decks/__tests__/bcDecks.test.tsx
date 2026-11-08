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
import {
  CARD_H,
  CARD_W,
  COURT_RADIUS,
  EDGE_INSET,
  EDGE_WIDTH,
  OUTLINE_MIN_WIDTH,
  pipSpots,
  SCRIM_RADIUS_PX,
} from "../bc/geometry";
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

const all = (el: string): TestInstance[] =>
  screen.queryAllByTestId(`svg-${el}`, { includeHiddenElements: true });

let current: Awaited<ReturnType<typeof render>> | undefined;
async function clear() {
  await current?.unmount();
  current = undefined;
}

/** The outer-edge rect: the one stroked EDGE_WIDTH wide. */
const edgeRect = (): TestInstance => {
  const hits = all("rect").filter((r) => r.props.strokeWidth === EDGE_WIDTH);
  expect(hits).toHaveLength(1);
  return hits[0]!;
};

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

  it.each(["light", "dark"] as const)(
    "face-up: the outer edge is the border prop, inset by half its width and 1 px+ on a 52 px card (%s)",
    async (theme) => {
      await draw(deck, "spades", 5, { width: 52, height: 74 }, theme);
      const edge = edgeRect();
      expect(edge.props.stroke).toBe(THEMES[theme].border);
      expect(edge.props.strokeWidth).toBe(EDGE_WIDTH);
      expect(edge.props.x).toBe(EDGE_INSET);
      expect(edge.props.y).toBe(EDGE_INSET);
      expect(edge.props.width).toBe(CARD_W - EDGE_WIDTH);
      expect(edge.props.height).toBe(CARD_H - EDGE_WIDTH);
      // The whole stroke sits inside the viewBox (nothing is clipped) ...
      expect(Number(edge.props.x) - EDGE_WIDTH / 2).toBeGreaterThanOrEqual(0);
      expect(Number(edge.props.x) + Number(edge.props.width) + EDGE_WIDTH / 2).toBeLessThanOrEqual(
        CARD_W
      );
      // ... and is at least 1 px wide on screen at 52 px.
      expect((EDGE_WIDTH * 52) / CARD_W).toBeGreaterThanOrEqual(1);
      // The fill rect carries no stroke of its own.
      expect(all("rect")[0]!.props.stroke).toBeUndefined();
    }
  );

  it("face-down: draws the same border edge, with a 6 px corner at any width", async () => {
    for (const width of [36, 52, 120]) {
      await draw(deck, "spades", 1, {
        faceDown: true,
        width,
        height: width * 1.4,
        border: "#123456",
      });
      const edge = edgeRect();
      expect(edge.props).toMatchObject({
        stroke: "#123456",
        strokeWidth: EDGE_WIDTH,
        x: EDGE_INSET,
        y: EDGE_INSET,
      });
      const outerRadius = (SCRIM_RADIUS_PX * CARD_W) / width;
      const fill = all("rect").find((r) => r.props.width === CARD_W && r.props.height === CARD_H)!;
      expect(fill.props.rx).toBeCloseTo(outerRadius);
      expect(Number(edge.props.rx)).toBeCloseTo(outerRadius - EDGE_INSET);
      await clear();
    }
  });

  it("every url(#...) reference matches an id defined in the same card", async () => {
    for (const faceDown of [false, true]) {
      for (const rank of faceDown ? [1] : [1, 5, 12]) {
        await draw(deck, "hearts", rank, { faceDown, width: 60, height: 84 });
        const ids = new Set(
          ["clip-path", "filter", "linear-gradient"].flatMap((el) =>
            all(el).map((n) => n.props.id as string)
          )
        );
        const refs = [...JSON.stringify(screen.toJSON() ?? "").matchAll(/url\(#([^)]+)\)/g)].map(
          (m) => m[1]!
        );
        for (const ref of refs) expect(ids.has(ref)).toBe(true);
        await clear();
      }
    }
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

  it("has no glow filter below 48 px, whatever the card", async () => {
    for (const rank of [1, 5, 12]) {
      await draw(SynthwaveDeck, "spades", rank, { width: 47, height: 66 });
      expect(all("filter")).toHaveLength(0);
      expect(all("g").some((g) => g.props.filter)).toBe(false);
      await clear();
    }
  });

  it("glows only court art and the ace pip from 48 px, never number pips", async () => {
    for (const rank of [2, 5, 10]) {
      await draw(SynthwaveDeck, "hearts", rank, { width: 60, height: 84 });
      expect(all("filter")).toHaveLength(0);
      await clear();
    }
    for (const rank of [1, 11, 12, 13]) {
      await draw(SynthwaveDeck, "hearts", rank, { width: 48, height: 67 });
      expect(all("filter")).toHaveLength(1);
      const filtered = all("g").filter((g) => g.props.filter);
      expect(filtered).toHaveLength(1);
      const id = all("filter")[0]!.props.id as string;
      expect(filtered[0]!.props.filter).toBe(`url(#${id})`);
      await clear();
    }
  });

  it("takes its outer edge from the border prop (highlight and hint borders)", async () => {
    await draw(SynthwaveDeck, "spades", 4, { border: "#123456" });
    expect(edgeRect().props.stroke).toBe("#123456");
    await clear();
    await draw(SynthwaveDeck, "spades", 4, { faceDown: true, border: "#123456" });
    expect(edgeRect().props.stroke).toBe("#123456");
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

describe("per-instance SVG ids and accessibility", () => {
  const idsOf = () =>
    ["clip-path", "filter", "linear-gradient"].flatMap((el) => all(el).map((n) => n.props.id));

  it.each([
    ["arcade", ArcadeDeck, 12, false],
    ["parlor", ParlorDeck, 1, true],
    ["synthwave", SynthwaveDeck, 12, false],
    ["synthwave", SynthwaveDeck, 1, true],
  ] as Array<[string, DeckTheme, number, boolean]>)(
    "%s rank %i (back %s): two cards share no clip, filter or gradient id",
    async (_id, deck, rank, faceDown) => {
      const Face = deck.CardFace;
      const props = { ...THEMES.light, suit: "spades" as const, rank, faceDown };
      current = await render(
        <>
          <Face {...props} width={60} height={84} />
          <Face {...props} width={60} height={84} />
        </>
      );
      const ids = idsOf();
      expect(ids.length).toBeGreaterThanOrEqual(2);
      expect(new Set(ids).size).toBe(ids.length);
      // Safe inside url(#...)
      for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  );

  it.each(DECKS)("%s: the face and the back are hidden from assistive tech", async (_id, deck) => {
    for (const faceDown of [false, true]) {
      await draw(deck, "hearts", 7, { faceDown });
      expect(all("svg")[0]!.props).toMatchObject({
        accessible: false,
        importantForAccessibility: "no-hide-descendants",
      });
      await clear();
    }
  });
});

describe("court clip", () => {
  it.each([
    ["arcade", ArcadeDeck],
    ["parlor", ParlorDeck],
    ["synthwave", SynthwaveDeck],
  ] as Array<["arcade" | "parlor" | "synthwave", DeckTheme]>)(
    "%s: the clip radius matches the court frame",
    async (id, deck) => {
      await draw(deck, "spades", 13);
      const clip = all("clip-path")[0]!;
      const clipRect = clip.children.find((c) => typeof c !== "string")!;
      const rects = all("rect").filter(
        (r) => r.props.rx === COURT_RADIUS[id] && r.props.width === 126
      );
      expect(rects.length).toBeGreaterThanOrEqual(2); // frame and clip
      expect(clipRect).toBeTruthy();
    }
  );
});
