/**
 * #3572: Solitaire's card motion and the sounds timed to it ("A. Brisk"). Each sound is checked
 * against the motion's own clock: the flights land from their UI-thread end callbacks
 * (`timeReanimatedEnds` reports them after their duration on the fake clock) or, when that
 * callback is lost, from their backstops. A card in flight is drawn by the flight layer
 * (testID `card-flight-<suit>-<rank>`, hidden from screen readers).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AccessibilityInfo, Animated, StyleSheet } from "react-native";
import { act, fireEvent } from "@testing-library/react-native";

import { createSeededRng, setRng } from "../../game/solitaire/engine";
import type { Rank, SolitaireState, Suit } from "../../game/solitaire/types";
import { resetReduceMotionForTests } from "../../components/shared/useReduceMotion";
import { GHOST_LIFT } from "../../game/_shared/drag/dragGeometry";
import { createDropSink, legalTargets, resetDropSink } from "../../test-utils/mockScreenDeps";
import { timeReanimatedEnds } from "../../components/hearts/__tests__/helpers/animationFixtures";
import {
  boardState,
  faceDown,
  faceUp,
  landMotion,
  mountOn,
  pressLabel,
  tableauOf,
} from "./helpers/solitaireFixtures";

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
type Api = Awaited<ReturnType<typeof mountOn>>;

/** When the sounds whose name starts with `prefix` played, in ms after `since`. */
const playedAt = (prefix: string, since: number) =>
  mockLog.filter((e) => e.name.startsWith(prefix)).map((e) => e.at - since);

const PLACE = "solitaire.cardPlace";

/** The card sounds since `since`, as "place@160" (variations folded together). */
const cardSounds = (since: number) =>
  mockLog
    .map((e) => {
      const kind = /cardPlace/.test(e.name)
        ? "place"
        : /cardFlip/.test(e.name)
          ? "flip"
          : /cardFan/.test(e.name)
            ? "fan"
            : /multiCardMove/.test(e.name)
              ? "multi"
              : null;
      return kind === null ? null : `${kind}@${e.at - since}`;
    })
    .filter((x): x is string => x !== null);
const FLIP = "solitaire.cardFlip";

/** The flight layer and the win cascade are hidden from screen readers. */
const HIDDEN_TOO = { includeHiddenElements: true };

/** A flight's testID (not the layer's own). */
const IN_FLIGHT = /^card-flight-[a-z]+-\d+$/;

const flying = (api: Api, key: string) =>
  api.queryByTestId(`card-flight-${key}`, { includeHiddenElements: true }) !== null;

/** A flight's starting point: the Jest Reanimated mock draws a flight's first frame and stops. */
function startOf(api: Api, key: string): { x: number; y: number } {
  const view = api.getByTestId(`card-flight-${key}`, HIDDEN_TOO);
  const transform = (StyleSheet.flatten(view.props.style).transform ?? []) as Array<
    Record<string, number>
  >;
  const x = transform.find((t) => "translateX" in t)?.translateX ?? NaN;
  const y = transform.find((t) => "translateY" in t)?.translateY ?? NaN;
  return { x, y };
}

const opacityOf = (el: { props: { style?: unknown } }) =>
  StyleSheet.flatten(el.props.style as never)?.opacity;

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

/** One card left: the K♣ in the waste. */
const oneLeft = () =>
  boardState({
    foundations: {
      spades: sequence("spades", 13),
      hearts: sequence("hearts", 13),
      diamonds: sequence("diamonds", 13),
      clubs: sequence("clubs", 12),
    },
    waste: [faceUp("clubs", 13)],
  });

/** 6♥ (column 1) fits 7♠ (column 2) and 7♣ (column 3). */
const twoTargets = () =>
  boardState({
    tableau: tableauOf([faceUp("hearts", 6)], [faceUp("spades", 7)], [faceUp("clubs", 7)]),
  });

/** Selects `from` and plays it on `to`; returns the time of the move. */
async function move(api: Api, from: string, to: string): Promise<number> {
  await pressLabel(api, from);
  const at = Date.now();
  await pressLabel(api, to);
  return at;
}

async function newGameFromMenu(api: Api) {
  await act(async () => {
    await fireEvent.press(api.getByLabelText("More options"));
  });
  await act(async () => {
    await fireEvent.press(api.getByText("New Game"));
  });
  await act(async () => {
    await fireEvent.press(api.getByLabelText("Start New"));
  });
}

beforeEach(async () => {
  mockNavListeners.clear();
  await AsyncStorage.clear();
  setRng(createSeededRng(42));
  resetReduceMotionForTests();
  resetDropSink(mockDrops);
  reduceMotionListeners = [];
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

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("with the flights' end callbacks (timeReanimatedEnds)", () => {
  beforeEach(() => {
    timeReanimatedEnds();
  });

  it("a tapped card lands at 200 ms; card place plays 40 ms before the contact", async () => {
    const api = await mountOn(twoTargets());
    const t = await move(api, "6 of Hearts", "7 of Spades");
    expect(flying(api, "hearts-6")).toBe(true);
    await landMotion(199);
    expect(flying(api, "hearts-6")).toBe(true);
    await landMotion(1);
    expect(flying(api, "hearts-6")).toBe(false);
    expect(playedAt(PLACE, t)).toEqual([160]);
  });

  it("a run lands 15 ms apart; the multi-move peak (237 ms) lands on the last card's contact", async () => {
    const api = await mountOn(
      boardState({
        tableau: tableauOf(
          [faceUp("spades", 7), faceUp("hearts", 6), faceUp("clubs", 5)],
          [faceUp("hearts", 8)]
        ),
      })
    );
    const t = await move(api, "7 of Spades", "8 of Hearts");
    await landMotion(249);
    expect(flying(api, "clubs-5")).toBe(true);
    expect(flying(api, "spades-7")).toBe(false);
    await landMotion(1);
    expect(flying(api, "clubs-5")).toBe(false);
    // The last contact is at 220 + 2 x 15 = 250 ms.
    expect(playedAt("solitaire.multiCardMove", t)).toEqual([250 - 237]);
    expect(playedAt(PLACE, t)).toEqual([]);
  });

  it("the uncovered card turns after the landing; the flip peaks on its edge-on point", async () => {
    const api = await mountOn(
      boardState({
        tableau: tableauOf([faceDown("clubs", 9), faceUp("hearts", 6)], [faceUp("spades", 7)]),
      })
    );
    const t = await move(api, "6 of Hearts", "7 of Spades");
    await landMotion(339);
    expect(flying(api, "clubs-9")).toBe(true);
    await landMotion(1);
    expect(flying(api, "clubs-9")).toBe(false);
    expect(playedAt(PLACE, t)).toEqual([160]);
    // The turn runs 200 -> 340 ms; edge-on at 270, less the flip's 28 ms peak.
    expect(playedAt(FLIP, t)).toEqual([242]);
  });

  it("a Draw-1 card slides and turns; the flip peaks on its edge-on point", async () => {
    const api = await mountOn(boardState({ stock: [faceDown("clubs", 5), faceDown("clubs", 6)] }));
    const t = Date.now();
    await pressLabel(api, "Draw 1 from stock, 2 cards remaining");
    await landMotion(200);
    expect(flying(api, "clubs-6")).toBe(false);
    expect(playedAt(FLIP, t)).toEqual([100 - 28]);
  });

  it("Draw 3 fans the cards 36 ms apart; the fan leads the first card's edge-on point by 27 ms", async () => {
    const api = await mountOn(
      boardState({
        drawMode: 3,
        stock: [faceDown("clubs", 5), faceDown("clubs", 6), faceDown("clubs", 7)],
      })
    );
    const t = Date.now();
    await pressLabel(api, "Draw 3 from stock, 3 cards remaining");
    await landMotion(271);
    expect(flying(api, "clubs-5")).toBe(true);
    await landMotion(1);
    expect(flying(api, "clubs-5")).toBe(false);
    expect(playedAt("solitaire.cardFan", t)).toEqual([100 - 27]);
    expect(playedAt(FLIP, t)).toEqual([]);
  });

  it("the recycle slides the waste back in 220 ms, the riffle's settle peaking on contact", async () => {
    const api = await mountOn(boardState({ waste: [faceUp("clubs", 5), faceUp("clubs", 6)] }));
    const t = Date.now();
    await pressLabel(api, "Recycle waste back to stock (draw 1)");
    expect(flying(api, "clubs-6")).toBe(true);
    await landMotion(220);
    expect(flying(api, "clubs-6")).toBe(false);
    expect(playedAt("solitaire.autoCompleteSettle", t)).toEqual([220 - 77]);
  });

  it("Undo flies the card back, card place 40 ms before its landing", async () => {
    const api = await mountOn(twoTargets());
    await move(api, "6 of Hearts", "7 of Spades");
    await landMotion(1000);
    mockLog.length = 0;
    const t = Date.now();
    await pressLabel(api, "Undo");
    expect(flying(api, "hearts-6")).toBe(true);
    await landMotion(200);
    expect(flying(api, "hearts-6")).toBe(false);
    expect(playedAt(PLACE, t)).toEqual([160]);
  });

  it("Auto-Complete: the riffle holds to the last landing; the settle and the win follow it", async () => {
    const api = await mountOn(nearlyDone());
    const t = Date.now();
    await pressLabel(api, "Auto-Complete");
    expect(playedAt("start:solitaire.autoCompleteLoop", t)).toEqual([0]);
    // The second (last) step is at 120 ms; its flight lands at 120 + 220 = 340 ms.
    await landMotion(262);
    expect(playedAt("stop:solitaire.autoCompleteLoop", t)).toEqual([]);
    expect(api.queryByTestId("solitaire-win-cascade", HIDDEN_TOO)).toBeNull();
    await landMotion(1);
    // The settle's 77 ms peak lands on the last contact: it starts at 263 ms, with the win.
    expect(playedAt("stop:solitaire.autoCompleteLoop", t)).toEqual([263]);
    expect(playedAt("solitaire.autoCompleteSettle", t)).toEqual([263]);
    expect(playedAt("solitaire.gameWin", t)).toEqual([263]);
    // The win (its cascade, then the result card) waits for the last landing.
    await landMotion(76);
    expect(api.queryByTestId("solitaire-win-cascade", HIDDEN_TOO)).toBeNull();
    await landMotion(1);
    expect(api.getByTestId("solitaire-win-cascade", HIDDEN_TOO)).toBeTruthy();
    // The run's own cards stay quiet.
    expect(playedAt(PLACE, t)).toEqual([]);
  });

  it("a new action re-targets a card in flight; the move it called off goes quiet", async () => {
    const api = await mountOn(twoTargets());
    const t = await move(api, "6 of Hearts", "7 of Spades");
    await landMotion(100);
    // The 6♥ is in flight (its real view transparent but still there): play it on to 7♣.
    await pressLabel(api, "6 of Hearts");
    await pressLabel(api, "7 of Clubs");
    await landMotion(150);
    // Re-targeted at 100 ms: it does not land at 200, but at 300.
    expect(flying(api, "hearts-6")).toBe(true);
    await landMotion(50);
    expect(flying(api, "hearts-6")).toBe(false);
    // Only the re-target's card place (100 + 160): the first move's was called off with it.
    expect(playedAt(PLACE, t)).toEqual([260]);
    expect(api.getByLabelText("Moves: 2")).toBeTruthy();
  });

  it("a second, unrelated action mid-flight keeps the first action's cues", async () => {
    const api = await mountOn({
      ...twoTargets(),
      stock: [faceDown("clubs", 2)],
    } as SolitaireState);
    const t = await move(api, "6 of Hearts", "7 of Spades");
    await landMotion(100);
    await pressLabel(api, "Draw 1 from stock, 1 cards remaining");
    await landMotion(400);
    expect(playedAt(PLACE, t)).toEqual([160]);
    expect(playedAt(FLIP, t)).toEqual([100 + 72]);
  });

  it("Undo 90 ms into a reveal move: the uncovered card stays face down, no flip, one card place", async () => {
    const api = await mountOn(
      boardState({
        tableau: tableauOf([faceDown("clubs", 9), faceUp("hearts", 6)], [faceUp("spades", 7)]),
      })
    );
    const t = await move(api, "6 of Hearts", "7 of Spades");
    expect(flying(api, "clubs-9")).toBe(true);
    await landMotion(90);
    await pressLabel(api, "Undo");
    // The 9♣'s turn was called off before it began: no flight draws its face.
    expect(flying(api, "clubs-9")).toBe(false);
    for (let i = 0; i < 10; i++) {
      await landMotion(50);
      expect(flying(api, "clubs-9")).toBe(false);
    }
    expect(playedAt(FLIP, t)).toEqual([]);
    // Only the Undo's card place: 90 + 160 ms.
    expect(playedAt(PLACE, t)).toEqual([250]);
    expect(api.getByLabelText("Moves: 0")).toBeTruthy();
  });

  it("Undo during a run: only the Undo's card place, no flip", async () => {
    const api = await mountOn(
      boardState({
        tableau: tableauOf(
          [faceDown("spades", 2), faceUp("spades", 7), faceUp("hearts", 6)],
          [faceUp("hearts", 8)]
        ),
      })
    );
    const t = await move(api, "7 of Spades", "8 of Hearts");
    await landMotion(100);
    await pressLabel(api, "Undo");
    await landMotion(1000);
    expect(playedAt(FLIP, t)).toEqual([]);
    // The run's own sweep had already played at the move (its 237 ms peak is past a 235 ms
    // contact, so it starts at once); nothing of the run plays after the Undo.
    expect(playedAt("solitaire.multiCardMove", t)).toEqual([0]);
    // The Undo flies the run back: 220 + 15 ms, card place 40 ms before.
    expect(playedAt(PLACE, t)).toEqual([100 + 235 - 40]);
  });

  it("Auto-Complete: one sparkle, on the last landing, for every suit it completed", async () => {
    const sparkle = jest.spyOn(Animated, "timing");
    const flashes = () =>
      sparkle.mock.calls.filter(([, c]) => c.toValue === 1 && c.duration === 100).length;
    // The K♦ (completing diamonds, step 1) and the K♣ (completing clubs, step 2, landing at 340).
    const api = await mountOn(
      boardState({
        foundations: {
          spades: sequence("spades", 13),
          hearts: sequence("hearts", 13),
          diamonds: sequence("diamonds", 12),
          clubs: sequence("clubs", 12),
        },
        waste: [faceUp("clubs", 13), faceUp("diamonds", 13)],
      })
    );
    await pressLabel(api, "Auto-Complete");
    await landMotion(339);
    expect(flashes()).toBe(0);
    await landMotion(1);
    expect(flashes()).toBe(1);
    await landMotion(1000);
    expect(flashes()).toBe(1);
  });

  it("a king moved by hand sparkles on its own landing", async () => {
    const sparkle = jest.spyOn(Animated, "timing");
    const flashes = () =>
      sparkle.mock.calls.filter(([, c]) => c.toValue === 1 && c.duration === 100).length;
    const api = await mountOn(
      boardState({
        foundations: {
          spades: sequence("spades", 13),
          hearts: sequence("hearts", 13),
          diamonds: sequence("diamonds", 12),
          clubs: sequence("clubs", 11),
        },
        waste: [faceUp("clubs", 13), faceUp("clubs", 12)],
        tableau: tableauOf([faceUp("diamonds", 13)]),
      })
    );
    await move(api, "K of Diamonds", "Q of Diamonds");
    await landMotion(199);
    expect(flashes()).toBe(0);
    await landMotion(1);
    expect(flashes()).toBe(1);
  });

  it("the board stays still while the result card waits for the winning landing", async () => {
    const api = await mountOn(oneLeft());
    await move(api, "K of Clubs", "Q of Clubs");
    await landMotion(50);
    // Undo is off, and pressing it does nothing.
    await pressLabel(api, "Undo");
    // A foundation card can't come back to the tableau.
    await pressLabel(api, "K of Clubs");
    await pressLabel(api, "Empty tableau column 1");
    expect(api.getByLabelText("Moves: 1")).toBeTruthy();
    expect(flying(api, "clubs-13")).toBe(true);
    await landMotion(150);
    expect(api.getByTestId("solitaire-win-cascade", HIDDEN_TOO)).toBeTruthy();
  });

  it("a drop's flight starts where the ghost was let go, GHOST_LIFT above the finger's card", async () => {
    // A tap's flight starts at the card's slot; the drop's at the slot plus the ghost's offset.
    const tapApi = await mountOn(twoTargets());
    await move(tapApi, "6 of Hearts", "7 of Spades");
    const slot = startOf(tapApi, "hearts-6");
    await act(async () => {
      await tapApi.unmount();
    });
    mockDrops.zones.clear();
    const api = await mountOn(twoTargets());
    let accepted = false;
    await act(async () => {
      accepted = mockDrops.zones.get("solitaire-tableau-1")!(
        { game: "solitaire", type: "tableau", col: 0, fromIndex: 0 },
        [{ suit: "hearts", rank: 6, width: 52, height: 74 }],
        { dx: 40, dy: 120 }
      );
    });
    expect(accepted).toBe(true);
    expect(startOf(api, "hearts-6")).toEqual({ x: slot.x + 40, y: slot.y + 120 - GHOST_LIFT });
  });

  it("the stock keeps its back and count while an Undo flies a drawn card back onto it", async () => {
    const api = await mountOn(
      boardState({ stock: [faceDown("clubs", 5), faceDown("clubs", 6), faceDown("clubs", 7)] })
    );
    await pressLabel(api, "Draw 1 from stock, 3 cards remaining");
    await landMotion(1000);
    await pressLabel(api, "Undo");
    expect(flying(api, "clubs-7")).toBe(true);
    expect(opacityOf(api.getByTestId("solitaire-stock-back", HIDDEN_TOO))).not.toBe(0);
    expect(api.getByText("3")).toBeVisible();
  });

  it("the stock's back waits for the card only when it is the stock's only card", async () => {
    const api = await mountOn(boardState({ stock: [faceDown("clubs", 7)] }));
    await pressLabel(api, "Draw 1 from stock, 1 cards remaining");
    await landMotion(1000);
    await pressLabel(api, "Undo");
    expect(opacityOf(api.getByTestId("solitaire-stock-back", HIDDEN_TOO))).toBe(0);
    expect(api.getByText("1")).toBeVisible();
    await landMotion(200);
    expect(opacityOf(api.getByTestId("solitaire-stock-back", HIDDEN_TOO))).not.toBe(0);
  });

  it("leaving the game mid-flight lands every card and drops the cues", async () => {
    const api = await mountOn(twoTargets());
    await move(api, "6 of Hearts", "7 of Spades");
    await landMotion(50);
    await act(async () => {
      mockNavListeners.get("blur")?.forEach((h) => h());
    });
    expect(flying(api, "hearts-6")).toBe(false);
    await landMotion(1000);
    expect(playedAt(PLACE, 0)).toEqual([]);
  });

  it("leaving during Auto-Complete's last landing: the riffle stops without its settle or the win sound", async () => {
    const api = await mountOn(nearlyDone());
    const t = Date.now();
    await pressLabel(api, "Auto-Complete");
    await landMotion(200);
    await act(async () => {
      mockNavListeners.get("blur")?.forEach((h) => h());
    });
    await landMotion(1000);
    expect(playedAt("stop:solitaire.autoCompleteLoop", t)).toHaveLength(1);
    expect(playedAt("solitaire.autoCompleteSettle", t)).toEqual([]);
    expect(playedAt("solitaire.gameWin", t)).toEqual([]);
  });

  it("Reduce Motion turned on mid-flight lands the card at once", async () => {
    const api = await mountOn(twoTargets());
    await move(api, "6 of Hearts", "7 of Spades");
    await landMotion(50);
    expect(flying(api, "hearts-6")).toBe(true);
    await act(async () => {
      reduceMotionListeners.forEach((h) => h(true));
    });
    expect(flying(api, "hearts-6")).toBe(false);
  });

  it("Undo while the uncovered card turns: it lands face down at once, with no flip", async () => {
    const api = await mountOn(
      boardState({
        tableau: tableauOf([faceDown("clubs", 9), faceUp("hearts", 6)], [faceUp("spades", 7)]),
      })
    );
    const t = await move(api, "6 of Hearts", "7 of Spades");
    // The 6♥ landed at 200; the 9♣ turns 200 -> 340 (edge-on at 270).
    await landMotion(230);
    await pressLabel(api, "Undo");
    expect(flying(api, "clubs-9")).toBe(false);
    for (let i = 0; i < 8; i++) {
      await landMotion(50);
      expect(flying(api, "clubs-9")).toBe(false);
    }
    expect(playedAt(FLIP, t)).toEqual([]);
    expect(playedAt(PLACE, t)).toEqual([160, 230 + 160]);
  });

  it("a re-targeted move's reveal still flips, on its new edge-on point", async () => {
    const api = await mountOn(
      boardState({
        tableau: tableauOf(
          [faceDown("clubs", 9), faceUp("hearts", 6)],
          [faceUp("spades", 7)],
          [faceUp("clubs", 7)]
        ),
      })
    );
    const t = await move(api, "6 of Hearts", "7 of Spades");
    await landMotion(100);
    await pressLabel(api, "6 of Hearts");
    await pressLabel(api, "7 of Clubs");
    await landMotion(1000);
    // Re-targeted at 100: contact at 300, the turn's edge-on at 370, less the 28 ms peak.
    expect(playedAt(FLIP, t)).toEqual([100 + 200 + 70 - 28]);
  });

  it("a Draw-1 card sent on before its edge-on point still flips", async () => {
    const api = await mountOn(
      boardState({
        foundations: {
          spades: sequence("spades", 3),
          hearts: [],
          diamonds: [],
          clubs: sequence("clubs", 1),
        },
        stock: [faceDown("hearts", 9), faceDown("clubs", 2)],
      })
    );
    const t = Date.now();
    await pressLabel(api, "Draw 1 from stock, 2 cards remaining");
    await landMotion(50);
    // A double-tap of the waste sends the 2♣ (still showing its back) to its foundation.
    await pressLabel(api, "2 of Clubs");
    await pressLabel(api, "2 of Clubs");
    expect(api.getByLabelText("Moves: 2")).toBeTruthy();
    await landMotion(1000);
    // Its turn now runs over the new 200 ms flight: edge-on at 50 + 100, less 28.
    expect(playedAt(FLIP, t)).toEqual([50 + 100 - 28]);
  });

  it("re-targeting one card of an Undo's run keeps the other's card place", async () => {
    const api = await mountOn(
      boardState({
        tableau: tableauOf(
          [faceUp("spades", 7), faceUp("hearts", 6)],
          [faceUp("hearts", 8)],
          [faceUp("clubs", 7)]
        ),
      })
    );
    await move(api, "7 of Spades", "8 of Hearts");
    await landMotion(1000);
    mockLog.length = 0;
    const u = Date.now();
    await pressLabel(api, "Undo");
    await landMotion(100);
    // The Undo flies the 7♠ (lands at 220) and the 6♥ back; the 6♥ goes on to the 7♣.
    await pressLabel(api, "6 of Hearts");
    await pressLabel(api, "7 of Clubs");
    await landMotion(1000);
    expect(playedAt(PLACE, u)).toEqual([220 - 40, 100 + 200 - 40]);
  });

  it("during the win hold the board is still: no selection, no lift, no sound, no drag", async () => {
    const api = await mountOn(oneLeft());
    await move(api, "K of Clubs", "Q of Clubs");
    mockLog.length = 0;
    await landMotion(50);
    // A tap and a double-tap on the foundation's top card.
    await pressLabel(api, "K of Clubs");
    await pressLabel(api, "K of Clubs");
    expect(api.queryByText(/\(selected\)/)).toBeNull();
    // A drag from it lights nothing.
    expect(
      await legalTargets(mockDrops, { game: "solitaire", type: "foundation", suit: "clubs" })
    ).toEqual([]);
    expect(mockLog.filter((e) => e.name === "solitaire.invalidMove")).toEqual([]);
    expect(api.getByLabelText("Moves: 1")).toBeTruthy();
  });

  // Review round 3: a called-off action's sounds are never played twice, nor added.
  const runBoard = () =>
    boardState({
      tableau: tableauOf(
        [faceUp("spades", 7), faceUp("hearts", 6)],
        [faceUp("hearts", 8)],
        [faceUp("clubs", 7)]
      ),
    });

  it("an Undo's card place already played is not played again when a card is re-targeted", async () => {
    const api = await mountOn(runBoard());
    await move(api, "7 of Spades", "8 of Hearts");
    await landMotion(1000);
    mockLog.length = 0;
    const u = Date.now();
    await pressLabel(api, "Undo");
    // The Undo's place plays at 195 (its last contact, 235, less 40); the 6♥ is re-targeted at 200.
    await landMotion(200);
    await pressLabel(api, "6 of Hearts");
    await pressLabel(api, "7 of Clubs");
    await landMotion(1000);
    expect(cardSounds(u)).toEqual(["place@195", "place@360"]);
  });

  it("a chain of call-offs on an Undo's run: one landing sound per action", async () => {
    const api = await mountOn(
      boardState({
        tableau: tableauOf(
          [faceUp("spades", 7), faceUp("hearts", 6), faceUp("spades", 5)],
          [faceUp("hearts", 8)],
          [faceUp("clubs", 7)],
          [faceUp("diamonds", 6)]
        ),
      })
    );
    await move(api, "7 of Spades", "8 of Hearts");
    await landMotion(1000);
    mockLog.length = 0;
    const u = Date.now();
    await pressLabel(api, "Undo");
    await landMotion(60);
    // The 5♠ goes on to the 6♦: the Undo's place, still pending, moves to its other cards'
    // last contact (the 6♥ at 235): 195.
    await pressLabel(api, "5 of Spades");
    await pressLabel(api, "6 of Diamonds");
    await landMotion(150);
    // The 6♥ goes on to the 7♣ at 210, after the Undo's place has played: nothing is added.
    await pressLabel(api, "6 of Hearts");
    await pressLabel(api, "7 of Clubs");
    await landMotion(1000);
    expect(cardSounds(u)).toEqual(["place@195", "place@220", "place@370"]);
  });

  it("a tapped run re-targeted gets no card place after its multi-card move", async () => {
    const api = await mountOn(runBoard());
    const t = await move(api, "7 of Spades", "8 of Hearts");
    await landMotion(100);
    await pressLabel(api, "6 of Hearts");
    await pressLabel(api, "7 of Clubs");
    await landMotion(1000);
    expect(cardSounds(t)).toEqual(["multi@0", "place@260"]);
  });

  it("a Draw-1 card sent on after its flip played gets no second flip", async () => {
    const api = await mountOn(
      boardState({
        foundations: { spades: [], hearts: [], diamonds: [], clubs: sequence("clubs", 1) },
        stock: [faceDown("hearts", 9), faceDown("clubs", 2)],
      })
    );
    const t = Date.now();
    await pressLabel(api, "Draw 1 from stock, 2 cards remaining");
    // The flip played at 72 (its peak leads the edge-on point, 100); a double-tap at 80.
    await landMotion(80);
    await pressLabel(api, "2 of Clubs");
    await pressLabel(api, "2 of Clubs");
    await landMotion(1000);
    expect(cardSounds(t)).toEqual(["flip@72", "place@240"]);
  });

  it("Draw 3 with its top card played on mid-draw: no card place for the draw, no second flip, and the sliding cards slide on", async () => {
    const api = await mountOn(
      boardState({
        drawMode: 3,
        foundations: { spades: [], hearts: [], diamonds: [], clubs: sequence("clubs", 4) },
        stock: [faceDown("clubs", 5), faceDown("hearts", 6), faceDown("hearts", 7)],
      })
    );
    const t = Date.now();
    await pressLabel(api, "Draw 3 from stock, 3 cards remaining");
    await landMotion(120);
    // The 6♥ (36 ms behind the first card) is part way from the stock to its fan slot.
    await pressLabel(api, "5 of Clubs");
    await pressLabel(api, "5 of Clubs");
    expect(api.getByLabelText("Moves: 2")).toBeTruthy();
    // It slides on from where it was shown (84 ms into its 200 ms flight from the stock, at
    // x 0, to its fan slot, x 132 at this test's card size): out-cubic 0.42, x ≈ 106. Before the
    // fix it restarted at its slot (132) as a turn in place.
    const from = startOf(api, "hearts-6");
    expect(from.x).toBeCloseTo(132 * (1 - (1 - 84 / 200) ** 3), 1);
    expect(from.y).toBe(0);
    await landMotion(1000);
    expect(cardSounds(t)).toEqual(["fan@73", "place@280"]);
    expect(api.queryAllByTestId(IN_FLIGHT, HIDDEN_TOO)).toEqual([]);
  });

  it("a restored game draws nothing in flight and replays no sound", async () => {
    const api = await mountOn({
      ...twoTargets(),
      events: ["cardPlace", "cardFlip"],
    } as SolitaireState);
    expect(api.queryAllByTestId(IN_FLIGHT, { includeHiddenElements: true })).toEqual([]);
    await landMotion(1000);
    expect(mockLog).toEqual([]);
  });

  it("New Game mid-flight lands every card and cancels the cues", async () => {
    const api = await mountOn(twoTargets());
    await move(api, "6 of Hearts", "7 of Spades");
    await landMotion(50);
    await newGameFromMenu(api);
    expect(flying(api, "hearts-6")).toBe(false);
    await landMotion(1000);
    expect(playedAt(PLACE, 0)).toEqual([]);
  });

  it("unmounting mid-flight cancels the cues", async () => {
    const api = await mountOn(
      boardState({
        tableau: tableauOf([faceDown("clubs", 9), faceUp("hearts", 6)], [faceUp("spades", 7)]),
      })
    );
    await move(api, "6 of Hearts", "7 of Spades");
    await landMotion(50);
    await act(async () => {
      await api.unmount();
    });
    await landMotion(1000);
    expect(mockLog).toEqual([]);
  });
});

describe("when a flight's end callback is lost (the default Reanimated mock drops it)", () => {
  it("the backstop lands the card 250 ms after its flight", async () => {
    const api = await mountOn(twoTargets());
    const t = await move(api, "6 of Hearts", "7 of Spades");
    await landMotion(449);
    expect(flying(api, "hearts-6")).toBe(true);
    await landMotion(1);
    expect(flying(api, "hearts-6")).toBe(false);
    // The cue is timed to the motion, not to the callback.
    expect(playedAt(PLACE, t)).toEqual([160]);
  });

  it("the backstop starts the win (its cascade, then the result card) for a winning move", async () => {
    const api = await mountOn(oneLeft());
    await move(api, "K of Clubs", "Q of Clubs");
    await landMotion(449);
    expect(api.queryByTestId("solitaire-win-cascade", HIDDEN_TOO)).toBeNull();
    await landMotion(1);
    expect(api.getByTestId("solitaire-win-cascade", HIDDEN_TOO)).toBeTruthy();
    expect(mockLog.filter((e) => e.name === "solitaire.gameWin")).toHaveLength(1);
  });
});

describe("with Reduce Motion", () => {
  beforeEach(() => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
  });

  it("nothing flies and every cue plays at the instant", async () => {
    const api = await mountOn(
      boardState({
        tableau: tableauOf([faceDown("clubs", 9), faceUp("hearts", 6)], [faceUp("spades", 7)]),
      })
    );
    await act(async () => {});
    const t = await move(api, "6 of Hearts", "7 of Spades");
    expect(api.queryAllByTestId(IN_FLIGHT, { includeHiddenElements: true })).toEqual([]);
    expect(playedAt(PLACE, t)).toEqual([0]);
    expect(playedAt(FLIP, t)).toEqual([0]);
  });

  it("a winning move shows the result card at once", async () => {
    const api = await mountOn(oneLeft());
    await act(async () => {});
    await move(api, "K of Clubs", "Q of Clubs");
    expect(api.getByTestId("solitaire-result")).toBeTruthy();
  });
});
