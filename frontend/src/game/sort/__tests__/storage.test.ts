import AsyncStorage from "@react-native-async-storage/async-storage";
import { recordLevelSolve } from "../storage";

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("recordLevelSolve (#2512)", () => {
  it("makes the first solve of a level its best", async () => {
    await expect(recordLevelSolve(3, 20)).resolves.toEqual({ best: 20, isNewBest: true });
  });

  it("keeps the fewest moves per level", async () => {
    await recordLevelSolve(3, 20);
    await expect(recordLevelSolve(3, 25)).resolves.toEqual({ best: 20, isNewBest: false });
    await expect(recordLevelSolve(3, 14)).resolves.toEqual({ best: 14, isNewBest: true });
    await expect(recordLevelSolve(3, 18)).resolves.toEqual({ best: 14, isNewBest: false });
  });

  it("tracks each level separately", async () => {
    await recordLevelSolve(3, 20);
    await expect(recordLevelSolve(4, 30)).resolves.toEqual({ best: 30, isNewBest: true });
  });

  it("starts fresh when the stored bests are corrupt", async () => {
    await AsyncStorage.setItem("@sort/best_moves", "not json");
    await expect(recordLevelSolve(3, 20)).resolves.toEqual({ best: 20, isNewBest: true });
  });
});
