import { BOARDS, GAME_TYPES, type BoardDefinition, type GameType } from "../vocab";

// Type-level: BOARDS must be keyed by exactly the GameType union (#2617).
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const boardsKeyedByGameType: Exact<keyof typeof BOARDS, GameType> = true;

describe("BOARDS (generated from backend GameModule.board)", () => {
  it("is keyed by GameType", () => {
    expect(boardsKeyedByGameType).toBe(true);
  });

  it("has an entry for every GAME_TYPES member and nothing else", () => {
    expect(Object.keys(BOARDS).sort()).toEqual([...GAME_TYPES].sort());
  });

  it.each(GAME_TYPES)("%s has a well-formed board or null", (gameType) => {
    const board: BoardDefinition | null = BOARDS[gameType];
    if (board === null) return;
    expect(board.metric).not.toHaveLength(0);
    expect(["asc", "desc"]).toContain(board.direction);
    expect(board.labelKey).not.toHaveLength(0);
    expect(Array.isArray(board.partitions)).toBe(true);
    expect(typeof board.enabled).toBe("boolean");
  });
});
