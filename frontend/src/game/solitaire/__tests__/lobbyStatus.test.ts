import AsyncStorage from "@react-native-async-storage/async-storage";

import { __resetPersonalBestForTests, recordResult } from "../../_shared/personalBest";
import { dealGame, drawFromStock } from "../engine";
import { getLobbyStatus, isResumable } from "../lobbyStatus";
import { saveGame } from "../storage";

describe("solitaire isResumable (#4008)", () => {
  const fresh = dealGame(1, 7);

  it("does not resume nothing, an untouched deal, or a complete game", () => {
    expect(isResumable(null)).toBe(false);
    expect(isResumable(fresh)).toBe(false);
    expect(isResumable({ ...drawFromStock(fresh), isComplete: true })).toBe(false);
  });

  it("resumes a game with a move made", () => {
    expect(isResumable(drawFromStock(fresh))).toBe(true);
  });
});

describe("solitaire getLobbyStatus (#4008)", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    __resetPersonalBestForTests();
  });

  it("is Resume for a game in progress, over the best time", async () => {
    await recordResult("solitaire", 300_000);
    await saveGame(drawFromStock(dealGame(1, 7)));
    expect(await getLobbyStatus()).toEqual({ kind: "resume" });
  });

  it("is the best time for an untouched deal", async () => {
    await recordResult("solitaire", 300_000);
    await saveGame(dealGame(1, 7));
    expect(await getLobbyStatus()).toEqual({ kind: "best", value: 300_000, unit: "time" });
  });

  it("is nothing with no save and no best, and for a corrupt save (left stored)", async () => {
    expect(await getLobbyStatus()).toBeUndefined();
    await AsyncStorage.setItem("solitaire_game", "[1,2");
    expect(await getLobbyStatus()).toBeUndefined();
    expect(await AsyncStorage.getItem("solitaire_game")).toBe("[1,2");
  });
});
