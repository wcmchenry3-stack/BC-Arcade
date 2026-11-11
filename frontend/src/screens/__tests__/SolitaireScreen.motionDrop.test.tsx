/**
 * #3572: a drop settles in 110 ms from where the ghost was let go, with card place on its
 * contact. A dropped run plays card place too, not the multi-card move (owner decision).
 *
 * DropTarget is replaced by a recorder (as in SolitaireScreen.drag.test.tsx), so a drop is
 * delivered to the handler the screen gave each target, with or without the ghost's offset.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act } from "@testing-library/react-native";

import { createSeededRng, setRng } from "../../game/solitaire/engine";
import type { DragCard, DragSource } from "../../game/_shared/drag/DragContext";
import { createDropSink, dropOn, resetDropSink } from "../../test-utils/mockScreenDeps";
import { timeReanimatedEnds } from "../../components/hearts/__tests__/helpers/animationFixtures";
import { boardState, faceUp, landMotion, mountOn, tableauOf } from "./helpers/solitaireFixtures";

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

const mockDrops = createDropSink();
jest.mock("../../game/_shared/drag/DropTarget", () =>
  mockScreenDeps().mockDropTarget(() => mockDrops)
);

/** Every sound played, with the fake clock's time. */
const mockLog: { name: string; at: number }[] = [];
jest.mock("../../game/_shared/useSound", () => {
  const players = new Map<string, { play: () => boolean; stop: () => void }>();
  return {
    useSound: (name: string) => {
      if (!players.has(name)) {
        players.set(name, {
          play: () => {
            mockLog.push({ name, at: Date.now() });
            return true;
          },
          stop: () => undefined,
        });
      }
      return players.get(name);
    },
  };
});

const playedAt = (prefix: string, since: number) =>
  mockLog.filter((e) => e.name.startsWith(prefix)).map((e) => e.at - since);

const CARD: DragCard = { suit: "spades", rank: 7, width: 52, height: 74 };
const fromTableau = (col: number, fromIndex = 0): DragSource => ({
  game: "solitaire",
  type: "tableau",
  col,
  fromIndex,
});

// The 7♠ 6♥ run (column 1) fits the 8♥ (column 2); the lone 6♦ (column 3) fits the 7♣ (column 4).
const board = () =>
  boardState({
    tableau: tableauOf(
      [faceUp("spades", 7), faceUp("hearts", 6)],
      [faceUp("hearts", 8)],
      [faceUp("diamonds", 6)],
      [faceUp("clubs", 7)]
    ),
  });

const flying = (api: Awaited<ReturnType<typeof mountOn>>, key: string) =>
  api.queryByTestId(`card-flight-${key}`, { includeHiddenElements: true }) !== null;

beforeEach(async () => {
  await AsyncStorage.clear();
  setRng(createSeededRng(42));
  resetDropSink(mockDrops);
  mockLog.length = 0;
  jest.useFakeTimers({ now: 1_700_000_000_000 });
  timeReanimatedEnds();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it("a dropped card settles in 110 ms from the ghost, card place 40 ms before contact", async () => {
  const api = await mountOn(board());
  const t = Date.now();
  let accepted = false;
  await act(async () => {
    // As DraggableCard delivers it: the ghost's offset from its pickup.
    accepted = mockDrops.zones.get("solitaire-tableau-3")!(fromTableau(2), [CARD], {
      dx: 40,
      dy: 120,
    });
  });
  expect(accepted).toBe(true);
  expect(flying(api, "diamonds-6")).toBe(true);
  await landMotion(109);
  expect(flying(api, "diamonds-6")).toBe(true);
  await landMotion(1);
  expect(flying(api, "diamonds-6")).toBe(false);
  expect(playedAt("solitaire.cardPlace", t)).toEqual([110 - 40]);
});

it("a dropped run plays card place on its contact, not the multi-card move", async () => {
  const api = await mountOn(board());
  const t = Date.now();
  expect(await dropOn(mockDrops, "solitaire-tableau-1", fromTableau(0), [CARD, CARD])).toBe(true);
  await landMotion(110);
  // The run settles together.
  expect(flying(api, "spades-7")).toBe(false);
  expect(flying(api, "hearts-6")).toBe(false);
  expect(playedAt("solitaire.cardPlace", t)).toEqual([70]);
  expect(playedAt("solitaire.multiCardMove", t)).toEqual([]);
});
