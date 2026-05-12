import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import { saveState, loadState, clearState, looksValid } from "../storage";
import { initialState } from "../engine";

const STORAGE_KEY = "daily_word_state_v1";

describe("daily_word storage", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    (Sentry.captureException as jest.Mock).mockClear();
    (Sentry.captureMessage as jest.Mock).mockClear();
  });

  it("round-trip save/load", async () => {
    const s = initialState("2026-05-03:en", 5, "en");
    await saveState(s);
    const loaded = await loadState();
    expect(loaded).toEqual(s);
  });

  it("returns null when no saved state exists", async () => {
    expect(await loadState()).toBeNull();
  });

  it("corrupt payload returns null", async () => {
    await AsyncStorage.setItem(STORAGE_KEY, "not json{{{");
    expect(await loadState()).toBeNull();
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
    expect(await loadState()).toBeNull();
  });

  it("clearState removes saved state", async () => {
    await saveState(initialState("2026-05-03:en", 5, "en"));
    await clearState();
    expect(await loadState()).toBeNull();
  });
});

describe("looksValid", () => {
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
