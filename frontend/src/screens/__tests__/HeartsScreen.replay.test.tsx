/**
 * HeartsScreen replay recording (#3283, epic #3273): what the screen hands the
 * recorder and when. The real `useGameRecorder`, `GameRecorder` and
 * `useGameSync` run over a mocked GameEventClient, so the events asserted here
 * are the ones the queue would take (`enqueueEvents`). The encodings and the
 * rebuild are in game/hearts/__tests__/replay.test.ts.
 */

import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { AppState } from "react-native";

import HeartsScreen from "../HeartsScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { HeartsRoundsProvider } from "../../game/hearts/RoundsContext";
import * as engine from "../../game/hearts/engine";
import { createSeededRng, setRng } from "../../game/hearts/engine";
import { loadGame } from "../../game/hearts/storage";
import { hand } from "../../game/hearts/__tests__/helpers/replayGame";
import { trickUnit } from "../../game/hearts/replay";
import type { HeartsState } from "../../game/hearts/types";
import { heartsCard, heartsPlay } from "./helpers/heartsFixtures";

jest.mock("../../game/hearts/storage", () => ({
  loadGame: jest.fn().mockResolvedValue(null),
  saveGame: jest.fn().mockResolvedValue(undefined),
  clearGame: jest.fn().mockResolvedValue(undefined),
  loadFinishedGameId: jest.fn().mockResolvedValue(null),
  saveFinishedGameId: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../game/hearts/playerNames", () => ({
  ...jest.requireActual("../../game/hearts/playerNames"),
  loadPlayerNames: jest.fn().mockResolvedValue(["You", "West", "North", "East"]),
  savePlayerNames: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../api/stats", () => mockScreenDeps().mockStatsApi({ getGameRank: jest.fn() }));
jest.mock("../../game/_shared/flushQueuedGames", () => mockScreenDeps().mockFlushQueuedGames());
jest.mock("../../game/_shared/displayNameSync", () => mockScreenDeps().mockDisplayNameSync());

// The queue's end of the recorder: what useGameSync hands the GameEventClient.
type SavedEvent = { type: string; data: Record<string, unknown> };
const mockStartGame = jest.fn((..._args: unknown[]) => "hearts-game-1");
const mockResumeGame = jest.fn((..._args: unknown[]): string | null => null);
const mockEnqueueEvents = jest.fn((_gameId: string, _events: readonly SavedEvent[]) => undefined);
const mockCompleteGame = jest.fn();
jest.mock("../../game/_shared/gameEventClient", () =>
  mockScreenDeps().mockGameEventClient({
    startGame: (...a: unknown[]) => mockStartGame(...a),
    resumeGame: (...a: unknown[]) => mockResumeGame(...a),
    markStarted: jest.fn(),
    discardGame: jest.fn(),
    completeGame: (...a: unknown[]) => mockCompleteGame(...a),
    enqueueEvents: (gameId: string, events: readonly SavedEvent[]) =>
      mockEnqueueEvents(gameId, events),
  })
);

jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(
    () => ({
      goBack: jest.fn(),
      popToTop: jest.fn(),
      navigate: jest.fn(),
      addListener: jest.fn(() => jest.fn()),
    }),
    { useFocusEffect: jest.fn() }
  )
);
jest.mock("../../game/_shared/useSound", () => mockScreenDeps().mockSoundByName(() => []));

jest.useFakeTimers();

async function mountOn(state: HeartsState | null) {
  (loadGame as jest.Mock).mockResolvedValue(state);
  const api = await render(
    <ThemeProvider>
      <HeartsRoundsProvider>
        <HeartsScreen />
      </HeartsRoundsProvider>
    </ThemeProvider>
  );
  await waitFor(() => expect(loadGame).toHaveBeenCalled());
  await waitFor(() =>
    state === null
      ? expect(api.getByTestId("hearts-start-game")).toBeTruthy()
      : expect(api.queryByTestId("hearts-start-game")).toBeNull()
  );
  await act(async () => {
    await Promise.resolve();
  });
  return api;
}

type Api = Awaited<ReturnType<typeof mountOn>>;

const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

async function advanceSteps(total: number, step: number) {
  for (let elapsed = 0; elapsed < total; elapsed += step) await advance(step);
}

async function press(api: Api, label: string | RegExp) {
  await act(async () => {
    await fireEvent.press(api.getByLabelText(label));
  });
}

/** Every event the recorder has saved, in order, with the game it was saved to. */
function saved(): { gameId: string; type: string; data: Record<string, unknown> }[] {
  return mockEnqueueEvents.mock.calls.flatMap(([gameId, events]) =>
    events.map((e) => ({ gameId, type: e.type, data: e.data }))
  );
}
const savedOf = (type: string) => saved().filter((e) => e.type === type);

beforeEach(() => {
  setRng(createSeededRng(42));
  mockStartGame.mockClear();
  mockResumeGame.mockReset();
  mockResumeGame.mockReturnValue(null);
  mockEnqueueEvents.mockClear();
  mockCompleteGame.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
  (loadGame as jest.Mock).mockResolvedValue(null);
});

// Seat 1 led 5♦, 2 played 9♦, 3 played 7♦; the human's 10♦ takes the trick (the 5th of hand 4).
const humanCompletes = (overrides: Partial<HeartsState> = {}) =>
  heartsPlay({
    currentLeaderIndex: 1,
    currentPlayerIndex: 0,
    currentTrick: [
      { playerIndex: 1, card: heartsCard("diamonds", 5) },
      { playerIndex: 2, card: heartsCard("diamonds", 9) },
      { playerIndex: 3, card: heartsCard("diamonds", 7) },
    ],
    playerHands: [
      [heartsCard("diamonds", 10), heartsCard("diamonds", 3), heartsCard("clubs", 4)],
      [heartsCard("diamonds", 2), heartsCard("clubs", 6)],
      [heartsCard("diamonds", 4), heartsCard("clubs", 8)],
      [heartsCard("diamonds", 6), heartsCard("clubs", 9)],
    ],
    ...overrides,
  });

describe("a trick completed by the human", () => {
  it("is held through the collect animation, then saved as one trick_completed unit", async () => {
    const api = await mountOn(humanCompletes());
    await press(api, /^10 of Diamonds/);
    // The animation is running: nothing has reached the recorder, let alone the queue.
    await advance(200);
    expect(saved()).toEqual([]);

    await advance(3000); // the take-away animation ends
    await advance(50); // the recorder's idle moment
    expect(saved()).toEqual([
      {
        gameId: "hearts-game-1",
        type: "trick_completed",
        data: {
          v: 1,
          unit: trickUnit(4, 5),
          t_ms: expect.any(Number),
          h: 4,
          n: 5,
          l: 1,
          c: "5D9D7DTD",
          w: 0,
          hb: 1,
        },
      },
    ]);
    // one save, not one per card
    expect(mockEnqueueEvents).toHaveBeenCalledTimes(1);
  });

  it("starts the session with the seats, the preset and the target score", async () => {
    const api = await mountOn(humanCompletes({ aiDifficulty: "mixed" }));
    await press(api, /^10 of Diamonds/);
    expect(mockStartGame).toHaveBeenCalledWith(
      "hearts",
      { ai_difficulty: "mixed" },
      {
        initial_score: 0,
        preset: "mixed",
        target: 100,
        seats: ["human", "cautious", "schemer", "daring"],
      }
    );
  });

  it("is saved at once when the app goes to the background, not at the next idle moment", async () => {
    const listeners: ((state: string) => void)[] = [];
    const real = AppState.addEventListener;
    AppState.addEventListener = ((_type: string, handler: (state: string) => void) => {
      listeners.push(handler);
      return { remove: jest.fn() };
    }) as unknown as typeof AppState.addEventListener;
    try {
      const api = await mountOn(humanCompletes());
      await press(api, /^10 of Diamonds/);
      await advance(200);
      expect(saved()).toEqual([]);

      // No timer advances: the save is synchronous.
      await act(async () => {
        listeners.forEach((l) => l("background"));
      });
      expect(savedOf("trick_completed")).toHaveLength(1);
      expect(savedOf("trick_completed")[0]!.data).toMatchObject({ n: 5, c: "5D9D7DTD", w: 0 });

      // And it is not saved a second time when the animation ends.
      await advance(4000);
      expect(savedOf("trick_completed")).toHaveLength(1);
    } finally {
      AppState.addEventListener = real;
    }
  });

  it("is saved with the session when the screen closes mid-animation, before the abandon", async () => {
    const api = await mountOn(humanCompletes());
    await press(api, /^10 of Diamonds/);
    await advance(200);
    expect(saved()).toEqual([]);
    await api.unmount();
    expect(savedOf("trick_completed")).toHaveLength(1);
    expect(savedOf("trick_completed")[0]!.gameId).toBe("hearts-game-1");
    expect(mockEnqueueEvents.mock.invocationCallOrder[0]!).toBeLessThan(
      mockCompleteGame.mock.invocationCallOrder[0] ?? Infinity
    );
  });
});

describe("a trick completed by the AI", () => {
  // The human led 10♦; the AIs must follow with a lower diamond, so the human wins.
  const humanLeads = () =>
    heartsPlay({
      aiDifficulty: "conservative",
      handNumber: 4,
      currentLeaderIndex: 0,
      currentPlayerIndex: 1,
      currentTrick: [{ playerIndex: 0, card: heartsCard("diamonds", 10) }],
      playerHands: [
        [heartsCard("diamonds", 3), heartsCard("clubs", 4)],
        [heartsCard("diamonds", 2), heartsCard("diamonds", 6)],
        [heartsCard("diamonds", 5), heartsCard("diamonds", 8)],
        [heartsCard("diamonds", 4), heartsCard("diamonds", 9)],
      ],
    });

  it("is saved after the animation, with the CPU principles of its plays and none for the human", async () => {
    // The human's lead was played before the kill; the session is the killed process's.
    mockResumeGame.mockReturnValue("killed-session");
    await mountOn(humanLeads());
    await advanceSteps(1300, 400); // three AI plays, 400 ms apart
    await advance(200);
    expect(saved()).toEqual([]); // the trick is on the table, animating

    await advance(3000);
    await advance(50);
    const [trick] = savedOf("trick_completed");
    expect(savedOf("trick_completed")).toHaveLength(1);
    expect(trick!.gameId).toBe("killed-session");
    expect(trick!.data).toMatchObject({ h: 4, n: 5, l: 0, w: 0 });
    expect(trick!.data.c).toMatch(/^TD(?:[2-9]D){3}$/);
    // The human led: no principle for seat 0. The CPUs' come from the decision the AI made.
    const r = trick!.data.r as number[] | undefined;
    if (r) {
      expect(r).toHaveLength(4);
      expect(r[0]).toBe(0);
      for (const n of r) expect(n).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("the last trick of a hand", () => {
  // Hand 4's 13th trick, completed by the human; the hand had already scored 26 points.
  const last = () =>
    humanCompletes({
      tricksPlayedInHand: 12,
      cumulativeScores: [20, 40, 30, 10],
      handScores: [13, 0, 10, 3],
      playerHands: [
        [heartsCard("diamonds", 10)],
        [heartsCard("diamonds", 2)],
        [heartsCard("diamonds", 4)],
        [heartsCard("diamonds", 6)],
      ],
    });

  it("goes with hand_scored in the same unit, at once: there is no animation to wait for", async () => {
    const api = await mountOn(last());
    await press(api, /^10 of Diamonds/);
    await advance(50);
    expect(mockEnqueueEvents).toHaveBeenCalledTimes(1);
    expect(saved().map((e) => [e.type, e.data.unit])).toEqual([
      ["trick_completed", trickUnit(4, 13)],
      ["hand_scored", trickUnit(4, 13)],
    ]);
    expect(savedOf("hand_scored")[0]!.data).toMatchObject({
      h: 4,
      s: [13, 0, 10, 3],
      t: [33, 40, 40, 13],
    });
    expect(savedOf("hand_scored")[0]!.data).not.toHaveProperty("m");
  });
});

describe("a game resumed after a kill", () => {
  it("carries on the unit numbers from the hand and trick it restores, saving to the continued session", async () => {
    mockResumeGame.mockReturnValue("killed-session");
    const api = await mountOn(humanCompletes({ handNumber: 7, tricksPlayedInHand: 8 }));
    await press(api, /^10 of Diamonds/);
    await advance(3000);
    await advance(50);
    expect(mockStartGame).not.toHaveBeenCalled();
    const [trick] = savedOf("trick_completed");
    expect(trick!.gameId).toBe("killed-session");
    // not unit 1: the 9th trick of hand 7 is unit 101, whatever the new process has recorded
    expect(trick!.data).toMatchObject({ unit: trickUnit(7, 9), h: 7, n: 9 });
    expect(trickUnit(7, 9)).toBe(101);
  });
});

describe("the deal and the pass", () => {
  // Hand 1, to pass left. The human holds every club (2♣ leads the first trick) and
  // passes the three highest; West the diamonds, North the spades, East the hearts.
  const passing = (): HeartsState => ({
    ...heartsPlay({
      aiDifficulty: "conservative",
      handNumber: 1,
      passDirection: "left",
      phase: "passing",
      passingComplete: false,
      heartsBroken: false,
      tricksPlayedInHand: 0,
      currentLeaderIndex: 0,
      currentPlayerIndex: 0,
    }),
    playerHands: [
      hand("2C3C4C5C6C7C8C9CTCJCQCKCAC"),
      hand("2D3D4D5D6D7D8D9DTDJDQDKDAD"),
      hand("2S3S4S5S6S7S8S9STSJSQSKSAS"),
      hand("2H3H4H5H6H7H8H9HTHJHQHKHAH"),
    ],
  });

  it("waits for the first card to open the game session, then goes with it: hand_dealt, then pass_committed", async () => {
    jest.spyOn(engine, "dealGame").mockReturnValue(passing());
    const api = await mountOn(null);
    await act(async () => {
      await fireEvent.press(api.getByTestId("hearts-start-game"));
    });
    for (const i of [10, 11, 12]) {
      await act(async () => {
        await fireEvent.press(api.getByTestId(`hearts-hand-card-${i}`));
      });
    }
    await press(api, /^Confirm/);
    await advance(500);
    // The deal and the pass are done, and no card has been played: no session, nothing saved.
    expect(mockStartGame).not.toHaveBeenCalled();
    expect(saved()).toEqual([]);

    await press(api, /^2 of Clubs/); // the human leads the first trick
    await advance(50);
    expect(mockStartGame).toHaveBeenCalledTimes(1);
    expect(saved().map((e) => [e.type, e.data.unit])).toEqual([
      ["hand_dealt", 1],
      ["pass_committed", 2],
    ]);
    const [dealt] = savedOf("hand_dealt");
    expect(dealt!.data).toMatchObject({
      h: 1,
      d: 0,
      c: [
        "2C3C4C5C6C7C8C9CTCJCQCKCAC",
        "2D3D4D5D6D7D8D9DTDJDQDKDAD",
        "2S3S4S5S6S7S8S9STSJSQSKSAS",
        "2H3H4H5H6H7H8H9HTHJHQHKHAH",
      ],
    });
    const [pass] = savedOf("pass_committed");
    expect(pass!.data).toMatchObject({ h: 1, p: expect.any(Array) });
    expect((pass!.data.p as string[])[0]).toBe("QCKCAC"); // the human's three, in the order chosen
    expect(
      (pass!.data.p as string[]).slice(1).every((p) => /^(?:[2-9TJQKA][CDHS]){3}$/.test(p))
    ).toBe(true);
    // seats 1-3 are conservative CPUs: their pass cards carry a principle number
    const r = pass!.data.r as unknown[];
    expect(r[0]).toBe(0);
    expect(r.slice(1).every((entry) => Array.isArray(entry) && entry.length === 3)).toBe(true);
  });
});
