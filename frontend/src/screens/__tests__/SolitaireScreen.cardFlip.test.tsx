/**
 * #3563: a Draw-1 stock draw plays a card flip, a Draw-3 one the three-card fan, and a move that
 * uncovers a face-down card plays card place and a flip together.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import { createSeededRng, setRng } from "../../game/solitaire/engine";
import {
  SOLITAIRE_CARD_FAN,
  SOLITAIRE_CARD_FLIP,
  SOLITAIRE_CARD_PLACE,
} from "../../game/solitaire/sounds";
import type { Card } from "../../game/solitaire/types";
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
const count = (keys: readonly string[]) => keys.reduce((n, key) => n + played(key), 0);
const faceDown = (card: Card): Card => ({ ...card, faceUp: false });
const stock = [faceUp("clubs", 5), faceUp("clubs", 6), faceUp("clubs", 7)].map(faceDown);

beforeEach(async () => {
  await AsyncStorage.clear();
  setRng(createSeededRng(42));
  mockPlayed.length = 0;
});

it("a Draw-1 stock draw plays one card flip", async () => {
  const api = await mountOn(boardState({ drawMode: 1, stock }));
  await pressLabel(api, "Draw 1 from stock, 3 cards remaining");
  expect(count(SOLITAIRE_CARD_FLIP)).toBe(1);
  expect(count(SOLITAIRE_CARD_FAN)).toBe(0);
});

it("a Draw-3 stock draw plays the three-card fan, not a flip", async () => {
  const api = await mountOn(boardState({ drawMode: 3, stock }));
  await pressLabel(api, "Draw 3 from stock, 3 cards remaining");
  expect(count(SOLITAIRE_CARD_FAN)).toBe(1);
  expect(count(SOLITAIRE_CARD_FLIP)).toBe(0);
});

it("a move that uncovers a card plays card place and a flip", async () => {
  const api = await mountOn(
    boardState({
      tableau: [
        [faceDown(faceUp("hearts", 9)), faceUp("hearts", 5)],
        [faceUp("spades", 6)],
        [],
        [],
        [],
        [],
        [],
      ],
    })
  );
  await pressLabel(api, "5 of Hearts");
  await pressLabel(api, "6 of Spades");
  expect(count(SOLITAIRE_CARD_PLACE)).toBe(1);
  expect(count(SOLITAIRE_CARD_FLIP)).toBe(1);
});
