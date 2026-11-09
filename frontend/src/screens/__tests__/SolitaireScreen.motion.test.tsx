/**
 * #3572: Solitaire's card motion and the sounds timed to it ("A. Brisk"). Each sound is checked
 * against the motion's own clock: the flights land from their UI-thread end callbacks
 * (`timeReanimatedEnds` reports them after their duration on the fake clock) or, when that
 * callback is lost, from their backstops. A card in flight is drawn by the flight layer
 * (testID `solitaire-flight-<suit>-<rank>`, hidden from screen readers).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AccessibilityInfo } from "react-native";
import { act, fireEvent } from "@testing-library/react-native";

import { createSeededRng, setRng } from "../../game/solitaire/engine";
import type { Rank, SolitaireState, Suit } from "../../game/solitaire/types";
import { resetReduceMotionForTests } from "../../components/shared/useReduceMotion";
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
    addListener: jest.fn(() => jest.fn()),
  }))
);
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

const T0 = 1_700_000_000_000;
type Api = Awaited<ReturnType<typeof mountOn>>;

/** When the sounds whose name starts with `prefix` played, in ms after `since`. */
const playedAt = (prefix: string, since: number) =>
  mockLog.filter((e) => e.name.startsWith(prefix)).map((e) => e.at - since);

const PLACE = "solitaire.cardPlace";
const FLIP = "solitaire.cardFlip";

/** The flight layer and the win cascade are hidden from screen readers. */
const HIDDEN_TOO = { includeHiddenElements: true };

/** A flight's testID (not the layer's own). */
const IN_FLIGHT = /^solitaire-flight-[a-z]+-\d+$/;

const flying = (api: Api, key: string) =>
  api.queryByTestId(`solitaire-flight-${key}`, { includeHiddenElements: true }) !== null;

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
  await AsyncStorage.clear();
  setRng(createSeededRng(42));
  resetReduceMotionForTests();
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

  it("a new action re-targets a card in flight; cues already scheduled still play", async () => {
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
    expect(playedAt(PLACE, t)).toEqual([160, 260]);
    expect(api.getByLabelText("Moves: 2")).toBeTruthy();
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
