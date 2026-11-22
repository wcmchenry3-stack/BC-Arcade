import AsyncStorage from "@react-native-async-storage/async-storage";

import { __resetPersonalBestForTests, recordResult } from "../../_shared/personalBest";
import { newGame } from "../engine";
import { getLobbyStatus, isResumable } from "../lobbyStatus";
import { saveGame, type SavedGame } from "../storage";
import type { GameState } from "../types";

const at = (round: number, extra: Partial<GameState> = {}): GameState => ({
  ...newGame(),
  round,
  ...extra,
});
const saved = (state: GameState, aiState: GameState | null = null): SavedGame => ({
  state,
  aiDifficulty: aiState ? "medium" : null,
  aiState,
});

describe("yacht isResumable (#4008, #2203)", () => {
  it("resumes an unfinished game", () => {
    expect(isResumable(saved(at(4)))).toBe(true);
  });

  it("does not resume nothing, or a finished solo game", () => {
    expect(isResumable(null)).toBe(false);
    expect(isResumable(saved(at(13, { game_over: true })))).toBe(false);
  });

  it("resumes a finished VS game while the computer still has its last turn (#2203)", () => {
    expect(isResumable(saved(at(13, { game_over: true }), at(12)))).toBe(true);
  });

  it("does not resume a VS game once both games are over", () => {
    expect(isResumable(saved(at(13, { game_over: true }), at(13, { game_over: true })))).toBe(
      false
    );
  });

  it("does not resume a finished game that names a computer difficulty but holds no computer game", () => {
    expect(
      isResumable({ state: at(13, { game_over: true }), aiDifficulty: "hard", aiState: null })
    ).toBe(false);
  });
});

describe("yacht getLobbyStatus (#4008)", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    __resetPersonalBestForTests();
  });

  it("is nothing for a new player", async () => {
    expect(await getLobbyStatus()).toBeUndefined();
  });

  it("is Resume for a game in progress, over a personal best", async () => {
    await recordResult("yacht", 312);
    await saveGame(at(5));
    expect(await getLobbyStatus()).toEqual({ kind: "resume" });
  });

  it("is Resume for a VS game mid computer turn", async () => {
    await saveGame(at(13, { game_over: true }), "medium", at(12));
    expect(await getLobbyStatus()).toEqual({ kind: "resume" });
  });

  it("is the best score once the game is over", async () => {
    await recordResult("yacht", 312);
    await saveGame(at(13, { game_over: true }));
    expect(await getLobbyStatus()).toEqual({ kind: "best", value: 312, unit: "score" });
  });

  it("reads a corrupt save as no resume, and leaves it stored", async () => {
    await AsyncStorage.setItem("yacht_game_v2", "{oops");
    expect(await getLobbyStatus()).toBeUndefined();
    expect(await AsyncStorage.getItem("yacht_game_v2")).toBe("{oops");
  });
});
