/**
 * #3573: FreeCell's card motion and the sounds timed to it ("A. Match Solitaire"). Each sound
 * is checked against the motion's own clock: the flights land from their UI-thread end
 * callbacks (`timeReanimatedEnds` reports them after their duration on the fake clock) or, when
 * that callback is lost, from their backstops. A card in flight is drawn by the flight layer
 * (testID `card-flight-<suit>-<rank>`, hidden from screen readers).
 */
import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AccessibilityInfo, Dimensions, StyleSheet } from "react-native";
import { act, fireEvent, render, within } from "@testing-library/react-native";

import FreeCellScreen from "../FreeCellScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import type { Card, FreeCellState, Rank, Suit } from "../../game/freecell/types";
import { resetReduceMotionForTests } from "../../components/shared/useReduceMotion";
import { GHOST_LIFT } from "../../game/_shared/drag/dragGeometry";
import { createDropSink, legalTargets, resetDropSink } from "../../test-utils/mockScreenDeps";
import { timeReanimatedEnds } from "../../components/hearts/__tests__/helpers/animationFixtures";
import { freeCellGeometry } from "../../game/freecell/layout";
import { faceUpStepFor } from "../../game/_shared/cards/tableLayout";
import { LARGE_CARD_WIDTH } from "../../game/freecell/largeCards";

jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(() => ({
    popToTop: jest.fn(),
    goBack: jest.fn(),
    navigate: jest.fn(),
    addListener: (event: string, handler: () => void) => {
      const list = mockNavListeners.get(event) ?? [];
      list.push(handler);
      mockNavListeners.set(event, list);
      return () => {
        mockNavListeners.set(
          event,
          (mockNavListeners.get(event) ?? []).filter((h) => h !== handler)
        );
      };
    },
  }))
);
/** The screen's navigation listeners, so a test can blur it (another screen covers the game). */
const mockNavListeners = new Map<string, Array<() => void>>();
jest.mock("../../game/_shared/gameEventClient", () => mockScreenDeps().mockGameEventClient());
jest.mock("../../api/stats", () => mockScreenDeps().mockStatsApi({ getGameRank: jest.fn() }));
jest.mock("../../game/_shared/flushQueuedGames", () => mockScreenDeps().mockFlushQueuedGames());

/** Every sound played (and the foundation effect shown), with the fake clock's time. */
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
jest.mock("../../game/_shared/useLoopSound", () => ({
  useLoopSound: (name: string) => ({
    start: () => mockLog.push({ name: `start:${name}`, at: Date.now() }),
    stop: () => mockLog.push({ name: `stop:${name}`, at: Date.now() }),
  }),
}));
const mockDrops = createDropSink();
jest.mock("../../game/_shared/drag/DropTarget", () =>
  mockScreenDeps().mockDropTarget(() => mockDrops)
);

/** The OS's Reduce Motion listeners, so a test can turn it on mid-flight. */
let reduceMotionListeners: Array<(enabled: boolean) => void> = [];

const T0 = 1_700_000_000_000;
const HIDDEN_TOO = { includeHiddenElements: true };
/** A flight's testID (not the layer's own). */
const IN_FLIGHT = /^card-flight-[a-z]+-\d+$/;

// ── Boards ───────────────────────────────────────────────────────────────────

const c = (suit: Suit, rank: number): Card => ({ suit, rank: rank as Rank });
const upTo = (suit: Suit, rank: number) => Array.from({ length: rank }, (_, i) => c(suit, i + 1));

function boardState(tableau: Card[][], overrides: Partial<FreeCellState> = {}): FreeCellState {
  const cols = [...tableau];
  while (cols.length < 8) cols.push([]);
  return {
    _v: 1,
    tableau: cols,
    freeCells: [null, null, null, null],
    foundations: { spades: [], hearts: [], diamonds: [], clubs: [] },
    undoStack: [],
    isComplete: false,
    moveCount: 0,
    ...overrides,
  };
}

/** 6♥ (column 0) fits 7♠ (column 1) and 7♣ (column 2); no Ace in play, so nothing auto-completes. */
const twoTargets = () => boardState([[c("hearts", 6)], [c("spades", 7)], [c("clubs", 7)]]);

/** A three-card run (8♠ 7♥ 6♣) that fits the 9♥ of column 1, and the 7♦ of column 2. */
const runBoard = () =>
  boardState([
    [c("spades", 8), c("hearts", 7), c("clubs", 6)],
    [c("hearts", 9)],
    [c("diamonds", 7)],
  ]);

/**
 * Every suit home but spades (A to J); the K♠ covers the Q♠ in column 0, so Auto-Complete
 * waits for the K♠ to go to a free cell. Then it moves the Q♠ and the K♠ (the win).
 * `hearts`: also leave the K♥ in column 1, so the run completes two suits.
 */
function blockedKing(hearts = false): FreeCellState {
  return boardState([[c("spades", 12), c("spades", 13)], hearts ? [c("hearts", 13)] : []], {
    foundations: {
      spades: upTo("spades", 11),
      hearts: upTo("hearts", hearts ? 12 : 13),
      diamonds: upTo("diamonds", 13),
      clubs: upTo("clubs", 13),
    },
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function mountOn(state: FreeCellState) {
  await AsyncStorage.setItem("freecell_game", JSON.stringify(state));
  const api = await render(
    <ThemeProvider>
      <FreeCellScreen />
    </ThemeProvider>
  );
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  return api;
}
type Api = Awaited<ReturnType<typeof mountOn>>;

async function press(api: Api, label: string) {
  await act(async () => {
    await fireEvent.press(api.getByLabelText(label));
  });
}

/** Selects `from` and plays it on `to`; returns the time of the move. */
async function move(api: Api, from: string, to: string): Promise<number> {
  await press(api, from);
  const at = Date.now();
  await press(api, to);
  return at;
}

/**
 * A move that makes the board auto-completable, then a tap on the Auto-Complete button
 * (#3566: no run starts by itself); returns the time of both. The run's first card is one
 * step (120 ms) away.
 */
async function moveThenAutoComplete(api: Api, from: string, to: string): Promise<number> {
  const at = await move(api, from, to);
  await press(api, "Auto-Complete");
  return at;
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

/** Delivers a drop of `source` with the ghost let go at `offset`; returns the time. */
async function dropAt(
  zone: string,
  source: Record<string, unknown>,
  cards: number,
  offset: { dx: number; dy: number }
): Promise<number> {
  const at = Date.now();
  let accepted = false;
  await act(async () => {
    accepted = mockDrops.zones.get(zone)!(
      { game: "freecell", ...source } as never,
      Array.from({ length: cards }, () => ({ suit: "hearts", rank: 6, width: 40, height: 56 })),
      offset
    );
  });
  expect(accepted).toBe(true);
  return at;
}

async function newGameFromMenu(api: Api) {
  await press(api, "More options");
  await act(async () => {
    await fireEvent.press(api.getByText("New Game"));
  });
  await press(api, "Start New");
}

/** When the sounds whose name starts with `prefix` played, in ms after `since`. */
const playedAt = (prefix: string, since: number) =>
  mockLog.filter((e) => e.name.startsWith(prefix)).map((e) => e.at - since);

const PLACE = "freecell.cardPlace";
const MULTI = "freecell.supermove";
const WIN = "freecell.gameWin";
const SETTLE = "freecell.autoCompleteSettle";
const RIFFLE_START = "freecell.autoCompleteStart";
const LOOP_STOP = "stop:freecell.autoCompleteLoop";

const flying = (api: Api, key: string) =>
  api.queryByTestId(`card-flight-${key}`, HIDDEN_TOO) !== null;
const inFlight = (api: Api) => api.queryAllByTestId(IN_FLIGHT, HIDDEN_TOO);

/** A flight's first frame: the Jest Reanimated mock draws a flight's first frame and stops. */
function transformOf(api: Api, key: string): Record<string, number> {
  const view = api.getByTestId(`card-flight-${key}`, HIDDEN_TOO);
  const transform = (StyleSheet.flatten(view.props.style).transform ?? []) as Array<
    Record<string, number>
  >;
  return Object.assign({}, ...transform);
}
const startOf = (api: Api, key: string) => {
  const t = transformOf(api, key);
  return { x: t.translateX!, y: t.translateY! };
};

/** A card's flight's testID. */
const flightID = (key: string) => `card-flight-${key}`;

/** The drawn size of the card inside `testID` (a flight, or a pile's card). */
function drawnSize(api: Api, testID: string): { width: number; height: number } {
  type El = { props: { style?: unknown }; children?: unknown[] };
  const sizeIn = (el: El): { width: number; height: number } | undefined => {
    const style = StyleSheet.flatten(el.props.style as never) as
      { width?: unknown; height?: unknown } | undefined;
    if (typeof style?.width === "number" && typeof style.height === "number") {
      return { width: style.width, height: style.height };
    }
    for (const child of el.children ?? []) {
      if (typeof child === "string") continue;
      const found = sizeIn(child as El);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return sizeIn(api.getByTestId(testID, HIDDEN_TOO) as never)!;
}
const drawnWidth = (api: Api, testID: string) => drawnSize(api, testID).width;

/** The "FREE" watermarks drawn (the empty cells', and one under a card flying into a cell). */
const freeMarks = (api: Api) => api.queryAllByText("free", HIDDEN_TOO).length;

const resultShown = (api: Api) =>
  api.queryByTestId("animation-overlay", HIDDEN_TOO) !== null ||
  api.queryByTestId("freecell-result") !== null;

beforeEach(async () => {
  mockNavListeners.clear();
  await AsyncStorage.clear();
  resetReduceMotionForTests();
  resetDropSink(mockDrops);
  reduceMotionListeners = [];
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, "addEventListener").mockImplementation(((
    event: string,
    handler: (enabled: boolean) => void
  ) => {
    if (event === "reduceMotionChanged") reduceMotionListeners.push(handler);
    return { remove: () => undefined };
  }) as never);
  mockLog.length = 0;
  jest.useFakeTimers({ now: T0 });
});

const ORIGINAL_WINDOW = Dimensions.get("window");

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  Dimensions.set({ window: ORIGINAL_WINDOW });
});

describe("with the flights' end callbacks (timeReanimatedEnds)", () => {
  beforeEach(() => {
    timeReanimatedEnds();
  });

  it("a tapped card lands at 200 ms; card place plays 40 ms before the contact", async () => {
    const api = await mountOn(twoTargets());
    const t = await move(api, "6 of Hearts", "7 of Spades");
    expect(flying(api, "hearts-6")).toBe(true);
    await advance(199);
    expect(flying(api, "hearts-6")).toBe(true);
    await advance(1);
    expect(flying(api, "hearts-6")).toBe(false);
    expect(playedAt(PLACE, t)).toEqual([160]);
  });

  it("a supermove lands head first, 15 ms apart; the multi-move peak lands on the last contact", async () => {
    const api = await mountOn(runBoard());
    const t = await move(api, "8 of Spades", "9 of Hearts");
    await advance(249);
    expect(flying(api, "clubs-6")).toBe(true);
    expect(flying(api, "spades-8")).toBe(false);
    await advance(1);
    expect(flying(api, "clubs-6")).toBe(false);
    // The last contact is at 220 + 2 x 15 = 250 ms; the multi-move's landing peak is 237 ms in.
    expect(playedAt(MULTI, t)).toEqual([250 - 237]);
    expect(playedAt(PLACE, t)).toEqual([]);
  });

  it("a card going to a free cell is drawn at the top row's size, scaling down from the tableau's", async () => {
    const api = await mountOn(twoTargets());
    const tableau = drawnWidth(api, "freecell-col-1-top");
    // The 6♥'s slot: where an unscaled flight of it starts (a move there and back).
    await move(api, "6 of Hearts", "7 of Spades");
    const slot = startOf(api, "hearts-6");
    await advance(1000);
    await press(api, "Undo");
    await advance(1000);
    mockLog.length = 0;
    expect(freeMarks(api)).toBe(4);
    const t = await move(api, "6 of Hearts", "Empty free cell 2");
    const size = drawnSize(api, flightID("hearts-6"));
    const flight = size.width;
    // Its first frame is the tableau card's size, about its top-left corner: React Native
    // scales about the centre, so the translate takes back half of what the scale moved.
    const first = transformOf(api, "hearts-6");
    const scale = tableau / flight;
    expect(first.scaleY).toBeCloseTo(scale);
    expect(first.scaleX).toBeCloseTo(scale);
    expect(first.translateX).toBeCloseTo(slot.x - ((1 - scale) * size.width) / 2);
    expect(first.translateY).toBeCloseTo(slot.y - ((1 - scale) * size.height) / 2);
    // The free cell it flies into keeps its "FREE" watermark under it until it lands.
    expect(freeMarks(api)).toBe(4);
    await advance(200);
    expect(flying(api, "hearts-6")).toBe(false);
    expect(freeMarks(api)).toBe(3);
    // It lands at exactly the free cell's card size (no pop).
    expect(drawnWidth(api, "freecell-slot-1-card")).toBe(flight);
    expect(flight).toBeLessThan(tableau);
    expect(playedAt(PLACE, t)).toEqual([160]);
  });

  it("a free-cell card comes down drawn at the tableau's size, growing from the top row's", async () => {
    const api = await mountOn(
      boardState([[c("spades", 7)]], { freeCells: [c("hearts", 6), null, null, null] })
    );
    const top = drawnWidth(api, "freecell-slot-0-card");
    await move(api, "6 of Hearts", "7 of Spades");
    const flight = drawnWidth(api, flightID("hearts-6"));
    expect(flight).toBeGreaterThan(top);
    expect(transformOf(api, "hearts-6").scaleY).toBeCloseTo(top / flight);
  });

  it("a drop settles in 110 ms from where the ghost was let go; card place 40 ms before", async () => {
    const tapApi = await mountOn(twoTargets());
    await move(tapApi, "6 of Hearts", "7 of Spades");
    const slot = startOf(tapApi, "hearts-6");
    await act(async () => {
      await tapApi.unmount();
    });
    mockDrops.zones.clear();
    mockLog.length = 0;
    const api = await mountOn(twoTargets());
    const t = await dropAt("freecell-tableau-1", { type: "tableau", col: 0, fromIndex: 0 }, 1, {
      dx: 40,
      dy: 120,
    });
    expect(startOf(api, "hearts-6")).toEqual({ x: slot.x + 40, y: slot.y + 120 - GHOST_LIFT });
    await advance(109);
    expect(flying(api, "hearts-6")).toBe(true);
    await advance(1);
    expect(flying(api, "hearts-6")).toBe(false);
    expect(playedAt(PLACE, t)).toEqual([70]);
  });

  it("a dropped run settles all at once, with card place (as Solitaire's)", async () => {
    const api = await mountOn(runBoard());
    const t = await dropAt("freecell-tableau-1", { type: "tableau", col: 0, fromIndex: 0 }, 3, {
      dx: 10,
      dy: 10,
    });
    await advance(110);
    expect(inFlight(api)).toEqual([]);
    expect(playedAt(PLACE, t)).toEqual([70]);
    expect(playedAt(MULTI, t)).toEqual([]);
  });

  it("Undo flies the card back, card place 40 ms before its landing", async () => {
    const api = await mountOn(twoTargets());
    await move(api, "6 of Hearts", "7 of Spades");
    await advance(1000);
    mockLog.length = 0;
    const t = Date.now();
    await press(api, "Undo");
    expect(flying(api, "hearts-6")).toBe(true);
    await advance(200);
    expect(flying(api, "hearts-6")).toBe(false);
    expect(playedAt(PLACE, t)).toEqual([160]);
  });

  it("Undo of a run flies it back with the run's timing, one card place on the last landing", async () => {
    const api = await mountOn(runBoard());
    await move(api, "8 of Spades", "9 of Hearts");
    await advance(1000);
    mockLog.length = 0;
    const t = Date.now();
    await press(api, "Undo");
    await advance(1000);
    expect(playedAt(PLACE, t)).toEqual([250 - 40]);
    expect(playedAt(MULTI, t)).toEqual([]);
  });

  it("Undo mid-flight: the card flies back from where it is; only the Undo's card place", async () => {
    const api = await mountOn(twoTargets());
    const t = await move(api, "6 of Hearts", "7 of Spades");
    await advance(90);
    await press(api, "Undo");
    expect(flying(api, "hearts-6")).toBe(true);
    await advance(1000);
    expect(playedAt(PLACE, t)).toEqual([90 + 160]);
    expect(api.getByLabelText("Moves: 0")).toBeTruthy();
  });

  it("Undo just after a supermove: the cards that had not left do not delay the landing sound", async () => {
    const api = await mountOn(runBoard());
    const t = await move(api, "8 of Spades", "9 of Hearts");
    // 10 ms in, only the 8♠ has left; the 7♥ and 6♣ still wait for their stagger at their slots.
    await advance(10);
    await press(api, "Undo");
    expect(flying(api, "spades-8")).toBe(true);
    expect(flying(api, "hearts-7")).toBe(false);
    expect(flying(api, "clubs-6")).toBe(false);
    await advance(1000);
    // The 8♠ flies back in 220 ms: card place at 10 + 180. Counting the cards that never moved
    // (the audition's bug) would have put it at 10 + 210. The run's multi-move was called off.
    expect(playedAt(PLACE, t)).toEqual([10 + 180]);
    expect(playedAt(MULTI, t)).toEqual([]);
  });

  it("a card sent straight back before it left plays no card place (#3712 review)", async () => {
    const api = await mountOn(
      boardState([[c("spades", 7)]], { freeCells: [c("hearts", 6), null, null, null] })
    );
    const t = await move(api, "6 of Hearts", "7 of Spades");
    // At 0 ms the 6♥ is still shown in free cell 1: sent back there, it never leaves.
    await move(api, "6 of Hearts", "Empty free cell 1");
    expect(inFlight(api)).toEqual([]);
    await advance(1000);
    expect(playedAt(PLACE, t)).toEqual([]);
    expect(api.getByLabelText("Moves: 2")).toBeTruthy();
  });

  it("a run sent straight back before it left plays no multi-card move", async () => {
    // The 8♠ 7♥ 6♣ run sits on a 9♦ in column 0, and fits the 9♥ of column 1 too.
    const api = await mountOn(
      boardState([
        [c("diamonds", 9), c("spades", 8), c("hearts", 7), c("clubs", 6)],
        [c("hearts", 9)],
      ])
    );
    const t = await move(api, "8 of Spades", "9 of Hearts");
    // At 0 ms no card of the run has left column 0: sent back onto the 9♦, none moves.
    await move(api, "8 of Spades", "9 of Diamonds");
    expect(api.getByLabelText("Moves: 2")).toBeTruthy();
    expect(inFlight(api)).toEqual([]);
    await advance(1000);
    expect(playedAt(MULTI, t)).toEqual([]);
    expect(playedAt(PLACE, t)).toEqual([]);
  });

  it("a new action re-targets a card in flight; the move it called off goes quiet", async () => {
    const api = await mountOn(twoTargets());
    const t = await move(api, "6 of Hearts", "7 of Spades");
    await advance(100);
    // The 6♥ is in flight (its real view transparent but still there): play it on to 7♣.
    await move(api, "6 of Hearts", "7 of Clubs");
    await advance(150);
    expect(flying(api, "hearts-6")).toBe(true);
    await advance(50);
    expect(flying(api, "hearts-6")).toBe(false);
    expect(playedAt(PLACE, t)).toEqual([100 + 160]);
    expect(api.getByLabelText("Moves: 2")).toBeTruthy();
  });

  it("Auto-Complete: no run starts by itself after the move; the button's first card goes one step after the tap (#3566)", async () => {
    const api = await mountOn(blockedKing());
    const t = await move(api, "K of Spades", "Empty free cell 1");
    // The move made the board auto-completable: the button is offered, nothing runs.
    await advance(2000);
    expect(api.getByLabelText("Auto-Complete")).toBeTruthy();
    expect(flying(api, "spades-12")).toBe(false);
    expect(playedAt(RIFFLE_START, t)).toEqual([]);
    const tap = Date.now();
    await press(api, "Auto-Complete");
    await advance(119);
    expect(flying(api, "spades-12")).toBe(false);
    expect(playedAt(RIFFLE_START, tap)).toEqual([]);
    await advance(1);
    // One step after the tap: the Q♠ goes up, and the riffle starts with it.
    expect(flying(api, "spades-12")).toBe(true);
    expect(playedAt(RIFFLE_START, tap)).toEqual([120]);
    expect(playedAt(PLACE, t)).toEqual([160]);
  });

  it("Auto-Complete: the riffle holds to the last landing; the settle and the win follow it; then the result", async () => {
    const api = await mountOn(blockedKing());
    const t = await moveThenAutoComplete(api, "K of Spades", "Empty free cell 1");
    // Steps at 120 (Q♠) and 240 (K♠, the win); the K♠ lands at 240 + 220 = 460.
    await advance(382);
    expect(playedAt(LOOP_STOP, t)).toEqual([]);
    expect(playedAt(WIN, t)).toEqual([]);
    await advance(1);
    // The settle's 77 ms peak lands on the last contact: it starts at 383, with the win.
    expect(playedAt(LOOP_STOP, t)).toEqual([383]);
    expect(playedAt(SETTLE, t)).toEqual([383]);
    expect(playedAt(WIN, t)).toEqual([383]);
    // The result (its celebration first) waits for the last landing.
    await advance(76);
    expect(resultShown(api)).toBe(false);
    await advance(1);
    expect(resultShown(api)).toBe(true);
    // The run's own cards stay quiet; the trigger keeps its card place.
    expect(playedAt(PLACE, t)).toEqual([160]);
  });

  it("during the win hold the board is still: no selection, no sound, no drag, no Undo", async () => {
    const api = await mountOn(blockedKing());
    await moveThenAutoComplete(api, "K of Spades", "Empty free cell 1");
    // The win step is at 240; its card is in the air until 460.
    await advance(320);
    mockLog.length = 0;
    expect(resultShown(api)).toBe(false);
    // A tap and a double-tap on the foundation's top card (the K♠, still landing).
    await press(api, "K of Spades");
    await press(api, "K of Spades");
    expect(api.queryByText(/\(selected\)/)).toBeNull();
    expect(
      await legalTargets(mockDrops, { game: "freecell", type: "foundation", suit: "spades" })
    ).toEqual([]);
    await press(api, "Undo");
    expect(mockLog.filter((e) => e.name === "freecell.invalidMove")).toEqual([]);
    expect(api.getByLabelText("Moves: 3")).toBeTruthy();
  });

  it("a restored game draws nothing in flight and replays no sound", async () => {
    const api = await mountOn({
      ...twoTargets(),
      events: [{ type: "cardPlace" }, { type: "supermove", cardCount: 2 }],
    } as FreeCellState);
    expect(inFlight(api)).toEqual([]);
    await advance(1000);
    expect(mockLog).toEqual([]);
  });

  it("New Game mid-flight lands every card and cancels the cues", async () => {
    const api = await mountOn(twoTargets());
    await move(api, "6 of Hearts", "7 of Spades");
    await advance(50);
    await newGameFromMenu(api);
    expect(inFlight(api)).toEqual([]);
    await advance(1000);
    expect(playedAt(PLACE, 0)).toEqual([]);
  });

  it("New Game during the win hold: no settle, no win sound, no result card", async () => {
    const api = await mountOn(blockedKing());
    const t = await moveThenAutoComplete(api, "K of Spades", "Empty free cell 1");
    await advance(320); // in the win hold: the win step at 240, its landing at 460
    await newGameFromMenu(api);
    expect(inFlight(api)).toEqual([]);
    await advance(3000);
    expect(playedAt(SETTLE, t)).toEqual([]);
    expect(playedAt(WIN, t)).toEqual([]);
    expect(api.queryByTestId("freecell-result")).toBeNull();
  });

  it("unmounting mid-flight cancels the cues", async () => {
    const api = await mountOn(runBoard());
    await move(api, "8 of Spades", "9 of Hearts");
    await act(async () => {
      await api.unmount();
    });
    await advance(1000);
    expect(mockLog).toEqual([]);
  });

  it("unmounting during the win hold plays nothing more", async () => {
    const api = await mountOn(blockedKing());
    const t = await moveThenAutoComplete(api, "K of Spades", "Empty free cell 1");
    await advance(320); // in the win hold: the win step at 240, its landing at 460
    await act(async () => {
      await api.unmount();
    });
    await advance(1000);
    expect(playedAt(SETTLE, t)).toEqual([]);
    expect(playedAt(WIN, t)).toEqual([]);
  });

  it("leaving the game mid-flight lands every card and drops the cues", async () => {
    const api = await mountOn(twoTargets());
    await move(api, "6 of Hearts", "7 of Spades");
    await advance(50);
    await act(async () => {
      mockNavListeners.get("blur")?.forEach((h) => h());
    });
    expect(flying(api, "hearts-6")).toBe(false);
    await advance(1000);
    expect(playedAt(PLACE, 0)).toEqual([]);
  });

  it("leaving during the win hold: the riffle stops without its settle or the win sound", async () => {
    const api = await mountOn(blockedKing());
    const t = await moveThenAutoComplete(api, "K of Spades", "Empty free cell 1");
    await advance(320); // in the win hold: the win step at 240, its landing at 460
    await act(async () => {
      mockNavListeners.get("blur")?.forEach((h) => h());
    });
    expect(inFlight(api)).toEqual([]);
    await advance(1000);
    expect(playedAt(LOOP_STOP, t)).toHaveLength(1);
    expect(playedAt(SETTLE, t)).toEqual([]);
    expect(playedAt(WIN, t)).toEqual([]);
  });

  it("a board re-laid out mid-flight (the felt resized) lands every card at once", async () => {
    const api = await mountOn(runBoard());
    await move(api, "8 of Spades", "9 of Hearts");
    await advance(50);
    expect(inFlight(api)).not.toEqual([]);
    await act(async () => {
      fireEvent(api.getByTestId("freecell-felt"), "layout", {
        nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 420 } },
      });
    });
    expect(inFlight(api)).toEqual([]);
  });

  it("no moves left: the stuck sound plays on the move's landing, and goes with a New Game", async () => {
    // Red cards only, but for the A♠: once it is home, nothing can move.
    const board = () =>
      boardState(
        [
          [c("hearts", 13), c("spades", 1)],
          [c("diamonds", 13)],
          [c("hearts", 12)],
          [c("diamonds", 12)],
          [c("hearts", 11)],
          [c("diamonds", 11)],
          [c("hearts", 10)],
          [c("diamonds", 10)],
        ],
        { freeCells: [c("hearts", 5), c("diamonds", 5), c("hearts", 4), c("diamonds", 4)] }
      );
    const api = await mountOn(board());
    const t = Date.now();
    await press(api, "A of Spades");
    await press(api, "A of Spades (selected)");
    expect(api.getByText(/no moves left/i)).toBeTruthy();
    await advance(199);
    expect(playedAt("freecell.noMoves", t)).toEqual([]);
    await advance(1);
    expect(playedAt("freecell.noMoves", t)).toEqual([200]);
    // Cancelled like the other cues: a New Game before the landing plays nothing.
    await newGameFromMenu(api);
    await act(async () => {
      await api.unmount();
    });
    mockLog.length = 0;
    const again = await mountOn(board());
    await press(again, "A of Spades");
    await press(again, "A of Spades (selected)");
    await advance(100);
    await newGameFromMenu(again);
    await advance(1000);
    expect(playedAt("freecell.noMoves", 0)).toEqual([]);
  });

  it("a card that slides on stays its move's: a later move of it silences that move, not the slide's", async () => {
    // The probe from the #3712 review. A: the 6♥ onto the 7♠. B, at 50 ms: a card onto the
    // tall column 3 tightens the board's step, so the 6♥ (still landing) slides on to its
    // shifted slot. C, at 100 ms: the 6♥ to a free cell. C calls A off; B and C keep theirs.
    Dimensions.set({ window: { width: 375, height: 667, scale: 2, fontScale: 1 } });
    const felt = { width: 363, height: 459 };
    const g = freeCellGeometry({ width: felt.width - 2, height: felt.height - 2 });
    const RUN = [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2].map((rank, i) =>
      c(i % 2 === 0 ? "hearts" : "clubs", rank)
    );
    const step = (n: number) => faceUpStepFor(g, [{ down: 0, up: n }]);
    // The column length at which one more card tightens the step.
    let n = 2;
    while (n < RUN.length - 1 && step(n + 1) === step(n)) n++;
    expect(step(n + 1)).toBeLessThan(step(n));
    const api = await mountOn(
      boardState([[c("hearts", 6)], [c("spades", 7)], [], RUN.slice(0, n), [RUN[n]!]])
    );
    await act(async () => {
      fireEvent(api.getByTestId("freecell-felt"), "layout", {
        nativeEvent: { layout: { x: 0, y: 0, ...felt } },
      });
    });
    const label = (card: Card) =>
      `${card.rank === 13 ? "K" : card.rank === 12 ? "Q" : card.rank === 11 ? "J" : card.rank} of ${
        card.suit[0]!.toUpperCase() + card.suit.slice(1)
      }`;
    const t = await move(api, "6 of Hearts", "7 of Spades");
    const aStart = startOf(api, "hearts-6");
    await advance(50);
    await move(api, label(RUN[n]!), label(RUN[n - 1]!));
    // The 6♥ slid on: a new flight, from where it was shown.
    expect(startOf(api, "hearts-6")).not.toEqual(aStart);
    await advance(50);
    await move(api, "6 of Hearts", "Empty free cell 1");
    await advance(1000);
    expect(playedAt(PLACE, t)).toEqual([50 + 160, 100 + 160]);
    expect(inFlight(api)).toEqual([]);
  });

  it("Reduce Motion turned on mid-flight lands the card at once", async () => {
    const api = await mountOn(twoTargets());
    await move(api, "6 of Hearts", "7 of Spades");
    await advance(50);
    expect(flying(api, "hearts-6")).toBe(true);
    await act(async () => {
      reduceMotionListeners.forEach((h) => h(true));
    });
    expect(flying(api, "hearts-6")).toBe(false);
    // The next move is instant.
    mockLog.length = 0;
    const t = await move(api, "6 of Hearts", "7 of Clubs");
    expect(inFlight(api)).toEqual([]);
    expect(playedAt(PLACE, t)).toEqual([0]);
  });
  it("Reduce Motion turned on mid-Auto-Complete: the run's later cards land at once (#3712 review)", async () => {
    const api = await mountOn(blockedKing(true));
    const t = await moveThenAutoComplete(api, "K of Spades", "Empty free cell 1");
    // Steps at 120 (Q♠), 240 (K♠) and 360 (K♥, the win). The toggle comes while Q♠ flies,
    // before K♠'s and K♥'s steps, so both of those are queued after it (#3831 review).
    await advance(170);
    expect(flying(api, "spades-12")).toBe(true);
    await act(async () => {
      reduceMotionListeners.forEach((h) => h(true));
    });
    expect(flying(api, "spades-12")).toBe(false);
    // The queued steps read the setting as it is now: nothing more flies.
    await advance(70);
    expect(flying(api, "spades-13")).toBe(false);
    expect(inFlight(api)).toEqual([]);
    await advance(120);
    expect(inFlight(api)).toEqual([]);
    // The win lands at its step, not at a flight's contact.
    expect(playedAt(WIN, t)).toEqual([360]);
  });
});

describe("when a flight's end callback is lost (the default Reanimated mock drops it)", () => {
  it("the backstop lands the card 250 ms after its flight", async () => {
    const api = await mountOn(twoTargets());
    const t = await move(api, "6 of Hearts", "7 of Spades");
    await advance(449);
    expect(flying(api, "hearts-6")).toBe(true);
    await advance(1);
    expect(flying(api, "hearts-6")).toBe(false);
    // The cue is timed to the motion, not to the callback.
    expect(playedAt(PLACE, t)).toEqual([160]);
  });

  it("the backstop releases the win (its celebration, then the result card)", async () => {
    const api = await mountOn(blockedKing());
    const t = await moveThenAutoComplete(api, "K of Spades", "Empty free cell 1");
    // The win step's flight would land at 460; its backstop is 250 ms later.
    await advance(709);
    expect(resultShown(api)).toBe(false);
    await advance(1);
    expect(resultShown(api)).toBe(true);
    expect(playedAt(WIN, t)).toEqual([383]);
  });
});

describe("with Reduce Motion", () => {
  beforeEach(() => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
  });

  it("nothing flies and every cue plays at the instant", async () => {
    const api = await mountOn(runBoard());
    await act(async () => {});
    const t = await move(api, "8 of Spades", "9 of Hearts");
    expect(inFlight(api)).toEqual([]);
    expect(playedAt(MULTI, t)).toEqual([0]);
  });

  it("Auto-Complete keeps its pace, the riffle starting with the run, and the result shows at the win", async () => {
    const api = await mountOn(blockedKing());
    await act(async () => {});
    const t = await moveThenAutoComplete(api, "K of Spades", "Empty free cell 1");
    expect(playedAt(RIFFLE_START, t)).toEqual([0]);
    expect(playedAt(PLACE, t)).toEqual([0]);
    await advance(240);
    expect(inFlight(api)).toEqual([]);
    expect(playedAt(SETTLE, t)).toEqual([240]);
    expect(playedAt(WIN, t)).toEqual([240]);
    expect(resultShown(api)).toBe(true);
  });
});

describe("Large cards (#3347)", () => {
  const originalWindow = Dimensions.get("window");
  afterEach(() => {
    Dimensions.set({ window: originalWindow });
  });

  /** Mounts with Large cards on, on a 375 x 667 phone, the felt measured. */
  async function mountLarge(state: FreeCellState) {
    Dimensions.set({ window: { width: 375, height: 667, scale: 2, fontScale: 1 } });
    await AsyncStorage.setItem("freecell_large_cards", "1");
    const api = await mountOn(state);
    // As FreeCellScreen.feltTable.test: a 9-card column keeps Large cards, a 10th falls back.
    const felt = { width: 375 - 12, height: 667 - (64 + 20) - 28 - 12 - (60 + 8 + 16) };
    await act(async () => {
      fireEvent(api.getByTestId("freecell-felt"), "layout", {
        nativeEvent: { layout: { x: 0, y: 0, ...felt } },
      });
    });
    return { api, felt };
  }

  const KING_TO_ACE = [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((rank, i) =>
    c(i % 2 === 0 ? "spades" : "diamonds", rank)
  );

  it("a flight is planned on the Large board, inside its scroller", async () => {
    timeReanimatedEnds();
    const { api, felt } = await mountLarge(twoTargets());
    const g = freeCellGeometry({
      width: felt.width - 2,
      height: felt.height - 2,
      largeCardWidth: LARGE_CARD_WIDTH,
    });
    expect(g.cardWidth).toBe(LARGE_CARD_WIDTH);
    await move(api, "6 of Hearts", "7 of Spades");
    // The layer is the board view's last child, inside the horizontal scroller.
    const scroller = api.getByTestId("freecell-board-hscroll");
    expect(within(scroller).getByTestId("card-flight-layer", HIDDEN_TOO)).toBeTruthy();
    // It starts at its slot on the Large board: column 0, the tableau's first card.
    expect(startOf(api, "hearts-6")).toEqual({ x: 0, y: g.padding + g.topCardHeight + g.rowGap });
    expect(drawnWidth(api, flightID("hearts-6"))).toBe(LARGE_CARD_WIDTH);
    await advance(200);
    expect(flying(api, "hearts-6")).toBe(false);
  });

  it("a move that flips the Large fallback is not animated: it lands on the new board at once", async () => {
    // col0: K♠ down to 5♠ (9 cards, Large still fits); the 4♦ waits in a free cell. A tenth
    // card is past the threshold: the board falls back to the fitted cards.
    const { api } = await mountLarge(
      boardState([KING_TO_ACE.slice(0, 9), [c("hearts", 9)]], {
        freeCells: [KING_TO_ACE[9]!, null, null, null],
      })
    );
    const isLarge = () => drawnWidth(api, "freecell-col-1-top") === LARGE_CARD_WIDTH;
    expect(isLarge()).toBe(true);
    const t = await move(api, "4 of Diamonds", "5 of Spades");
    expect(isLarge()).toBe(false);
    expect(inFlight(api)).toEqual([]);
    expect(playedAt(PLACE, t)).toEqual([0]);
  });
});
