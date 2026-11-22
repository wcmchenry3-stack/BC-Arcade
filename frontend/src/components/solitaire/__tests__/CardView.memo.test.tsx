/**
 * #3622: the compact corner index is part of CardView's memo (#2264). A board re-render with
 * the same stripe skips the card; only a changed stripe re-draws it.
 */
import React from "react";
import { render } from "@testing-library/react-native";

import CardView from "../CardView";
import type { Card } from "../../../game/solitaire/types";

const mockFaces: Array<number | undefined> = [];
jest.mock("../../shared/PlayingCard", () => ({
  __esModule: true,
  default: (props: { compactIndex?: number }) => {
    mockFaces.push(props.compactIndex);
    return null;
  },
}));

const card: Card = { suit: "hearts", rank: 7, faceUp: true };

describe("CardView memo and compactIndex (#3622)", () => {
  it("re-renders only when compactIndex changes", async () => {
    mockFaces.length = 0;
    const { rerender } = await render(<CardView card={card} compactIndex={18} />);
    // A move hands the column a fresh card object for an unchanged card.
    await rerender(<CardView card={{ ...card }} compactIndex={18} />);
    expect(mockFaces).toEqual([18]);
    await rerender(<CardView card={card} compactIndex={17} />);
    await rerender(<CardView card={card} />);
    expect(mockFaces).toEqual([18, 17, undefined]);
  });
});
