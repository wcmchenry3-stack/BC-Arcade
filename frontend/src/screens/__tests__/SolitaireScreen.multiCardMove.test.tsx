/**
 * #3563: moving a run of two or more cards (tableau to tableau) plays the multi-card "fan sweep"
 * instead of one card place; a single card still plays card place.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import { applyMove, createSeededRng, setRng } from "../../game/solitaire/engine";
import { SOLITAIRE_CARD_PLACE } from "../../game/solitaire/sounds";
import { playedCount } from "../../test-utils/mockScreenDeps";
import { boardState, faceUp, landMotion, mountOn, pressLabel } from "./helpers/solitaireFixtures";

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
jest.mock("../../game/_shared/useLoopSound", () => ({
  useLoopSound: (name: string) => ({
    start: () => mockPlayed.push(`start:${name}`),
    stop: () => mockPlayed.push(`stop:${name}`),
  }),
}));

const played = (name: string) => playedCount(mockPlayed, name);
const cardPlaces = () => SOLITAIRE_CARD_PLACE.reduce((n, key) => n + played(key), 0);

// 7♠ 6♥ (a run of two) on column 1, the 8♥ on column 2, a lone 5♠ on column 3.
const RUN_BOARD = {
  tableau: [
    [faceUp("spades", 7), faceUp("hearts", 6)],
    [faceUp("hearts", 8)],
    [faceUp("spades", 5)],
    [],
    [],
    [],
    [],
  ],
};

beforeEach(async () => {
  await AsyncStorage.clear();
  setRng(createSeededRng(42));
  mockPlayed.length = 0;
  // The sounds are timed to the cards' motion (#3572).
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("engine", () => {
  it("a run of two or more cards emits multiCardMove, not cardPlace", () => {
    const next = applyMove(boardState(RUN_BOARD), {
      type: "tableau-to-tableau",
      fromCol: 0,
      fromIndex: 0,
      toCol: 1,
    });
    expect(next.events).toEqual(["multiCardMove"]);
  });

  it("a single card emits cardPlace", () => {
    const next = applyMove(boardState(RUN_BOARD), {
      type: "tableau-to-tableau",
      fromCol: 2,
      fromIndex: 0,
      toCol: 0,
    });
    expect(next.events).toEqual(["cardPlace"]);
  });
});

describe("screen", () => {
  it("moving a run plays the multi-card sound once and no card place", async () => {
    const api = await mountOn(boardState(RUN_BOARD));
    await pressLabel(api, "7 of Spades");
    await pressLabel(api, "8 of Hearts");
    await landMotion();
    expect(played("solitaire.multiCardMove")).toBe(1);
    expect(cardPlaces()).toBe(0);
  });

  it("moving one card plays card place, not the multi-card sound", async () => {
    const api = await mountOn(boardState(RUN_BOARD));
    await pressLabel(api, "5 of Spades");
    await pressLabel(api, "6 of Hearts");
    await landMotion();
    expect(cardPlaces()).toBe(1);
    expect(played("solitaire.multiCardMove")).toBe(0);
  });
});
