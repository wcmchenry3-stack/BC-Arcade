/**
 * HeartsScreen card table (#3587): the felt, the four seat plates (name, score, this hand's
 * points, turn glow), the pile detail behind a plate, the geometry applied from the table's
 * measured size, and the trick-animation hand-off that must still resolve the AI loop. Each
 * test resumes a hand-built game (helpers/heartsFixtures) through the mocked `loadGame`.
 */

import React from "react";
import { StyleSheet } from "react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

import HeartsScreen from "../HeartsScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { HeartsRoundsProvider } from "../../game/hearts/RoundsContext";
import { createSeededRng, setRng } from "../../game/hearts/engine";
import { loadGame } from "../../game/hearts/storage";
import { computeHeartsGeometry } from "../../game/hearts/layout";
import type { HeartsState } from "../../game/hearts/types";
import { playedCount } from "../../test-utils/mockScreenDeps";
import { HEARTS_CARD_PLAY, HEARTS_TRICK_WON } from "../../game/hearts/sounds";
import { AI_PACE_MS } from "../../components/hearts/trickMotion";
import {
  mockReduceMotion,
  flushReduceMotion,
} from "../../components/hearts/__tests__/helpers/animationFixtures";
import i18n from "i18next";
import EnHearts from "../../i18n/locales/en/hearts.json";
import { heartsCard, heartsDealing, heartsPlay } from "./helpers/heartsFixtures";

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
const played = (name: string) => playedCount(mockPlayed, name);
// Card plays and trick wins pick one of their variants at random (#3601): count them all.
const cardPlays = () => HEARTS_CARD_PLAY.reduce((n, key) => n + played(key), 0);
const trickWins = () => HEARTS_TRICK_WON.reduce((n, key) => n + played(key), 0);

jest.useFakeTimers();

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

const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

async function press(api: Api, label: string | RegExp) {
  await act(async () => {
    await fireEvent.press(api.getByLabelText(label));
  });
}

/** The table's measured size arriving (RNTL never lays out, so a test sends it). */
async function layoutTable(api: Api, width: number, height: number) {
  await act(async () => {
    fireEvent(api.getByTestId("hearts-table"), "layout", {
      nativeEvent: { layout: { x: 0, y: 0, width, height } },
    });
  });
}

const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never);

beforeEach(() => {
  setRng(createSeededRng(42));
  mockPlayed.length = 0;
  (loadGame as jest.Mock).mockClear();
});

afterEach(() => {
  (loadGame as jest.Mock).mockResolvedValue(null);
  jest.restoreAllMocks();
});

// Seat 1 led 3♥, 2 played 2♥, 3 played 4♥: the human's 10♥ takes four hearts. Everyone holds
// one more card, so the hand goes on afterwards.
const humanTakesHearts = () =>
  heartsPlay({
    currentLeaderIndex: 1,
    currentPlayerIndex: 0,
    cumulativeScores: [34, 52, 41, 60],
    currentTrick: [
      { playerIndex: 1, card: heartsCard("hearts", 3) },
      { playerIndex: 2, card: heartsCard("hearts", 2) },
      { playerIndex: 3, card: heartsCard("hearts", 4) },
    ],
    playerHands: [
      [heartsCard("hearts", 10), heartsCard("clubs", 4)],
      [heartsCard("clubs", 6)],
      [heartsCard("clubs", 8)],
      [heartsCard("clubs", 9)],
    ],
  });

describe("the seat plates", () => {
  it("show each seat's name and game score during play", async () => {
    const api = await mountOn(humanTakesHearts());
    for (const [seat, name, score] of [
      [0, "You", "34"],
      [1, "West", "52"],
      [2, "North", "41"],
      [3, "East", "60"],
    ] as const) {
      const plate = api.getByTestId(`hearts-plate-${seat}`);
      expect(plate).toBeTruthy();
      expect(api.getByLabelText(new RegExp(`^${name}, score ${score}`))).toBe(plate);
    }
  });

  it("show a seat's points this hand as +N♥ only once they are above 0", async () => {
    const api = await mountOn(
      heartsPlay({
        playerHands: [[heartsCard("clubs", 4)], [], [], []],
        wonCards: [[], [heartsCard("hearts", 2), heartsCard("spades", 12)], [], []],
      })
    );
    // West holds a heart and the queen: 14.
    expect(api.getByText("+14♥")).toBeTruthy();
    expect(api.getAllByText(/^\+\d+♥$/)).toHaveLength(1);
    expect(api.getByLabelText(/^West, score 0, 14 points this hand/)).toBeTruthy();
  });

  it("give the turn glow to the seat that is to play, and to nobody while passing", async () => {
    const api = await mountOn(heartsPlay({ currentPlayerIndex: 0 }));
    const accent = flat(api.getByTestId("hearts-plate-0")).borderColor;
    // The human's turn: only the human's plate carries the glow and the "your turn" label.
    expect(flat(api.getByTestId("hearts-plate-0")).shadowOpacity).toBeGreaterThan(0);
    for (const seat of [1, 2, 3]) {
      expect(flat(api.getByTestId(`hearts-plate-${seat}`)).borderColor).not.toBe(accent);
      expect(flat(api.getByTestId(`hearts-plate-${seat}`)).shadowOpacity).toBeUndefined();
    }
    expect(api.getByLabelText(/^You, score 0, your turn$/)).toBeTruthy();
    expect(api.getByLabelText(/^West, score 0$/)).toBeTruthy();
  });

  it("move the glow with the turn", async () => {
    const api = await mountOn(
      heartsPlay({
        currentLeaderIndex: 0,
        currentPlayerIndex: 1,
        currentTrick: [{ playerIndex: 0, card: heartsCard("diamonds", 10) }],
        playerHands: [
          [heartsCard("diamonds", 3), heartsCard("clubs", 4)],
          [heartsCard("diamonds", 2), heartsCard("diamonds", 6)],
          [heartsCard("diamonds", 5), heartsCard("diamonds", 8)],
          [heartsCard("diamonds", 4), heartsCard("diamonds", 9)],
        ],
      })
    );
    // West plays first, after the AI's pause (AI_PACE_MS, #3574).
    expect(api.getByLabelText(/^West, score 0, their turn$/)).toBeTruthy();
    expect(api.getByLabelText(/^You, score 0$/)).toBeTruthy();
    await advance(AI_PACE_MS);
    expect(api.getByLabelText(/^North, score 0, their turn$/)).toBeTruthy();
    expect(api.getByLabelText(/^West, score 0$/)).toBeTruthy();
  });

  it("update live: the human's trick adds +4♥ to their plate", async () => {
    const api = await mountOn(humanTakesHearts());
    expect(api.queryByText("+4♥")).toBeNull();
    await press(api, /^10 of Hearts/);
    expect(api.getByText("+4♥")).toBeTruthy();
    expect(api.getByLabelText(/^You, score 34, 4 points this hand/)).toBeTruthy();
  });

  it("show a renamed seat's name", async () => {
    const { loadPlayerNames } = jest.requireMock("../../game/hearts/playerNames") as {
      loadPlayerNames: jest.Mock;
    };
    loadPlayerNames.mockResolvedValueOnce(["Ada", "Bo", "Cy", "Di"]);
    const api = await mountOn(humanTakesHearts());
    await waitFor(() => expect(api.getByLabelText(/^Ada, score 34/)).toBeTruthy());
    expect(api.getByLabelText(/^Di, score 60/)).toBeTruthy();
  });
});

describe("the captured cards behind a plate", () => {
  it("no longer show a TAKEN row on the table", async () => {
    const api = await mountOn(humanTakesHearts());
    expect(api.queryByText("TAKEN")).toBeNull();
    expect(api.queryByText("Nothing yet")).toBeNull();
  });

  it("open from your plate, with the cards you have taken, and close again", async () => {
    const api = await mountOn(
      heartsPlay({
        playerHands: [[heartsCard("clubs", 4)], [], [], []],
        wonCards: [[heartsCard("hearts", 7), heartsCard("spades", 12)], [], [], []],
      })
    );
    await press(api, /^You, score 0/);
    expect(api.getByText("You: cards taken")).toBeTruthy();
    expect(api.getByText("TAKEN")).toBeTruthy();
    expect(api.getByLabelText("You have taken 2 cards, 14 penalty points")).toBeTruthy();
    await press(api, "Close");
    expect(api.queryByText("You: cards taken")).toBeNull();
  });

  it("open from an opponent's plate too", async () => {
    const api = await mountOn(
      heartsPlay({
        playerHands: [[heartsCard("clubs", 4)], [], [], []],
        wonCards: [[], [], [heartsCard("hearts", 7)], []],
      })
    );
    await press(api, /^North, score 0/);
    expect(api.getByText("North: cards taken")).toBeTruthy();
    expect(api.getByLabelText("North has taken 1 cards, 1 penalty points")).toBeTruthy();
  });
});

describe("the table's geometry", () => {
  it("lays out the felt, plates and hand from the measured size (390 x 708: the mockup)", async () => {
    const api = await mountOn(humanTakesHearts());
    await layoutTable(api, 390, 708);
    const g = computeHeartsGeometry({ width: 390, height: 708 });
    const felt = flat(api.getByTestId("hearts-felt"));
    expect([felt.left, felt.top, felt.width, felt.height, felt.borderRadius]).toEqual([
      14, 64, 362, 392, 48,
    ]);
    const hand = flat(api.getByTestId("hearts-player-hand-area"));
    expect([hand.left, hand.top]).toEqual([g.hand.rect.x, g.hand.rect.y]);
    // The plates' wrappers sit where the geometry puts them.
    const northSlot = flat(api.getByTestId("hearts-plate-2-slot"));
    expect(northSlot.top).toBe(g.plates.top.rect.y);
    expect(northSlot.left).toBe(g.plates.top.rect.x);
  });

  it("re-lays out in landscape", async () => {
    const api = await mountOn(humanTakesHearts());
    await layoutTable(api, 844, 285);
    const g = computeHeartsGeometry({ width: 844, height: 285 });
    expect(g.mode).toBe("landscape");
    const felt = flat(api.getByTestId("hearts-felt"));
    expect([felt.left, felt.top, felt.width, felt.height]).toEqual([
      g.felt.x,
      g.felt.y,
      g.felt.w,
      g.felt.h,
    ]);
    await layoutTable(api, 390, 708);
    expect(flat(api.getByTestId("hearts-felt")).width).toBe(362);
  });
});

describe("passing", () => {
  it("shows the pass banner inside the felt, with the hand still selectable", async () => {
    const hand = Array.from({ length: 13 }, (_, i) =>
      heartsCard(["clubs", "diamonds", "spades", "hearts"][i % 4] as "clubs", (2 + (i >> 2)) as 2)
    );
    const api = await mountOn(
      heartsPlay({
        phase: "passing",
        passDirection: "left",
        passingComplete: false,
        playerHands: [hand, [], [], []],
      })
    );
    await layoutTable(api, 390, 708);
    const g = computeHeartsGeometry({ width: 390, height: 708 });
    expect(api.getByText("0 of 3 selected")).toBeTruthy();
    expect(api.queryByLabelText(/(their|your) turn/)).toBeNull();
    const banner = flat(api.getByTestId("hearts-pass-banner"));
    expect(banner.top).toBe(g.passBanner.y);
    expect(banner.left).toBe(g.passBanner.x);
    expect(banner.top as number).toBeGreaterThanOrEqual(g.felt.y);
    await act(async () => {
      await fireEvent.press(api.getByTestId("hearts-hand-card-0"));
    });
    expect(api.getByText("1 of 3 selected")).toBeTruthy();
  });
});

describe("the trick animation still resolves the AI loop (no frozen turns)", () => {
  const humanLeads = () =>
    heartsPlay({
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

  it("hands the turn back to the human after the sweep", async () => {
    const api = await mountOn(humanLeads());
    await layoutTable(api, 390, 708);
    for (let i = 0; i < 4; i++) await advance(AI_PACE_MS);
    expect(cardPlays()).toBe(3);
    await advance(3000);
    expect(trickWins()).toBe(1);
    await press(api, /^3 of Diamonds/);
    expect(api.getByLabelText("Your hand, 1 cards")).toBeTruthy();
  });

  it("does the same with Reduce Motion on, with the plates still showing the turn", async () => {
    mockReduceMotion(true);
    const api = await mountOn(humanLeads());
    await flushReduceMotion();
    await layoutTable(api, 390, 708);
    // Static styles only: the glow is a border and a shadow, not an animation.
    expect(flat(api.getByTestId("hearts-plate-1")).shadowOpacity).toBeGreaterThan(0);
    for (let i = 0; i < 4; i++) await advance(AI_PACE_MS);
    await advance(3000);
    expect(trickWins()).toBe(1);
    // The human took the trick, so the turn, and the glow, are theirs again.
    expect(api.getByLabelText(/^You, score 0, your turn$/)).toBeTruthy();
    await press(api, /^3 of Diamonds/);
    expect(api.getByLabelText("Your hand, 1 cards")).toBeTruthy();
  });
});

describe("the captured-cards dialog follows the game", () => {
  // The human plays the last card of the hand: 13th trick.
  const lastTrick = () =>
    heartsPlay({
      tricksPlayedInHand: 12,
      currentLeaderIndex: 1,
      currentPlayerIndex: 0,
      currentTrick: [
        { playerIndex: 1, card: heartsCard("clubs", 3) },
        { playerIndex: 2, card: heartsCard("clubs", 2) },
        { playerIndex: 3, card: heartsCard("clubs", 4) },
      ],
      playerHands: [[heartsCard("clubs", 10)], [], [], []],
    });

  it("closes when the hand ends, and Hand Complete is shown", async () => {
    const api = await mountOn(lastTrick());
    await press(api, /^You, score 0/);
    expect(api.getByText("You: cards taken")).toBeTruthy();
    await act(async () => {
      await fireEvent.press(
        api.getByTestId("hearts-hand-playable-0", { includeHiddenElements: true })
      );
    });
    expect(api.queryByText("You: cards taken")).toBeNull();
    expect(api.getByText("Hand Complete")).toBeTruthy();
  });

  it("does not open from a plate once the hand is over", async () => {
    const api = await mountOn(heartsDealing());
    expect(api.getByText("Hand Complete")).toBeTruthy();
    await act(async () => {
      await fireEvent.press(api.getByTestId("hearts-plate-0", { includeHiddenElements: true }));
    });
    expect(api.queryByText("You: cards taken")).toBeNull();
  });
});

describe("layering and the pass banner", () => {
  it("draws the trick above the plates, and the plates with no Android elevation", async () => {
    const api = await mountOn(humanTakesHearts());
    const trick = flat(api.getByTestId("hearts-trick"));
    // Raised above the plates and the pass banner, so it must not catch their taps.
    expect(api.getByTestId("hearts-trick").props.pointerEvents).toBe("none");
    expect(trick.elevation).toBeGreaterThan(0);
    expect(trick.zIndex).toBeGreaterThan(0);
    for (const seat of [0, 1, 2, 3]) {
      const slot = flat(api.getByTestId(`hearts-plate-${seat}-slot`));
      const plate = flat(api.getByTestId(`hearts-plate-${seat}`));
      expect(plate.elevation ?? 0).toBeLessThan(trick.elevation as number);
      expect(slot.elevation ?? 0).toBeLessThan(trick.elevation as number);
      expect(slot.zIndex ?? 0).toBeLessThan(trick.zIndex as number);
    }
  });

  it("caps the pass banner's height and lines, so a long string cannot reach the plates", async () => {
    i18n.addResource("en", "hearts", "pass.title", "Choose three cards ".repeat(12));
    try {
      const hand = Array.from({ length: 13 }, (_, i) =>
        heartsCard(["clubs", "diamonds", "spades", "hearts"][i % 4] as "clubs", (2 + (i >> 2)) as 2)
      );
      const api = await mountOn(
        heartsPlay({
          phase: "passing",
          passDirection: "left",
          passingComplete: false,
          playerHands: [hand, [], [], []],
        })
      );
      await layoutTable(api, 320, 432);
      const g = computeHeartsGeometry({ width: 320, height: 432 });
      const banner = flat(api.getByTestId("hearts-pass-banner"));
      expect(banner.maxHeight).toBe(g.passBanner.h);
      expect(banner.overflow).toBe("hidden");
      // The edge margins PassBanner has by default are cleared too (they beat `margin`).
      expect(banner.marginHorizontal).toBe(0);
      expect(banner.marginBottom).toBe(0);
      expect(banner.elevation).toBeGreaterThanOrEqual(4);
      expect(banner.zIndex).toBeGreaterThanOrEqual(4);
      expect(api.getByText(/^Choose three cards/).props.numberOfLines).toBe(1);
      expect(api.getByText("Pass left").props.numberOfLines).toBe(1);
      expect(api.getByText("0 of 3 selected").props.numberOfLines).toBe(1);
    } finally {
      i18n.removeResourceBundle("en", "hearts");
      i18n.addResourceBundle("en", "hearts", EnHearts, true, true);
    }
  });
});

describe("the pass banner's width and room come from the geometry (no wide-then-narrow frame)", () => {
  const passing = () => {
    const hand = Array.from({ length: 13 }, (_, i) =>
      heartsCard(["clubs", "diamonds", "spades", "hearts"][i % 4] as "clubs", (2 + (i >> 2)) as 2)
    );
    return heartsPlay({
      phase: "passing",
      passDirection: "left",
      passingComplete: false,
      playerHands: [hand, [], [], []],
    });
  };
  const counterHidden = (api: Api) => flat(api.getByText("0 of 3 selected") as never).width === 1;

  it("hides the count at 320 dp from the first measure, and draws it on a wide, tall table", async () => {
    const small = await mountOn(passing());
    await layoutTable(small, 320, 432);
    expect(computeHeartsGeometry({ width: 320, height: 432 }).passBanner.w).toBeLessThan(260);
    expect(counterHidden(small)).toBe(true);
    await small.unmount();

    const wide = await mountOn(passing());
    await layoutTable(wide, 430, 796);
    const g = computeHeartsGeometry({ width: 430, height: 796 });
    expect(g.passBanner.w).toBeGreaterThanOrEqual(260);
    expect(g.passBanner.h).toBeGreaterThanOrEqual(62);
    expect(counterHidden(wide)).toBe(false);
    // The screen decides: no onLayout fallback on the banner.
    expect(wide.getByTestId("hearts-pass-banner").props.onLayout).toBeUndefined();
  });
});

describe("overlays draw above the trick", () => {
  it("never catch taps (the layers are non-interactive)", async () => {
    const api = await mountOn(humanTakesHearts());
    for (const id of ["hearts-overlay-broken", "hearts-overlay-moon", "hearts-overlay-queen"]) {
      expect(api.getByTestId(id).props.pointerEvents).toBe("none");
    }
  });

  it("lifts the hearts broken, Moon Shot and Queen of Spades layers above the trick (zIndex and elevation)", async () => {
    const api = await mountOn(humanTakesHearts());
    const trick = flat(api.getByTestId("hearts-trick"));
    for (const id of ["hearts-overlay-broken", "hearts-overlay-moon", "hearts-overlay-queen"]) {
      const layer = flat(api.getByTestId(id));
      expect(layer.zIndex).toBeGreaterThan(trick.zIndex as number);
      expect(layer.elevation).toBeGreaterThan(trick.elevation as number);
      expect(layer.zIndex).toBeGreaterThanOrEqual(5);
    }
  });
});
