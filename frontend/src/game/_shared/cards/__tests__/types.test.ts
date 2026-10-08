import { cardColor, RANKS, SUITS, type PlayingCard } from "../types";

describe("SUITS / RANKS", () => {
  it("lists the four suits in deal order", () => {
    expect(SUITS).toEqual(["spades", "hearts", "diamonds", "clubs"]);
  });

  it("lists ranks Ace (1) through King (13)", () => {
    expect(RANKS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });
});

describe("cardColor", () => {
  it.each([
    ["hearts", "red"],
    ["diamonds", "red"],
    ["spades", "black"],
    ["clubs", "black"],
  ] as const)("%s is %s", (suit, color) => {
    expect(cardColor({ suit, rank: 5 })).toBe(color);
  });

  it("accepts game cards that extend PlayingCard", () => {
    const solitaireCard: PlayingCard & { faceUp: boolean } = {
      suit: "diamonds",
      rank: 12,
      faceUp: false,
    };
    expect(cardColor(solitaireCard)).toBe("red");
  });
});
