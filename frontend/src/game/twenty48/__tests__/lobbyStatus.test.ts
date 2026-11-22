import AsyncStorage from "@react-native-async-storage/async-storage";

import { __resetPersonalBestForTests, recordResult } from "../../_shared/personalBest";
import { newGame } from "../engine";
import { getLobbyStatus, isResumable } from "../lobbyStatus";
import { saveGame } from "../storage";

describe("twenty48 isResumable (#4008)", () => {
  it("does not resume nothing, a fresh deal, or a game that is over", () => {
    expect(isResumable(null)).toBe(false);
    expect(isResumable(newGame())).toBe(false);
    expect(isResumable({ ...newGame(), score: 400, game_over: true })).toBe(false);
  });

  it("resumes a game with a score, or with moves recorded", () => {
    expect(isResumable({ ...newGame(), score: 12 })).toBe(true);
    expect(isResumable({ ...newGame(), recordedMoves: 3 })).toBe(true);
  });

  it("resumes a game that has won and is kept playing", () => {
    expect(isResumable({ ...newGame(), score: 20_000, has_won: true })).toBe(true);
  });
});

describe("twenty48 getLobbyStatus (#4008)", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    __resetPersonalBestForTests();
  });

  it("is nothing for a new player, and for the fresh deal opening 2048 saves", async () => {
    expect(await getLobbyStatus()).toBeUndefined();
    await saveGame(newGame());
    expect(await getLobbyStatus()).toBeUndefined();
  });

  it("is Resume for a game in progress, over the best score", async () => {
    await recordResult("twenty48", 9000);
    await saveGame({ ...newGame(), score: 44 });
    expect(await getLobbyStatus()).toEqual({ kind: "resume" });
  });

  it("is the best score when no game is in progress", async () => {
    await recordResult("twenty48", 9000);
    await saveGame({ ...newGame(), score: 9000, game_over: true });
    expect(await getLobbyStatus()).toEqual({ kind: "best", value: 9000, unit: "score" });
  });

  it("reads a save missing its core fields as no resume, and leaves it stored", async () => {
    await AsyncStorage.setItem("twenty48_game_v2", JSON.stringify({ score: 5 }));
    expect(await getLobbyStatus()).toBeUndefined();
    expect(await AsyncStorage.getItem("twenty48_game_v2")).toBe(JSON.stringify({ score: 5 }));
  });
});
