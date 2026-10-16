import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import {
  saveState,
  loadState,
  clearState,
  pruneStates,
  looksValid,
  saveTodayMeta,
  loadTodayMeta,
} from "../storage";
import { initialState } from "../engine";

const PUZZLE = "2026-05-03:en";
const STORAGE_KEY = `daily_word_board_${PUZZLE}`;
const LEGACY_KEY = "daily_word_state_v1";

describe("daily_word storage", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    (Sentry.captureException as jest.Mock).mockClear();
    (Sentry.captureMessage as jest.Mock).mockClear();
  });

  it("round-trip save/load", async () => {
    const s = initialState(PUZZLE, 5, "en");
    await saveState(s);
    const loaded = await loadState(PUZZLE);
    expect(loaded).toEqual(s);
  });

  it("returns null when no saved state exists", async () => {
    expect(await loadState(PUZZLE)).toBeNull();
  });

  it("keeps one board per puzzle (#3230)", async () => {
    const today = initialState("2026-05-03:en", 5, "en");
    const tomorrow = { ...initialState("2026-05-04:en", 5, "en"), current_row: 2 };
    await saveState(today);
    await saveState(tomorrow);
    expect(await loadState("2026-05-03:en")).toEqual(today);
    expect(await loadState("2026-05-04:en")).toEqual(tomorrow);
    expect(await loadState("2026-05-05:en")).toBeNull();
  });

  it("never returns a board stored under another puzzle's key", async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(initialState("2026-05-04:en", 5, "en")));
    expect(await loadState(PUZZLE)).toBeNull();
  });

  it("migrates the pre-#3230 single board to its puzzle's key", async () => {
    const old = { ...initialState(PUZZLE, 5, "en"), current_row: 1 };
    await AsyncStorage.setItem(LEGACY_KEY, JSON.stringify(old));
    expect(await loadState(PUZZLE)).toEqual(old);
    expect(await AsyncStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(JSON.parse((await AsyncStorage.getItem(STORAGE_KEY))!)).toEqual(old);
  });

  it("migrates another day's old board without overwriting a newer one", async () => {
    const old = { ...initialState(PUZZLE, 5, "en"), current_row: 1 };
    const newer = { ...initialState(PUZZLE, 5, "en"), current_row: 3 };
    await saveState(newer);
    await AsyncStorage.setItem(LEGACY_KEY, JSON.stringify(old));
    expect(await loadState("2026-05-09:en")).toBeNull();
    expect(await AsyncStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(await loadState(PUZZLE)).toEqual(newer);
  });

  it("pruneStates removes every other puzzle's board", async () => {
    await saveState(initialState("2026-05-02:en", 5, "en"));
    await saveState(initialState("2026-05-03:hi", 4, "hi"));
    await saveState(initialState(PUZZLE, 5, "en"));
    await AsyncStorage.setItem("daily_word_today_2026-05-03_en", "{}");
    await pruneStates(PUZZLE);
    expect([...(await AsyncStorage.getAllKeys())].sort()).toEqual([
      STORAGE_KEY,
      "daily_word_today_2026-05-03_en",
    ]);
  });

  it("pruneStates reports a failure and resolves", async () => {
    jest.spyOn(AsyncStorage, "getAllKeys").mockRejectedValueOnce(new Error("boom"));
    await expect(pruneStates(PUZZLE)).resolves.toBeUndefined();
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { subsystem: "daily_word.storage", op: "prune" },
    });
  });

  it("corrupt payload returns null", async () => {
    await AsyncStorage.setItem(STORAGE_KEY, "not json{{{");
    expect(await loadState(PUZZLE)).toBeNull();
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("corrupt payload"),
      expect.objectContaining({
        level: "warning",
        tags: expect.objectContaining({ subsystem: "daily_word.storage" }),
      })
    );
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("_v mismatch returns null", async () => {
    const s = initialState("2026-05-03:en", 5, "en");
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ ...s, _v: 2 }));
    expect(await loadState(PUZZLE)).toBeNull();
  });

  it("clearState removes saved state", async () => {
    await saveState(initialState("2026-05-03:en", 5, "en"));
    await clearState(PUZZLE);
    expect(await loadState(PUZZLE)).toBeNull();
  });
});

describe("looksValid", () => {
  it("accepts a versioned English puzzle id (#3155)", () => {
    expect(looksValid(initialState("2026-05-03:en:2", 5, "en"))).toBe(true);
  });

  it("rejects a malformed version suffix", () => {
    expect(looksValid(initialState("2026-05-03:en:x", 5, "en"))).toBe(false);
    expect(looksValid(initialState("2026-05-03:en:2:3", 5, "en"))).toBe(false);
  });

  it("accepts a valid initial state", () => {
    expect(looksValid(initialState("2026-05-03:en", 5, "en"))).toBe(true);
  });

  it("rejects null", () => {
    expect(looksValid(null)).toBe(false);
  });

  it("rejects a non-object", () => {
    expect(looksValid("string")).toBe(false);
  });

  it("rejects wrong _v", () => {
    expect(looksValid({ _v: 2, puzzle_id: "2026-05-03:en", rows: [] })).toBe(false);
  });

  it("rejects invalid puzzle_id format", () => {
    const s = initialState("2026-05-03:en", 5, "en");
    expect(looksValid({ ...s, puzzle_id: "invalid" })).toBe(false);
  });

  it("rejects rows.length > 6", () => {
    const s = initialState("2026-05-03:en", 5, "en");
    expect(looksValid({ ...s, rows: [...s.rows, ...s.rows] })).toBe(false);
  });
});

describe("saveTodayMeta / loadTodayMeta", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("round-trip save/load for today's date key", async () => {
    const meta = { puzzle_id: "2026-05-31:en", word_length: 5 };
    await saveTodayMeta("2026-05-31_en", meta);
    const loaded = await loadTodayMeta("2026-05-31_en");
    expect(loaded).toEqual(meta);
  });

  it("returns null for a different date key (cache miss)", async () => {
    const meta = { puzzle_id: "2026-05-30:en", word_length: 5 };
    await saveTodayMeta("2026-05-30_en", meta);
    expect(await loadTodayMeta("2026-05-31_en")).toBeNull();
  });

  it("returns null when nothing has been saved", async () => {
    expect(await loadTodayMeta("2026-05-31_en")).toBeNull();
  });

  it("overwrites previous entry for the same date key", async () => {
    await saveTodayMeta("2026-05-31_en", { puzzle_id: "2026-05-31:en", word_length: 5 });
    const updated = { puzzle_id: "2026-05-31:en", word_length: 6 };
    await saveTodayMeta("2026-05-31_en", updated);
    expect(await loadTodayMeta("2026-05-31_en")).toEqual(updated);
  });
});
