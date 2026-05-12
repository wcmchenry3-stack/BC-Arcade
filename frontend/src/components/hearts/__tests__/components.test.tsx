import React from "react";
import { render, fireEvent, act } from "@testing-library/react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import PlayingCard from "../PlayingCard";
import PlayerHand from "../PlayerHand";
import OpponentHand from "../OpponentHand";
import TrickArea from "../TrickArea";
import PassBanner from "../PassBanner";
import { OpponentCapturedPile, SelfCapturedPile, penaltyPoints } from "../CapturedPile";
import type { Card, TrickCard } from "../../../game/hearts/types";

jest.mock("expo-linear-gradient", () => ({
  LinearGradient: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

function c(suit: Card["suit"], rank: Card["rank"]): Card {
  return { suit, rank };
}

// ---------------------------------------------------------------------------
// PlayingCard
// ---------------------------------------------------------------------------

describe("PlayingCard", () => {
  it("renders rank and suit symbol for a visible card", () => {
    const { getByText } = wrap(<PlayingCard card={c("spades", 12)} />);
    expect(getByText("Q")).toBeTruthy();
    expect(getByText("♠")).toBeTruthy();
  });

  it("renders Ace as A", () => {
    const { getByText } = wrap(<PlayingCard card={c("hearts", 1)} />);
    expect(getByText("A")).toBeTruthy();
  });

  it("renders Jack, Queen, King correctly", () => {
    const { getByText: g1 } = wrap(<PlayingCard card={c("clubs", 11)} />);
    expect(g1("J")).toBeTruthy();
    const { getByText: g2 } = wrap(<PlayingCard card={c("diamonds", 13)} />);
    expect(g2("K")).toBeTruthy();
  });

  it("renders face-down card without rank/suit text", () => {
    const { queryByText } = wrap(<PlayingCard card={c("spades", 1)} faceDown />);
    expect(queryByText("A")).toBeNull();
    expect(queryByText("♠")).toBeNull();
  });

  it("has accessible label for visible card", () => {
    const { getByLabelText } = wrap(<PlayingCard card={c("hearts", 1)} />);
    expect(getByLabelText(/A.*Hearts/i)).toBeTruthy();
  });

  it("calls onPress when pressed", () => {
    const onPress = jest.fn();
    const { getByRole } = wrap(<PlayingCard card={c("clubs", 7)} onPress={onPress} />);
    fireEvent.press(getByRole("button"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("does not call onPress when disabled", () => {
    const onPress = jest.fn();
    const { getByRole } = wrap(<PlayingCard card={c("clubs", 7)} onPress={onPress} disabled />);
    fireEvent.press(getByRole("button"));
    expect(onPress).not.toHaveBeenCalled();
  });

  it("disabled card wrapper is fully opaque (no opacity < 1)", () => {
    // Regression guard for #704: wrapper opacity makes the SVG translucent
    // and overlapping cards bleed through. Dimming must use an overlay.
    const { getByRole } = wrap(<PlayingCard card={c("clubs", 7)} onPress={() => {}} disabled />);
    const style = getByRole("button").props.style;
    const flat = Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style;
    expect(flat.opacity).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PlayerHand
// ---------------------------------------------------------------------------

describe("PlayerHand", () => {
  const hand: Card[] = [c("spades", 2), c("hearts", 5), c("clubs", 9)];

  it("renders all cards", () => {
    const { getByText } = wrap(<PlayerHand hand={hand} />);
    expect(getByText("2")).toBeTruthy();
    expect(getByText("5")).toBeTruthy();
    expect(getByText("9")).toBeTruthy();
  });

  it("renders empty hand without error", () => {
    const { toJSON } = wrap(<PlayerHand hand={[]} />);
    expect(toJSON()).toBeTruthy();
  });

  it("fires onCardPress with the correct card", () => {
    const onPress = jest.fn();
    // Hand is sorted: clubs 9, spades 2, hearts 5 → suit order clubs→spades→hearts
    // Sorted: clubs-9, spades-2, hearts-5 → buttons[0]=clubs9, [1]=spades2, [2]=hearts5
    const { getAllByRole } = wrap(<PlayerHand hand={hand} onCardPress={onPress} />);
    fireEvent.press(getAllByRole("button")[0]!);
    expect(onPress).toHaveBeenCalledWith(c("clubs", 9));
  });

  it("sorts by suit then rank ascending (clubs→diamonds→spades→hearts, Ace high)", () => {
    const unsorted: Card[] = [
      c("hearts", 1),
      c("clubs", 3),
      c("spades", 7),
      c("diamonds", 2),
      c("clubs", 1),
    ];
    const { getAllByRole } = wrap(<PlayerHand hand={unsorted} onCardPress={jest.fn()} />);
    const buttons = getAllByRole("button");
    // Expected sort: clubs-3, clubs-A, diamonds-2, spades-7, hearts-A
    expect(buttons[0]!.props.accessibilityLabel).toMatch(/3.*clubs/i);
    expect(buttons[1]!.props.accessibilityLabel).toMatch(/A.*clubs/i);
    expect(buttons[2]!.props.accessibilityLabel).toMatch(/2.*diamonds/i);
    expect(buttons[3]!.props.accessibilityLabel).toMatch(/7.*spades/i);
    expect(buttons[4]!.props.accessibilityLabel).toMatch(/A.*hearts/i);
  });
});

// ---------------------------------------------------------------------------
// OpponentHand
// ---------------------------------------------------------------------------

describe("OpponentHand", () => {
  it("renders correct number of face-down cards", () => {
    const { getAllByLabelText } = wrap(<OpponentHand cardCount={4} label="Left" />);
    expect(getAllByLabelText(/face.down/i)).toHaveLength(4);
  });

  it("renders label text", () => {
    const { getByText } = wrap(<OpponentHand cardCount={3} label="Right" />);
    expect(getByText("Right")).toBeTruthy();
  });

  it("renders zero cards without error", () => {
    const { toJSON } = wrap(<OpponentHand cardCount={0} label="Top" />);
    expect(toJSON()).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// TrickArea
// ---------------------------------------------------------------------------

describe("TrickArea", () => {
  it("renders empty area when trick is empty", () => {
    const { toJSON } = wrap(<TrickArea trick={[]} playerIndex={0} />);
    expect(toJSON()).toBeTruthy();
  });

  it("renders cards from the trick", () => {
    const trick: TrickCard[] = [
      { card: c("spades", 10), playerIndex: 0 },
      { card: c("hearts", 3), playerIndex: 1 },
    ];
    const { getByText } = wrap(
      <TrickArea trick={trick} playerIndex={0} playerLabels={["You", "Left", "Top", "Right"]} />
    );
    expect(getByText("10")).toBeTruthy();
    expect(getByText("3")).toBeTruthy();
  });

  describe("animation", () => {
    const fullTrick: TrickCard[] = [
      { card: c("spades", 10), playerIndex: 0 },
      { card: c("hearts", 3), playerIndex: 1 },
      { card: c("clubs", 8), playerIndex: 2 },
      { card: c("diamonds", 5), playerIndex: 3 },
    ];

    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("does not fire onAnimationComplete when winnerIndex is null", () => {
      const onComplete = jest.fn();
      wrap(
        <TrickArea
          trick={fullTrick}
          playerIndex={0}
          winnerIndex={null}
          onAnimationComplete={onComplete}
        />
      );
      act(() => {
        jest.advanceTimersByTime(1000);
      });
      expect(onComplete).not.toHaveBeenCalled();
    });

    it("does not fire onAnimationComplete for an incomplete trick", () => {
      const onComplete = jest.fn();
      const partial: TrickCard[] = [
        { card: c("spades", 10), playerIndex: 0 },
        { card: c("hearts", 3), playerIndex: 1 },
      ];
      wrap(
        <TrickArea
          trick={partial}
          playerIndex={0}
          winnerIndex={1}
          onAnimationComplete={onComplete}
        />
      );
      act(() => {
        jest.advanceTimersByTime(1000);
      });
      expect(onComplete).not.toHaveBeenCalled();
    });

    it("fires onAnimationComplete when a complete trick has a winner", () => {
      const onComplete = jest.fn();
      wrap(
        <TrickArea
          trick={fullTrick}
          playerIndex={0}
          winnerIndex={2}
          onAnimationComplete={onComplete}
        />
      );
      act(() => {
        jest.advanceTimersByTime(950);
      });
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it("fires onAnimationComplete within the 930ms budget (250ms settle + 3×60ms stagger + 500ms slide)", () => {
      const onComplete = jest.fn();
      wrap(
        <TrickArea
          trick={fullTrick}
          playerIndex={0}
          winnerIndex={0}
          onAnimationComplete={onComplete}
        />
      );
      // Not yet complete mid-settle window.
      act(() => {
        jest.advanceTimersByTime(300);
      });
      expect(onComplete).not.toHaveBeenCalled();
      // Finishes after the full duration.
      act(() => {
        jest.advanceTimersByTime(650);
      });
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it("shows all 4 cards statically during settle window (E/W completing-card regression)", () => {
      // West (seat 1 / George) plays the completing 4th card — previously his card
      // appeared for only ~60ms before animating, making it imperceptible.
      const trick: TrickCard[] = [
        { card: c("spades", 10), playerIndex: 2 }, // North leads
        { card: c("hearts", 3), playerIndex: 3 }, // East (Elaine)
        { card: c("clubs", 8), playerIndex: 0 }, // South (human)
        { card: c("diamonds", 5), playerIndex: 1 }, // West (George) — completing card
      ];
      const onComplete = jest.fn();
      const { getByText } = wrap(
        <TrickArea trick={trick} playerIndex={0} winnerIndex={1} onAnimationComplete={onComplete} />
      );
      // All 4 cards visible immediately (before animation starts).
      expect(getByText("10")).toBeTruthy(); // North
      expect(getByText("3")).toBeTruthy(); // East
      expect(getByText("8")).toBeTruthy(); // South
      expect(getByText("5")).toBeTruthy(); // West (the completing card)
      // Animation not complete before settle window ends.
      act(() => {
        jest.advanceTimersByTime(249);
      });
      expect(onComplete).not.toHaveBeenCalled();
      // Animation completes after full window.
      act(() => {
        jest.advanceTimersByTime(701);
      });
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
  });
});

// ---------------------------------------------------------------------------
// PassBanner
// ---------------------------------------------------------------------------

describe("PassBanner", () => {
  it("renders instructions with direction", () => {
    const { getByText } = wrap(
      <PassBanner passDirection="left" selectedCount={0} onConfirm={jest.fn()} />
    );
    expect(getByText(/pass left/i)).toBeTruthy();
  });

  it("shows 'X of 3 selected' counter", () => {
    const { getByText } = wrap(
      <PassBanner passDirection="right" selectedCount={2} onConfirm={jest.fn()} />
    );
    expect(getByText(/2 of 3 selected/i)).toBeTruthy();
  });

  it("confirm button is disabled when fewer than 3 cards selected", () => {
    const { getByRole } = wrap(
      <PassBanner passDirection="left" selectedCount={1} onConfirm={jest.fn()} />
    );
    expect(getByRole("button", { name: /confirm/i }).props.accessibilityState?.disabled).toBe(true);
  });

  it("confirm button is enabled and fires onConfirm when exactly 3 selected", () => {
    const onConfirm = jest.fn();
    const { getByRole } = wrap(
      <PassBanner passDirection="across" selectedCount={3} onConfirm={onConfirm} />
    );
    const btn = getByRole("button", { name: /confirm/i });
    expect(btn.props.accessibilityState?.disabled).toBe(false);
    fireEvent.press(btn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not render a Modal (inline UI, not overlay)", () => {
    const { UNSAFE_queryAllByType } = wrap(
      <PassBanner passDirection="left" selectedCount={0} onConfirm={jest.fn()} />
    );
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Modal } = require("react-native");
    expect(UNSAFE_queryAllByType(Modal)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// CapturedPile — penalty points helper
// ---------------------------------------------------------------------------

describe("penaltyPoints", () => {
  it("returns 0 for empty and non-penalty cards", () => {
    expect(penaltyPoints([])).toBe(0);
    expect(penaltyPoints([c("clubs", 7), c("diamonds", 3), c("spades", 1)])).toBe(0);
  });

  it("counts hearts as +1 each", () => {
    expect(penaltyPoints([c("hearts", 2), c("hearts", 8), c("hearts", 13)])).toBe(3);
  });

  it("counts Q♠ as +13", () => {
    expect(penaltyPoints([c("spades", 12)])).toBe(13);
  });

  it("combines hearts + Q♠: 3 hearts + Q♠ = 16", () => {
    expect(penaltyPoints([c("hearts", 4), c("hearts", 10), c("hearts", 11), c("spades", 12)])).toBe(
      16
    );
  });
});

// ---------------------------------------------------------------------------
// OpponentCapturedPile (face-down)
// ---------------------------------------------------------------------------

describe("OpponentCapturedPile", () => {
  it("renders no summary pill when pile is empty", () => {
    const { queryByText } = wrap(<OpponentCapturedPile cards={[]} seatLabel="Left" />);
    expect(queryByText("+0")).toBeNull();
  });

  it("renders card fan without numeric badges for a mixed pile (4 cards, +16)", () => {
    const cards: Card[] = [c("hearts", 4), c("hearts", 10), c("hearts", 11), c("spades", 12)];
    const { queryByText } = wrap(<OpponentCapturedPile cards={cards} seatLabel="Top" />);
    expect(queryByText("4")).toBeNull();
    expect(queryByText("+16")).toBeNull();
  });

  it("exposes count and points in its accessibility label", () => {
    const cards: Card[] = [c("hearts", 2), c("spades", 12)];
    const { getByLabelText } = wrap(<OpponentCapturedPile cards={cards} seatLabel="Right" />);
    expect(getByLabelText(/Right.*2.*14/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// SelfCapturedPile (face-up)
// ---------------------------------------------------------------------------

describe("SelfCapturedPile", () => {
  it("shows the empty-state placeholder when no cards captured", () => {
    const { getByText } = wrap(<SelfCapturedPile cards={[]} />);
    expect(getByText(/nothing yet/i)).toBeTruthy();
  });

  it("does not render a points pill when empty", () => {
    const { queryByText } = wrap(<SelfCapturedPile cards={[]} />);
    expect(queryByText("+0")).toBeNull();
  });

  it("renders face-up rank + suit for each captured card", () => {
    const cards: Card[] = [c("hearts", 13), c("spades", 12)];
    const { getAllByText, getByText } = wrap(<SelfCapturedPile cards={cards} />);
    expect(getByText("K")).toBeTruthy();
    expect(getByText("Q")).toBeTruthy();
    expect(getAllByText("♥").length).toBeGreaterThan(0);
    expect(getAllByText("♠").length).toBeGreaterThan(0);
  });

  it("does not render a numeric points badge (score badges removed per #716)", () => {
    const cards: Card[] = [c("hearts", 2), c("hearts", 5), c("hearts", 9), c("spades", 12)];
    const { queryByText } = wrap(<SelfCapturedPile cards={cards} />);
    expect(queryByText("+16")).toBeNull();
  });

  it("excludes non-scoring cards (clubs, diamonds, non-queen spades) from display", () => {
    const cards: Card[] = [
      c("hearts", 5),
      c("clubs", 13),
      c("spades", 1),
      c("diamonds", 7),
      c("clubs", 2),
      c("hearts", 11),
    ];
    const { UNSAFE_getAllByType } = wrap(<SelfCapturedPile cards={cards} />);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Text: RNText } = require("react-native");
    const texts = UNSAFE_getAllByType(RNText)
      .map((n: { props: { children?: unknown } }) =>
        typeof n.props.children === "string" ? n.props.children : null
      )
      .filter((s: string | null): s is string => s !== null);
    const ranksInOrder = texts.filter((s: string) => /^(A|J|Q|K|[2-9]|10)$/.test(s));
    // Only the two hearts (5, J) should appear; clubs/diamonds/non-Q-spades are hidden.
    expect(ranksInOrder).toEqual(["5", "J"]);
  });

  it("sorts scoring cards by suit then rank (Q♠ before hearts)", () => {
    const cards: Card[] = [c("hearts", 11), c("spades", 12), c("hearts", 3)];
    const { UNSAFE_getAllByType } = wrap(<SelfCapturedPile cards={cards} />);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Text: RNText } = require("react-native");
    const texts = UNSAFE_getAllByType(RNText)
      .map((n: { props: { children?: unknown } }) =>
        typeof n.props.children === "string" ? n.props.children : null
      )
      .filter((s: string | null): s is string => s !== null);
    const ranksInOrder = texts.filter((s: string) => /^(A|J|Q|K|[2-9]|10)$/.test(s));
    // sortHand order: spades before hearts → Q♠, ♥3, ♥J
    expect(ranksInOrder).toEqual(["Q", "3", "J"]);
  });
});
