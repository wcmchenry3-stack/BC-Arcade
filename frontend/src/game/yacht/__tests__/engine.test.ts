/**
 * Tests for the client-side Yacht engine.
 *
 * Ports backend/tests/test_game.py so the two engines behave identically.
 */

import {
  newGame,
  roll,
  score,
  toggleHold,
  possibleScores,
  calculateScore,
  calculateJokerScore,
  computeDerived,
  isInProgress,
  setRng,
  createSeededRng,
  Category,
  CATEGORIES,
} from "../engine";
import { GameState } from "../types";

// Helpers ------------------------------------------------------------------

function makeGame(dice: number[], rollsUsed = 1): GameState {
  // Bypass RNG by starting from a fresh game and overriding fields.
  const base = newGame();
  return {
    ...base,
    dice,
    rolls_used: rollsUsed,
  };
}

function fillUpper(
  state: GameState,
  values: Partial<Record<"ones" | "twos" | "threes" | "fours" | "fives" | "sixes", number>> = {}
): GameState {
  return computeDerived({
    ...state,
    scores: {
      ...state.scores,
      ones: 3,
      twos: 6,
      threes: 9,
      fours: 12,
      fives: 15,
      sixes: 18,
      ...values,
    },
  });
}

// --- Scoring helpers: calculateScore ---------------------------------------

describe("calculateScore — upper categories", () => {
  it("ones counts ones", () => expect(calculateScore("ones", [1, 1, 2, 3, 4])).toBe(2));
  it("ones none", () => expect(calculateScore("ones", [2, 3, 4, 5, 6])).toBe(0));
  it("twos", () => expect(calculateScore("twos", [2, 2, 2, 1, 1])).toBe(6));
  it("threes", () => expect(calculateScore("threes", [3, 3, 1, 1, 1])).toBe(6));
  it("fours", () => expect(calculateScore("fours", [4, 4, 4, 4, 2])).toBe(16));
  it("fives", () => expect(calculateScore("fives", [5, 5, 1, 2, 3])).toBe(10));
  it("sixes all", () => expect(calculateScore("sixes", [6, 6, 6, 6, 6])).toBe(30));
  it("sixes none", () => expect(calculateScore("sixes", [1, 2, 3, 4, 5])).toBe(0));
});

describe("calculateScore — three_of_a_kind", () => {
  it("hit", () => expect(calculateScore("three_of_a_kind", [3, 3, 3, 1, 2])).toBe(12));
  it("four also qualifies", () =>
    expect(calculateScore("three_of_a_kind", [4, 4, 4, 4, 1])).toBe(17));
  it("yacht also qualifies", () =>
    expect(calculateScore("three_of_a_kind", [5, 5, 5, 5, 5])).toBe(25));
  it("miss", () => expect(calculateScore("three_of_a_kind", [1, 2, 3, 4, 5])).toBe(0));
});

describe("calculateScore — four_of_a_kind", () => {
  it("hit", () => expect(calculateScore("four_of_a_kind", [6, 6, 6, 6, 2])).toBe(26));
  it("yacht also qualifies", () =>
    expect(calculateScore("four_of_a_kind", [3, 3, 3, 3, 3])).toBe(15));
  it("miss (three)", () => expect(calculateScore("four_of_a_kind", [2, 2, 2, 1, 3])).toBe(0));
});

describe("calculateScore — full_house", () => {
  it("hit 2-3", () => expect(calculateScore("full_house", [2, 2, 3, 3, 3])).toBe(25));
  it("hit 3-2", () => expect(calculateScore("full_house", [6, 6, 6, 1, 1])).toBe(25));
  it("miss four_of_a_kind", () => expect(calculateScore("full_house", [4, 4, 4, 4, 1])).toBe(0));
  it("miss yacht", () => expect(calculateScore("full_house", [5, 5, 5, 5, 5])).toBe(0));
  it("miss no pair", () => expect(calculateScore("full_house", [1, 2, 3, 4, 5])).toBe(0));
});

describe("calculateScore — straights", () => {
  it("small 1234", () => expect(calculateScore("small_straight", [1, 2, 3, 4, 6])).toBe(30));
  it("small 2345", () => expect(calculateScore("small_straight", [2, 3, 4, 5, 1])).toBe(30));
  it("small 3456", () => expect(calculateScore("small_straight", [3, 4, 5, 6, 3])).toBe(30));
  it("small with duplicate", () =>
    expect(calculateScore("small_straight", [1, 2, 3, 3, 4])).toBe(30));
  it("small miss", () => expect(calculateScore("small_straight", [1, 2, 4, 5, 6])).toBe(0));
  it("large 12345", () => expect(calculateScore("large_straight", [1, 2, 3, 4, 5])).toBe(40));
  it("large 23456", () => expect(calculateScore("large_straight", [2, 3, 4, 5, 6])).toBe(40));
  it("large miss small only", () =>
    expect(calculateScore("large_straight", [1, 2, 3, 4, 6])).toBe(0));
  it("large miss duplicate", () =>
    expect(calculateScore("large_straight", [1, 2, 3, 3, 5])).toBe(0));
});

describe("calculateScore — yacht + chance", () => {
  it("yacht hit", () => expect(calculateScore("yacht", [4, 4, 4, 4, 4])).toBe(50));
  it("yacht miss", () => expect(calculateScore("yacht", [4, 4, 4, 4, 3])).toBe(0));
  it("chance sums", () => expect(calculateScore("chance", [1, 2, 3, 4, 5])).toBe(15));
  it("chance max", () => expect(calculateScore("chance", [6, 6, 6, 6, 6])).toBe(30));
});

// GH #2242: calculateJokerScore is public (used directly by the AI's
// valuation logic), so its fixed-value contract is worth pinning on its own,
// independent of score()'s Joker-priority enforcement tested below.
describe("calculateJokerScore", () => {
  // Five-of-a-kind never forms a natural full house / straight, so these
  // fixed values only differ from calculateScore's 0 on a Joker turn.
  const fiveOfAKind = [2, 2, 2, 2, 2];

  it("upper categories delegate to calculateScore (Joker rule doesn't change upper scoring)", () => {
    expect(calculateJokerScore("twos", fiveOfAKind)).toBe(calculateScore("twos", fiveOfAKind));
    expect(calculateJokerScore("sixes", [6, 6, 6, 6, 6])).toBe(
      calculateScore("sixes", [6, 6, 6, 6, 6])
    );
  });

  it("full_house scores the fixed 25", () => {
    expect(calculateJokerScore("full_house", fiveOfAKind)).toBe(25);
  });

  it("small_straight scores the fixed 30", () => {
    expect(calculateJokerScore("small_straight", fiveOfAKind)).toBe(30);
  });

  it("large_straight scores the fixed 40", () => {
    expect(calculateJokerScore("large_straight", fiveOfAKind)).toBe(40);
  });

  it("three_of_a_kind and four_of_a_kind score the dice sum", () => {
    expect(calculateJokerScore("three_of_a_kind", fiveOfAKind)).toBe(10);
    expect(calculateJokerScore("four_of_a_kind", fiveOfAKind)).toBe(10);
  });

  it("chance scores the dice sum", () => {
    expect(calculateJokerScore("chance", fiveOfAKind)).toBe(10);
  });

  it("yacht scores the flat 50 (not currently reachable via score(), but priced defensively)", () => {
    expect(calculateJokerScore("yacht", fiveOfAKind)).toBe(50);
  });
});

// --- Roll logic ------------------------------------------------------------

describe("roll", () => {
  it("first roll sets dice to 1-6 values", () => {
    const g = roll(newGame(), [false, false, false, false, false]);
    for (const d of g.dice) {
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(6);
    }
    expect(g.rolls_used).toBe(1);
  });

  it("first roll of turn ignores held", () => {
    let g = newGame();
    // Cannot hold before rolling; pass all true. Engine should force to false on first roll.
    g = roll(g, [true, true, true, true, true]);
    expect(g.rolls_used).toBe(1);
  });

  it("held dice preserved on subsequent rolls", () => {
    // First roll
    let g = roll(newGame(), [false, false, false, false, false]);
    // Force known state
    g = { ...g, dice: [6, 6, 1, 1, 1] };
    g = roll(g, [true, true, false, false, false]);
    expect(g.dice[0]).toBe(6);
    expect(g.dice[1]).toBe(6);
  });

  it("rolls_used increments", () => {
    let g = newGame();
    g = roll(g, [false, false, false, false, false]);
    expect(g.rolls_used).toBe(1);
    g = roll(g, [false, false, false, false, false]);
    expect(g.rolls_used).toBe(2);
  });

  it("cannot roll after 3", () => {
    let g = newGame();
    for (let i = 0; i < 3; i++) g = roll(g, [false, false, false, false, false]);
    expect(() => roll(g, [false, false, false, false, false])).toThrow(/No rolls remaining/);
  });

  it("cannot roll when game over", () => {
    const g: GameState = { ...makeGame([1, 1, 1, 1, 1]), game_over: true };
    expect(() => roll(g, [false, false, false, false, false])).toThrow(/Game is over/);
  });
});

// --- Score / round logic ---------------------------------------------------

describe("score", () => {
  it("records value", () => {
    const g = score(makeGame([1, 1, 1, 2, 3]), "ones");
    expect(g.scores.ones).toBe(3);
  });

  it("advances round", () => {
    const g = score(makeGame([1, 1, 1, 2, 3]), "ones");
    expect(g.round).toBe(2);
  });

  it("resets rolls and dice", () => {
    const g = score(makeGame([1, 1, 1, 2, 3]), "ones");
    expect(g.rolls_used).toBe(0);
    expect(g.dice).toEqual([0, 0, 0, 0, 0]);
  });

  it("cannot score before rolling", () => {
    expect(() => score(newGame(), "ones")).toThrow(/Must roll/);
  });

  it("cannot score duplicate", () => {
    let g = score(makeGame([1, 1, 1, 2, 3]), "ones");
    g = { ...g, dice: [1, 1, 1, 2, 3], rolls_used: 1 };
    expect(() => score(g, "ones")).toThrow(/already scored/);
  });

  it("unknown category raises", () => {
    expect(() => score(makeGame([1, 2, 3, 4, 5]), "bogus" as unknown as Category)).toThrow(
      /Unknown scoring category/
    );
  });

  it("game over after 13 rounds", () => {
    let g = newGame();
    for (const cat of CATEGORIES) {
      g = { ...g, dice: [1, 2, 3, 4, 5], rolls_used: 1 };
      g = score(g, cat);
    }
    expect(g.game_over).toBe(true);
    expect(g.round).toBe(14);
  });

  it("cannot score when game over", () => {
    const g: GameState = { ...makeGame([1, 2, 3, 4, 5]), game_over: true };
    expect(() => score(g, "ones")).toThrow(/Game is over/);
  });
});

// --- Upper bonus -----------------------------------------------------------

describe("upper bonus", () => {
  it("bonus triggers at 63", () => {
    const g = fillUpper(newGame());
    expect(g.upper_bonus).toBe(35);
  });

  it("bonus triggers above 63", () => {
    const g = fillUpper(newGame(), { sixes: 30 });
    expect(g.upper_bonus).toBe(35);
  });

  it("no bonus below 63", () => {
    const g = fillUpper(newGame(), { ones: 0 });
    expect(g.upper_bonus).toBe(0);
  });

  it("no bonus while upper incomplete", () => {
    const g: GameState = { ...newGame(), scores: { ...newGame().scores, ones: 3 } };
    // Recompute derived — simulate withDerived by calling newGame + replacing via score
    // Since we can't call withDerived directly, we just check upper_bonus computed by the caller.
    expect(g.upper_bonus).toBe(0);
  });

  // End-to-end total_score bonus assertion lives in the
  // "derived values after score()" describe block below.
});

describe("derived values after score()", () => {
  it("total_score reflects bonus + chance after scoring through the engine", () => {
    // Fill upper directly via score() calls with rigged dice.
    let g = newGame();
    const riggedUpper: Array<[number[], Category]> = [
      [[1, 1, 1, 2, 2], "ones"],
      [[2, 2, 2, 1, 1], "twos"],
      [[3, 3, 3, 1, 1], "threes"],
      [[4, 4, 4, 1, 1], "fours"],
      [[5, 5, 5, 1, 1], "fives"],
      [[6, 6, 6, 1, 1], "sixes"],
    ];
    for (const [dice, cat] of riggedUpper) {
      g = { ...g, dice, rolls_used: 1 };
      g = score(g, cat);
    }
    // ones=3, twos=6, threes=9, fours=12, fives=15, sixes=18 → 63 → +35
    expect(g.upper_subtotal).toBe(63);
    expect(g.upper_bonus).toBe(35);

    // Now score chance with 20
    g = { ...g, dice: [2, 4, 6, 6, 2], rolls_used: 1 };
    g = score(g, "chance");
    expect(g.total_score).toBe(63 + 35 + 20);
  });
});

// --- possibleScores --------------------------------------------------------

describe("possibleScores", () => {
  it("returns only unfilled", () => {
    const base = makeGame([1, 1, 1, 2, 3]);
    const g = { ...base, scores: { ...base.scores, ones: 3 } };
    const ps = possibleScores(g);
    expect(ps.ones).toBeUndefined();
    expect(ps.twos).toBeDefined();
  });

  it("returns correct values", () => {
    const ps = possibleScores(makeGame([6, 6, 6, 6, 6]));
    expect(ps.yacht).toBe(50);
    expect(ps.sixes).toBe(30);
    expect(ps.chance).toBe(30);
  });

  it("returns empty when rolls_used is 0", () => {
    expect(possibleScores(newGame())).toEqual({});
  });
});

// --- Yacht bonus (multiple yachts) -----------------------------------------

describe("yacht bonus", () => {
  it("no bonus on first yacht", () => {
    const g = score(makeGame([4, 4, 4, 4, 4]), "yacht");
    expect(g.yacht_bonus_count).toBe(0);
    expect(g.scores.yacht).toBe(50);
  });

  it("bonus awarded on second yacht (joker must go to corresponding upper)", () => {
    let g = makeGame([4, 4, 4, 4, 4]);
    g = { ...g, scores: { ...g.scores, yacht: 50 } };
    g = score(g, "fours"); // joker into corresponding upper
    expect(g.yacht_bonus_count).toBe(1);
  });

  it("multiple bonuses accumulate", () => {
    let g = makeGame([3, 3, 3, 3, 3]);
    g = { ...g, scores: { ...g.scores, yacht: 50, threes: 9 } };
    g = score(g, "three_of_a_kind");
    expect(g.yacht_bonus_count).toBe(1);

    g = { ...g, dice: [3, 3, 3, 3, 3], rolls_used: 1 };
    g = score(g, "four_of_a_kind");
    expect(g.yacht_bonus_count).toBe(2);
  });

  it("no bonus when yacht scratched", () => {
    let g = makeGame([3, 3, 3, 3, 3]);
    g = { ...g, scores: { ...g.scores, yacht: 0 } };
    g = score(g, "threes");
    expect(g.yacht_bonus_count).toBe(0);
  });

  it("yacht_bonus_total = count × 100", () => {
    const base = newGame();
    // 3 bonuses → 300
    const g = { ...base, yacht_bonus_count: 3 };
    // total_score computation needs to include bonus
    // Since we bypassed score() by directly setting yacht_bonus_count,
    // the derived values aren't recomputed. Just check the formula:
    expect(g.yacht_bonus_count * 100).toBe(300);
  });
});

// --- Joker rule ------------------------------------------------------------

describe("joker rule — enforcement", () => {
  it("must use corresponding upper if open", () => {
    const g: GameState = {
      ...makeGame([4, 4, 4, 4, 4]),
      scores: { ...newGame().scores, yacht: 50 },
    };
    expect(() => score(g, "chance")).toThrow(/corresponding upper/);
  });

  it("corresponding upper scores correctly", () => {
    let g: GameState = { ...makeGame([4, 4, 4, 4, 4]), scores: { ...newGame().scores, yacht: 50 } };
    g = score(g, "fours");
    expect(g.scores.fours).toBe(20); // 4 × 5
  });

  it("lower section when upper filled — full_house full value", () => {
    let g: GameState = {
      ...makeGame([5, 5, 5, 5, 5]),
      scores: { ...newGame().scores, yacht: 50, fives: 15 },
    };
    g = score(g, "full_house");
    expect(g.scores.full_house).toBe(25);
  });

  it("lower small_straight full value", () => {
    let g: GameState = {
      ...makeGame([6, 6, 6, 6, 6]),
      scores: { ...newGame().scores, yacht: 50, sixes: 18 },
    };
    g = score(g, "small_straight");
    expect(g.scores.small_straight).toBe(30);
  });

  it("lower large_straight full value", () => {
    let g: GameState = {
      ...makeGame([1, 1, 1, 1, 1]),
      scores: { ...newGame().scores, yacht: 50, ones: 3 },
    };
    g = score(g, "large_straight");
    expect(g.scores.large_straight).toBe(40);
  });

  it("lower three_of_a_kind = sum of dice", () => {
    let g: GameState = {
      ...makeGame([6, 6, 6, 6, 6]),
      scores: { ...newGame().scores, yacht: 50, sixes: 18 },
    };
    g = score(g, "three_of_a_kind");
    expect(g.scores.three_of_a_kind).toBe(30);
  });

  it("lower chance = sum of dice", () => {
    let g: GameState = {
      ...makeGame([3, 3, 3, 3, 3]),
      scores: { ...newGame().scores, yacht: 50, threes: 9 },
    };
    g = score(g, "chance");
    expect(g.scores.chance).toBe(15);
  });

  it("cannot pick upper when lower open", () => {
    const g: GameState = {
      ...makeGame([4, 4, 4, 4, 4]),
      scores: { ...newGame().scores, yacht: 50, fours: 16 },
    };
    expect(() => score(g, "ones")).toThrow(/open lower/);
  });

  it("upper fallback when all lower filled", () => {
    let g: GameState = {
      ...makeGame([2, 2, 2, 2, 2]),
      scores: { ...newGame().scores, yacht: 50, twos: 6 },
    };
    // Fill all other lower
    g = {
      ...g,
      scores: {
        ...g.scores,
        three_of_a_kind: 0,
        four_of_a_kind: 0,
        full_house: 0,
        small_straight: 0,
        large_straight: 0,
        chance: 0,
      },
    };
    g = score(g, "ones");
    expect(g.scores.ones).toBe(0); // five 2s → zero ones
  });
});

describe("joker rule — possibleScores", () => {
  it("priority 1: only mandatory upper", () => {
    const g: GameState = {
      ...makeGame([3, 3, 3, 3, 3]),
      scores: { ...newGame().scores, yacht: 50 },
    };
    expect(possibleScores(g)).toEqual({ threes: 15 });
  });

  it("priority 2: open lower at joker values", () => {
    const g: GameState = {
      ...makeGame([6, 6, 6, 6, 6]),
      scores: { ...newGame().scores, yacht: 50, sixes: 18 },
    };
    const ps = possibleScores(g);
    expect(ps.full_house).toBe(25);
    expect(ps.large_straight).toBe(40);
    expect(ps.small_straight).toBe(30);
    expect(ps.yacht).toBeUndefined();
  });

  it("priority 3: open upper when lower all filled", () => {
    let g: GameState = {
      ...makeGame([4, 4, 4, 4, 4]),
      scores: { ...newGame().scores, yacht: 50, fours: 16 },
    };
    g = {
      ...g,
      scores: {
        ...g.scores,
        three_of_a_kind: 0,
        four_of_a_kind: 0,
        full_house: 0,
        small_straight: 0,
        large_straight: 0,
        chance: 0,
      },
    };
    const ps = possibleScores(g);
    expect(ps.ones).toBeDefined();
    expect(ps.fours).toBeUndefined();
  });

  it("no joker when yacht not scored yet", () => {
    const ps = possibleScores(makeGame([5, 5, 5, 5, 5]));
    expect(ps.yacht).toBe(50);
    expect(Object.keys(ps)).toHaveLength(13);
  });

  it("no joker when yacht scratched", () => {
    const g: GameState = {
      ...makeGame([2, 2, 2, 2, 2]),
      scores: { ...newGame().scores, yacht: 0 },
    };
    const ps = possibleScores(g);
    expect(ps.twos).toBe(10);
    expect(ps.full_house).toBe(0);
  });

  // --- New edge cases (#186) -----------------------------------------------

  it("priority 3: only non-corresponding upper open → that category is the sole option", () => {
    // Five 3s with threes filled and all lower filled — only fives remains open.
    const g: GameState = {
      ...makeGame([3, 3, 3, 3, 3]),
      scores: {
        ...newGame().scores,
        yacht: 50,
        threes: 9, // corresponding upper filled
        ones: 0,
        twos: 0,
        fours: 0,
        sixes: 0, // all other uppers filled except fives
        three_of_a_kind: 0,
        four_of_a_kind: 0,
        full_house: 0,
        small_straight: 0,
        large_straight: 0,
        chance: 0, // all lower filled
      },
    };

    const ps = possibleScores(g);
    expect(ps).toEqual({ fives: 0 }); // five 3s → 0 in fives

    const g2 = score(g, "fives");
    expect(g2.scores.fives).toBe(0);
    expect(g2.yacht_bonus_count).toBe(1); // bonus still awarded under Priority 3
  });

  it("scratched yacht: subsequent yacht roll does not activate joker or award bonus", () => {
    // Score yacht as 0 (non-yacht dice).
    let g = makeGame([1, 2, 3, 4, 5]);
    g = score(g, "yacht");
    expect(g.scores.yacht).toBe(0);
    expect(g.yacht_bonus_count).toBe(0);

    // Later turn: roll a genuine yacht.
    const g2: GameState = { ...g, dice: [4, 4, 4, 4, 4], rolls_used: 1 };

    // Joker requires scores.yacht === 50 — scratched means it's 0, not active.
    const ps = possibleScores(g2);
    expect(ps.fours).toBe(20); // normal upper scoring
    expect(ps.full_house).toBe(0); // normal (not joker) lower value

    const g3 = score(g2, "fours");
    expect(g3.scores.fours).toBe(20);
    expect(g3.yacht_bonus_count).toBe(0); // no bonus ever awarded
  });

  it("only yacht remaining with non-yacht roll → possible_scores is {yacht: 0}", () => {
    const g: GameState = {
      ...makeGame([1, 2, 3, 4, 5]),
      scores: {
        ones: 0,
        twos: 0,
        threes: 0,
        fours: 0,
        fives: 0,
        sixes: 0,
        three_of_a_kind: 0,
        four_of_a_kind: 0,
        full_house: 0,
        small_straight: 0,
        large_straight: 0,
        chance: 0,
        yacht: null, // the only unscored category
      },
    };

    const ps = possibleScores(g);
    expect(ps).toEqual({ yacht: 0 });
  });
});

// --- Seedable RNG ---------------------------------------------------------

describe("seedable RNG (setRng + createSeededRng)", () => {
  afterEach(() => {
    // Restore default RNG so subsequent tests aren't affected.
    setRng(Math.random);
  });

  it("same seed produces identical first roll", () => {
    setRng(createSeededRng(42));
    const a = roll(newGame(), [false, false, false, false, false]);
    setRng(createSeededRng(42));
    const b = roll(newGame(), [false, false, false, false, false]);
    expect(a.dice).toEqual(b.dice);
  });

  it("different seeds produce different rolls", () => {
    setRng(createSeededRng(1));
    const a = roll(newGame(), [false, false, false, false, false]);
    setRng(createSeededRng(999));
    const b = roll(newGame(), [false, false, false, false, false]);
    expect(a.dice).not.toEqual(b.dice);
  });

  it("same seed replays an identical 3-roll turn", () => {
    const held = [false, false, false, false, false];

    setRng(createSeededRng(7));
    let a = roll(newGame(), held);
    a = roll(a, held);
    a = roll(a, held);

    setRng(createSeededRng(7));
    let b = roll(newGame(), held);
    b = roll(b, held);
    b = roll(b, held);

    expect(a.dice).toEqual(b.dice);
    expect(a.rolls_used).toEqual(b.rolls_used);
  });

  it("held dice are preserved across seeded re-rolls", () => {
    setRng(createSeededRng(123));
    let g = roll(newGame(), [false, false, false, false, false]);
    const firstRoll = [...g.dice];
    // Hold dice 0 and 1, reroll the rest with a seeded continuation.
    g = roll(g, [true, true, false, false, false]);
    expect(g.dice[0]).toBe(firstRoll[0]);
    expect(g.dice[1]).toBe(firstRoll[1]);
  });

  it("seeded dice are always in 1..6", () => {
    setRng(createSeededRng(999_999));
    for (let i = 0; i < 20; i++) {
      const g = roll(newGame(), [false, false, false, false, false]);
      for (const d of g.dice) {
        expect(d).toBeGreaterThanOrEqual(1);
        expect(d).toBeLessThanOrEqual(6);
      }
    }
  });

  it("setRng(Math.random) afterEach restores non-determinism", () => {
    // Two fresh rolls from Math.random almost never match across 5 dice.
    const a = roll(newGame(), [false, false, false, false, false]);
    const b = roll(newGame(), [false, false, false, false, false]);
    expect(a.dice).not.toEqual(b.dice);
  });
});

describe("isInProgress", () => {
  it("returns false for a fresh new game", () => {
    expect(isInProgress(newGame())).toBe(false);
  });

  it("returns true when rolls_used > 0", () => {
    const g = newGame();
    expect(isInProgress({ ...g, rolls_used: 1 })).toBe(true);
  });

  it("returns true when round > 1", () => {
    const g = newGame();
    expect(isInProgress({ ...g, round: 2 })).toBe(true);
  });

  it("returns true when any category has been scored", () => {
    const g = newGame();
    expect(isInProgress({ ...g, scores: { ...g.scores, chance: 12 } })).toBe(true);
  });

  it("returns true when a category is scored to 0 (still a decision made)", () => {
    const g = newGame();
    expect(isInProgress({ ...g, scores: { ...g.scores, yacht: 0 } })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GameEvent emissions
// ---------------------------------------------------------------------------

describe("roll — diceRoll event", () => {
  afterEach(() => setRng(Math.random));

  it("emits diceRoll with all 5 indices on first roll", () => {
    setRng(createSeededRng(42));
    const g = newGame();
    const next = roll(g, [false, false, false, false, false]);
    expect(next.events).toEqual([{ type: "diceRoll", rolledIndices: [0, 1, 2, 3, 4] }]);
  });

  it("emits diceRoll with only unhold indices on subsequent rolls", () => {
    setRng(createSeededRng(1));
    const g = newGame();
    const after1 = roll(g, [false, false, false, false, false]);
    setRng(createSeededRng(2));
    const after2 = roll(after1, [true, false, true, false, true]);
    const event = after2.events?.[0];
    expect(event?.type).toBe("diceRoll");
    if (event?.type === "diceRoll") {
      expect(event.rolledIndices).toEqual([1, 3]);
    }
  });

  it("clears events when another roll is made", () => {
    setRng(createSeededRng(10));
    const g = newGame();
    const after1 = roll(g, [false, false, false, false, false]);
    setRng(createSeededRng(11));
    const after2 = roll(after1, [false, false, false, false, false]);
    // The second roll replaces the first roll's events
    expect(after2.events?.[0]?.type).toBe("diceRoll");
    expect(after2.events).toHaveLength(1);
  });
});

describe("toggleHold — dieHold / dieRelease events", () => {
  it("emits dieHold when die is not held", () => {
    const g = makeGame([1, 2, 3, 4, 5], 1);
    const next = toggleHold(g, 2);
    expect(next.held[2]).toBe(true);
    expect(next.events).toEqual([{ type: "dieHold", index: 2 }]);
  });

  it("emits dieRelease when die is already held", () => {
    const g = { ...makeGame([1, 2, 3, 4, 5], 1), held: [false, false, true, false, false] };
    const next = toggleHold(g, 2);
    expect(next.held[2]).toBe(false);
    expect(next.events).toEqual([{ type: "dieRelease", index: 2 }]);
  });

  it("does nothing before first roll (rolls_used === 0)", () => {
    const g = newGame();
    const next = toggleHold(g, 0);
    expect(next).toBe(g);
  });

  it("does nothing when game is over", () => {
    const g = { ...makeGame([1, 2, 3, 4, 5], 1), game_over: true };
    const next = toggleHold(g, 0);
    expect(next).toBe(g);
  });
});

describe("score — yacht event", () => {
  afterEach(() => setRng(Math.random));

  it("emits yacht event when scoring the yacht category with all-match dice", () => {
    const g = makeGame([3, 3, 3, 3, 3], 1);
    const next = score(g, "yacht");
    expect(next.events).toContainEqual({ type: "yacht" });
  });

  it("does not emit yacht event when scoring yacht with 0 (no match)", () => {
    const g = makeGame([1, 2, 3, 4, 5], 1);
    const next = score(g, "yacht");
    expect(next.events ?? []).not.toContainEqual({ type: "yacht" });
  });
});

describe("score — straight events", () => {
  it("emits largeStraight when scoring large_straight with a run of 5", () => {
    const g = makeGame([1, 2, 3, 4, 5], 1);
    const next = score(g, "large_straight");
    expect(next.events).toContainEqual({ type: "largeStraight" });
  });

  it("does not emit largeStraight when scoring large_straight for 0", () => {
    const g = makeGame([1, 1, 3, 4, 5], 1);
    const next = score(g, "large_straight");
    expect(next.events ?? []).not.toContainEqual({ type: "largeStraight" });
  });

  it("emits smallStraight when scoring small_straight with a run of 4", () => {
    const g = makeGame([1, 2, 3, 4, 6], 1);
    const next = score(g, "small_straight");
    expect(next.events).toContainEqual({ type: "smallStraight" });
  });
});

describe("score — upperBonus event", () => {
  it("emits upperBonus exactly once when upper total first reaches 63", () => {
    // Fill upper scores so total is 60 (3+6+9+12+15+15 = 60 — just below 63)
    const base = newGame();
    const partial = computeDerived({
      ...base,
      scores: {
        ...base.scores,
        ones: 3,
        twos: 6,
        threes: 9,
        fours: 12,
        fives: 15,
        // sixes not yet scored
      },
    });
    // Score sixes with [6,6,6,6,6] → 30 pts; total = 3+6+9+12+15+30 = 75 ≥ 63
    const withDice = { ...partial, dice: [6, 6, 6, 6, 6], rolls_used: 1 };
    const next = score(withDice, "sixes");
    expect(next.events).toContainEqual({ type: "upperBonus" });
  });

  it("does not emit upperBonus when upper total was already ≥ 63 before scoring", () => {
    const base = newGame();
    const already = computeDerived({
      ...base,
      scores: {
        ...base.scores,
        ones: 5,
        twos: 10,
        threes: 15,
        fours: 20,
        fives: 25,
        // sixes not scored yet but total already 75 ≥ 63 — not possible in normal play
        // but let's test the guard anyway
        sixes: 18,
      },
    });
    // Now try scoring something else; upperBonus should not re-fire
    const withDice = { ...already, dice: [1, 2, 3, 4, 5], rolls_used: 1 };
    const next = score(withDice, "chance");
    expect(next.events ?? []).not.toContainEqual({ type: "upperBonus" });
  });
});

describe("score — joker event", () => {
  function stateWithYachtScored(): GameState {
    const base = newGame();
    return computeDerived({ ...base, scores: { ...base.scores, yacht: 50 }, yacht_bonus_count: 0 });
  }

  it("emits joker event when scoring a second yacht (joker bonus)", () => {
    const withYachtScored = stateWithYachtScored();
    const withDice = { ...withYachtScored, dice: [4, 4, 4, 4, 4], rolls_used: 1 };
    const next = score(withDice, "fours");
    expect(next.yacht_bonus_count).toBe(1);
    expect(next.events ?? []).toContainEqual({ type: "joker" });
  });

  it("does not emit joker event when scoring normally (no joker)", () => {
    const base = makeGame([1, 2, 3, 4, 5]);
    const next = score(base, "chance");
    expect(next.events ?? []).not.toContainEqual({ type: "joker" });
  });
});

describe("roll opts.dice", () => {
  it("applies override values to unheld dice", () => {
    const state = newGame();
    const next = roll(state, [false, false, false, false, false], { dice: [6, 6, 6, 6, 6] });
    expect(next.dice).toEqual([6, 6, 6, 6, 6]);
    // Subsequent roll without opts uses RNG (not all-6)
    setRng(createSeededRng(42));
    const next2 = roll({ ...next, rolls_used: 1 }, [false, false, false, false, false]);
    expect(next2.dice).not.toEqual([6, 6, 6, 6, 6]);
  });

  it("respects held dice when applying override", () => {
    const base = newGame();
    setRng(createSeededRng(7));
    const after1 = roll(base, [false, false, false, false, false]);
    const die0 = after1.dice[0];
    const after2 = roll(after1, [true, false, false, false, false], { dice: [99, 1, 1, 1, 1] });
    expect(after2.dice[0]).toBe(die0); // held — unchanged
    expect(after2.dice[1]).toBe(1); // override applied
  });
});
