import { BOARDS, GAME_OUTCOMES, GAME_TYPES, type BoardDefinition, type GameType } from "../vocab";
import { DIFFICULTY_TIERS } from "../../game/starswarm/engine";

// Type-level: BOARDS must be keyed by exactly the GameType union (#2617).
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const boardsKeyedByGameType: Exact<keyof typeof BOARDS, GameType> = true;

const BOARD_FIELDS = [
  "metric",
  "direction",
  "tiebreak",
  "labelKey",
  "partitions",
  "partitionDefaults",
  "partitionValues",
  "maxValue",
  "partitionMaxValues",
  "qualifyingOutcomes",
  "enabled",
] as const satisfies readonly (keyof BoardDefinition)[];
// Type-level: the list above names every BoardDefinition field.
const boardFieldsComplete: Exact<(typeof BOARD_FIELDS)[number], keyof BoardDefinition> = true;

describe("BOARDS (generated from backend GameModule.board)", () => {
  it("is keyed by GameType", () => {
    expect(boardsKeyedByGameType).toBe(true);
    expect(boardFieldsComplete).toBe(true);
  });

  it("has an entry for every GAME_TYPES member and nothing else", () => {
    expect(Object.keys(BOARDS).sort()).toEqual([...GAME_TYPES].sort());
  });

  it.each(GAME_TYPES)("%s has a well-formed board or null", (gameType) => {
    const board: BoardDefinition | null = BOARDS[gameType];
    if (board === null) return;
    expect(Object.keys(board).sort()).toEqual([...BOARD_FIELDS].sort());
    expect(board.metric).not.toHaveLength(0);
    expect(["asc", "desc"]).toContain(board.direction);
    if (board.tiebreak !== null) {
      expect(board.tiebreak[0]).not.toHaveLength(0);
      expect(["asc", "desc"]).toContain(board.tiebreak[1]);
    }
    expect(board.labelKey).not.toHaveLength(0);
    expect(Array.isArray(board.partitions)).toBe(true);
    for (const [key, value] of Object.entries(board.partitionDefaults)) {
      expect(board.partitions).toContain(key);
      if (key in board.partitionValues) expect(board.partitionValues[key]).toContain(value);
    }
    for (const [key, values] of Object.entries(board.partitionValues)) {
      expect(board.partitions).toContain(key);
      expect(values.length).toBeGreaterThan(0);
      expect(new Set(values).size).toBe(values.length);
    }
    if (board.maxValue !== null) expect(board.maxValue).toBeGreaterThanOrEqual(0);
    for (const [key, caps] of Object.entries(board.partitionMaxValues)) {
      expect(board.partitions).toContain(key);
      expect(board.maxValue).not.toBeNull();
      for (const cap of Object.values(caps)) {
        expect(cap).toBeGreaterThanOrEqual(0);
        expect(cap).toBeLessThanOrEqual(board.maxValue as number);
      }
    }
    if (board.qualifyingOutcomes !== null) {
      expect(board.qualifyingOutcomes.length).toBeGreaterThan(0);
      for (const outcome of board.qualifyingOutcomes) {
        expect(GAME_OUTCOMES).toContain(outcome);
        expect(outcome).not.toBe("abandoned");
      }
    }
    expect(typeof board.enabled).toBe("boolean");
  });

  it("carries Sudoku's legacy variant default and per-difficulty caps", () => {
    const sudoku = BOARDS.sudoku;
    expect(sudoku?.partitionDefaults).toEqual({ variant: "classic" });
    expect(sudoku?.partitionMaxValues).toEqual({
      difficulty: { easy: 100, medium: 200, hard: 300 },
    });
    expect(sudoku?.maxValue).toBe(300);
  });

  it("counts only won Daily Word games toward best", () => {
    expect(BOARDS.daily_word?.qualifyingOutcomes).toEqual(["win"]);
  });

  it("gives Sort no moves tie-break: levels are random per request (#2746)", () => {
    expect(BOARDS.sort?.tiebreak).toBeNull();
  });

  it("has a Star Swarm board for exactly the engine's tiers, LieutenantJG by default", () => {
    const starswarm = BOARDS.starswarm;
    expect(starswarm?.partitionValues).toEqual({ difficulty_tier: [...DIFFICULTY_TIERS] });
    expect(starswarm?.partitionDefaults).toEqual({ difficulty_tier: "LieutenantJG" });
  });
});
