/**
 * HeartsScreen's off-table report (#3653): the player's fanned hand and the trick
 * against the measured table. A table too short for the 13-card fan at the smallest
 * cards is reported; the mockup's table is not, nor is the first-frame estimate.
 */

import React from "react";
import * as Sentry from "@sentry/react-native";
import { Dimensions } from "react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

import HeartsScreen from "../HeartsScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { HeartsRoundsProvider } from "../../game/hearts/RoundsContext";
import { createSeededRng, setRng } from "../../game/hearts/engine";
import { loadGame } from "../../game/hearts/storage";
import {
  TABLE_CHROME_HEIGHT,
  computeHeartsGeometry,
  handCardBounds,
} from "../../game/hearts/layout";
import type { HeartsState } from "../../game/hearts/types";
import { resetSentryThrottle } from "../../game/_shared/sentryThrottle";
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
jest.mock("../../game/_shared/gameEventClient", () => mockScreenDeps().mockGameEventClient());
jest.mock("../../game/_shared/displayNameSync", () => mockScreenDeps().mockDisplayNameSync());
jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(
    () => ({
      goBack: jest.fn(),
      popToTop: jest.fn(),
      navigate: jest.fn(),
      addListener: jest.fn(() => jest.fn()),
    }),
    {
      useFocusEffect: (effect: () => void | (() => void)) => {
        const { useEffect } = jest.requireActual<typeof import("react")>("react");
        useEffect(effect, [effect]);
      },
    }
  )
);
const mockPlayed: string[] = [];
jest.mock("../../game/_shared/useSound", () => mockScreenDeps().mockSoundByName(() => mockPlayed));

jest.useFakeTimers();

const capture = Sentry.captureMessage as jest.Mock;
const offTableCalls = () => capture.mock.calls.filter((call) => call[0] === "cards.offTable");

/** The human to play, holding 13 clubs and spades, with West's lead on the table. */
function fullHand(): HeartsState {
  const hand = Array.from({ length: 13 }, (_, i) =>
    heartsCard(i % 2 ? "spades" : "clubs", (2 + (i >> 1)) as 2)
  );
  return heartsPlay({
    tricksPlayedInHand: 0,
    currentLeaderIndex: 1,
    currentPlayerIndex: 0,
    currentTrick: [{ card: heartsCard("diamonds", 5), playerIndex: 1 }],
    playerHands: [hand, [], [], []],
  });
}

async function mountOn(state: HeartsState) {
  (loadGame as jest.Mock).mockResolvedValue(state);
  const api = await render(
    <ThemeProvider>
      <HeartsRoundsProvider>
        <HeartsScreen />
      </HeartsRoundsProvider>
    </ThemeProvider>
  );
  await waitFor(() => expect(loadGame).toHaveBeenCalled());
  await waitFor(() => expect(api.queryByTestId("hearts-start-game")).toBeNull());
  await act(async () => {
    await Promise.resolve();
  });
  return api;
}
type Api = Awaited<ReturnType<typeof mountOn>>;

async function layoutTable(api: Api, width: number, height: number) {
  await act(async () => {
    fireEvent(api.getByTestId("hearts-table"), "layout", {
      nativeEvent: { layout: { x: 0, y: 0, width, height } },
    });
  });
}

beforeEach(() => {
  setRng(createSeededRng(42));
  mockPlayed.length = 0;
  (loadGame as jest.Mock).mockClear();
  resetSentryThrottle();
  capture.mockClear();
});

afterEach(() => {
  (loadGame as jest.Mock).mockResolvedValue(null);
  jest.restoreAllMocks();
});

describe("HeartsScreen reports cards off the table (#3653)", () => {
  it("sends nothing for the mockup's table (390 x 708)", async () => {
    const api = await mountOn(fullHand());
    await layoutTable(api, 390, 708);
    expect(offTableCalls()).toEqual([]);
  });

  it("never checks the first-frame estimate", async () => {
    // The window less the chrome estimates the same short table that overflows below.
    const original = Dimensions.get("window");
    Dimensions.set({
      window: { width: 250, height: 300 + TABLE_CHROME_HEIGHT, scale: 2, fontScale: 1 },
    });
    try {
      await mountOn(fullHand());
      expect(offTableCalls()).toEqual([]);
    } finally {
      Dimensions.set({ window: original });
    }
  });

  it("reports a measured table too short for the hand, with the layout's numbers", async () => {
    const api = await mountOn(fullHand());
    await layoutTable(api, 250, 300);
    expect(offTableCalls()).toHaveLength(1);
    const [, { tags, extra }] = offTableCalls()[0];
    const g = computeHeartsGeometry({ width: 250, height: 300 });
    const bottom = Math.max(...handCardBounds(g.hand, 13).map((b) => b.y + b.h));
    expect(tags).toEqual({
      game: "hearts",
      edge: "bottom",
      deck: "minimal",
      largeCards: "false",
      platform: "ios",
    });
    expect(extra).toMatchObject({
      overflow: Math.round((bottom - 300) * 10) / 10,
      containerWidth: 250,
      containerHeight: 300,
      feltWidth: g.felt.w,
      feltHeight: g.felt.h,
      cardWidth: g.hand.cardW,
      cardHeight: g.hand.cardH,
      compression: "portrait",
      handLengths: [13],
      trickLength: 1,
    });
  });
});
