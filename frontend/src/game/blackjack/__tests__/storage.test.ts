import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import { saveGame, loadGame, clearGame, saveRun, loadRuns, RunRecord } from "../storage";
import { newGame, toViewState, EngineState } from "../engine";
import {
  c,
  savedAgainstNatural,
  splitSetup,
  stateInPlayer,
  stateInResult,
} from "./helpers/engineFixtures";

const STORAGE_KEY = "blackjack_game_v2";

describe("blackjack storage", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    (Sentry.captureException as jest.Mock).mockClear();
    (Sentry.captureMessage as jest.Mock).mockClear();
  });

  it("saves and loads a game", async () => {
    const g = newGame();
    await saveGame(g);
    const loaded = await loadGame();
    expect(loaded).toEqual(g);
  });

  it("returns null when no saved game exists", async () => {
    expect(await loadGame()).toBeNull();
  });

  it("returns null when saved data is corrupted", async () => {
    // NB: previous revision of this test wrote to "blackjack_game_v1",
    // which no longer exists as a key — so the test was passing because
    // loadGame saw an empty slot, not because it survived a parse error.
    // #510 exposed that: the actual key is v2.
    await AsyncStorage.setItem(STORAGE_KEY, "not-valid-json{{{");
    expect(await loadGame()).toBeNull();
  });

  it("returns null when saved data has different shape", async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ foo: "bar" }));
    expect(await loadGame()).toBeNull();
  });

  // #510: corrupt payload should be reported at WARNING level and the
  // corrupt entry should be cleared so it doesn't re-fire every launch.
  it("reports corrupt payload as warning (not exception) and clears the entry", async () => {
    await AsyncStorage.setItem(STORAGE_KEY, "not-valid-json{{{");
    expect(await loadGame()).toBeNull();
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("corrupt game payload"),
      expect.objectContaining({
        level: "warning",
        tags: expect.objectContaining({ subsystem: "blackjack.storage", op: "load" }),
      })
    );
    // Subsequent load sees a clean slot — the corrupt entry was removed.
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  // #1094: rawPayload must be included in the Sentry extra so engineers can
  // see what the malformed JSON looked like without unfiltering PII fields.
  it("includes rawPayload in Sentry extra for corrupt payload (#1094)", async () => {
    const corrupt = "truncated{json";
    await AsyncStorage.setItem(STORAGE_KEY, corrupt);
    await loadGame();
    const call = (Sentry.captureMessage as jest.Mock).mock.calls[0];
    expect(call[1].extra.rawPayload).toBe(corrupt);
  });

  it("clearGame removes the saved state", async () => {
    await saveGame(newGame());
    await clearGame();
    expect(await loadGame()).toBeNull();
  });

  it("persists lastWin across save/load", async () => {
    const g = newGame();
    const withLastWin: EngineState = { ...g, lastWin: 150 };
    await saveGame(withLastWin);
    const loaded = await loadGame();
    expect(loaded?.lastWin).toBe(150);
  });

  it("backfills lastWin as null for saves that predate the HUD feature", async () => {
    const g = newGame();
    // Simulate an old save without lastWin by serializing then deleting the key
    const serialized = JSON.parse(JSON.stringify(g)) as Record<string, unknown>;
    delete serialized["lastWin"];
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(serialized));
    const loaded = await loadGame();
    expect(loaded?.lastWin).toBeNull();
  });

  it("backfills milestone fields for saves that predate BJ-5", async () => {
    const g = newGame();
    const serialized = JSON.parse(JSON.stringify(g)) as Record<string, unknown>;
    delete serialized["milestones"];
    delete serialized["milestones_reached"];
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(serialized));
    const loaded = await loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.milestones).toEqual([]);
    expect(loaded!.milestones_reached).toEqual([]);
  });

  it("backfills run-mode fields for saves that predate run mode", async () => {
    const g = newGame();
    const serialized = JSON.parse(JSON.stringify(g)) as Record<string, unknown>;
    delete serialized["runGoal"];
    delete serialized["startingChips"];
    delete serialized["betMin"];
    delete serialized["betMax"];
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(serialized));
    const loaded = await loadGame();
    expect(loaded?.runGoal).toBeNull();
    expect(loaded?.startingChips).toBe(1000);
    expect(loaded?.betMin).toBe(5);
    expect(loaded?.betMax).toBe(500);
  });
});

const makeRun = (overrides: Partial<RunRecord> = {}): RunRecord => ({
  table: "beginner",
  startingChips: 1000,
  finalChips: 800,
  runGoal: null,
  completed: false,
  handsPlayed: 10,
  biggestWin: 50,
  lowestChips: 750,
  startedAt: 1000000,
  endedAt: 1001000,
  ...overrides,
});

describe("blackjack run history", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    (Sentry.captureException as jest.Mock).mockClear();
    (Sentry.captureMessage as jest.Mock).mockClear();
  });

  it("returns empty array when no runs saved", async () => {
    expect(await loadRuns()).toEqual([]);
  });

  it("saves and loads a single run", async () => {
    const run = makeRun();
    await saveRun(run);
    const runs = await loadRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual(run);
  });

  it("appends runs in order", async () => {
    await saveRun(makeRun({ startedAt: 1 }));
    await saveRun(makeRun({ startedAt: 2 }));
    await saveRun(makeRun({ startedAt: 3 }));
    const runs = await loadRuns();
    expect(runs).toHaveLength(3);
    expect(runs.map((r) => r.startedAt)).toEqual([1, 2, 3]);
  });

  it("caps history at 50 runs, dropping oldest", async () => {
    for (let i = 0; i < 55; i++) {
      await saveRun(makeRun({ startedAt: i }));
    }
    const runs = await loadRuns();
    expect(runs).toHaveLength(50);
    expect(runs[0].startedAt).toBe(5);
    expect(runs[49].startedAt).toBe(54);
  });

  it("persists completed flag correctly", async () => {
    await saveRun(makeRun({ completed: true, runGoal: 2000, finalChips: 2000 }));
    const runs = await loadRuns();
    expect(runs[0].completed).toBe(true);
    expect(runs[0].runGoal).toBe(2000);
  });

  it("returns empty array on corrupt storage and clears the key", async () => {
    await AsyncStorage.setItem("blackjack_runs_v1", "not-valid-json{{{");
    const runs = await loadRuns();
    expect(runs).toEqual([]);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("corrupt runs payload"),
      expect.objectContaining({ level: "warning" })
    );
    expect(await AsyncStorage.getItem("blackjack_runs_v1")).toBeNull();
  });

  it("returns empty array when stored value is not an array, logs warning, and clears the key", async () => {
    await AsyncStorage.setItem("blackjack_runs_v1", JSON.stringify({ foo: "bar" }));
    const runs = await loadRuns();
    expect(runs).toEqual([]);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("not an array"),
      expect.objectContaining({ level: "warning" })
    );
    expect(await AsyncStorage.getItem("blackjack_runs_v1")).toBeNull();
  });
});

// #3741: a save from before the dealer's peek, mid-hand against a dealer natural, is settled on
// load as the peek would have settled it at the deal: the original bet only.
describe("blackjack storage: a save from before the dealer's peek (#3741)", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  const loadSaved = async (s: EngineState) => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    return (await loadGame())!;
  };

  it("in play against a dealer natural: lost for the original bet, phase result", async () => {
    const loaded = await loadSaved(savedAgainstNatural([c("♠", "10"), c("♥", "8")]));
    expect(loaded.phase).toBe("result");
    expect(loaded.outcome).toBe("lose");
    expect(loaded.payout).toBe(-100);
    expect(loaded.chips).toBe(900);
    expect(loaded.bet).toBe(100);
    expect(loaded.events).toBeUndefined();
  });

  it("with a card already hit: back to the two dealt cards, still the original bet only", async () => {
    const loaded = await loadSaved(savedAgainstNatural([c("♠", "10"), c("♥", "6"), c("♣", "5")]));
    expect(loaded.player_hand).toEqual([c("♠", "10"), c("♥", "6")]);
    expect(loaded.outcome).toBe("lose");
    expect(loaded.chips).toBe(900);
  });

  it("mid-split: the split is undone and only the original bet is lost", async () => {
    const s: EngineState = {
      ...splitSetup({ dealer: [c("♦", "K"), c("♣", "A")] }),
      split_count: 1,
      player_hands: [
        [c("♠", "8"), c("♦", "3")],
        [c("♥", "8"), c("♣", "2")],
      ],
      hand_bets: [100, 100],
      hand_outcomes: [null, null],
      hand_payouts: [0, 0],
      split_from_aces: [false, false],
    };
    const loaded = await loadSaved(s);
    expect(loaded.split_count).toBe(0);
    expect(loaded.player_hands).toEqual([]);
    expect(loaded.player_hand).toEqual([c("♠", "8"), c("♥", "8")]);
    expect(loaded.outcome).toBe("lose");
    expect(loaded.payout).toBe(-100);
    expect(loaded.chips).toBe(900);
  });

  it("the player's natural against the dealer's natural: a push", async () => {
    const loaded = await loadSaved(savedAgainstNatural([c("♠", "A"), c("♥", "K")]));
    expect(loaded.phase).toBe("result");
    expect(loaded.outcome).toBe("push");
    expect(loaded.payout).toBe(0);
    expect(loaded.chips).toBe(1000);
  });

  it("all in: the chips go to 0 and the run is over", async () => {
    const s = { ...savedAgainstNatural([c("♠", "10"), c("♥", "8")]), chips: 100, bet: 100 };
    const loaded = await loadSaved(s);
    expect(loaded.chips).toBe(0);
    expect(toViewState(loaded).game_over).toBe(true);
  });

  it("a save that needs no change loads unchanged", async () => {
    const natural = [c("♦", "K"), c("♣", "A")];
    for (const s of [
      stateInPlayer(), // in play, the dealer not a natural
      { ...stateInResult(900, 100, "lose", -100), dealer_hand: natural }, // already settled
      newGame(), // betting
    ]) {
      expect(await loadSaved(s)).toEqual(s);
    }
  });
});
