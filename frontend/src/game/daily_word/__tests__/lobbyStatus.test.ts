import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

import { initialState } from "../engine";
import { getLobbyStatus } from "../lobbyStatus";
import { isBoardFinished, saveState, saveTodayMeta } from "../storage";
import { getLanguage, getTimezoneOffset, localDateKey } from "../todayMeta";

const PUZZLE = "2026-11-21:en:1";

async function cacheToday(puzzleId = PUZZLE): Promise<void> {
  await saveTodayMeta(localDateKey(getTimezoneOffset(), getLanguage()), {
    puzzle_id: puzzleId,
    word_length: 5,
  });
}

describe("daily_word getLobbyStatus (#4008)", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it("is Done today once today's board is won", async () => {
    await cacheToday();
    await saveState({ ...initialState(PUZZLE, 5, "en"), is_complete: true, won: true });
    expect(await getLobbyStatus()).toEqual({ kind: "doneToday" });
  });

  it("is Done today for a lost board too", async () => {
    await cacheToday();
    await saveState({ ...initialState(PUZZLE, 5, "en"), is_complete: true, won: false });
    expect(await getLobbyStatus()).toEqual({ kind: "doneToday" });
  });

  it("is nothing for a board still being played, or no board", async () => {
    await cacheToday();
    expect(await getLobbyStatus()).toBeUndefined();
    await saveState(initialState(PUZZLE, 5, "en"));
    expect(await getLobbyStatus()).toBeUndefined();
  });

  it("is nothing when today's metadata is not cached, even with a finished board stored", async () => {
    await saveState({ ...initialState(PUZZLE, 5, "en"), is_complete: true, won: true });
    expect(await getLobbyStatus()).toBeUndefined();
  });

  it("is nothing when the finished board is another day's puzzle", async () => {
    await cacheToday();
    await saveState({ ...initialState("2026-11-20:en:1", 5, "en"), is_complete: true, won: true });
    expect(await getLobbyStatus()).toBeUndefined();
  });

  it("lapses overnight: once the date key moves to tomorrow, yesterday's finished board is not Done today", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "setTimeout"] });
    try {
      jest.setSystemTime(new Date("2026-11-21T12:00:00Z"));
      await cacheToday("2026-11-21:en:1");
      await saveState({
        ...initialState("2026-11-21:en:1", 5, "en"),
        is_complete: true,
        won: true,
      });
      expect(await getLobbyStatus()).toEqual({ kind: "doneToday" });
      jest.setSystemTime(new Date("2026-11-22T12:00:00Z"));
      // Tomorrow's meta is not cached (yet): no status, even though yesterday's board is stored.
      expect(await getLobbyStatus()).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it("reads only: a corrupt board is left stored and nothing is reported or written", async () => {
    await cacheToday();
    await AsyncStorage.setItem(`daily_word_board_${PUZZLE}`, "{bad");
    (AsyncStorage.setItem as jest.Mock).mockClear();
    expect(await getLobbyStatus()).toBeUndefined();
    expect(await isBoardFinished(PUZZLE)).toBe(false);
    expect(await AsyncStorage.getItem(`daily_word_board_${PUZZLE}`)).toBe("{bad");
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
