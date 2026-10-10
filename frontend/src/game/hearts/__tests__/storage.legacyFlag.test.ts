import AsyncStorage from "@react-native-async-storage/async-storage";
import { dealGame } from "../engine";
import { loadGame } from "../storage";

describe("hearts storage — legacy persona flag (#3158)", () => {
  const g = globalThis as { __DEV__?: boolean };
  const realDev = g.__DEV__;
  const realUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
    (AsyncStorage.removeItem as jest.Mock).mockClear().mockResolvedValue(undefined);
  });
  afterEach(() => {
    g.__DEV__ = realDev;
    if (realUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = realUrl;
  });

  async function loadSavedAs(aiDifficulty: string, legacyOn: boolean) {
    g.__DEV__ = legacyOn;
    delete process.env.EXPO_PUBLIC_API_URL;
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify({ ...dealGame(), aiDifficulty })
    );
    return loadGame();
  }

  it.each(["cautious", "schemer", "daring", "mixed"])(
    "a saved %s game resumes as conservative with the flag off",
    async (preset) => {
      const loaded = await loadSavedAs(preset, false);
      expect(loaded).not.toBeNull();
      expect(loaded?.aiDifficulty).toBe("conservative");
      expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
    }
  );

  it.each(["cautious", "schemer", "daring", "mixed", "conservative"])(
    "a saved %s game keeps its preset with the flag on",
    async (preset) => {
      expect((await loadSavedAs(preset, true))?.aiDifficulty).toBe(preset);
    }
  );

  it("a saved conservative game stays conservative with the flag off", async () => {
    expect((await loadSavedAs("conservative", false))?.aiDifficulty).toBe("conservative");
  });

  it("still migrates pre-#1653 names, then applies the flag", async () => {
    expect((await loadSavedAs("hard", true))?.aiDifficulty).toBe("daring");
    expect((await loadSavedAs("hard", false))?.aiDifficulty).toBe("conservative");
  });
});
