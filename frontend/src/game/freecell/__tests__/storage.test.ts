import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

import { clearGame, loadGame, saveGame, loadStats, saveStats } from "../storage";
import { dealGame } from "../engine";
import type { FreeCellState } from "../types";

const GAME_KEY = "freecell_game";

function seedState(): FreeCellState {
  return dealGame();
}

describe("freecell storage", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    (Sentry.captureException as jest.Mock).mockClear();
    (Sentry.captureMessage as jest.Mock).mockClear();
  });

  it("round-trips a fresh deal via save → load", async () => {
    const s = seedState();
    await saveGame(s);
    const loaded = await loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.tableau.length).toBe(8);
    expect(loaded!.freeCells.length).toBe(4);
    expect(loaded!.isComplete).toBe(false);
  });

  it("returns null when no save exists", async () => {
    expect(await loadGame()).toBeNull();
  });

  it("strips nested undoStack snapshots at save time so storage cannot balloon", async () => {
    const s = seedState();
    const nested: FreeCellState = {
      ...s,
      undoStack: [{ ...s, undoStack: [{ ...s, undoStack: [] }] }],
    };
    await saveGame(nested);
    const raw = await AsyncStorage.getItem(GAME_KEY);
    const parsed = JSON.parse(raw!);
    for (const snap of parsed.undoStack) {
      expect(snap.undoStack).toEqual([]);
    }
  });

  it("returns null and captures a warning on a corrupt JSON payload", async () => {
    await AsyncStorage.setItem(GAME_KEY, "not-json{{");
    expect(await loadGame()).toBeNull();
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("corrupt game payload"),
      expect.objectContaining({
        level: "warning",
        tags: expect.objectContaining({ subsystem: "freecell.storage", op: "load" }),
      })
    );
    // Corrupt entry is removed so subsequent loads don't keep warning.
    expect(await AsyncStorage.getItem(GAME_KEY)).toBeNull();
  });

  it("returns null when the payload has a different shape (missing fields)", async () => {
    await AsyncStorage.setItem(GAME_KEY, JSON.stringify({ foo: "bar" }));
    expect(await loadGame()).toBeNull();
    // Malformed entry is also removed so the next mount starts clean.
    expect(await AsyncStorage.getItem(GAME_KEY)).toBeNull();
  });

  it("returns null on a schema version mismatch (_v !== 1)", async () => {
    const future = { ...seedState(), _v: 2 };
    await AsyncStorage.setItem(GAME_KEY, JSON.stringify(future));
    expect(await loadGame()).toBeNull();
  });

  it("clearGame removes the saved state", async () => {
    await saveGame(seedState());
    await clearGame();
    expect(await loadGame()).toBeNull();
  });
});

describe("freecell stats storage", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    (Sentry.captureException as jest.Mock).mockClear();
  });

  it("returns zero defaults when no stats saved", async () => {
    const stats = await loadStats();
    expect(stats).toEqual({ bestMoves: 0, gamesPlayed: 0, gamesWon: 0 });
  });

  it("saves and loads stats round-trip", async () => {
    await saveStats({ bestMoves: 42, gamesPlayed: 7, gamesWon: 3 });
    const loaded = await loadStats();
    expect(loaded).toEqual({ bestMoves: 42, gamesPlayed: 7, gamesWon: 3 });
  });

  it("returns zero defaults on corrupt stats payload", async () => {
    await AsyncStorage.setItem("freecell_stats_v1", "not-json{");
    const stats = await loadStats();
    expect(stats).toEqual({ bestMoves: 0, gamesPlayed: 0, gamesWon: 0 });
  });

  it("coerces missing numeric fields to 0 on partial payload", async () => {
    await AsyncStorage.setItem("freecell_stats_v1", JSON.stringify({ gamesPlayed: 5 }));
    const stats = await loadStats();
    expect(stats).toEqual({ bestMoves: 0, gamesPlayed: 5, gamesWon: 0 });
  });
});
