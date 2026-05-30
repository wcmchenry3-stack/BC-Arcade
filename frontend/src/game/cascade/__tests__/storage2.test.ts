import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import { saveGame, loadGame, clearGame, looksValid } from "../storage2";
import type { SavedState } from "../storage2";

const STORAGE_KEY = "cascade_game_v3";

const makeSavedState = (overrides: Partial<SavedState> = {}): SavedState => ({
  version: 3,
  pieces: [{ tier: 1, x: 100, y: 200 }],
  score: 42,
  savedAt: 1700000000000,
  queue: { current: 0, next: 1 },
  ...overrides,
});

describe("cascade storage2 — looksValid", () => {
  it("returns true for a valid SavedState", () => {
    expect(looksValid(makeSavedState())).toBe(true);
  });

  it("returns true for an empty pieces array", () => {
    expect(looksValid(makeSavedState({ pieces: [] }))).toBe(true);
  });

  it("returns false for version !== 3", () => {
    expect(looksValid({ ...makeSavedState(), version: 2 })).toBe(false);
  });

  it("returns false when pieces is not an array", () => {
    expect(looksValid({ ...makeSavedState(), pieces: null as unknown as [] })).toBe(false);
  });

  it("returns false when a piece is missing a required field", () => {
    expect(looksValid({ ...makeSavedState(), pieces: [{ tier: 1, x: 100 }] })).toBe(false);
  });

  it("returns false when score is not a number", () => {
    expect(looksValid({ ...makeSavedState(), score: "0" as unknown as number })).toBe(false);
  });

  it("returns false when savedAt is not a number", () => {
    expect(looksValid({ ...makeSavedState(), savedAt: null as unknown as number })).toBe(false);
  });

  it("returns false when queue is missing", () => {
    const { queue: _q, ...noQueue } = makeSavedState();
    expect(looksValid(noQueue)).toBe(false);
  });

  it("returns false when queue.current is not a number", () => {
    expect(looksValid({ ...makeSavedState(), queue: { current: "0", next: 1 } })).toBe(false);
  });

  it("returns false when queue.next is not a number", () => {
    expect(looksValid({ ...makeSavedState(), queue: { current: 0, next: null } })).toBe(false);
  });

  it("returns false for null", () => {
    expect(looksValid(null)).toBe(false);
  });

  it("returns false for a plain string", () => {
    expect(looksValid("not-an-object")).toBe(false);
  });
});

describe("cascade storage2 — save / load roundtrip", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    (Sentry.captureException as jest.Mock).mockClear();
    (Sentry.captureMessage as jest.Mock).mockClear();
  });

  it("save → load → looksValid returns true", async () => {
    const state = makeSavedState();
    await saveGame(state);
    const loaded = await loadGame();
    expect(loaded).not.toBeNull();
    expect(looksValid(loaded)).toBe(true);
    expect(loaded).toEqual(state);
  });

  it("returns null when no saved game exists", async () => {
    expect(await loadGame()).toBeNull();
  });

  it("corrupted JSON → loadGame returns null (no throw)", async () => {
    await AsyncStorage.setItem(STORAGE_KEY, "not-valid-json{{{");
    await expect(loadGame()).resolves.toBeNull();
  });

  it("version !== 3 → looksValid returns false and loadGame returns null", async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ ...makeSavedState(), version: 2 }));
    expect(await loadGame()).toBeNull();
  });

  it("reports corrupt payload as warning (not exception) and clears the entry", async () => {
    await AsyncStorage.setItem(STORAGE_KEY, "not-valid-json{{{");
    expect(await loadGame()).toBeNull();
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("corrupt game payload"),
      expect.objectContaining({
        level: "warning",
        tags: expect.objectContaining({ subsystem: "cascade.storage", op: "load" }),
      })
    );
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("includes rawPayload in Sentry extra for corrupt payload", async () => {
    const corrupt = "truncated{json";
    await AsyncStorage.setItem(STORAGE_KEY, corrupt);
    await loadGame();
    const call = (Sentry.captureMessage as jest.Mock).mock.calls[0];
    expect(call[1].extra.rawPayload).toBe(corrupt);
  });

  it("invalid-shape JSON → loadGame returns null and clears the entry", async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ foo: "bar" }));
    expect(await loadGame()).toBeNull();
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("clearGame removes the saved state", async () => {
    await saveGame(makeSavedState());
    await clearGame();
    expect(await loadGame()).toBeNull();
  });

  it("preserves all piece fields through save/load", async () => {
    const state = makeSavedState({
      pieces: [
        { tier: 0, x: 50, y: 300 },
        { tier: 3, x: 150, y: 250 },
      ],
    });
    await saveGame(state);
    const loaded = await loadGame();
    expect(loaded?.pieces).toEqual(state.pieces);
  });

  it("preserves queue through save/load", async () => {
    const state = makeSavedState({ queue: { current: 2, next: 4 } });
    await saveGame(state);
    const loaded = await loadGame();
    expect(loaded?.queue).toEqual({ current: 2, next: 4 });
  });

  it("preserves score and savedAt through save/load", async () => {
    const state = makeSavedState({ score: 9999, savedAt: 1750000000000 });
    await saveGame(state);
    const loaded = await loadGame();
    expect(loaded?.score).toBe(9999);
    expect(loaded?.savedAt).toBe(1750000000000);
  });
});
