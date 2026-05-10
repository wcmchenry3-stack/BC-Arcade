import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import {
  Unlock,
  INITIAL_UNLOCKS,
  evaluateUnlocks,
  loadUnlocks,
  saveUnlocks,
  mergeUnlocks,
} from "../unlocks";
import { RunRecord } from "../storage";

const UNLOCKS_KEY = "blackjack_unlocks_v1";

const makeRun = (overrides: Partial<RunRecord> = {}): RunRecord => ({
  table: "beginner",
  startingChips: 100,
  finalChips: 250,
  runGoal: 250,
  completed: true,
  handsPlayed: 20,
  biggestWin: 50,
  lowestChips: 80,
  startedAt: 1000000,
  endedAt: 1002000,
  ...overrides,
});

describe("evaluateUnlocks", () => {
  it("returns empty array when no runs are provided", () => {
    const existing = INITIAL_UNLOCKS.map((u) => ({ ...u }));
    expect(evaluateUnlocks([], existing)).toEqual([]);
  });

  it("returns empty array when all unlocks are already unlocked", () => {
    const existing: Unlock[] = INITIAL_UNLOCKS.map((u) => ({
      ...u,
      unlocked: true,
      unlockedAt: "2026-01-01T00:00:00.000Z",
    }));
    const runs = [makeRun({ table: "beginner", completed: true })];
    expect(evaluateUnlocks(runs, existing)).toEqual([]);
  });

  it("triggers beginner table theme on a completed beginner run", () => {
    const existing = INITIAL_UNLOCKS.map((u) => ({ ...u }));
    const runs = [makeRun({ table: "beginner", completed: true })];
    const triggered = evaluateUnlocks(runs, existing);
    expect(triggered).toHaveLength(1);
    expect(triggered[0]!.id).toBe("beginner_table_theme");
    expect(triggered[0]!.unlocked).toBe(true);
    expect(triggered[0]!.unlockedAt).toBeDefined();
  });

  it("does not trigger unlock for an incomplete beginner run", () => {
    const existing = INITIAL_UNLOCKS.map((u) => ({ ...u }));
    const runs = [makeRun({ table: "beginner", completed: false })];
    expect(evaluateUnlocks(runs, existing)).toHaveLength(0);
  });

  it("triggers intermediate card back on a completed intermediate run", () => {
    const existing = INITIAL_UNLOCKS.map((u) => ({ ...u }));
    const runs = [makeRun({ table: "intermediate", completed: true })];
    const triggered = evaluateUnlocks(runs, existing);
    expect(triggered).toHaveLength(1);
    expect(triggered[0]!.id).toBe("intermediate_card_back");
  });

  it("triggers high roller chip style on a completed high_roller run", () => {
    const existing = INITIAL_UNLOCKS.map((u) => ({ ...u }));
    const runs = [makeRun({ table: "high_roller", completed: true })];
    const triggered = evaluateUnlocks(runs, existing);
    expect(triggered).toHaveLength(1);
    expect(triggered[0]!.id).toBe("high_roller_chip_style");
  });

  it("triggers multiple unlocks when multiple conditions are met", () => {
    const existing = INITIAL_UNLOCKS.map((u) => ({ ...u }));
    const runs = [
      makeRun({ table: "beginner", completed: true }),
      makeRun({ table: "intermediate", completed: true }),
    ];
    const triggered = evaluateUnlocks(runs, existing);
    expect(triggered).toHaveLength(2);
    const ids = triggered.map((u) => u.id);
    expect(ids).toContain("beginner_table_theme");
    expect(ids).toContain("intermediate_card_back");
  });

  it("does not re-trigger an already unlocked item", () => {
    const existing: Unlock[] = INITIAL_UNLOCKS.map((u) => ({
      ...u,
      unlocked: u.id === "beginner_table_theme",
      unlockedAt: u.id === "beginner_table_theme" ? "2026-01-01T00:00:00.000Z" : undefined,
    }));
    const runs = [makeRun({ table: "beginner", completed: true })];
    const triggered = evaluateUnlocks(runs, existing);
    expect(triggered.find((u) => u.id === "beginner_table_theme")).toBeUndefined();
  });

  it("triggers run_count unlock when run count meets threshold", () => {
    const existing: Unlock[] = [
      {
        id: "veteran",
        name: "Veteran",
        type: "table_theme",
        conditionType: "run_count",
        conditionValue: 3,
        unlocked: false,
      },
    ];
    const runs = [makeRun(), makeRun(), makeRun()];
    const triggered = evaluateUnlocks(runs, existing);
    expect(triggered).toHaveLength(1);
    expect(triggered[0]!.id).toBe("veteran");
  });

  it("does not trigger run_count unlock below threshold", () => {
    const existing: Unlock[] = [
      {
        id: "veteran",
        name: "Veteran",
        type: "table_theme",
        conditionType: "run_count",
        conditionValue: 5,
        unlocked: false,
      },
    ];
    const runs = [makeRun(), makeRun()];
    expect(evaluateUnlocks(runs, existing)).toHaveLength(0);
  });

  it("triggers comeback unlock when a run recovered from very low chips", () => {
    const existing: Unlock[] = [
      {
        id: "comeback_kid",
        name: "Comeback Kid",
        type: "chip_style",
        conditionType: "comeback",
        conditionValue: null,
        unlocked: false,
      },
    ];
    // lowestChips = 20, startingChips = 100 → 20% which is ≤ 25%
    const runs = [makeRun({ lowestChips: 20, startingChips: 100, completed: true })];
    const triggered = evaluateUnlocks(runs, existing);
    expect(triggered).toHaveLength(1);
    expect(triggered[0]!.id).toBe("comeback_kid");
  });

  it("does not trigger comeback when lowest chips is above 25% threshold", () => {
    const existing: Unlock[] = [
      {
        id: "comeback_kid",
        name: "Comeback Kid",
        type: "chip_style",
        conditionType: "comeback",
        conditionValue: null,
        unlocked: false,
      },
    ];
    // lowestChips = 30, startingChips = 100 → 30% which is > 25%
    const runs = [makeRun({ lowestChips: 30, startingChips: 100, completed: true })];
    expect(evaluateUnlocks(runs, existing)).toHaveLength(0);
  });

  it("sets unlockedAt to a valid ISO date string", () => {
    const existing = INITIAL_UNLOCKS.map((u) => ({ ...u }));
    const runs = [makeRun({ table: "beginner", completed: true })];
    const triggered = evaluateUnlocks(runs, existing);
    expect(triggered[0]!.unlockedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

describe("mergeUnlocks", () => {
  it("returns the original array unchanged when no triggered unlocks", () => {
    const existing = INITIAL_UNLOCKS.map((u) => ({ ...u }));
    expect(mergeUnlocks(existing, [])).toBe(existing);
  });

  it("replaces the triggered item with its unlocked version", () => {
    const existing = INITIAL_UNLOCKS.map((u) => ({ ...u }));
    const triggered: Unlock[] = [
      { ...existing[0]!, unlocked: true, unlockedAt: "2026-01-01T00:00:00.000Z" },
    ];
    const merged = mergeUnlocks(existing, triggered);
    expect(merged[0]!.unlocked).toBe(true);
    expect(merged[0]!.unlockedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(merged[1]!.unlocked).toBe(false);
    expect(merged[2]!.unlocked).toBe(false);
  });

  it("preserves original array length", () => {
    const existing = INITIAL_UNLOCKS.map((u) => ({ ...u }));
    const triggered: Unlock[] = [
      { ...existing[1]!, unlocked: true, unlockedAt: "2026-01-01T00:00:00.000Z" },
    ];
    expect(mergeUnlocks(existing, triggered)).toHaveLength(INITIAL_UNLOCKS.length);
  });
});

describe("loadUnlocks / saveUnlocks", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    (Sentry.captureException as jest.Mock).mockClear();
    (Sentry.captureMessage as jest.Mock).mockClear();
  });

  it("returns a copy of INITIAL_UNLOCKS when nothing is stored", async () => {
    const result = await loadUnlocks();
    expect(result).toHaveLength(INITIAL_UNLOCKS.length);
    expect(result[0]!.unlocked).toBe(false);
  });

  it("saves and loads unlocks correctly", async () => {
    const unlocks = INITIAL_UNLOCKS.map((u) => ({ ...u }));
    unlocks[0]!.unlocked = true;
    unlocks[0]!.unlockedAt = "2026-01-01T00:00:00.000Z";
    await saveUnlocks(unlocks);
    const loaded = await loadUnlocks();
    expect(loaded[0]!.unlocked).toBe(true);
    expect(loaded[0]!.unlockedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(loaded[1]!.unlocked).toBe(false);
  });

  it("returns INITIAL_UNLOCKS and logs warning on corrupt storage", async () => {
    await AsyncStorage.setItem(UNLOCKS_KEY, "not-valid-json{{{");
    const result = await loadUnlocks();
    expect(result).toHaveLength(INITIAL_UNLOCKS.length);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("corrupt payload"),
      expect.objectContaining({ level: "warning" })
    );
    expect(await AsyncStorage.getItem(UNLOCKS_KEY)).toBeNull();
  });

  it("returns INITIAL_UNLOCKS and logs warning when stored value is not an array", async () => {
    await AsyncStorage.setItem(UNLOCKS_KEY, JSON.stringify({ foo: "bar" }));
    const result = await loadUnlocks();
    expect(result).toHaveLength(INITIAL_UNLOCKS.length);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("not an array"),
      expect.objectContaining({ level: "warning" })
    );
    expect(await AsyncStorage.getItem(UNLOCKS_KEY)).toBeNull();
  });

  it("saveUnlocks swallows the error and reports to Sentry on write failure", async () => {
    jest.spyOn(AsyncStorage, "setItem").mockRejectedValueOnce(new Error("storage full"));
    await saveUnlocks(INITIAL_UNLOCKS.map((u) => ({ ...u })));
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: expect.objectContaining({ op: "saveUnlocks" }) })
    );
  });
});
