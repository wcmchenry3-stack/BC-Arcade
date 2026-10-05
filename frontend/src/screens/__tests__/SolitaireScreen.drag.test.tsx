/**
 * SolitaireScreen drag-and-drop (#2957): what a drop on a tableau column or a
 * foundation does, and which targets light up for a drag.
 *
 * The real DragProvider runs. DropTarget is replaced by a recorder, so the
 * test can start a drag through the provider (the screen's own
 * `getLegalDropIds` answers it) and deliver a drop to the handler the screen
 * gave each target, without laying out native views.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { createSeededRng, setRng } from "../../game/solitaire/engine";
import type { DragCard, DragSource } from "../../game/_shared/drag/DragContext";
import {
  createDropSink,
  dropOn,
  legalTargets as legalTargetsOf,
  resetDropSink,
} from "../../test-utils/mockScreenDeps";
import { boardState, faceUp, mountOn, tableauOf } from "./helpers/solitaireFixtures";

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

// 6♦ (col 0) fits 7♣ (col 1). The waste's 2♠ fits 3♥ (col 6) and the spades
// foundation (A♠). The hearts foundation's A♥ fits 2♣ (col 4), and 2♥ (col 5)
// fits the hearts foundation. Columns 2 and 3 are empty.
function board() {
  return boardState({
    tableau: tableauOf(
      [faceUp("diamonds", 6)],
      [faceUp("clubs", 7)],
      [],
      [],
      [faceUp("clubs", 2)],
      [faceUp("hearts", 2)],
      [faceUp("hearts", 3)]
    ),
    waste: [faceUp("spades", 2)],
    foundations: {
      spades: [faceUp("spades", 1)],
      hearts: [faceUp("hearts", 1)],
      diamonds: [],
      clubs: [],
    },
  });
}

const CARD: DragCard = { suit: "spades", rank: 2, width: 52, height: 74 };

const fromTableau = (col: number, fromIndex = 0): DragSource => ({
  game: "solitaire",
  type: "tableau",
  col,
  fromIndex,
});
const fromWaste: DragSource = { game: "solitaire", type: "waste" };
const fromFoundation = (suit: string): DragSource => ({
  game: "solitaire",
  type: "foundation",
  suit,
});
const fromFreeCell: DragSource = { game: "freecell", type: "freecell", cell: 0 };

const drop = (zoneId: string, source: DragSource, cards: DragCard[] = [CARD]) =>
  dropOn(mockDrops, zoneId, source, cards);

/** Starts a drag and returns the ids of the targets the screen lights up for it. */
const legalTargets = (source: DragSource, cards: DragCard[] = [CARD]) =>
  legalTargetsOf(mockDrops, source, cards);

const ALL_FOUNDATIONS = [
  "solitaire-foundation-spades",
  "solitaire-foundation-hearts",
  "solitaire-foundation-diamonds",
  "solitaire-foundation-clubs",
];

beforeEach(async () => {
  await AsyncStorage.clear();
  setRng(createSeededRng(42));
  resetDropSink(mockDrops);
});

describe("SolitaireScreen — drop on a tableau column", () => {
  it("moves a tableau card onto a legal column", async () => {
    const api = await mountOn(board());
    expect(await drop("solitaire-tableau-1", fromTableau(0))).toBe(true);
    expect(api.getByLabelText("Moves: 1")).toBeTruthy();
  });

  it("rejects a tableau card dropped on an illegal column", async () => {
    const api = await mountOn(board());
    expect(await drop("solitaire-tableau-4", fromTableau(0))).toBe(false);
    expect(api.getByLabelText("Moves: 0")).toBeTruthy();
  });

  it("moves the waste card onto a legal column", async () => {
    const api = await mountOn(board());
    expect(await drop("solitaire-tableau-6", fromWaste)).toBe(true);
    expect(api.getByLabelText("Moves: 1")).toBeTruthy();
    expect(api.getByLabelText("Empty waste pile")).toBeTruthy();
  });

  it("rejects the waste card dropped on an illegal column", async () => {
    const api = await mountOn(board());
    expect(await drop("solitaire-tableau-0", fromWaste)).toBe(false);
    expect(api.getByLabelText("Moves: 0")).toBeTruthy();
  });

  it("returns a foundation card to a legal column", async () => {
    const api = await mountOn(board());
    expect(await drop("solitaire-tableau-4", fromFoundation("hearts"))).toBe(true);
    expect(api.getByLabelText("Moves: 1")).toBeTruthy();
  });

  it("rejects a foundation card dropped on an illegal column", async () => {
    const api = await mountOn(board());
    expect(await drop("solitaire-tableau-4", fromFoundation("spades"))).toBe(false);
    expect(api.getByLabelText("Moves: 0")).toBeTruthy();
  });

  it("rejects a drag from another game", async () => {
    const api = await mountOn(board());
    expect(await drop("solitaire-tableau-1", fromFreeCell)).toBe(false);
    expect(api.getByLabelText("Moves: 0")).toBeTruthy();
  });
});

describe("SolitaireScreen — drop on a foundation", () => {
  it("sends a tableau card to its foundation", async () => {
    const api = await mountOn(board());
    expect(await drop("solitaire-foundation-hearts", fromTableau(5))).toBe(true);
    expect(api.getByLabelText("Moves: 1")).toBeTruthy();
    expect(api.getByLabelText("2 of Hearts")).toBeTruthy();
  });

  it("rejects a tableau card that is not next on its foundation", async () => {
    const api = await mountOn(board());
    expect(await drop("solitaire-foundation-diamonds", fromTableau(0))).toBe(false);
    expect(api.getByLabelText("Moves: 0")).toBeTruthy();
  });

  it("sends the waste card to its foundation", async () => {
    const api = await mountOn(board());
    expect(await drop("solitaire-foundation-spades", fromWaste)).toBe(true);
    expect(api.getByLabelText("Moves: 1")).toBeTruthy();
    expect(api.getByLabelText("Empty waste pile")).toBeTruthy();
  });

  it("rejects a card dragged from a foundation, or from another game", async () => {
    const api = await mountOn(board());
    expect(await drop("solitaire-foundation-hearts", fromFoundation("hearts"))).toBe(false);
    expect(await drop("solitaire-foundation-hearts", fromFreeCell)).toBe(false);
    expect(api.getByLabelText("Moves: 0")).toBeTruthy();
  });
});

describe("SolitaireScreen — legal targets while dragging", () => {
  it("lights the column a tableau card fits, and no foundation it does not", async () => {
    await mountOn(board());
    expect(await legalTargets(fromTableau(0))).toEqual(["solitaire-tableau-1"]);
  });

  it("lights every foundation for a top card that is next on its own", async () => {
    await mountOn(board());
    expect(await legalTargets(fromTableau(5))).toEqual(ALL_FOUNDATIONS);
  });

  it("offers no foundation for a run of several cards", async () => {
    await mountOn(board());
    expect(await legalTargets(fromTableau(0), [CARD, CARD])).toEqual(["solitaire-tableau-1"]);
  });

  it("lights the column and the foundations the waste card fits", async () => {
    await mountOn(board());
    expect(await legalTargets(fromWaste)).toEqual(["solitaire-tableau-6", ...ALL_FOUNDATIONS]);
  });

  it("lights the columns a foundation card can return to", async () => {
    await mountOn(board());
    expect(await legalTargets(fromFoundation("hearts"))).toEqual(["solitaire-tableau-4"]);
  });

  it("lights nothing for a drag from another game", async () => {
    await mountOn(board());
    expect(await legalTargets(fromFreeCell)).toEqual([]);
  });
});
