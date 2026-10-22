import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import {
  applyHandScoring,
  commitPass,
  dealGame,
  dealNextHand,
  getValidPlays,
  playCard,
  selectPassCard,
} from "../engine";
import { clearGame, loadFinishedGameId, loadGame, saveFinishedGameId, saveGame } from "../storage";
import type { HeartsState } from "../types";

describe("hearts storage", () => {
  beforeEach(() => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
    (AsyncStorage.removeItem as jest.Mock).mockResolvedValue(undefined);
  });

  it("saveGame serialises state to AsyncStorage", async () => {
    const state = { ...dealGame(), accumulatedMs: 1_500 };
    await saveGame(state);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith("hearts_game", JSON.stringify(state));
  });

  it("loadGame returns null when no key exists", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    expect(await loadGame()).toBeNull();
  });

  it("loadGame returns parsed state for valid payload", async () => {
    const state = dealGame();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(state));
    const loaded = await loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded?._v).toBe(3);
    expect(loaded?.phase).toBe(state.phase);
  });

  it("loadGame round-trips scoreHistory (#745)", async () => {
    const state: HeartsState = {
      ...dealGame(),
      handNumber: 3,
      cumulativeScores: [15, 13, 12, 12],
      scoreHistory: [
        [5, 5, 8, 8],
        [10, 8, 4, 4],
      ],
    };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(state));
    const loaded = await loadGame();
    expect(loaded?.scoreHistory).toEqual([
      [5, 5, 8, 8],
      [10, 8, 4, 4],
    ]);
  });

  it("loadGame returns null and removes key for corrupt JSON", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue("{not valid json");
    expect(await loadGame()).toBeNull();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("hearts_game");
  });

  it("loadGame returns null and removes key when _v is wrong", async () => {
    const bad = { ...dealGame(), _v: 99 };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(bad));
    expect(await loadGame()).toBeNull();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("hearts_game");
  });

  it("loadGame discards v1 saves (#745 schema bump)", async () => {
    const v1Save = { ...dealGame(), _v: 1 } as unknown;
    // Strip scoreHistory to mimic an actual v1 payload
    delete (v1Save as { scoreHistory?: unknown }).scoreHistory;
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(v1Save));
    expect(await loadGame()).toBeNull();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("hearts_game");
  });

  it("loadGame rejects payloads with malformed scoreHistory rows", async () => {
    const bad = { ...dealGame(), scoreHistory: [[5, 5, 5]] }; // 3 entries, not 4
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(bad));
    expect(await loadGame()).toBeNull();
  });

  it("loadGame returns null for missing required arrays", async () => {
    const bad: Partial<HeartsState> = { _v: 3 };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(bad));
    expect(await loadGame()).toBeNull();
  });

  it("loadGame migrates v2 save by defaulting aiDifficulty to schemer (#1168, #1653)", async () => {
    const v2Save = { ...dealGame(), _v: 2 } as unknown as Record<string, unknown>;
    delete v2Save["aiDifficulty"];
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(v2Save));
    const loaded = await loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded?._v).toBe(3);
    expect(loaded?.aiDifficulty).toBe("schemer");
  });

  it.each([
    ["easy", "cautious"],
    ["medium", "schemer"],
    ["hard", "daring"],
  ])("loadGame migrates old '%s' to '%s' (#1653)", async (oldValue, newValue) => {
    const oldState = { ...dealGame(), aiDifficulty: oldValue };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(oldState));
    const loaded = await loadGame();
    expect(loaded?.aiDifficulty).toBe(newValue);
  });

  it("loadGame round-trips aiDifficulty: daring", async () => {
    const state: HeartsState = { ...dealGame(), aiDifficulty: "daring" };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(state));
    const loaded = await loadGame();
    expect(loaded?.aiDifficulty).toBe("daring");
  });

  it("loadGame round-trips aiDifficulty: mixed (#1654)", async () => {
    const state: HeartsState = { ...dealGame(), aiDifficulty: "mixed" };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(state));
    const loaded = await loadGame();
    expect(loaded?.aiDifficulty).toBe("mixed");
  });

  it("loadGame rejects handScores with out-of-range values (#1540)", async () => {
    const bad = { ...dealGame(), handScores: [27, 0, 0, 0] };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(bad));
    expect(await loadGame()).toBeNull();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("hearts_game");
  });

  it("loadGame rejects scoreHistory rows with out-of-range values (#1540)", async () => {
    const bad = { ...dealGame(), scoreHistory: [[27, 0, 0, 0]] };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(bad));
    expect(await loadGame()).toBeNull();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("hearts_game");
  });

  it("loadGame discards a shape-valid save that fails the integrity check (#2224)", async () => {
    const s = dealGame();
    const hands = s.playerHands.map((h) => [...h]);
    hands[1]![0] = hands[0]![0]!; // duplicated card, otherwise well-shaped
    const bad = { ...s, playerHands: hands, accumulatedMs: 0 };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(bad));
    expect(await loadGame()).toBeNull();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("hearts_game");
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      "hearts.storage: invalid game state, discarding",
      expect.objectContaining({
        extra: expect.objectContaining({ integrityFindings: ["deck_not_conserved"] }),
      })
    );
  });

  it("loadGame discards a save whose scores don't reconcile with its history (#2224)", async () => {
    const bad = { ...dealGame(), cumulativeScores: [50, 0, 0, 0] };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(bad));
    expect(await loadGame()).toBeNull();
  });

  describe("positive-path round trips through saveGame/loadGame (#2224)", () => {
    /** Save through the real saveGame, then load what was written through loadGame. */
    async function roundTrip(state: HeartsState): Promise<HeartsState | null> {
      (AsyncStorage.setItem as jest.Mock).mockClear();
      await saveGame({ ...state, accumulatedMs: 0 });
      const written = (AsyncStorage.setItem as jest.Mock).mock.calls[0]![1] as string;
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(written);
      const loaded = await loadGame();
      if (!loaded) return null;
      const { accumulatedMs: _ms, ...rest } = loaded;
      return rest;
    }

    it("loads back passing, mid-trick, dealing and game_over states from a simulated game", async () => {
      const seen = new Set<string>();
      let sawMidTrick = false;
      let sawDealingWithHistory = false;
      const check = async (s: HeartsState, tag: string) => {
        const loaded = await roundTrip(s);
        expect(loaded).not.toBeNull();
        expect(loaded).toEqual(JSON.parse(JSON.stringify(s)));
        seen.add(tag);
      };
      let s = dealGame();
      for (let h = 0; h < 60; h++) {
        if (s.phase === "passing") {
          await check(s, "passing");
          for (let p = 0; p < 4; p++) {
            for (const c of s.playerHands[p]!.slice(0, 3)) s = selectPassCard(s, p, c);
          }
          await check(s, "passing");
          s = commitPass(s);
        }
        while (s.phase === "playing") {
          const p = s.currentPlayerIndex;
          s = playCard(s, p, getValidPlays(s, p)[0]!);
          if (s.currentTrick.length >= 1 && s.currentTrick.length <= 3 && !sawMidTrick) {
            sawMidTrick = true;
            await check(s, "mid-trick");
          }
        }
        if (s.phase === "dealing" && s.scoreHistory.length > 0 && !sawDealingWithHistory) {
          sawDealingWithHistory = true;
          await check(s, "dealing");
        }
        if (s.phase === "game_over") {
          await check(s, "game_over");
          break;
        }
        s = dealNextHand(s);
      }
      expect([...seen].sort()).toEqual(["dealing", "game_over", "mid-trick", "passing"]);
    });

    it("loads back the state right after a moon-shot hand", async () => {
      const deck = dealGame().playerHands.flat();
      const isPoint = (c: (typeof deck)[number]) =>
        c.suit === "hearts" || (c.suit === "spades" && c.rank === 12);
      const points = deck.filter(isPoint);
      const rest = deck.filter((c) => !isPoint(c));
      expect(points).toHaveLength(14);
      const hand: HeartsState = {
        ...dealGame(),
        phase: "hand_end",
        handNumber: 1,
        playerHands: [[], [], [], []],
        wonCards: [rest.slice(0, 13), points, rest.slice(13, 26), rest.slice(26)],
        handScores: [0, 26, 0, 0],
        tricksPlayedInHand: 13,
      };
      const scored = applyHandScoring(hand);
      expect(scored.phase).toBe("dealing");
      expect(scored.scoreHistory).toEqual([[26, 0, 26, 26]]);
      const loaded = await roundTrip(scored);
      expect(loaded).not.toBeNull();
      expect(loaded).toEqual(JSON.parse(JSON.stringify(scored)));
    });
  });

  it("clearGame removes the storage key", async () => {
    await clearGame();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("hearts_game");
  });

  // #2629: the play time survives a save and restore.
  it("loadGame keeps a saved game's play time", async () => {
    const state = { ...dealGame(), accumulatedMs: 125_000 };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(state));
    expect((await loadGame())?.accumulatedMs).toBe(125_000);
  });

  it.each([
    ["an older save with none", undefined],
    ["a negative value", -1],
    ["a non-number", "12"],
  ])("loadGame counts %s as no play time yet", async (_label, accumulatedMs) => {
    const state = { ...dealGame(), accumulatedMs };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(state));
    const loaded = await loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded?.accumulatedMs).toBe(0);
  });

  // #2629: the reopened result card asks for the finished game's rank again.
  it("saves and loads the finished game's id", async () => {
    await saveFinishedGameId("g-1");
    expect(AsyncStorage.setItem).toHaveBeenCalledWith("hearts_finished_game_id", "g-1");
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue("g-1");
    expect(await loadFinishedGameId()).toBe("g-1");
    expect(AsyncStorage.getItem).toHaveBeenCalledWith("hearts_finished_game_id");
  });

  it("loadFinishedGameId is null when none is saved or storage fails", async () => {
    expect(await loadFinishedGameId()).toBeNull();
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error("boom"));
    expect(await loadFinishedGameId()).toBeNull();
  });

  it("clearGame also forgets the finished game's id and the pre-#2629 owed score", async () => {
    await clearGame();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("hearts_finished_game_id");
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("hearts_pending_submission");
  });
});
