import AsyncStorage from "@react-native-async-storage/async-storage";

import { __resetPersonalBestForTests, recordResult } from "../../_shared/personalBest";
import { dealGame } from "../engine";
import { getLobbyStatus, isResumable } from "../lobbyStatus";
import { saveGame } from "../storage";

describe("freecell isResumable (#4008)", () => {
  const fresh = dealGame(11);

  it("does not resume nothing, an untouched deal, or a complete game", () => {
    expect(isResumable(null)).toBe(false);
    expect(isResumable(fresh)).toBe(false);
    expect(isResumable({ ...fresh, moveCount: 60, isComplete: true })).toBe(false);
  });

  it("resumes a game with a move made", () => {
    expect(isResumable({ ...fresh, moveCount: 1 })).toBe(true);
  });
});

describe("freecell getLobbyStatus (#4008)", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    __resetPersonalBestForTests();
  });

  it("is Resume for a game in progress, over the best moves", async () => {
    await recordResult("freecell", 88);
    await saveGame({ ...dealGame(11), moveCount: 9 });
    expect(await getLobbyStatus()).toEqual({ kind: "resume" });
  });

  it("is the best (fewest) moves for an untouched deal", async () => {
    await recordResult("freecell", 88);
    await saveGame(dealGame(11));
    expect(await getLobbyStatus()).toEqual({ kind: "best", value: 88, unit: "moves" });
  });

  it("reads a malformed save as no resume, and leaves it stored", async () => {
    await AsyncStorage.setItem("freecell_game", JSON.stringify({ _v: 1, tableau: [] }));
    expect(await getLobbyStatus()).toBeUndefined();
    expect(await AsyncStorage.getItem("freecell_game")).not.toBeNull();
  });
});
