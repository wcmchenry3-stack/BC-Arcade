import AsyncStorage from "@react-native-async-storage/async-storage";
import { loadBestScore, saveBestScore } from "../bestScore";

// Star Swarm's leaderboard adapter and queue handler are gone (#2626): the
// finished run's session row is the leaderboard entry, and the result card
// reads its rank through the shared sessionBoardAdapter. What stays on the
// device is the best score behind the card's "Best" and "New best".

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("best score storage", () => {
  it("is 0 with nothing saved, and keeps a saved best", async () => {
    await expect(loadBestScore()).resolves.toBe(0);
    await saveBestScore(4200);
    await expect(loadBestScore()).resolves.toBe(4200);
  });

  it("treats a corrupt value as no best", async () => {
    await AsyncStorage.setItem("starswarm.bestScore", "not a number");
    await expect(loadBestScore()).resolves.toBe(0);
  });
});
