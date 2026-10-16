/**
 * The replay counters in the Sudoku save (#3288): `entryCount` and `replayRows`
 * round-trip, and a value that is not a non-negative integer is dropped on load.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { loadPuzzle } from "../engine";
import { loadGame, saveGame } from "../storage";

const GAME_KEY = "sudoku_game";

const base = () => loadPuzzle("easy", "classic", () => 0);

async function loadWith(patch: Record<string, unknown>) {
  await saveGame(base());
  const raw = JSON.parse((await AsyncStorage.getItem(GAME_KEY))!) as Record<string, unknown>;
  await AsyncStorage.setItem(GAME_KEY, JSON.stringify({ ...raw, ...patch }));
  return loadGame();
}

describe("replay counters in the save", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("round-trips entryCount and replayRows", async () => {
    await saveGame({ ...base(), entryCount: 123, replayRows: 7 });
    const loaded = await loadGame();
    expect(loaded?.entryCount).toBe(123);
    expect(loaded?.replayRows).toBe(7);
  });

  it("round-trips zero", async () => {
    await saveGame({ ...base(), entryCount: 0, replayRows: 0 });
    const loaded = await loadGame();
    expect(loaded?.entryCount).toBe(0);
    expect(loaded?.replayRows).toBe(0);
  });

  it("a save without them loads without them, and writes no keys for them", async () => {
    await saveGame(base());
    const raw = JSON.parse((await AsyncStorage.getItem(GAME_KEY))!) as Record<string, unknown>;
    expect(raw).not.toHaveProperty("entryCount");
    expect(raw).not.toHaveProperty("replayRows");
    const loaded = await loadGame();
    expect(loaded?.entryCount).toBeUndefined();
    expect(loaded?.replayRows).toBeUndefined();
  });

  it("a game that records nothing saves no counters even if the state had them", async () => {
    await saveGame({ ...base(), entryCount: undefined, replayRows: undefined });
    const raw = JSON.parse((await AsyncStorage.getItem(GAME_KEY))!) as Record<string, unknown>;
    expect(Object.keys(raw)).not.toContain("entryCount");
  });

  it.each([
    ["a float", 1.5],
    ["a negative", -1],
    ["a string", "5"],
    ["null", null],
    ["a boolean", true],
    ["beyond safe integers", 2 ** 60],
  ])("drops %s", async (_name, bad) => {
    const loaded = await loadWith({ entryCount: bad, replayRows: bad });
    expect(loaded).not.toBeNull(); // the save itself still loads
    expect(loaded?.entryCount).toBeUndefined();
    expect(loaded?.replayRows).toBeUndefined();
  });

  it("drops the bad one and keeps the good one", async () => {
    const loaded = await loadWith({ entryCount: 9, replayRows: -3 });
    expect(loaded?.entryCount).toBe(9);
    expect(loaded?.replayRows).toBeUndefined();
  });
});
