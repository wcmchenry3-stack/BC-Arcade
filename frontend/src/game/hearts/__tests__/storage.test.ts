import AsyncStorage from "@react-native-async-storage/async-storage";
import { dealGame } from "../engine";
import { clearGame, loadFinishedGameId, loadGame, saveFinishedGameId, saveGame } from "../storage";
import type { HeartsState } from "../types";

describe("hearts storage", () => {
  beforeEach(() => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
    (AsyncStorage.removeItem as jest.Mock).mockResolvedValue(undefined);
  });

  it("saveGame serialises state to AsyncStorage", async () => {
    const state = { ...dealGame(), accumulatedMs: 1_500 };
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

  it("loadGame migrates v2 save by defaulting aiDifficulty to schemer (#1168, #1653)", async () => {
    const v2Save = { ...dealGame(), _v: 2 } as unknown as Record<string, unknown>;
    delete v2Save["aiDifficulty"];
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(v2Save));
    const loaded = await loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded?._v).toBe(3);
    expect(loaded?.aiDifficulty).toBe("schemer");
  });

  it.each([
    ["easy", "cautious"],
    ["medium", "schemer"],
    ["hard", "daring"],
  ])("loadGame migrates old '%s' to '%s' (#1653)", async (oldValue, newValue) => {
    const oldState = { ...dealGame(), aiDifficulty: oldValue };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(oldState));
    const loaded = await loadGame();
    expect(loaded?.aiDifficulty).toBe(newValue);
  });

  it("loadGame round-trips aiDifficulty: daring", async () => {
    const state: HeartsState = { ...dealGame(), aiDifficulty: "daring" };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(state));
    const loaded = await loadGame();
    expect(loaded?.aiDifficulty).toBe("daring");
  });

  it("loadGame round-trips aiDifficulty: mixed (#1654)", async () => {
    const state: HeartsState = { ...dealGame(), aiDifficulty: "mixed" };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(state));
    const loaded = await loadGame();
    expect(loaded?.aiDifficulty).toBe("mixed");
  });

  it("loadGame rejects handScores with out-of-range values (#1540)", async () => {
    const bad = { ...dealGame(), handScores: [27, 0, 0, 0] };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(bad));
    expect(await loadGame()).toBeNull();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("hearts_game");
  });

  it("loadGame rejects scoreHistory rows with out-of-range values (#1540)", async () => {
    const bad = { ...dealGame(), scoreHistory: [[27, 0, 0, 0]] };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(bad));
    expect(await loadGame()).toBeNull();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("hearts_game");
  });

  it("clearGame removes the storage key", async () => {
    await clearGame();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("hearts_game");
  });

  // #2629: the play time survives a save and restore.
  it("loadGame keeps a saved game's play time", async () => {
    const state = { ...dealGame(), accumulatedMs: 125_000 };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(state));
    expect((await loadGame())?.accumulatedMs).toBe(125_000);
  });

  it.each([
    ["an older save with none", undefined],
    ["a negative value", -1],
    ["a non-number", "12"],
  ])("loadGame counts %s as no play time yet", async (_label, accumulatedMs) => {
    const state = { ...dealGame(), accumulatedMs };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(state));
    const loaded = await loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded?.accumulatedMs).toBe(0);
  });

  // #2629: the reopened result card asks for the finished game's rank again.
  it("saves and loads the finished game's id", async () => {
    await saveFinishedGameId("g-1");
    expect(AsyncStorage.setItem).toHaveBeenCalledWith("hearts_finished_game_id", "g-1");
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue("g-1");
    expect(await loadFinishedGameId()).toBe("g-1");
    expect(AsyncStorage.getItem).toHaveBeenCalledWith("hearts_finished_game_id");
  });

  it("loadFinishedGameId is null when none is saved or storage fails", async () => {
    expect(await loadFinishedGameId()).toBeNull();
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error("boom"));
    expect(await loadFinishedGameId()).toBeNull();
  });

  it("clearGame also forgets the finished game's id and the pre-#2629 owed score", async () => {
    await clearGame();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("hearts_finished_game_id");
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("hearts_pending_submission");
  });
});
