/**
 * #2983: SvgCardFace on its own — the options a deck passes (palette, radius, glyph set, glow).
 * The Classic and Neon decks' drawn output is pinned separately in svgCardFaces.test.tsx.
 */
import React from "react";
import { render, screen } from "@testing-library/react-native";

import SvgCardFace, { type SvgCardGlyphs, type SvgCardPalette } from "../svgCardFace";

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

// Placeholder colour names: the face only passes them through.
const PALETTE: SvgCardPalette = {
  face: "face",
  back: "back",
  border: "border",
  faceBorder: "faceBorder",
  backGrid: "grid",
  backGridOpacity: 0.5,
  blackSuit: "black",
  redSuit: "red",
};

const GLYPHS: SvgCardGlyphs = {
  pipPaths: { spades: "P-S", hearts: "P-H", diamonds: "P-D", clubs: "P-C" },
  cornerGlyph: (suit) => `<${suit}>`,
};

async function draw(props: Partial<React.ComponentProps<typeof SvgCardFace>> = {}) {
  await render(
    <SvgCardFace
      suit="hearts"
      rank={4}
      width={60}
      height={84}
      faceDown={false}
      palette={PALETTE}
      radius={5}
      glyphs={GLYPHS}
      {...props}
    />
  );
}

const all = (el: string) => screen.queryAllByTestId(`svg-${el}`);
const texts = () =>
  all("text")
    .map((t) => `${t.props.children}|${t.props.fill}`)
    .sort();

describe("SvgCardFace", () => {
  it("draws the deck's own glyph set: its pip path and its corner glyph", async () => {
    await draw();
    expect(all("path").map((p) => p.props.d)).toEqual(["P-H"]);
    expect(texts()).toEqual(["4|red", "4|red", "<hearts>|red", "<hearts>|red"]);
  });

  it("face-up: face fill, faceBorder inset, radius and radius - 1", async () => {
    await draw({ suit: "clubs" });
    const [bg, inset] = all("rect");
    expect(bg!.props).toMatchObject({ fill: "face", rx: 5 });
    expect(inset!.props).toMatchObject({ stroke: "faceBorder", rx: 4, fill: "none" });
    expect(all("path")[0]!.props.fill).toBe("black");
  });

  it("a fixed rank colour overrides the suit colour for ranks only", async () => {
    await draw({ palette: { ...PALETTE, rank: "rank" } });
    expect(texts()).toEqual(["4|rank", "4|rank", "<hearts>|red", "<hearts>|red"]);
  });

  it("without glowFilter there is no filter definition and nothing references one", async () => {
    await draw({ rank: 12 });
    expect(all("defs")).toHaveLength(0);
    for (const n of [...all("text"), ...all("path")]) expect(n.props.filter).toBeUndefined();
  });

  it("glowFilter defines the filter under that id and applies it to the pip and the letter", async () => {
    await draw({ glowFilter: "halo" });
    expect(all("filter").map((f) => f.props.id)).toEqual(["halo"]);
    expect(all("path")[0]!.props.filter).toBe("url(#halo)");
    await draw({ glowFilter: "halo", rank: 13 });
    const letter = all("text").find((t) => t.props.textAnchor === "middle")!;
    expect(letter.props).toMatchObject({ children: "K", filter: "url(#halo)" });
    // The frame around the letter takes the palette's border.
    expect(all("rect").find((r) => r.props.x === 6)!.props.stroke).toBe("border");
  });

  it("face-down: back fill, border inset, and the grid in its own colour and opacity", async () => {
    await draw({ faceDown: true, glowFilter: "halo" });
    expect(all("rect")[0]!.props.fill).toBe("back");
    expect(all("rect")[1]!.props.stroke).toBe("border");
    expect(all("path")).toHaveLength(16);
    expect(new Set(all("path").map((p) => p.props.stroke))).toEqual(new Set(["grid"]));
    expect(all("g")[0]!.props.opacity).toBe(0.5);
    expect(all("text")).toHaveLength(0);
    expect(all("filter")).toHaveLength(0);
  });
});
