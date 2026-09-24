import { createSeededRng, newGame, setRng } from "../engine";
import type { GameState } from "../types";
import { finishTurnFallback, isAiTurnPending } from "../vsTurn";

const at = (round: number, extra: Partial<GameState> = {}): GameState => ({
  ...newGame(),
  round,
  ...extra,
});

describe("isAiTurnPending (#2203)", () => {
  it("is false at the start of a round, before the human scores", () => {
    expect(isAiTurnPending(at(1), at(1))).toBe(false);
    expect(isAiTurnPending(at(5, { rolls_used: 2 }), at(5))).toBe(false);
  });

  it("is true once the human has scored the round", () => {
    expect(isAiTurnPending(at(2), at(1))).toBe(true);
  });

  it("is true for an AI turn interrupted part-way through", () => {
    for (const rolls_used of [1, 2, 3]) {
      expect(isAiTurnPending(at(7), at(6, { rolls_used }))).toBe(true);
    }
  });

  it("covers the AI's last turn after the human finishes", () => {
    expect(isAiTurnPending(at(13, { game_over: true }), at(13))).toBe(true);
  });

  it("is false once the AI's game is over", () => {
    expect(isAiTurnPending(at(13, { game_over: true }), at(13, { game_over: true }))).toBe(false);
  });
});

describe("finishTurnFallback (#2203)", () => {
  afterEach(() => setRng(Math.random));

  it("rolls if the turn hasn't started, then scores and advances the round", () => {
    setRng(createSeededRng(4));
    const next = finishTurnFallback(at(3));
    expect(next.round).toBe(4);
    expect(next.rolls_used).toBe(0);
    expect(Object.values(next.scores).filter((v) => v !== null)).toHaveLength(1);
  });

  it("scores the dice it already has in the best legal category", () => {
    const next = finishTurnFallback(at(1, { dice: [6, 6, 6, 6, 6], rolls_used: 3 }));
    expect(next.scores.yacht).toBe(50);
    expect(next.round).toBe(2);
  });

  it("finishes the computer's game on its last round", () => {
    const scores = Object.fromEntries(
      Object.keys(newGame().scores).map((c) => [c, c === "chance" ? null : 0])
    );
    const last = at(13, { dice: [1, 2, 3, 4, 6], rolls_used: 2, scores });
    const next = finishTurnFallback(last);
    expect(next.scores.chance).toBe(16);
    expect(next.game_over).toBe(true);
  });
});
