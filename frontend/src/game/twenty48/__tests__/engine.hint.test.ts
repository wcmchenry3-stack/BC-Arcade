/**
 * #3688: the hint's swipe, chosen by the engine — the legal move that merges the most tiles, then
 * the one that scores the most, then the first legal in left, up, right, down; null when stuck.
 */
import { newGame, move, suggestMove, setRng, createSeededRng } from "../engine";
import type { Direction } from "../engine";

describe("suggestMove", () => {
  it("picks the move that merges the most tiles, even past an earlier legal one", () => {
    // Left merges one pair (the 8s); up merges two (column 0's 2s and column 3's 4s).
    const board = [
      [2, 0, 0, 4],
      [2, 0, 0, 4],
      [0, 8, 8, 0],
      [0, 0, 0, 0],
    ];
    expect(suggestMove(board)).toBe("up");
  });

  it("takes the first of equal moves: left before up", () => {
    // Left merges the 2s, up merges the 2s: one merge and 4 points each.
    const board = [
      [2, 2, 0, 0],
      [2, 4, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    expect(suggestMove(board)).toBe("left");
  });

  it("breaks a tie on merges by the points scored", () => {
    const board = [
      [16, 16, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [2, 0, 0, 0],
    ];
    // Left and right both merge the 16s (1 merge, 32 points); up has no merge: order picks left.
    expect(suggestMove(board)).toBe("left");
    const board2 = [
      [4, 4, 0, 0],
      [0, 0, 0, 0],
      [8, 0, 0, 0],
      [8, 0, 0, 0],
    ];
    // Left merges the 4s (1 merge, 8 points); up merges the 8s (1 merge, 16 points): the higher
    // score wins, though left comes first.
    expect(suggestMove(board2)).toBe("up");
  });

  it("with no merge, takes the first legal move in left, up, right, down", () => {
    const board = [
      [0, 0, 0, 2],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 4],
    ];
    expect(suggestMove(board)).toBe("left");
    // Pushed against the left edge, only right (the opposite) and the vertical slides are legal.
    const leftEdge = [
      [2, 0, 0, 0],
      [4, 0, 0, 0],
      [8, 0, 0, 0],
      [16, 0, 0, 0],
    ];
    expect(suggestMove(leftEdge)).toBe("right");
    // Packed into the top-left corner, right comes before down.
    const corner = [
      [2, 4, 0, 0],
      [8, 16, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    expect(suggestMove(corner)).toBe("right");
  });

  it("skips a direction that changes nothing", () => {
    // Everything is up against the top edge, with no merge available: up is not legal.
    const board = [
      [2, 4, 8, 16],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    expect(suggestMove(board)).toBe("down");
  });

  it("returns null on a stuck board", () => {
    const stuck = [
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 4, 2],
    ];
    expect(suggestMove(stuck)).toBeNull();
  });

  it("returns null on an empty board (nothing moves)", () => {
    expect(suggestMove(Array.from({ length: 4 }, () => Array(4).fill(0)))).toBeNull();
  });

  it("always suggests a move that changes the board, and never changes the game", () => {
    setRng(createSeededRng(42));
    let state = newGame();
    for (let i = 0; i < 200 && !state.game_over; i++) {
      const before = JSON.stringify(state);
      const direction = suggestMove(state.board);
      expect(JSON.stringify(state)).toBe(before);
      // A non-over game always has a legal move, and the suggestion is one (move() throws on a
      // move with no effect).
      expect(direction).not.toBeNull();
      state = move(state, direction as Direction);
    }
  });
});
