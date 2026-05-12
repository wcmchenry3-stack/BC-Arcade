import AsyncStorage from "@react-native-async-storage/async-storage";
import { dealGame } from "../engine";
import { clearGame, loadGame, saveGame } from "../storage";
import type { HeartsState } from "../types";

describe("hearts storage", () => {
  beforeEach(() => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
    (AsyncStorage.removeItem as jest.Mock).mockResolvedValue(undefined);
  });

  it("saveGame serialises state to AsyncStorage", async () => {
    const state = dealGame();
    await saveGame(state);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith("hearts_game", JSON.stringify(state));
  });

  it("loadGame returns null when no key exists", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    expect(await loadGame()).toBeNull();
  });

  it("loadGame returns parsed state for valid payload", async () => {
    const state = dealGame();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(state));
    const loaded = await loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded?._v).toBe(3);
    expect(loaded?.phase).toBe(state.phase);
  });

  it("loadGame round-trips scoreHistory (#745)", async () => {
    const state: HeartsState = {
      ...dealGame(),
      scoreHistory: [
        [5, 5, 5, 5],
        [10, 8, 4, 4],
      ],
    };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(state));
    const loaded = await loadGame();
    expect(loaded?.scoreHistory).toEqual([
      [5, 5, 5, 5],
      [10, 8, 4, 4],
    ]);
  });

  it("loadGame returns null and removes key for corrupt JSON", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue("{not valid json");
    expect(await loadGame()).toBeNull();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("hearts_game");
  });

  it("loadGame returns null and removes key when _v is wrong", async () => {
    const bad = { ...dealGame(), _v: 99 };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(bad));
    expect(await loadGame()).toBeNull();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("hearts_game");
  });

  it("loadGame discards v1 saves (#745 schema bump)", async () => {
    const v1Save = { ...dealGame(), _v: 1 } as unknown;
    // Strip scoreHistory to mimic an actual v1 payload
    delete (v1Save as { scoreHistory?: unknown }).scoreHistory;
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(v1Save));
    expect(await loadGame()).toBeNull();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("hearts_game");
  });

  it("loadGame rejects payloads with malformed scoreHistory rows", async () => {
    const bad = { ...dealGame(), scoreHistory: [[5, 5, 5]] }; // 3 entries, not 4
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(bad));
    expect(await loadGame()).toBeNull();
  });

  it("loadGame returns null for missing required arrays", async () => {
    const bad: Partial<HeartsState> = { _v: 3 };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(bad));
    expect(await loadGame()).toBeNull();
  });

  it("loadGame migrates v2 save by defaulting aiDifficulty to medium (#1168)", async () => {
    const v2Save = { ...dealGame(), _v: 2 } as unknown as Record<string, unknown>;
    delete v2Save["aiDifficulty"];
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(v2Save));
    const loaded = await loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded?._v).toBe(3);
    expect(loaded?.aiDifficulty).toBe("medium");
  });

  it("loadGame round-trips aiDifficulty: hard", async () => {
    const state: HeartsState = { ...dealGame(), aiDifficulty: "hard" };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(state));
    const loaded = await loadGame();
    expect(loaded?.aiDifficulty).toBe("hard");
  });

  it("clearGame removes the storage key", async () => {
    await clearGame();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("hearts_game");
  });
});
