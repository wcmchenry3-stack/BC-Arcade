/**
 * 2048 motion (#3689): every animation stays under its story ceiling, so the game never feels
 * slow, and the sounds (#3690) can be timed to the same numbers.
 */
import {
  GAME_OVER_BEAT_MS,
  GAME_OVER_DIM_AT_MS,
  GAME_OVER_DIM_MS,
  GAME_OVER_DIM_OPACITY,
  GAME_OVER_SHAKE_MS,
  GAME_OVER_SHAKE_PX,
  MERGE_POP_DOWN_MS,
  MERGE_POP_MS,
  MERGE_POP_SCALE,
  MERGE_POP_UP_MS,
  MOVE_LOCK_MS,
  MOVE_QUEUE_DEPTH,
  SCORE_FLOAT_MS,
  SLIDE_MS,
  SPAWN_AT_MS,
  SPAWN_DOWN_MS,
  SPAWN_FROM_SCALE,
  SPAWN_MS,
  SPAWN_UP_MS,
  WIN_BEAT_MS,
  WIN_GLOW_MS,
  WIN_POP_DOWN_MS,
  WIN_POP_SCALE,
  WIN_POP_UP_MS,
} from "../motion";

// The story's ceilings (#3689), kept here rather than exported from the module.
const CEILING = {
  slide: 120,
  pop: 200,
  spawn: 250,
  moveLock: 150,
  scoreFloat: 600,
  winBeat: 1200,
  gameOverBeat: 800,
};

describe("2048 motion", () => {
  it("a slide is quick, and the board is locked only a little longer than it", () => {
    expect(SLIDE_MS).toBeLessThanOrEqual(CEILING.slide);
    expect(MOVE_LOCK_MS).toBeGreaterThanOrEqual(SLIDE_MS);
    expect(MOVE_LOCK_MS).toBeLessThanOrEqual(CEILING.moveLock);
  });

  it("two quick swipes are queued during a slide", () => {
    expect(MOVE_QUEUE_DEPTH).toBe(2);
  });

  it("the merged tile appears as the sources meet (at the slide's end), and its pop stays under the ceiling", () => {
    expect(MERGE_POP_MS).toBe(MERGE_POP_UP_MS + MERGE_POP_DOWN_MS);
    expect(MERGE_POP_MS).toBeLessThanOrEqual(CEILING.pop);
    expect(MERGE_POP_SCALE).toBeGreaterThan(1);
    expect(MERGE_POP_SCALE).toBeLessThanOrEqual(1.2);
  });

  it("a spawn starts while the slide is finishing, is visible as it starts, and stays short", () => {
    expect(SPAWN_AT_MS).toBeLessThan(SLIDE_MS);
    expect(SPAWN_FROM_SCALE).toBeGreaterThanOrEqual(0.3);
    expect(SPAWN_FROM_SCALE).toBeLessThan(1);
    expect(SPAWN_MS).toBe(SPAWN_AT_MS + SPAWN_UP_MS + SPAWN_DOWN_MS);
    expect(SPAWN_MS).toBeLessThanOrEqual(CEILING.spawn);
  });

  it("the score float is the 600 ms it was", () => {
    expect(SCORE_FLOAT_MS).toBeLessThanOrEqual(CEILING.scoreFloat);
  });

  it("the win beat lasts about a second, and the 2048 tile's pop and glow fit inside it", () => {
    expect(WIN_BEAT_MS).toBeLessThanOrEqual(CEILING.winBeat);
    expect(WIN_BEAT_MS).toBeGreaterThanOrEqual(900);
    expect(WIN_POP_SCALE).toBeGreaterThan(MERGE_POP_SCALE);
    expect(SLIDE_MS + WIN_POP_UP_MS + WIN_POP_DOWN_MS).toBeLessThan(WIN_BEAT_MS);
    expect(SLIDE_MS + WIN_GLOW_MS).toBeLessThan(WIN_BEAT_MS);
  });

  it("the game-over beat lasts about 0.6 s, and the dim and shake finish inside it", () => {
    expect(GAME_OVER_BEAT_MS).toBeLessThanOrEqual(CEILING.gameOverBeat);
    expect(GAME_OVER_BEAT_MS).toBeGreaterThanOrEqual(500);
    // The last tile has settled before the board dims.
    expect(GAME_OVER_DIM_AT_MS).toBeGreaterThanOrEqual(SPAWN_MS);
    expect(GAME_OVER_DIM_AT_MS + GAME_OVER_DIM_MS).toBeLessThanOrEqual(GAME_OVER_BEAT_MS);
    expect(GAME_OVER_DIM_AT_MS + GAME_OVER_SHAKE_MS).toBeLessThanOrEqual(GAME_OVER_BEAT_MS);
    // A small shake and a dim that still shows the board.
    expect(GAME_OVER_SHAKE_PX).toBeLessThanOrEqual(8);
    expect(GAME_OVER_DIM_OPACITY).toBeGreaterThan(0);
    expect(GAME_OVER_DIM_OPACITY).toBeLessThanOrEqual(0.6);
  });

  it("the win beat is longer than the game-over beat", () => {
    expect(WIN_BEAT_MS).toBeGreaterThan(GAME_OVER_BEAT_MS);
  });
});
