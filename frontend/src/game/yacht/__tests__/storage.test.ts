import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import { saveGame, loadGame, clearGame } from "../storage";
import { newGame } from "../engine";

const STORAGE_KEY = "yacht_game_v2";

describe("yacht storage", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    (Sentry.captureException as jest.Mock).mockClear();
    (Sentry.captureMessage as jest.Mock).mockClear();
  });

  it("saves and loads a game", async () => {
    const g = newGame();
    await saveGame(g);
    const loaded = await loadGame();
    expect(loaded).toEqual({ state: g, aiDifficulty: null, aiState: null });
  });

  it("returns null when no saved game exists", async () => {
    expect(await loadGame()).toBeNull();
  });

  it("returns null when saved data is corrupted", async () => {
    await AsyncStorage.setItem(STORAGE_KEY, "not json");
    expect(await loadGame()).toBeNull();
  });

  it("returns null when saved data has different shape", async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ foo: "bar" }));
    expect(await loadGame()).toBeNull();
  });

  // Same #501/#510 pattern: corrupt payload reports as warning, not
  // exception, and the entry is cleared.
  it("reports corrupt payload as warning (not exception) and clears the entry", async () => {
    await AsyncStorage.setItem(STORAGE_KEY, "not-valid-json{{{");
    expect(await loadGame()).toBeNull();
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("corrupt game payload"),
      expect.objectContaining({
        level: "warning",
        tags: expect.objectContaining({ subsystem: "yacht.storage", op: "load" }),
      })
    );
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("clearGame removes the saved state", async () => {
    await saveGame(newGame());
    await clearGame();
    expect(await loadGame()).toBeNull();
  });
});
