import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

import { LARGE_CARD_WIDTH, largeCardSize, loadLargeCards, saveLargeCards } from "../largeCards";
import { computeCardSize } from "../../_shared/CardSizeContext";

const KEY = "freecell_large_cards";

describe("FreeCell Large cards setting (#3347)", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    (Sentry.captureException as jest.Mock).mockClear();
  });

  it("is off by default", async () => {
    expect(await loadLargeCards()).toBe(false);
  });

  it("persists on and off", async () => {
    await saveLargeCards(true);
    expect(await AsyncStorage.getItem(KEY)).toBe("1");
    expect(await loadLargeCards()).toBe(true);
    await saveLargeCards(false);
    expect(await loadLargeCards()).toBe(false);
  });

  it("reads anything unexpected as off", async () => {
    await AsyncStorage.setItem(KEY, "yes please");
    expect(await loadLargeCards()).toBe(false);
  });

  it("falls back to off and reports when storage throws", async () => {
    const spy = jest.spyOn(AsyncStorage, "getItem").mockRejectedValueOnce(new Error("disk"));
    expect(await loadLargeCards()).toBe(false);
    expect(Sentry.captureException).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("stores one small value under one key", async () => {
    await saveLargeCards(true);
    expect(await AsyncStorage.getAllKeys()).toEqual([KEY]);
  });

  it("is a fixed width larger than any fitted card, at the card's aspect ratio", () => {
    const large = largeCardSize(52, 74);
    expect(large.cardWidth).toBe(LARGE_CARD_WIDTH);
    expect(large.cardHeight).toBe(Math.round((74 * LARGE_CARD_WIDTH) / 52));
    // The fitted board never exceeds the natural 52 dp, whatever the screen.
    for (const screenWidth of [320, 375, 390, 430, 768, 1024]) {
      expect(computeCardSize(screenWidth, 52, 74, 8, 2, 24).cardWidth).toBeLessThan(
        large.cardWidth
      );
    }
  });
});
