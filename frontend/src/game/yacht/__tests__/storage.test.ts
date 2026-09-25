import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import { saveGame, loadGame, clearGame, saveLastMode, loadLastMode } from "../storage";
import { newGame } from "../engine";
import { __setPremiumLevelsForTests } from "../../../entitlements/premiumLevels";

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

describe("yacht last mode (#1129)", () => {
  const PREF_KEY = "yacht_pref_v1";

  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  afterEach(() => {
    __setPremiumLevelsForTests(null);
  });

  it("round-trips the mode and difficulty", async () => {
    await saveLastMode("vs", "hard");
    expect(await loadLastMode()).toEqual({ mode: "vs", difficulty: "hard" });
  });

  it("returns null when nothing is stored", async () => {
    expect(await loadLastMode()).toBeNull();
  });

  it("falls back to medium for an unknown difficulty", async () => {
    await AsyncStorage.setItem(PREF_KEY, JSON.stringify({ mode: "vs", difficulty: "insane" }));
    expect(await loadLastMode()).toEqual({ mode: "vs", difficulty: "medium" });
  });

  it("falls back to medium for a difficulty that is now premium", async () => {
    await saveLastMode("vs", "hard");
    __setPremiumLevelsForTests({ yacht: ["hard"] });
    expect(await loadLastMode()).toEqual({ mode: "vs", difficulty: "medium" });
  });

  it("falls back to solo for an unknown mode", async () => {
    await AsyncStorage.setItem(PREF_KEY, JSON.stringify({ mode: "duo", difficulty: "easy" }));
    expect(await loadLastMode()).toEqual({ mode: "solo", difficulty: "easy" });
  });
});
