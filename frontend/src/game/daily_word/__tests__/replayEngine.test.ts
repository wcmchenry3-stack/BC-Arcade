/**
 * Daily Word's `rebuild` replays by `engine_version` (#3912): the current version
 * and a `game_started` without the field rebuild the board, an older version
 * registered with `withLegacy` (a test-only fake) rebuilds with its own rules, and
 * an unknown version rebuilds nothing and says why.
 */

import { REPLAY_ENGINES, rebuild, type RebuiltBoard, type RecordedEvent } from "../replay";

const PUZZLE = { puzzle_id: "2026-05-03:en", word_length: 5, language: "en" };
const GUESSES: RecordedEvent = {
  type: "guess_submitted",
  data: { g: ["crane", "slate"], t: ["apaaa", "ccccc"] },
};
const started = (data: Record<string, unknown>): RecordedEvent => ({
  type: "game_started",
  data: { puzzle_id: PUZZLE.puzzle_id, ...data },
});

describe("daily_word rebuild by engine_version (#3912)", () => {
  it.each([[{ engine_version: 1 }], [{}]])(
    "rebuilds the board for the current version or a missing field (%j)",
    (data) => {
      const board = rebuild([started(data), GUESSES], PUZZLE);
      expect(board.incompatible).toBeUndefined();
      expect(board.problems).toEqual([]);
      expect(board.state.current_row).toBe(2);
      expect(board.state.won).toBe(true);
    }
  );

  it("rebuilds an older, still-supported version with its frozen rules", () => {
    const frozen: RebuiltBoard = {
      state: rebuild([], PUZZLE).state,
      refusals: 0,
      problems: ["frozen rules ran"],
    };
    const engines = REPLAY_ENGINES.withLegacy(0, { rebuild: () => frozen });
    expect(rebuild([started({ engine_version: 0 }), GUESSES], PUZZLE, engines)).toBe(frozen);
    expect(rebuild([started({ engine_version: 1 }), GUESSES], PUZZLE, engines)).not.toBe(frozen);
  });

  it("rebuilds nothing for an unknown version and says why", () => {
    const reason = "incompatible engine: engine_version 99, this reader rebuilds 1";
    const board = rebuild([started({ engine_version: 99 }), GUESSES], PUZZLE);
    expect(board.incompatible).toBe(reason);
    expect(board.problems).toEqual([reason]);
    expect(board.state.current_row).toBe(0);
    expect(board.state.rows.every((row) => !row.submitted)).toBe(true);
    expect(board.state.won).toBe(false);
  });
});
