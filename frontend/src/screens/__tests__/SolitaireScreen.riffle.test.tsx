/**
 * #3563: Auto-Complete plays the riffle (start + loop, then the settle with the win) and the cards
 * it moves make no card-place or card-flip sound of their own. A card moved by hand still does.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act } from "@testing-library/react-native";

import { createSeededRng, setRng } from "../../game/solitaire/engine";
import { SOLITAIRE_CARD_PLACE } from "../../game/solitaire/sounds";
import type { Rank, Suit } from "../../game/solitaire/types";
import { playedCount } from "../../test-utils/mockScreenDeps";
import { boardState, faceUp, mountOn, pressLabel } from "./helpers/solitaireFixtures";

jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(() => ({
    popToTop: jest.fn(),
    goBack: jest.fn(),
    navigate: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
  }))
);
jest.mock("../../game/_shared/gameEventClient", () => mockScreenDeps().mockGameEventClient());
jest.mock("../../api/stats", () => mockScreenDeps().mockStatsApi({ getGameRank: jest.fn() }));
jest.mock("../../game/_shared/flushQueuedGames", () => mockScreenDeps().mockFlushQueuedGames());

const mockPlayed: string[] = [];
jest.mock("../../game/_shared/useSound", () => mockScreenDeps().mockSoundByName(() => mockPlayed));
// The loop's edges, as "start:<key>" / "stop:<key>".
jest.mock("../../game/_shared/useLoopSound", () => ({
  useLoopSound: (name: string) => ({
    start: () => mockPlayed.push(`start:${name}`),
    stop: () => mockPlayed.push(`stop:${name}`),
  }),
}));

const played = (name: string) => playedCount(mockPlayed, name);
const cardPlaces = () => SOLITAIRE_CARD_PLACE.reduce((n, key) => n + played(key), 0);
const sequence = (suit: Suit, upTo: number) =>
  Array.from({ length: upTo }, (_, i) => faceUp(suit, (i + 1) as Rank));

/** Three suits home; the K♣ and Q♣ wait in the waste, so Auto-Complete moves two cards. */
const nearlyDone = () =>
  boardState({
    foundations: {
      spades: sequence("spades", 13),
      hearts: sequence("hearts", 13),
      diamonds: sequence("diamonds", 13),
      clubs: sequence("clubs", 11),
    },
    waste: [faceUp("clubs", 13), faceUp("clubs", 12)],
  });

beforeEach(async () => {
  await AsyncStorage.clear();
  setRng(createSeededRng(42));
  mockPlayed.length = 0;
  jest.useFakeTimers({ now: 1_700_000_000_000 });
});

afterEach(() => {
  jest.useRealTimers();
});

it("Auto-Complete plays the riffle for the run, with no card sounds, and settles with the win", async () => {
  const api = await mountOn(nearlyDone());
  expect(played("start:solitaire.autoCompleteLoop")).toBe(0);

  await pressLabel(api, "Auto-Complete");
  expect(played("solitaire.autoCompleteStart")).toBe(1);
  expect(played("start:solitaire.autoCompleteLoop")).toBe(1);

  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  expect(played("stop:solitaire.autoCompleteLoop")).toBe(1);
  expect(played("solitaire.autoCompleteSettle")).toBe(1);
  expect(played("solitaire.gameWin")).toBe(1);
  // Both cards were moved by the run (the last one included): the riffle stands in for them.
  expect(cardPlaces()).toBe(0);
  expect(played("solitaire.cardFlip")).toBe(0);
  // The settle comes as the loop stops, never before.
  expect(mockPlayed.indexOf("solitaire.autoCompleteSettle")).toBeGreaterThan(
    mockPlayed.indexOf("stop:solitaire.autoCompleteLoop")
  );
});

it("a card moved by hand still plays card place, and no riffle starts", async () => {
  const api = await mountOn(
    boardState({
      tableau: [[faceUp("spades", 1)], [], [], [], [], [], []],
    })
  );
  await pressLabel(api, "A of Spades");
  await pressLabel(api, "Empty Spades foundation");
  expect(cardPlaces()).toBe(1);
  expect(played("solitaire.autoCompleteStart")).toBe(0);
  expect(played("start:solitaire.autoCompleteLoop")).toBe(0);
});
