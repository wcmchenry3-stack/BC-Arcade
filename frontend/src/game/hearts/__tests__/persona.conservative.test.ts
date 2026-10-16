/**
 * The Conservative CPU and the legacy-persona flag's pure helpers (#3158).
 */
import { selectCardToPlay, selectCardsToPass } from "../ai";
import { choosePass } from "../conservative/pass";
import { choosePlay } from "../conservative/play";
import { dealGame, setRng } from "../engine";
import {
  AI_PRESETS,
  DEFAULT_AI_PRESET,
  resolveAvailablePreset,
  resolvePersona,
  selectablePresets,
} from "../types";
import type { AiPreset, Card, TrickCard } from "../types";
import { c, mkState } from "./helpers/aiFixtures";

afterEach(() => setRng(Math.random));

describe("presets (#3158)", () => {
  it("defaults to conservative, and a fresh game is dealt at it", () => {
    expect(DEFAULT_AI_PRESET).toBe("conservative");
    expect(dealGame().aiDifficulty).toBe("conservative");
  });

  it("resolves conservative to itself at every seat, and keeps the Mixed Table", () => {
    for (const seat of [1, 2, 3]) expect(resolvePersona("conservative", seat)).toBe("conservative");
    expect([1, 2, 3].map((s) => resolvePersona("mixed", s))).toEqual([
      "cautious",
      "schemer",
      "daring",
    ]);
  });

  it("offers only conservative without the flag, and every preset with it", () => {
    expect(selectablePresets(false)).toEqual(["conservative"]);
    expect(selectablePresets(true)).toEqual(AI_PRESETS);
    expect(AI_PRESETS).toEqual(["conservative", "cautious", "schemer", "daring", "mixed"]);
  });

  it.each<AiPreset>(["cautious", "schemer", "daring", "mixed"])(
    "turns legacy preset %s into conservative without the flag, keeps it with",
    (preset) => {
      expect(resolveAvailablePreset(preset, false)).toBe("conservative");
      expect(resolveAvailablePreset(preset, true)).toBe(preset);
    }
  );

  it("keeps conservative either way", () => {
    expect(resolveAvailablePreset("conservative", false)).toBe("conservative");
    expect(resolveAvailablePreset("conservative", true)).toBe("conservative");
  });
});

describe("conservative CPU (#3158, #3159)", () => {
  const hand: Card[] = [c("clubs", 6), c("clubs", 8), c("clubs", 11), c("clubs", 13)];
  const trick: TrickCard[] = [{ card: c("clubs", 9), playerIndex: 0 }];
  const state = mkState({
    playerHands: [[], hand, [], []],
    currentTrick: trick,
    currentLeaderIndex: 0,
    currentPlayerIndex: 1,
  });
  const passHand: Card[] = [
    c("spades", 12),
    c("spades", 3),
    c("spades", 4),
    c("hearts", 2),
    c("hearts", 9),
    c("clubs", 7),
    c("clubs", 8),
    c("clubs", 9),
    c("diamonds", 5),
    c("diamonds", 6),
    c("diamonds", 13),
    c("diamonds", 2),
    c("hearts", 12),
  ];

  it("plays and passes as the principle-based conservative CPU (#3159)", () => {
    setRng(() => 0.99);
    expect(selectCardToPlay(hand, trick, state, 1, "conservative")).toEqual(
      choosePlay(state, 1).card
    );
    expect(selectCardsToPass(passHand, "left", "conservative", 1)).toEqual(
      choosePass(passHand, "left").cards
    );
  });

  it("plays the same card whatever the RNG says, and never draws from it", () => {
    const plays = [0, 0.3, 0.99].map((r) => {
      const rng = jest.fn(() => r);
      setRng(rng);
      const card = selectCardToPlay(hand, trick, state, 1, "conservative");
      const pass = selectCardsToPass(passHand, "left", "conservative", 1);
      expect(rng).not.toHaveBeenCalled();
      return { card, pass };
    });
    expect(plays[1]).toEqual(plays[0]);
    expect(plays[2]).toEqual(plays[0]);
  });

  it("differs from legacy cautious when its noise would have fired", () => {
    // cautious draws rng() < 0.55 and errs; conservative must not.
    setRng(() => 0);
    const noisy = selectCardToPlay(hand, trick, state, 1, "cautious");
    setRng(() => 0.99);
    const best = selectCardToPlay(hand, trick, state, 1, "cautious");
    expect(noisy).not.toEqual(best);
    setRng(() => 0);
    expect(selectCardToPlay(hand, trick, state, 1, "conservative")).toEqual(
      choosePlay(state, 1).card
    );
  });
});
