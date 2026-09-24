import { newGame } from "../engine";
import type { GameState } from "../types";
import { isAiTurnPending } from "../vsTurn";

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
