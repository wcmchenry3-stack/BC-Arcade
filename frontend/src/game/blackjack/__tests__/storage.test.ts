import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import { saveGame, loadGame, clearGame, saveRun, loadRuns, RunRecord } from "../storage";
import { newGame, EngineState } from "../engine";

const STORAGE_KEY = "blackjack_game_v2";

describe("blackjack storage", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    (Sentry.captureException as jest.Mock).mockClear();
    (Sentry.captureMessage as jest.Mock).mockClear();
  });

  it("saves and loads a game", async () => {
    const g = newGame();
    await saveGame(g);
    const loaded = await loadGame();
    expect(loaded).toEqual(g);
  });

  it("returns null when no saved game exists", async () => {
    expect(await loadGame()).toBeNull();
  });

  it("returns null when saved data is corrupted", async () => {
    // NB: previous revision of this test wrote to "blackjack_game_v1",
    // which no longer exists as a key — so the test was passing because
    // loadGame saw an empty slot, not because it survived a parse error.
    // #510 exposed that: the actual key is v2.
    await AsyncStorage.setItem(STORAGE_KEY, "not-valid-json{{{");
    expect(await loadGame()).toBeNull();
  });

  it("returns null when saved data has different shape", async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ foo: "bar" }));
    expect(await loadGame()).toBeNull();
  });

  // #510: corrupt payload should be reported at WARNING level and the
  // corrupt entry should be cleared so it doesn't re-fire every launch.
  it("reports corrupt payload as warning (not exception) and clears the entry", async () => {
    await AsyncStorage.setItem(STORAGE_KEY, "not-valid-json{{{");
    expect(await loadGame()).toBeNull();
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("corrupt game payload"),
      expect.objectContaining({
        level: "warning",
        tags: expect.objectContaining({ subsystem: "blackjack.storage", op: "load" }),
      })
    );
    // Subsequent load sees a clean slot — the corrupt entry was removed.
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  // #1094: rawPayload must be included in the Sentry extra so engineers can
  // see what the malformed JSON looked like without unfiltering PII fields.
  it("includes rawPayload in Sentry extra for corrupt payload (#1094)", async () => {
    const corrupt = "truncated{json";
    await AsyncStorage.setItem(STORAGE_KEY, corrupt);
    await loadGame();
    const call = (Sentry.captureMessage as jest.Mock).mock.calls[0];
    expect(call[1].extra.rawPayload).toBe(corrupt);
  });

  it("clearGame removes the saved state", async () => {
    await saveGame(newGame());
    await clearGame();
    expect(await loadGame()).toBeNull();
  });

  it("persists lastWin across save/load", async () => {
    const g = newGame();
    const withLastWin: EngineState = { ...g, lastWin: 150 };
    await saveGame(withLastWin);
    const loaded = await loadGame();
    expect(loaded?.lastWin).toBe(150);
  });

  it("backfills lastWin as null for saves that predate the HUD feature", async () => {
    const g = newGame();
    // Simulate an old save without lastWin by serializing then deleting the key
    const serialized = JSON.parse(JSON.stringify(g)) as Record<string, unknown>;
    delete serialized["lastWin"];
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(serialized));
    const loaded = await loadGame();
    expect(loaded?.lastWin).toBeNull();
  });

  it("backfills run-mode fields for saves that predate run mode", async () => {
    const g = newGame();
    const serialized = JSON.parse(JSON.stringify(g)) as Record<string, unknown>;
    delete serialized["runGoal"];
    delete serialized["startingChips"];
    delete serialized["betMin"];
    delete serialized["betMax"];
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(serialized));
    const loaded = await loadGame();
    expect(loaded?.runGoal).toBeNull();
    expect(loaded?.startingChips).toBe(1000);
    expect(loaded?.betMin).toBe(5);
    expect(loaded?.betMax).toBe(500);
  });
});

const makeRun = (overrides: Partial<RunRecord> = {}): RunRecord => ({
  table: "beginner",
  startingChips: 1000,
  finalChips: 800,
  runGoal: null,
  completed: false,
  handsPlayed: 10,
  biggestWin: 50,
  lowestChips: 750,
  startedAt: 1000000,
  endedAt: 1001000,
  ...overrides,
});

describe("blackjack run history", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    (Sentry.captureException as jest.Mock).mockClear();
    (Sentry.captureMessage as jest.Mock).mockClear();
  });

  it("returns empty array when no runs saved", async () => {
    expect(await loadRuns()).toEqual([]);
  });

  it("saves and loads a single run", async () => {
    const run = makeRun();
    await saveRun(run);
    const runs = await loadRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual(run);
  });

  it("appends runs in order", async () => {
    await saveRun(makeRun({ startedAt: 1 }));
    await saveRun(makeRun({ startedAt: 2 }));
    await saveRun(makeRun({ startedAt: 3 }));
    const runs = await loadRuns();
    expect(runs).toHaveLength(3);
    expect(runs.map((r) => r.startedAt)).toEqual([1, 2, 3]);
  });

  it("caps history at 50 runs, dropping oldest", async () => {
    for (let i = 0; i < 55; i++) {
      await saveRun(makeRun({ startedAt: i }));
    }
    const runs = await loadRuns();
    expect(runs).toHaveLength(50);
    expect(runs[0].startedAt).toBe(5);
    expect(runs[49].startedAt).toBe(54);
  });

  it("persists completed flag correctly", async () => {
    await saveRun(makeRun({ completed: true, runGoal: 2000, finalChips: 2000 }));
    const runs = await loadRuns();
    expect(runs[0].completed).toBe(true);
    expect(runs[0].runGoal).toBe(2000);
  });

  it("returns empty array on corrupt storage and clears the key", async () => {
    await AsyncStorage.setItem("blackjack_runs_v1", "not-valid-json{{{");
    const runs = await loadRuns();
    expect(runs).toEqual([]);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("corrupt runs payload"),
      expect.objectContaining({ level: "warning" })
    );
    expect(await AsyncStorage.getItem("blackjack_runs_v1")).toBeNull();
  });

  it("returns empty array when stored value is not an array, logs warning, and clears the key", async () => {
    await AsyncStorage.setItem("blackjack_runs_v1", JSON.stringify({ foo: "bar" }));
    const runs = await loadRuns();
    expect(runs).toEqual([]);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("not an array"),
      expect.objectContaining({ level: "warning" })
    );
    expect(await AsyncStorage.getItem("blackjack_runs_v1")).toBeNull();
  });
});
