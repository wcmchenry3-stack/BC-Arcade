/**
 * Yacht's solo personal best (#3749, owner: a local best): a new best is a win for the end beat,
 * anything else a tie; the first finished game sets it and counts as a new best; saves from
 * before it load unchanged.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { loadBestScore, saveBestScore, soloEndOutcome } from "../bestScore";
import { loadGame } from "../storage";
import { newGame } from "../engine";

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("soloEndOutcome", () => {
  it("a score above the best is a win, and the new best", () => {
    expect(soloEndOutcome(180, 212)).toEqual({ outcome: "win", newBest: 212 });
  });

  it("a score equal to or below the best is a tie, and the best stays", () => {
    expect(soloEndOutcome(212, 212)).toEqual({ outcome: "tie", newBest: null });
    expect(soloEndOutcome(212, 150)).toEqual({ outcome: "tie", newBest: null });
  });

  it("the first finished game (no best on record) is a new best (owner)", () => {
    expect(soloEndOutcome(0, 140)).toEqual({ outcome: "win", newBest: 140 });
  });

  it("a game of 0 is never a best", () => {
    expect(soloEndOutcome(0, 0)).toEqual({ outcome: "tie", newBest: null });
  });
});

describe("the stored best", () => {
  it("is 0 with nothing stored, and keeps what was saved", async () => {
    expect(await loadBestScore()).toBe(0);
    await saveBestScore(212);
    expect(await loadBestScore()).toBe(212);
  });

  it("reads anything unusable as no best", async () => {
    await AsyncStorage.setItem("yacht_best_score_v1", "not a number");
    expect(await loadBestScore()).toBe(0);
    await AsyncStorage.setItem("yacht_best_score_v1", "-5");
    expect(await loadBestScore()).toBe(0);
    // Above the most a game can score (1575): corrupt.
    await AsyncStorage.setItem("yacht_best_score_v1", "1576");
    expect(await loadBestScore()).toBe(0);
    await AsyncStorage.setItem("yacht_best_score_v1", "1575");
    expect(await loadBestScore()).toBe(1575);
  });

  it("is its own record: a game saved before it still loads, and has no best", async () => {
    const state = { ...newGame(), round: 4 };
    await AsyncStorage.setItem(
      "yacht_game_v2",
      JSON.stringify({ state, aiDifficulty: null, aiState: null })
    );
    const loaded = await loadGame();
    expect(loaded?.state.round).toBe(4);
    expect(await loadBestScore()).toBe(0);
    // Saving a best leaves the game save alone.
    await saveBestScore(99);
    expect((await loadGame())?.state.round).toBe(4);
  });
});
