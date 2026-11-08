/**
 * HeartsScreen hand flow (#2957): passing, the trick animation hand-off between
 * the human and the AI loop, the between-hands card, the event overlays and
 * their sounds, the rename modal, blur-time saving, the debug panel and the
 * header's back and New Game. Each test resumes a hand-built game
 * (helpers/heartsFixtures) through the mocked `loadGame`.
 */

import React from "react";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react-native";

import HeartsScreen from "../HeartsScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { HeartsRoundsProvider } from "../../game/hearts/RoundsContext";
import { createSeededRng, dealGame, setRng } from "../../game/hearts/engine";
import { loadGame, saveGame } from "../../game/hearts/storage";
import { loadPlayerNames, savePlayerNames } from "../../game/hearts/playerNames";
import i18n from "i18next";
import EsHearts from "../../i18n/locales/es/hearts.json";
import FrCaHearts from "../../i18n/locales/fr-CA/hearts.json";
import FrCaCommon from "../../i18n/locales/fr-CA/common.json";
import EsCommon from "../../i18n/locales/es/common.json";
import type { HeartsState } from "../../game/hearts/types";
import { playedCount } from "../../test-utils/mockScreenDeps";
import { heartsCard, heartsDealing, heartsPlay, moonHaul } from "./helpers/heartsFixtures";
import { HEARTS_CARD_PLAY, HEARTS_TRICK_WON } from "../../game/hearts/sounds";
import { BROKEN_TIMING, MOON_TIMING, QUEEN_TIMING } from "../../components/hearts/momentTimeline";
import { AccessibilityInfo } from "react-native";
import { resetReduceMotionForTests } from "../../components/shared/useReduceMotion";
import * as brokenModule from "../../components/hearts/HeartsBrokenAnimation";

// These tests drive the pre-game picker flow, so they run with the opponent picker switch on
// (#3489). The switch-off flow is in HeartsScreen.noPicker.test.tsx.
const mockPickerEnabled = true;
jest.mock("../../game/hearts/types", () => {
  const actual = jest.requireActual("../../game/hearts/types");
  return Object.defineProperty({ ...actual }, "HEARTS_OPPONENT_PICKER_ENABLED", {
    enumerable: true,
    get: () => mockPickerEnabled,
  });
});

jest.mock("../../game/hearts/storage", () => ({
  loadGame: jest.fn().mockResolvedValue(null),
  saveGame: jest.fn().mockResolvedValue(undefined),
  clearGame: jest.fn().mockResolvedValue(undefined),
  loadFinishedGameId: jest.fn().mockResolvedValue(null),
  saveFinishedGameId: jest.fn().mockResolvedValue(undefined),
}));
// Only the storage ends are replaced: the real validateName runs on a save.
jest.mock("../../game/hearts/playerNames", () => ({
  ...jest.requireActual("../../game/hearts/playerNames"),
  loadPlayerNames: jest.fn().mockResolvedValue(["You", "West", "North", "East"]),
  savePlayerNames: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../api/stats", () => mockScreenDeps().mockStatsApi({ getGameRank: jest.fn() }));
jest.mock("../../game/_shared/flushQueuedGames", () => mockScreenDeps().mockFlushQueuedGames());
jest.mock("../../game/_shared/gameEventClient", () => mockScreenDeps().mockGameEventClient());
jest.mock("../../game/_shared/displayNameSync", () => mockScreenDeps().mockDisplayNameSync());

const mockGoBack = jest.fn();
jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(
    () => ({
      goBack: mockGoBack,
      popToTop: jest.fn(),
      navigate: jest.fn(),
      addListener: jest.fn(() => jest.fn()),
    }),
    {
      // The screen's focus effect, run as a plain mount effect: its cleanup is the blur.
      useFocusEffect: (effect: () => void | (() => void)) => {
        const { useEffect } = jest.requireActual<typeof import("react")>("react");
        useEffect(effect, [effect]);
      },
    }
  )
);

// Sounds by name, so a test can tell which one played.
const mockPlayed: string[] = [];
jest.mock("../../game/_shared/useSound", () => mockScreenDeps().mockSoundByName(() => mockPlayed));

const played = (name: string) => playedCount(mockPlayed, name);
// Card play has three variations (#3563); count any of them.
const cardPlays = () => HEARTS_CARD_PLAY.reduce((n, key) => n + played(key), 0);
// Trick gathered has three variations too (#3563).
const trickWons = () => HEARTS_TRICK_WON.reduce((n, key) => n + played(key), 0);

jest.useFakeTimers();

/**
 * Mounts the screen on a saved game. `expectPicker` says what the screen shows once
 * the load lands: the difficulty picker (the default for no saved game) or the table.
 */
async function mountOn(
  state: HeartsState | null,
  { expectPicker = state === null }: { expectPicker?: boolean } = {}
) {
  (loadGame as jest.Mock).mockResolvedValue(state);
  const api = await render(
    <ThemeProvider>
      <HeartsRoundsProvider>
        <HeartsScreen />
      </HeartsRoundsProvider>
    </ThemeProvider>
  );
  // The load has landed once it was asked for and the screen shows its result: by
  // default a game on the table (the picker is gone), or the picker for no saved game.
  await waitFor(() => expect(loadGame).toHaveBeenCalled());
  await waitFor(() =>
    expectPicker
      ? expect(api.getByTestId("hearts-start-game")).toBeTruthy()
      : expect(api.queryByTestId("hearts-start-game")).toBeNull()
  );
  await act(async () => {
    await Promise.resolve();
  });
  return api;
}

const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

/** Advances in `step` ms slices, letting the AI loop's next `delay` start between them. */
async function advanceSteps(total: number, step: number) {
  for (let elapsed = 0; elapsed < total; elapsed += step) await advance(step);
}

type Api = Awaited<ReturnType<typeof mountOn>>;

/** Presses the element with this label; `hidden` reaches one a modal on top has hidden. */
async function press(api: Api, label: string | RegExp, { hidden = false } = {}) {
  await act(async () => {
    await fireEvent.press(api.getByLabelText(label, { includeHiddenElements: hidden }));
  });
}

beforeEach(() => {
  setRng(createSeededRng(42));
  mockPlayed.length = 0;
  mockGoBack.mockClear();
  (loadGame as jest.Mock).mockClear();
  (saveGame as jest.Mock).mockClear();
  (savePlayerNames as jest.Mock).mockClear();
});

afterEach(() => {
  (loadGame as jest.Mock).mockResolvedValue(null);
});

describe("passing", () => {
  it("hands the three chosen cards over when Confirm is pressed, and play begins", async () => {
    const api = await mountOn(dealGame());
    expect(api.getByText("0 of 3 selected")).toBeTruthy();
    expect(api.getByLabelText(/^Confirm/).props.accessibilityState.disabled).toBe(true);

    for (const i of [0, 1, 2]) {
      await act(async () => {
        await fireEvent.press(api.getByTestId(`hearts-hand-card-${i}`));
      });
    }
    expect(api.getByText("3 of 3 selected")).toBeTruthy();

    await press(api, /^Confirm/);

    expect(api.queryByText(/of 3 selected/)).toBeNull();
    expect(api.queryByLabelText(/^Confirm/)).toBeNull();
    expect(api.getByLabelText("Your hand, 13 cards")).toBeTruthy();
  });
});

describe("between hands", () => {
  it("shows the scorecard, and Next Hand deals the next one and saves it", async () => {
    const api = await mountOn(heartsDealing());
    expect(api.getByText("Hand Complete")).toBeTruthy();
    expect(api.queryByText(/shot the moon! \+26/)).toBeNull();

    await press(api, "Next Hand");

    expect(api.queryByText("Hand Complete")).toBeNull();
    // Hand 2 passes right.
    expect(api.getByText(/pass right/i)).toBeTruthy();
    expect(saveGame).toHaveBeenCalledWith(expect.objectContaining({ handNumber: 2 }));
  });

  it("names who shot the moon", async () => {
    const wonCards = [[], moonHaul(), [], []];
    const api = await mountOn(heartsDealing({ wonCards }));
    expect(api.getByText("West shot the moon! +26 to all others.")).toBeTruthy();
  });
});

describe("a trick completed by the human", () => {
  // Seat 1 led 5♦, 2 played 9♦, 3 played 7♦; the human's 10♦ takes it.
  const trickToComplete = () =>
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
    });

  it("ignores taps until the take-away animation ends, then plays the trick-won sound", async () => {
    const api = await mountOn(trickToComplete());
    await press(api, /^10 of Diamonds/);
    expect(api.getByLabelText("Your hand, 2 cards")).toBeTruthy();
    expect(cardPlays()).toBe(1);
    expect(trickWons()).toBe(0);

    // A tap while the trick is still on the table is dropped.
    await press(api, /^3 of Diamonds/);
    expect(api.getByLabelText("Your hand, 2 cards")).toBeTruthy();
    expect(cardPlays()).toBe(1);

    await advance(3000);
    expect(trickWons()).toBe(1);

    // The winner leads again.
    await press(api, /^3 of Diamonds/);
    expect(api.getByLabelText("Your hand, 1 cards")).toBeTruthy();
  });
});

describe("a trick completed by the AI", () => {
  // The human led 10♦; the AIs must follow with a lower diamond, so the human wins.
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

  it("waits for the animation, then hands the turn back to the human", async () => {
    const api = await mountOn(humanLeads());
    await advanceSteps(1300, 400); // three AI plays, 400 ms apart
    expect(cardPlays()).toBe(3);
    expect(trickWons()).toBe(0);
    await advance(3000);
    expect(trickWons()).toBe(1);

    // The human, who took the trick, leads the next one.
    await press(api, /^3 of Diamonds/);
    expect(api.getByLabelText("Your hand, 1 cards")).toBeTruthy();
  });

  it("stops quietly when the screen closes mid-animation", async () => {
    const api = await mountOn(humanLeads());
    await advanceSteps(1300, 400);
    await api.unmount();
    await advance(5000);
    expect(trickWons()).toBe(0);
  });
});

// Positions that make each moment happen through a real play (#3588). A restored game's
// events never replay, so a test cannot inject them through `loadGame`.
const hearts = (...ranks: number[]) => ranks.map((r) => heartsCard("hearts", r as 2));
const SWEEP_MS = 930; // the sweep after a trick: 250 ms settle + 3 × 60 ms stagger + 500 ms

/** West led 5♦, North 9♦, East 7♦; the human, out of diamonds, breaks hearts with the 2♥. */
const humanBreaksHearts = () =>
  heartsPlay({
    heartsBroken: false,
    currentLeaderIndex: 1,
    currentPlayerIndex: 0,
    currentTrick: [
      { playerIndex: 1, card: heartsCard("diamonds", 5) },
      { playerIndex: 2, card: heartsCard("diamonds", 9) },
      { playerIndex: 3, card: heartsCard("diamonds", 7) },
    ],
    playerHands: [
      [heartsCard("hearts", 2), heartsCard("clubs", 4)],
      [heartsCard("clubs", 6)],
      [heartsCard("clubs", 8), heartsCard("clubs", 9)],
      [heartsCard("clubs", 10)],
    ],
  });

/** The human led 3♠; West's only card is the Q♠, so the CPU plays it next. */
const westPlaysTheQueen = () =>
  heartsPlay({
    currentLeaderIndex: 0,
    currentPlayerIndex: 1,
    currentTrick: [{ playerIndex: 0, card: heartsCard("spades", 3) }],
    playerHands: [
      [heartsCard("clubs", 4)],
      [heartsCard("spades", 12)],
      [heartsCard("spades", 5)],
      [heartsCard("spades", 6)],
    ],
  });

/** Mid-hand: the human's A♥ takes West's 2♥, North's 3♥ and East's 4♥, clinching the moon. */
const humanClinchesTheMoonMidHand = () =>
  heartsPlay({
    currentLeaderIndex: 1,
    currentPlayerIndex: 0,
    currentTrick: [
      { playerIndex: 1, card: heartsCard("hearts", 2) },
      { playerIndex: 2, card: heartsCard("hearts", 3) },
      { playerIndex: 3, card: heartsCard("hearts", 4) },
    ],
    playerHands: [
      [heartsCard("hearts", 1), heartsCard("clubs", 4)],
      [heartsCard("clubs", 6)],
      [heartsCard("clubs", 8)],
      [heartsCard("clubs", 9)],
    ],
    wonCards: [[...hearts(5, 6, 7, 8, 9, 10, 11, 12, 13), heartsCard("spades", 12)], [], [], []],
  });

/**
 * Mid-hand: East led 2♥; the human follows 3♥, West 4♥, and North's A♥ takes the trick,
 * clinching the moon with the hearts and the Q♠ it already holds. North then leads.
 */
const northClinchesTheMoonMidHand = () =>
  heartsPlay({
    currentLeaderIndex: 3,
    currentPlayerIndex: 0,
    currentTrick: [{ playerIndex: 3, card: heartsCard("hearts", 2) }],
    playerHands: [
      [heartsCard("hearts", 3), heartsCard("clubs", 4)],
      [heartsCard("hearts", 4), heartsCard("clubs", 6)],
      [heartsCard("hearts", 1), heartsCard("clubs", 8)],
      [heartsCard("clubs", 9)],
    ],
    wonCards: [[], [], [...hearts(5, 6, 7, 8, 9, 10, 11, 12, 13), heartsCard("spades", 12)], []],
  });

/**
 * The human leads A♠ to the hand's last trick; West 2♠, North 3♠, and East's Q♠ completes it.
 * With every heart already taken, the human shoots the moon on the trick the Q♠ was played to.
 */
const queenCompletesTheMoonTrick = (overrides: Partial<HeartsState> = {}) =>
  heartsPlay({
    tricksPlayedInHand: 12,
    currentLeaderIndex: 0,
    currentPlayerIndex: 0,
    playerHands: [
      [heartsCard("spades", 1)],
      [heartsCard("spades", 2)],
      [heartsCard("spades", 3)],
      [heartsCard("spades", 12)],
    ],
    wonCards: [hearts(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13), [], [], []],
    ...overrides,
  });

describe("event overlays", () => {
  // The moments (#3588) replace the old overlays: each shows its caption at its point on the
  // timeline and is gone (unmounted) once it reports it is over.
  it("hearts broken: sounds, shows the moment's caption, then hides it", async () => {
    const api = await mountOn(humanBreaksHearts());
    await press(api, /^2 of Hearts/);
    expect(played("hearts.heartsBroken")).toBe(1);
    expect(api.getByTestId("hearts-broken-moment")).toBeTruthy();
    await advance(BROKEN_TIMING.caption);
    expect(api.getByText("Hearts are broken")).toBeTruthy();
    await advance(BROKEN_TIMING.end - BROKEN_TIMING.caption);
    expect(api.queryByText("Hearts are broken")).toBeNull();
    expect(api.queryByTestId("hearts-broken-moment")).toBeNull();
  });

  it("the human shooting the moon sounds and names them, then hides the overlay", async () => {
    const api = await mountOn(humanClinchesTheMoonMidHand());
    await press(api, /^A of Hearts/);
    expect(played("hearts.moonShot")).toBe(1);
    await advance(MOON_TIMING.title);
    expect(api.getByText("You shot the moon!")).toBeTruthy();
    expect(api.getByText("+26 to West, North and East")).toBeTruthy();
    // Mid-hand: the same scene, and no scorecard.
    expect(api.queryByText("Hand Complete")).toBeNull();
    await advance(MOON_TIMING.end - MOON_TIMING.title);
    expect(api.queryByText("You shot the moon!")).toBeNull();
    expect(api.queryByTestId("hearts-moon-moment")).toBeNull();
    expect(api.queryByText("Hand Complete")).toBeNull();
  });

  it("an AI shooting the moon names them without the human's sound", async () => {
    const api = await mountOn(northClinchesTheMoonMidHand());
    await press(api, /^3 of Hearts/);
    await advanceSteps(800, 400); // West, then North takes the trick and clinches the moon
    expect(played("hearts.moonShot")).toBe(0);
    await advance(MOON_TIMING.title);
    expect(api.getByText("North shot the moon!")).toBeTruthy();
    expect(api.getByText("+26 to East, You and West")).toBeTruthy();
  });

  it("the Queen of Spades played: shows the moment's caption, then hides it", async () => {
    const api = await mountOn(westPlaysTheQueen());
    await advance(400);
    expect(api.getByTestId("hearts-queen-moment")).toBeTruthy();
    await advance(QUEEN_TIMING.caption);
    expect(api.getByText("The Queen of Spades · 13 points")).toBeTruthy();
    await advance(QUEEN_TIMING.end - QUEEN_TIMING.caption);
    expect(api.queryByText("The Queen of Spades · 13 points")).toBeNull();
    expect(api.queryByTestId("hearts-queen-moment")).toBeNull();
  });

  it("the Queen of Spades played by an AI sounds once", async () => {
    await mountOn(westPlaysTheQueen());
    await advance(400);
    expect(played("hearts.queenOfSpades")).toBe(1);
  });

  it("a restored game does not replay the sounds and moments it saved with (#3588)", async () => {
    const api = await mountOn(
      heartsPlay({
        events: [
          { type: "heartsBroken" },
          { type: "queenOfSpadesPlayed", seat: 1 },
          { type: "moonShot", shooter: 0 },
        ],
        playerHands: [[heartsCard("clubs", 4)], [], [], []],
      })
    );
    await advance(100);
    expect(played("hearts.heartsBroken")).toBe(0);
    expect(played("hearts.queenOfSpades")).toBe(0);
    expect(played("hearts.moonShot")).toBe(0);
    for (const id of ["hearts-broken-moment", "hearts-queen-moment", "hearts-moon-moment"]) {
      expect(api.queryByTestId(id)).toBeNull();
    }
  });

  it("the Queen of Spades played by the human sounds once, not twice", async () => {
    const api = await mountOn(
      heartsPlay({
        playerHands: [[heartsCard("spades", 12), heartsCard("clubs", 4)], [], [], []],
        currentTrick: [],
      })
    );
    await press(api, /^Q of Spades/);
    expect(played("hearts.queenOfSpades")).toBe(1);
    expect(api.getByLabelText("Your hand, 1 cards")).toBeTruthy();
  });
});

describe("the moments hold the table (#3588)", () => {
  // The human leads 3♠; West's only card is the Q♠, so the CPU plays it next.
  const westHoldsTheQueen = () =>
    heartsPlay({
      currentLeaderIndex: 0,
      currentPlayerIndex: 1,
      currentTrick: [{ playerIndex: 0, card: heartsCard("spades", 3) }],
      playerHands: [
        [heartsCard("clubs", 4)],
        [heartsCard("spades", 12)],
        [heartsCard("spades", 5)],
        [heartsCard("spades", 6)],
      ],
    });

  it("North waits for the Queen of Spades' moment before playing", async () => {
    const api = await mountOn(westHoldsTheQueen());
    await advance(400); // West plays the Q♠: the gong, and the moment starts
    expect(played("hearts.queenOfSpades")).toBe(1);
    const afterWest = cardPlays();
    expect(api.getByTestId("hearts-queen-moment")).toBeTruthy();

    // North's turn comes 400 ms later, but the moment holds it until it ends (2330 ms in).
    await advanceSteps(QUEEN_TIMING.end - 100, 100);
    expect(cardPlays()).toBe(afterWest);
    await advanceSteps(200, 100);
    expect(api.queryByTestId("hearts-queen-moment")).toBeNull();
    expect(cardPlays()).toBe(afterWest + 1);
  });

  // West led 2♥, North 3♥, East 4♥: the human's A♥ takes the last trick and, with the
  // other ten hearts and the Q♠ already taken, shoots the moon.
  const humanShootsTheMoon = () =>
    heartsPlay({
      tricksPlayedInHand: 12,
      currentLeaderIndex: 1,
      currentPlayerIndex: 0,
      currentTrick: [
        { playerIndex: 1, card: heartsCard("hearts", 2) },
        { playerIndex: 2, card: heartsCard("hearts", 3) },
        { playerIndex: 3, card: heartsCard("hearts", 4) },
      ],
      playerHands: [[heartsCard("hearts", 1)], [], [], []],
      wonCards: [
        [
          ...[5, 6, 7, 8, 9, 10, 11, 12, 13].map((r) => heartsCard("hearts", r as 5)),
          heartsCard("spades", 12),
        ],
        [],
        [],
        [],
      ],
    });

  it("#3586: in a hand the human shoots the moon, Hand Complete stays closed until the moment ends", async () => {
    const api = await mountOn(humanShootsTheMoon());
    await press(api, /^A of Hearts/);
    expect(played("hearts.moonShot")).toBe(1);
    expect(api.queryByText("Hand Complete")).toBeNull();

    await advance(MOON_TIMING.title);
    expect(api.getByText("You shot the moon!")).toBeTruthy();
    expect(api.queryByText("Hand Complete")).toBeNull();

    // Up to the moment's onAnimationEnd, the scorecard stays closed.
    await advance(MOON_TIMING.end - MOON_TIMING.title - 1);
    expect(api.queryByText("Hand Complete")).toBeNull();
    await advance(1);
    expect(api.getByText("Hand Complete")).toBeTruthy();
    expect(api.getByText("You shot the moon! +26 to all others.")).toBeTruthy();
    expect(api.queryByTestId("hearts-moon-moment")).toBeNull();
  });

  describe("with Reduce Motion on", () => {
    beforeEach(() => {
      resetReduceMotionForTests();
      jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    });
    afterEach(() => {
      // React Native's Jest setup already mocks it, so the spy is that mock: put its answer back.
      (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(false);
      jest.restoreAllMocks();
      resetReduceMotionForTests();
    });

    it("the moon shot sounds at once, shows a still caption, and opens Hand Complete soon", async () => {
      const api = await mountOn(humanShootsTheMoon());
      await press(api, /^A of Hearts/);
      expect(played("hearts.moonShot")).toBe(1);
      // The caption at once: no rise, no fade.
      expect(api.getByText("You shot the moon!")).toBeTruthy();
      expect(api.queryByText("Hand Complete")).toBeNull();
      await advance(MOON_TIMING.reducedEnd);
      expect(api.getByText("Hand Complete")).toBeTruthy();
    });
  });
});

describe("hearts broken holds its trick on the table (#3588)", () => {
  it("keeps the trick until the moment ends, then sweeps", async () => {
    const api = await mountOn(humanBreaksHearts());
    await press(api, /^2 of Hearts/);
    expect(played("hearts.heartsBroken")).toBe(1);

    // Without the hold the trick would be gone by 930 ms.
    await advance(BROKEN_TIMING.end - 100);
    expect(trickWons()).toBe(0);
    expect(api.getByLabelText(/^2 of Hearts/)).toBeTruthy();

    await advance(100); // the moment ends: the sweep starts
    expect(api.queryByTestId("hearts-broken-moment")).toBeNull();
    await advance(SWEEP_MS - 50);
    expect(trickWons()).toBe(0);
    await advance(100);
    expect(trickWons()).toBe(1);
  });

  it("does not delay the CPU players: they keep playing while the trick is held", async () => {
    // The human led 10♦; West has only hearts, so its card breaks hearts; North and East follow.
    const api = await mountOn(
      heartsPlay({
        heartsBroken: false,
        currentLeaderIndex: 0,
        currentPlayerIndex: 1,
        currentTrick: [{ playerIndex: 0, card: heartsCard("diamonds", 10) }],
        playerHands: [
          [heartsCard("clubs", 4)],
          [heartsCard("hearts", 3)],
          [heartsCard("diamonds", 2)],
          [heartsCard("diamonds", 4)],
        ],
      })
    );
    await advanceSteps(1300, 400); // three CPU plays, 400 ms apart, as without the moment
    expect(played("hearts.heartsBroken")).toBe(1);
    expect(cardPlays()).toBe(3);
    expect(api.getByTestId("hearts-broken-moment")).toBeTruthy();

    // The completed trick waits for the moment (it started with West's card at 400 ms).
    await advanceSteps(400 + BROKEN_TIMING.end - 1300 - 100, 100);
    expect(trickWons()).toBe(0);
    await advanceSteps(100 + SWEEP_MS + 100, 100);
    expect(trickWons()).toBe(1);
  });

  it("lets go after a bounded time even if the moment never reports its end", async () => {
    // A stand-in that draws nothing and never calls onAnimationEnd.
    const spy = jest.spyOn(brokenModule, "HeartsBrokenAnimation").mockImplementation(() => null);
    try {
      const api = await mountOn(humanBreaksHearts());
      await press(api, /^2 of Hearts/);
      await advance(BROKEN_TIMING.end + 400);
      expect(trickWons()).toBe(0);
      // The limit is the moment's run plus 500 ms; then the usual sweep.
      await advance(150);
      await advance(SWEEP_MS + 50);
      expect(trickWons()).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  describe("with Reduce Motion on", () => {
    beforeEach(() => {
      resetReduceMotionForTests();
      jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    });
    afterEach(() => {
      // React Native's Jest setup already mocks it, so the spy is that mock: put its answer back.
      (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(false);
      jest.restoreAllMocks();
      resetReduceMotionForTests();
    });

    it("holds only as long as the still caption", async () => {
      const api = await mountOn(humanBreaksHearts());
      await press(api, /^2 of Hearts/);
      expect(api.getByText("Hearts are broken")).toBeTruthy();
      await advance(BROKEN_TIMING.reducedEnd - 50);
      expect(trickWons()).toBe(0);
      await advance(100); // the caption ends: the sweep starts
      await advance(SWEEP_MS + 50);
      expect(trickWons()).toBe(1);
    });
  });
});

describe("the Queen of Spades' sound", () => {
  it("a CPU's Q♠ plays the gong once and no card-place sound", async () => {
    // The human led 3♠; West's only card is the Q♠.
    await mountOn(
      heartsPlay({
        currentLeaderIndex: 0,
        currentPlayerIndex: 1,
        currentTrick: [{ playerIndex: 0, card: heartsCard("spades", 3) }],
        playerHands: [
          [heartsCard("clubs", 4)],
          [heartsCard("spades", 12)],
          [heartsCard("spades", 5)],
          [heartsCard("spades", 6)],
        ],
      })
    );
    await advance(400);
    expect(played("hearts.queenOfSpades")).toBe(1);
    expect(cardPlays()).toBe(0);
  });
});

describe("the moments and the table, screen level (#3588)", () => {
  it("a Q♠ that completes a trick keeps it on the table until the queen's moment ends", async () => {
    // Mid-hand, so the trick sweeps (and sounds) once the moment lets go.
    const api = await mountOn(
      queenCompletesTheMoonTrick({
        tricksPlayedInHand: 4,
        wonCards: [[], [], [], []],
        playerHands: [
          [heartsCard("spades", 1), heartsCard("clubs", 4)],
          [heartsCard("spades", 2), heartsCard("clubs", 5)],
          [heartsCard("spades", 3), heartsCard("clubs", 6)],
          [heartsCard("spades", 12), heartsCard("clubs", 7)],
        ],
      })
    );
    await press(api, /^A of Spades/);
    await advanceSteps(1200, 400); // West, North, then East's Q♠ completes the trick
    expect(played("hearts.queenOfSpades")).toBe(1);
    await advanceSteps(QUEEN_TIMING.end + SWEEP_MS - 200, 100);
    expect(trickWons()).toBe(0);
    await advanceSteps(400, 100);
    expect(trickWons()).toBe(1);
  });

  it("the human's Q♠ on the hand's last trick: the trick stays under the lift, Hand Complete waits", async () => {
    // West led 2♠, North 3♠, East 4♠; the human's Q♠ takes the last trick (no moon).
    const api = await mountOn(
      heartsPlay({
        tricksPlayedInHand: 12,
        currentLeaderIndex: 1,
        currentPlayerIndex: 0,
        currentTrick: [
          { playerIndex: 1, card: heartsCard("spades", 2) },
          { playerIndex: 2, card: heartsCard("spades", 3) },
          { playerIndex: 3, card: heartsCard("spades", 4) },
        ],
        playerHands: [[heartsCard("spades", 12)], [], [], []],
      })
    );
    await press(api, /^Q of Spades/);
    await advance(QUEEN_TIMING.strike);
    expect(api.getByTestId("hearts-queen-moment")).toBeTruthy();
    // The real Q♠ is still in the trick under its lifted copy.
    expect(within(api.getByTestId("hearts-trick")).getByLabelText(/^Q of Spades/)).toBeTruthy();
    expect(api.queryByText("Hand Complete")).toBeNull();

    await advance(QUEEN_TIMING.end - QUEEN_TIMING.strike - 1);
    expect(api.queryByText("Hand Complete")).toBeNull();
    await advance(1);
    expect(api.getByText("Hand Complete")).toBeTruthy();
  });

  it("queues a moon shot clinched on the Q♠'s trick until the queen's moment ends", async () => {
    const api = await mountOn(queenCompletesTheMoonTrick());
    await press(api, /^A of Spades/);
    await advanceSteps(1200, 400); // East's Q♠ completes the last trick: the moon is clinched
    expect(api.getByTestId("hearts-queen-moment")).toBeTruthy();
    expect(api.queryByTestId("hearts-moon-moment")).toBeNull();
    expect(played("hearts.moonShot")).toBe(0);
    expect(api.queryByText("Hand Complete")).toBeNull();

    await advanceSteps(QUEEN_TIMING.end, 100);
    // The queen is done: the moon shot plays now, with its howl.
    expect(api.queryByTestId("hearts-queen-moment")).toBeNull();
    expect(api.getByTestId("hearts-moon-moment")).toBeTruthy();
    expect(played("hearts.moonShot")).toBe(1);
    expect(api.queryByText("Hand Complete")).toBeNull();

    await advanceSteps(MOON_TIMING.end, 100);
    expect(api.getByText("Hand Complete")).toBeTruthy();
  });

  it("a CPU's mid-hand moon shot holds the CPU players until it ends", async () => {
    const api = await mountOn(northClinchesTheMoonMidHand());
    await press(api, /^3 of Hearts/);
    await advanceSteps(800, 400); // West, then North's A♥ clinches the moon
    const afterNorth = cardPlays();
    // Without the hold, North would lead again after the sweep and a 400 ms beat (~1.4 s).
    await advanceSteps(MOON_TIMING.end - 200, 100);
    expect(cardPlays()).toBe(afterNorth);
    await advanceSteps(400, 100);
    expect(cardPlays()).toBe(afterNorth + 1);
  });

  it("a moon shot on the game's last hand keeps the result card and its sound until it ends", async () => {
    // The human's A♥ takes the 13th trick and shoots the moon: the others reach 106.
    const api = await mountOn(
      heartsPlay({
        handNumber: 2,
        cumulativeScores: [10, 80, 80, 80],
        scoreHistory: [[10, 80, 80, 80]],
        tricksPlayedInHand: 12,
        currentLeaderIndex: 1,
        currentPlayerIndex: 0,
        currentTrick: [
          { playerIndex: 1, card: heartsCard("hearts", 2) },
          { playerIndex: 2, card: heartsCard("hearts", 3) },
          { playerIndex: 3, card: heartsCard("hearts", 4) },
        ],
        playerHands: [[heartsCard("hearts", 1)], [], [], []],
        wonCards: [
          [...hearts(5, 6, 7, 8, 9, 10, 11, 12, 13), heartsCard("spades", 12)],
          [],
          [],
          [],
        ],
      })
    );
    await press(api, /^A of Hearts/);
    expect(played("hearts.moonShot")).toBe(1);
    expect(api.queryByTestId("hearts-result")).toBeNull();
    expect(played("hearts.gameWon")).toBe(0);

    await advanceSteps(MOON_TIMING.end - 200, 100);
    expect(api.queryByTestId("hearts-result")).toBeNull();
    expect(played("hearts.gameWon")).toBe(0);
    await advanceSteps(300, 100);
    expect(api.getByTestId("hearts-result")).toBeTruthy();
    expect(played("hearts.gameWon")).toBe(1);
  });

  it("a Q♠ during the hearts-broken moment supersedes it: one caption", async () => {
    // The human led 10♦; West, with only hearts, breaks them; North, out of diamonds, plays the Q♠.
    const api = await mountOn(
      heartsPlay({
        heartsBroken: false,
        currentLeaderIndex: 0,
        currentPlayerIndex: 1,
        currentTrick: [{ playerIndex: 0, card: heartsCard("diamonds", 10) }],
        playerHands: [
          [heartsCard("clubs", 4)],
          [heartsCard("hearts", 3)],
          [heartsCard("spades", 12)],
          [heartsCard("diamonds", 4)],
        ],
      })
    );
    await advance(400);
    expect(api.getByTestId("hearts-broken-moment")).toBeTruthy();
    await advance(400); // North's Q♠, 400 ms into the broken moment
    expect(api.queryByTestId("hearts-broken-moment")).toBeNull();
    expect(api.getByTestId("hearts-queen-moment")).toBeTruthy();
    await advance(QUEEN_TIMING.caption);
    expect(api.getByText("The Queen of Spades · 13 points")).toBeTruthy();
    expect(api.queryByText("Hearts are broken")).toBeNull();
  });
});

describe("leaving the table", () => {
  it("saves the game with its play time when the screen loses focus", async () => {
    const api = await mountOn(heartsPlay({ playerHands: [[heartsCard("clubs", 4)], [], [], []] }));
    (saveGame as jest.Mock).mockClear();
    await api.unmount();
    expect(saveGame).toHaveBeenCalledTimes(1);
    expect(saveGame).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "playing", accumulatedMs: expect.any(Number) })
    );
  });

  it("does not save a finished game on blur", async () => {
    const api = await mountOn(
      heartsPlay({
        phase: "game_over",
        isComplete: true,
        winnerIndex: 0,
        scoreHistory: [[5, 5, 5, 5]],
      })
    );
    (saveGame as jest.Mock).mockClear();
    await api.unmount();
    expect(saveGame).not.toHaveBeenCalled();
  });

  it("goes back from the pre-game picker and from a game", async () => {
    const pre = await mountOn(null);
    await press(pre, "Go back to home screen");
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    await pre.unmount();

    const inGame = await mountOn(
      heartsPlay({ playerHands: [[heartsCard("clubs", 4)], [], [], []] })
    );
    await press(inGame, "Go back to home screen");
    expect(mockGoBack).toHaveBeenCalledTimes(2);
  });

  it("starts a game from the pre-game picker's New Game", async () => {
    const api = await mountOn(null);
    await press(api, "More options");
    await act(async () => {
      await fireEvent.press(api.getByText("New Game"));
    });
    await press(api, "Start New");
    expect(api.queryByTestId("hearts-start-game")).toBeNull();
    expect(api.getByLabelText("Your hand, 13 cards")).toBeTruthy();
  });
});

describe("player names", () => {
  const inGame = () => heartsPlay({ playerHands: [[heartsCard("clubs", 4)], [], [], []] });

  async function openRename(api: Api) {
    await press(api, "More options");
    await act(async () => {
      await fireEvent.press(api.getByText("Edit Names"));
    });
  }

  it("saves the edited names, falling back to the default for a blank one", async () => {
    const api = await mountOn(inGame());
    await openRename(api);
    await act(async () => {
      await fireEvent.changeText(api.getByLabelText("Player 2 (default: West)"), "Zed");
      await fireEvent.changeText(api.getByLabelText("Player 3 (default: North)"), "   ");
    });
    await press(api, "Save");

    expect(savePlayerNames).toHaveBeenCalledWith(["You", "Zed", "North", "East"]);
    expect(api.queryByText("Player Names")).toBeNull();
    expect(api.getByText("Zed")).toBeTruthy();
  });

  describe("default seat names follow the app language (#2221)", () => {
    beforeEach(async () => {
      await i18n.changeLanguage("es");
      i18n.addResourceBundle("es", "hearts", EsHearts);
      i18n.addResourceBundle("es", "common", EsCommon);
    });
    afterEach(async () => {
      await i18n.changeLanguage("en");
      (loadPlayerNames as jest.Mock).mockResolvedValue(["You", "West", "North", "East"]);
    });

    it("renders a persisted English default seat name translated", async () => {
      // The stored value is the English default; the label shown is Spanish.
      const api = await mountOn(inGame());
      expect(api.queryAllByText("Oeste").length).toBeGreaterThan(0);
      expect(api.queryAllByText("Norte").length).toBeGreaterThan(0);
      expect(api.queryByText("West")).toBeNull();
      expect(api.queryByText("North")).toBeNull();
    });

    it("leaves a custom name untouched", async () => {
      (loadPlayerNames as jest.Mock).mockResolvedValue(["You", "West", "Zed", "East"]);
      const api = await mountOn(inGame());
      expect(api.getByText("Zed")).toBeTruthy();
      expect(api.queryByText("Norte")).toBeNull();
      expect(api.queryAllByText("Oeste").length).toBeGreaterThan(0);
    });

    it("saves the English defaults back when the translated defaults are left as they are", async () => {
      const api = await mountOn(inGame());
      await press(api, "Más opciones");
      await act(async () => {
        await fireEvent.press(api.getByText("Editar nombres"));
      });
      // The form is seeded with the translated defaults; only seat 3 is renamed.
      expect(api.getByLabelText("Jugador 2 (predeterminado: Oeste)")).toHaveDisplayValue("Oeste");
      await act(async () => {
        await fireEvent.changeText(api.getByLabelText("Jugador 3 (predeterminado: Norte)"), "Zed");
      });
      await press(api, "Guardar");
      expect(savePlayerNames).toHaveBeenCalledWith(["You", "West", "Zed", "East"]);
    });

    it("stores a translated default typed into a previously custom seat as typed", async () => {
      (loadPlayerNames as jest.Mock).mockResolvedValue(["You", "West", "Zed", "East"]);
      const api = await mountOn(inGame());
      await press(api, "Más opciones");
      await act(async () => {
        await fireEvent.press(api.getByText("Editar nombres"));
      });
      await act(async () => {
        await fireEvent.changeText(
          api.getByLabelText("Jugador 3 (predeterminado: Norte)"),
          "Norte"
        );
      });
      await press(api, "Guardar");
      expect(savePlayerNames).toHaveBeenCalledWith(["You", "West", "Norte", "East"]);
    });
  });

  describe("an existing custom name that equals a translated default (#2221)", () => {
    beforeEach(async () => {
      i18n.addResourceBundle("fr-CA", "hearts", FrCaHearts);
      i18n.addResourceBundle("fr-CA", "common", FrCaCommon);
      await i18n.changeLanguage("fr-CA");
    });
    afterEach(async () => {
      await i18n.changeLanguage("en");
      (loadPlayerNames as jest.Mock).mockResolvedValue(["You", "West", "North", "East"]);
    });

    it("stays custom in storage while another seat is edited", async () => {
      (loadPlayerNames as jest.Mock).mockResolvedValue(["You", "Ouest", "North", "East"]);
      const api = await mountOn(inGame());
      await act(async () => {
        await fireEvent.press(api.getByTestId("nav-menu"));
      });
      await act(async () => {
        await fireEvent.press(api.getByText(FrCaHearts["settings.rename"]));
      });
      await act(async () => {
        await fireEvent.changeText(api.getByLabelText("Joueur 4 (par défaut : Est)"), "Zed");
      });
      await press(api, FrCaHearts["settings.save"]);
      expect(savePlayerNames).toHaveBeenCalledWith(["You", "Ouest", "North", "Zed"]);
    });
  });

  it("keeps the old names when the edit is cancelled", async () => {
    const api = await mountOn(inGame());
    await openRename(api);
    await act(async () => {
      await fireEvent.changeText(api.getByLabelText("Player 2 (default: West)"), "Zed");
    });
    await press(api, "Cancel");

    expect(savePlayerNames).not.toHaveBeenCalled();
    expect(api.queryByText("Player Names")).toBeNull();
    // Reopening starts from the saved names, not the abandoned draft.
    await openRename(api);
    expect(api.getByLabelText("Player 2 (default: West)")).toHaveDisplayValue("West");
  });
});

describe("debug panel (dev builds)", () => {
  // Trick 13: the human led 5♥ and the AIs follow with their last diamonds.
  const finalTrick = () =>
    heartsPlay({
      handNumber: 1,
      passDirection: "none",
      tricksPlayedInHand: 12,
      currentLeaderIndex: 0,
      currentPlayerIndex: 1,
      currentTrick: [{ playerIndex: 0, card: heartsCard("hearts", 5) }],
      playerHands: [
        [],
        [heartsCard("diamonds", 7)],
        [heartsCard("diamonds", 8)],
        [heartsCard("diamonds", 9)],
      ],
    });

  it("toggles from the DBG button", async () => {
    const api = await mountOn(finalTrick());
    // The panel is a modal: once it is open, the table behind it is hidden from queries.
    const behind = { includeHiddenElements: true };
    expect(api.getByText("DBG ▴")).toBeTruthy();
    await press(api, "Toggle Hearts debugger panel");
    expect(api.getByText("DBG ▾", behind)).toBeTruthy();
    expect(api.getByText(/Hearts Debugger/)).toBeTruthy();
    await press(api, "Close debugger");
    expect(api.getByText("DBG ▴", behind)).toBeTruthy();
  });

  it("logs a finished hand with its trick, and keeps the notes typed against it", async () => {
    const api = await mountOn(finalTrick());
    await advance(2000);
    await waitFor(() => expect(api.getByText("Hand Complete")).toBeTruthy());

    // The hand-end card is a modal, so the panel opens behind it as far as queries go.
    const any = { includeHiddenElements: true };
    await press(api, "Toggle Hearts debugger panel", { hidden: true });
    expect(api.getByText("Hearts Debugger — 1 hand", any)).toBeTruthy();
    expect(api.getByText("Hand 1 — No Pass", any)).toBeTruthy();
    expect(api.getByText("Tricks (1)", any)).toBeTruthy();

    await act(async () => {
      await fireEvent.changeText(
        api.getByPlaceholderText("Observations about this hand...", any),
        "AI dumped a diamond"
      );
    });
    expect(api.getByPlaceholderText("Observations about this hand...", any)).toHaveDisplayValue(
      "AI dumped a diamond"
    );
  });
});
