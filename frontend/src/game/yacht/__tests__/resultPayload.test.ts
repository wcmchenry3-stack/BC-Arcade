/**
 * The Yacht result payload (#2839): the category scorecard and bonus
 * components reconcile to `final_score`, Joker bonuses counted once.
 */

import { newGame, roll, score, possibleScores, Category, CATEGORIES } from "../engine";
import { buildEndedPayload, scorecardPayload } from "../resultPayload";
import type { GameState } from "../types";

type Dice = number[];

function play(state: GameState, dice: Dice, category?: Category): GameState {
  const rolled = roll(state, [false, false, false, false, false], { dice });
  const cat = category ?? (Object.keys(possibleScores(rolled))[0] as Category);
  return score(rolled, cat);
}

/** Plays `turns` (dice, optional category), then fills the rest with 1-2-3-4-6 rolls. */
function playGame(turns: [Dice, Category?][], fillOnly = false): GameState {
  let s = newGame();
  for (const [dice, cat] of turns) s = play(s, dice, cat);
  while (!fillOnly && !s.game_over) s = play(s, [1, 2, 3, 4, 6]);
  return s;
}

const vsOutcome = (p: GameState, c: GameState) =>
  p.total_score > c.total_score ? "win" : p.total_score < c.total_score ? "loss" : "draw";
const recorded = (r: string) => (r === "draw" ? "push" : r === "win" ? "win" : "loss");

function sum(v: Record<string, number>): number {
  return Object.values(v).reduce((a, b) => a + b, 0);
}

const REGULAR = playGame([]);
// Yacht 50 first, then a sixes Joker (must go in the matching upper), then a
// second Joker with sixes filled: a lower category at its Joker price.
const JOKER = playGame([
  [[6, 6, 6, 6, 6], "yacht"],
  [[6, 6, 6, 6, 6], "sixes"],
  [[3, 3, 3, 3, 3], "threes"],
  [[4, 4, 4, 4, 4], "fours"],
  [[5, 5, 5, 5, 5], "fives"],
  [[2, 2, 2, 2, 2], "twos"],
  [[1, 1, 1, 1, 1], "ones"],
  [[6, 6, 6, 6, 6], "full_house"],
]);

describe("scorecardPayload", () => {
  it("omits unfilled categories and carries the bonus components", () => {
    const s = play(newGame(), [1, 1, 1, 2, 3], "ones");
    expect(scorecardPayload(s)).toEqual({
      categories: { ones: 3 },
      upper_bonus: 0,
      yacht_bonus_count: 0,
      yacht_bonus_total: 0,
    });
  });

  it("uses only the 13 Yacht category keys", () => {
    for (const k of Object.keys(scorecardPayload(REGULAR).categories)) {
      expect(CATEGORIES).toContain(k);
    }
  });
});

describe("buildEndedPayload", () => {
  it("regular game: categories + bonuses add up to final_score", () => {
    expect(REGULAR.game_over).toBe(true);
    const p = buildEndedPayload(REGULAR, "completed", null, vsOutcome, recorded);
    const card = p.scorecard as ReturnType<typeof scorecardPayload>;
    expect(Object.keys(card.categories)).toHaveLength(13);
    expect(sum(card.categories) + card.upper_bonus + card.yacht_bonus_total).toBe(p.final_score);
    expect(p).toMatchObject({ outcome: "completed", upper_bonus: card.upper_bonus });
    expect(p).not.toHaveProperty("opponent_scorecard");
  });

  it("joker game: the bonus is counted once, on top of the category scores", () => {
    expect(JOKER.yacht_bonus_count).toBeGreaterThan(0);
    const p = buildEndedPayload(JOKER, "completed", null, vsOutcome, recorded);
    const card = p.scorecard as ReturnType<typeof scorecardPayload>;
    expect(card.yacht_bonus_total).toBe(card.yacht_bonus_count * 100);
    expect(card.categories.sixes).toBe(30);
    expect(card.categories.full_house).toBe(25);
    expect(card.categories.yacht).toBe(50);
    expect(sum(card.categories) + card.upper_bonus + card.yacht_bonus_total).toBe(p.final_score);
  });

  it("abandoned game: partial card, no opponent", () => {
    const partial = playGame([[[2, 2, 2, 4, 5], "twos"]], true);
    const p = buildEndedPayload(partial, "abandoned", REGULAR, vsOutcome, recorded);
    expect(p.outcome).toBe("abandoned");
    expect(p).not.toHaveProperty("opponent_scorecard");
    expect((p.scorecard as ReturnType<typeof scorecardPayload>).categories).toEqual({ twos: 6 });
  });

  it("vs game: both cards, the outcome recorded from the totals", () => {
    const p = buildEndedPayload(JOKER, "completed", REGULAR, vsOutcome, recorded);
    const opp = p.opponent_scorecard as ReturnType<typeof scorecardPayload>;
    expect(sum(opp.categories) + opp.upper_bonus + opp.yacht_bonus_total).toBe(p.opponent_score);
    expect(p.vs_result).toBe(vsOutcome(JOKER, REGULAR));
    expect(p.outcome).toBe(recorded(p.vs_result as string));
    expect(p.final_score).toBe(JOKER.total_score);
  });

  it("vs game with the computer still playing sends no opponent", () => {
    const cpu = { ...REGULAR, game_over: false };
    const p = buildEndedPayload(JOKER, "completed", cpu, vsOutcome, recorded);
    expect(p).not.toHaveProperty("opponent_score");
    expect(p).not.toHaveProperty("opponent_scorecard");
    expect(p.outcome).toBe("completed");
  });

  it("is JSON-serialisable and far below the 8 KiB result cap", () => {
    const p = buildEndedPayload(JOKER, "completed", REGULAR, vsOutcome, recorded);
    expect(JSON.stringify(p).length).toBeLessThan(1500);
  });
});
