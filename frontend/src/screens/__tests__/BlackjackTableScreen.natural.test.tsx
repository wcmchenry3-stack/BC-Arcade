/**
 * #3621: the natural-blackjack moment on the screen (owner decisions, #3739: direction B, "glint +
 * sweep"; the sting S0, `result-blackjack.ogg`). On the fake clock, from the deal's tap: the
 * player's second card lands at 600 ms, and with it the sting, the gold edge, the lift, the sheen
 * and the sweep; the result shows at the flip's end (1100 ms). The sting is the round's chime: it
 * plays exactly once, a tap before it included. A tap lands the moment to the static edge, which
 * stays until the next deal; input is never locked (no overlay). Reduce Motion shows the static
 * edge, the banner and the chips at once with the sting once; nothing replays on restore; away,
 * New Game and unmount play nothing more. The dealer's natural gets a static silver edge as it
 * turns right after the deal (the peek ends the hand, #3741), with the normal loss; natural against
 * natural the gold edge only, then the push.
 */
import React from "react";
import { AccessibilityInfo, StyleSheet } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

import i18n from "i18next";
import BlackjackTableScreen, { feltResultFor } from "../BlackjackTableScreen";
import { BlackjackGameProvider } from "../../game/blackjack/BlackjackGameContext";
import { ThemeProvider } from "../../theme/ThemeContext";
import { loadGame } from "../../game/blackjack/storage";
import {
  createSeededRng,
  hit,
  newGame,
  placeBet,
  setRng,
  stand,
  toViewState,
} from "../../game/blackjack/engine";
import { savedAgainstNatural } from "../../game/blackjack/__tests__/helpers/engineFixtures";
import type { Card, EngineState } from "../../game/blackjack/engine";
import { resetReduceMotionForTests } from "../../components/shared/useReduceMotion";
import { NATURAL_CHIP_SCALE } from "../../components/blackjack/blackjackMotion";
import { REDUCE_MOTION_SOUND_GAP_MS } from "../../components/blackjack/useBlackjackMotion";
import { BLACKJACK_NATURAL_GOLD } from "../../theme/theme.constants";

jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(() => ({ navigate: jest.fn() }), { actual: true })
);
jest.mock("../../game/blackjack/storage", () => ({
  saveGame: jest.fn(),
  clearGame: jest.fn(),
  loadGame: jest.fn().mockResolvedValue(null),
  saveRun: jest.fn().mockResolvedValue(undefined),
  loadRuns: jest.fn().mockResolvedValue([]),
}));
jest.mock("../../game/_shared/gameEventClient", () => mockScreenDeps().mockGameEventClient());

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

const T0 = 1_700_000_000_000;
const HIDDEN = { includeHiddenElements: true };

const card = (rank: string, suit = "♠"): Card => ({ rank, suit });
/** A deck dealt in this order (the engine deals from the end), then 2♣s. */
const deck = (...order: Card[]): Card[] => [
  ...Array.from({ length: 80 }, () => card("2", "♣")),
  ...[...order].reverse(),
];
const BEGINNER = { startingChips: 100, runGoal: 250, betMin: 5, betMax: 25 };

// Each round's cards in the order they are dealt: player, dealer hole, player, dealer up.
/** A natural: A K against 16. */
const NATURAL = [card("A"), card("7", "♣"), card("K", "♥"), card("9", "♥")];
/** A natural against the dealer's natural: a push. */
const BOTH = [card("A"), card("A", "♣"), card("K", "♥"), card("K", "♦")];
/** 18 against the dealer's K (hole) and A (up): the dealer peeks and its natural wins at the deal. */
const DEALER = [card("10"), card("K", "♣"), card("8", "♥"), card("A", "♦")];
/** 15 against 16, who draws a 2 (a plain loss): the next round after a natural. */
const LOSE = [card("10"), card("7", "♣"), card("5", "♥"), card("9", "♥")];
/** Aces to split, each dealt its card: A K (21, paid 1:1) and A 5. */
const SPLIT_ACES = [
  card("A"),
  card("7", "♣"),
  card("A", "♥"),
  card("9", "♦"),
  card("K", "♦"),
  card("5", "♣"),
];

const listeners = new Map<string, Array<() => void>>();
function nav() {
  return {
    navigate: jest.fn(),
    goBack: jest.fn(),
    replace: jest.fn(),
    popToTop: jest.fn(),
    isFocused: () => true,
    addListener: (event: string, handler: () => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
      return () =>
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter((h) => h !== handler)
        );
    },
  } as unknown as Parameters<typeof BlackjackTableScreen>[0]["navigation"];
}
const fire = (event: string) =>
  act(async () => {
    (listeners.get(event) ?? []).forEach((h) => h());
  });

async function mountOn(state: EngineState) {
  (loadGame as jest.Mock).mockResolvedValue(state);
  const view = await render(
    <ThemeProvider>
      <BlackjackGameProvider>
        <BlackjackTableScreen navigation={nav()} />
      </BlackjackGameProvider>
    </ThemeProvider>
  );
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

const betting = (order: Card[]) => newGame(deck(...order), BEGINNER);

const press = (label: string | RegExp) =>
  act(async () => {
    await fireEvent.press(screen.getByLabelText(label));
  });
const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });
const settle = () => advance(5000);
const tapFelt = () =>
  act(async () => {
    await fireEvent.press(screen.getByTestId("blackjack-table-area"));
  });

/** Puts 10 on the circle and deals. Returns the deal's time. */
async function dealTen(): Promise<number> {
  await press("Add 10 to bet");
  const at = Date.now();
  await press(/deal cards with 10-chip bet/i);
  return at;
}

const named = (since: number, name: string) =>
  mockLog
    .filter((e) => e.at >= since && e.name.replace(/[23]$/, "") === name)
    .map((e) => e.at - since);
const stings = () => mockLog.filter((e) => e.name === "blackjack.blackjack").length;
const shows = (testID: string) => screen.queryByTestId(testID, HIDDEN) !== null;
const resultShown = () => screen.queryByTestId("blackjack-felt-result") !== null;
const styleOf = (testID: string) =>
  StyleSheet.flatten(screen.getByTestId(testID, HIDDEN).props.style) as {
    opacity?: number;
    transform?: Record<string, number>[];
    borderColor?: string;
    borderWidth?: number;
  };
/** How far a card is lifted (px). */
const liftOf = (testID: string) => {
  const t = styleOf(testID).transform ?? [];
  return Math.abs(t.find((x) => "translateY" in x)?.translateY ?? 0);
};

/** The gold edge on the player's two cards. */
const goldEdge = () => shows("hand-0-card-0-natural-gold") && shows("hand-0-card-1-natural-gold");
/** The silver edge on the dealer's two cards. */
const silverEdge = () =>
  shows("dealer-card-0-natural-silver") && shows("dealer-card-1-natural-silver");
/** Any of the moment's motion: a sheen across a card, or the sweep. */
const moving = () =>
  shows("hand-0-card-0-natural-sheen") ||
  shows("hand-0-card-1-natural-sheen") ||
  shows("natural-sweep");
const anyEdge = () => screen.queryAllByTestId(/-natural-(gold|silver)$/, HIDDEN).length > 0;

let reduceMotionListeners: Array<(enabled: boolean) => void> = [];
const setReduceMotion = (on: boolean) =>
  act(async () => {
    reduceMotionListeners.forEach((l) => l(on));
  });

beforeEach(() => {
  setRng(createSeededRng(3621));
  jest.clearAllMocks();
  listeners.clear();
  resetReduceMotionForTests();
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

afterEach(() => {
  setRng(Math.random);
  jest.useRealTimers();
  jest.restoreAllMocks();
  (loadGame as jest.Mock).mockResolvedValue(null);
});

describe("the player's natural", () => {
  it("lands with the second card: the sting, the gold edge, the lift, the sheen and the sweep", async () => {
    await mountOn(betting(NATURAL));
    const at = await dealTen();
    await advance(599);
    expect(anyEdge()).toBe(false);
    expect(moving()).toBe(false);
    expect(named(at, "blackjack.blackjack")).toEqual([]);
    await advance(1);
    expect(named(at, "blackjack.blackjack")).toEqual([600]);
    expect(goldEdge()).toBe(true);
    expect(shows("hand-0-card-0-natural-sheen")).toBe(true);
    expect(shows("hand-0-card-1-natural-sheen")).toBe(true);
    expect(shows("natural-sweep")).toBe(true);
    // Only the two cards: the dealer's are not marked.
    expect(silverEdge()).toBe(false);
    expect(screen.queryByTestId("dealer-card-0-natural-gold", HIDDEN)).toBeNull();
    // Decoration only: nothing of it takes a touch.
    for (const id of [
      "hand-0-card-0-natural-gold",
      "hand-0-card-0-natural-sheen",
      "natural-sweep",
    ]) {
      let node = screen.getByTestId(id, HIDDEN);
      while (node.props.pointerEvents !== "none" && node.parent) node = node.parent;
      expect(node.props.pointerEvents).toBe("none");
    }
  });

  it("its first frame pops nothing: the edge fades in from 0, the cards start at rest", async () => {
    await mountOn(betting(NATURAL));
    await dealTen();
    await advance(600);
    expect(styleOf("hand-0-card-0-natural-gold").opacity).toBe(0);
    expect(styleOf("hand-0-card-0-natural-sheen").opacity).toBe(0);
    expect(styleOf("natural-sweep-band").opacity).toBe(0);
    expect(liftOf("hand-0-card-0")).toBe(0);
    expect(liftOf("hand-0-card-1")).toBe(0);
  });

  it('the result shows at the flip\'s end, "Blackjack! 3:2", with no second chime; the 3:2 chip is larger, gold-rimmed', async () => {
    await mountOn(betting(NATURAL));
    const at = await dealTen();
    await advance(1099);
    expect(resultShown()).toBe(false);
    await advance(1);
    expect(resultShown()).toBe(true);
    expect(screen.getByTestId("result-outcome").props.children).toBe("Blackjack! 3:2");
    await advance(420);
    const chip = styleOf("felt-chip-payout");
    expect(chip.borderColor).toBe(BLACKJACK_NATURAL_GOLD);
    expect(chip.borderWidth).toBe(2);
    expect(chip.transform).toContainEqual({ scale: NATURAL_CHIP_SCALE });
    await settle();
    expect(stings()).toBe(1);
    expect(named(at, "blackjack.chipPayout")).toEqual([1520]);
    expect(named(at, "blackjack.win")).toEqual([]);
  });

  it("its moment ends; the gold edge stays, static, until the next deal", async () => {
    await mountOn(betting([...NATURAL, ...LOSE]));
    await dealTen();
    await settle();
    expect(moving()).toBe(false);
    expect(goldEdge()).toBe(true);
    expect(styleOf("hand-0-card-0-natural-gold").opacity ?? 1).toBe(1);
    expect(liftOf("hand-0-card-0")).toBe(0);
    await advance(60_000);
    expect(goldEdge()).toBe(true);
    await press(/^Rebet — deal again with 10 chips/);
    expect(anyEdge()).toBe(false);
    await settle();
    expect(anyEdge()).toBe(false);
  });
});

describe("a tap completes the moment", () => {
  it("before the sting: the sting plays once, at the tap, and the static edge shows", async () => {
    await mountOn(betting(NATURAL));
    const at = await dealTen();
    await advance(300);
    await tapFelt();
    expect(named(at, "blackjack.blackjack")).toEqual([300]);
    expect(goldEdge()).toBe(true);
    expect(moving()).toBe(false);
    expect(resultShown()).toBe(true);
    await settle();
    expect(stings()).toBe(1);
    expect(moving()).toBe(false);
  });

  it("mid-moment: it lands, static; the sting is not played again", async () => {
    await mountOn(betting(NATURAL));
    const at = await dealTen();
    await advance(700);
    expect(moving()).toBe(true);
    await tapFelt();
    expect(moving()).toBe(false);
    expect(goldEdge()).toBe(true);
    expect(styleOf("hand-0-card-0-natural-gold").opacity ?? 1).toBe(1);
    expect(liftOf("hand-0-card-0")).toBe(0);
    await settle();
    expect(named(at, "blackjack.blackjack")).toEqual([600]);
  });

  it("input stays live: a Rebet during the moment deals at once (no overlay to dismiss)", async () => {
    await mountOn(betting([...NATURAL, ...LOSE]));
    await dealTen();
    await advance(1200);
    // The banner is up; the moment (its lift, to 1520 ms) is still playing.
    expect(resultShown()).toBe(true);
    expect(moving()).toBe(true);
    expect(screen.queryByTestId(/^animation-overlay/, HIDDEN)).toBeNull();
    const at = Date.now();
    await press(/^Rebet — deal again with 10 chips/);
    expect(named(at, "blackjack.cardDeal")).toEqual([0]);
    expect(anyEdge()).toBe(false);
    await settle();
    expect(stings()).toBe(1);
  });
});

describe("Reduce Motion", () => {
  it("shows the static edge, the banner and the chips at once; the sting once", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    await mountOn(betting(NATURAL));
    const at = await dealTen();
    expect(goldEdge()).toBe(true);
    expect(moving()).toBe(false);
    expect(liftOf("hand-0-card-0")).toBe(0);
    expect(resultShown()).toBe(true);
    expect(screen.getByTestId("result-outcome").props.children).toBe("Blackjack! 3:2");
    expect(screen.queryByTestId(/^felt-chip-/, HIDDEN)).toBeNull();
    // The sting follows the deal's sound by 100 ms (#3751).
    expect(named(at, "blackjack.blackjack")).toEqual([]);
    await advance(100);
    expect(named(at, "blackjack.blackjack")).toEqual([100]);
    await settle();
    expect(stings()).toBe(1);
    expect(moving()).toBe(false);
  });

  it("turned on mid-moment lands it to the static edge; nothing is left moving or plays again", async () => {
    await mountOn(betting(NATURAL));
    const at = await dealTen();
    await advance(700);
    expect(moving()).toBe(true);
    await setReduceMotion(true);
    expect(moving()).toBe(false);
    expect(goldEdge()).toBe(true);
    expect(liftOf("hand-0-card-0")).toBe(0);
    expect(resultShown()).toBe(true);
    await settle();
    expect(named(at, "blackjack.blackjack")).toEqual([600]);
    expect(named(at, "blackjack.cardFlip")).toEqual([]);
    expect(moving()).toBe(false);
  });

  it("turned on before the sting: the sting plays once, at once", async () => {
    await mountOn(betting(NATURAL));
    const at = await dealTen();
    await advance(400);
    await setReduceMotion(true);
    expect(goldEdge()).toBe(true);
    expect(moving()).toBe(false);
    await settle();
    expect(named(at, "blackjack.blackjack")).toEqual([400]);
  });
});

describe("nothing replays", () => {
  it("a restored natural shows only the static edge: no motion, no sound", async () => {
    const settled = placeBet(betting(NATURAL), 10);
    expect(settled.outcome).toBe("blackjack");
    await mountOn({ ...settled, events: [{ type: "blackjack" }] });
    expect(goldEdge()).toBe(true);
    expect(moving()).toBe(false);
    expect(liftOf("hand-0-card-0")).toBe(0);
    expect(screen.getByTestId("result-outcome").props.children).toBe("Blackjack! 3:2");
    await settle();
    expect(mockLog).toEqual([]);
    expect(moving()).toBe(false);
  });

  it("leaving mid-deal lands the moment silently; coming back replays nothing", async () => {
    await mountOn(betting(NATURAL));
    await dealTen();
    await advance(300);
    await fire("blur");
    expect(goldEdge()).toBe(true);
    expect(moving()).toBe(false);
    await settle();
    await fire("focus");
    await settle();
    expect(stings()).toBe(0);
    expect(moving()).toBe(false);
  });

  it("leaving mid-moment: it lands, static, and nothing more plays", async () => {
    await mountOn(betting(NATURAL));
    const at = await dealTen();
    await advance(700);
    await fire("blur");
    expect(moving()).toBe(false);
    expect(goldEdge()).toBe(true);
    await settle();
    expect(named(at, "blackjack.blackjack")).toEqual([600]);
    expect(named(at, "blackjack.cardFlip")).toEqual([]);
  });

  it("New Game before the sting: it never plays, and no edge is left", async () => {
    await mountOn(betting(NATURAL));
    await dealTen();
    await advance(300);
    await press("More options");
    await act(async () => {
      await fireEvent.press(screen.getByText("New Game"));
    });
    await press("Start New");
    await settle();
    expect(stings()).toBe(0);
    expect(moving()).toBe(false);
  });

  it("unmounting before the sting: it never plays", async () => {
    const view = await mountOn(betting(NATURAL));
    await dealTen();
    await advance(300);
    await act(async () => view.unmount());
    await settle();
    expect(stings()).toBe(0);
  });
});

describe("the dealer's natural, found by the peek (#3741)", () => {
  const disabled = (label: RegExp) =>
    screen.getByLabelText(label).props.accessibilityState?.disabled === true;

  it("the hole card turns right after the deal, a static silver edge as it ends, then the loss", async () => {
    await mountOn(betting(DEALER));
    const at = await dealTen();
    // The up card lands at 780 ms; the hole card turns then, with no player turn.
    await advance(779);
    expect(named(at, "blackjack.cardFlip")).toEqual([]);
    await advance(1);
    expect(named(at, "blackjack.cardFlip")).toEqual([780]);
    await advance(319);
    expect(silverEdge()).toBe(false);
    await advance(1);
    expect(silverEdge()).toBe(true);
    expect(goldEdge()).toBe(false);
    expect(moving()).toBe(false);
    expect(resultShown()).toBe(false);
    await advance(299);
    expect(resultShown()).toBe(false);
    await advance(1);
    expect(resultShown()).toBe(true);
    expect(screen.getByTestId("result-outcome").props.children).toBe("You Lose");
    await settle();
    expect(named(at, "blackjack.lose")).toEqual([1400]);
    expect(named(at, "blackjack.chipCollect")).toEqual([1820]);
    expect(stings()).toBe(0);
    expect(silverEdge()).toBe(true);
  });

  it("the dock: greyed actions until the banner shows (none can be taken), then the result's dock", async () => {
    await mountOn(betting(DEALER));
    await dealTen();
    expect(disabled(/^Hit/)).toBe(true);
    expect(disabled(/^Stand/)).toBe(true);
    await advance(1399);
    expect(disabled(/^Hit/)).toBe(true);
    expect(screen.queryByText("Rebet")).toBeNull();
    await advance(1);
    expect(screen.getByText("Rebet")).toBeTruthy();
    expect(screen.queryByLabelText(/^Hit/)).toBeNull();
  });

  it("a tap lands the flip and the result, with the silver edge, and holds the beat", async () => {
    await mountOn(betting(DEALER));
    const at = await dealTen();
    await advance(300);
    await tapFelt();
    expect(resultShown()).toBe(true);
    expect(silverEdge()).toBe(true);
    await settle();
    expect(named(at, "blackjack.lose")).toEqual([300]);
    expect(stings()).toBe(0);
  });

  it("Reduce Motion: the static silver edge, the banner and the chips at once; the sounds 100 ms apart (#3751)", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    await mountOn(betting(DEALER));
    const at = await dealTen();
    expect(silverEdge()).toBe(true);
    expect(goldEdge()).toBe(false);
    expect(moving()).toBe(false);
    expect(resultShown()).toBe(true);
    expect(screen.getByTestId("result-outcome").props.children).toBe("You Lose");
    expect(screen.queryByTestId(/^felt-chip-/, HIDDEN)).toBeNull();
    expect(screen.getByText("Rebet")).toBeTruthy();
    await settle();
    // Each sound once, in the timeline's order, REDUCE_MOTION_SOUND_GAP_MS apart from the tap.
    const GAP = REDUCE_MOTION_SOUND_GAP_MS;
    expect(named(at, "blackjack.cardDeal")).toEqual([0]);
    expect(named(at, "blackjack.cardFlip")).toEqual([GAP]);
    expect(named(at, "blackjack.lose")).toEqual([2 * GAP]);
    expect(named(at, "blackjack.chipCollect")).toEqual([3 * GAP]);
    expect(stings()).toBe(0);
    expect(silverEdge()).toBe(true);
  });
});

describe("natural against natural", () => {
  it("the gold edge only (no lift, glint, sweep or sting), the silver at the flip, then the push", async () => {
    await mountOn(betting(BOTH));
    const at = await dealTen();
    await advance(600);
    expect(goldEdge()).toBe(true);
    expect(moving()).toBe(false);
    expect(liftOf("hand-0-card-0")).toBe(0);
    expect(silverEdge()).toBe(false);
    await advance(499);
    expect(silverEdge()).toBe(false);
    expect(resultShown()).toBe(false);
    await advance(1);
    expect(silverEdge()).toBe(true);
    expect(resultShown()).toBe(true);
    expect(screen.getByTestId("result-outcome").props.children).toBe("Push");
    await settle();
    expect(stings()).toBe(0);
    expect(named(at, "blackjack.push")).toEqual([1100]);
    expect(named(at, "blackjack.chipNudge")).toEqual([1520]);
  });
});

describe("a split hand's ace and ten", () => {
  it("is not a natural (it pays 1:1): no edge, no moment, no sting", async () => {
    await mountOn(betting(SPLIT_ACES));
    await dealTen();
    await settle();
    await press(/^Split —/);
    for (let t = 0; t < 3000; t += 100) {
      await advance(100);
      expect(anyEdge()).toBe(false);
      expect(moving()).toBe(false);
    }
    expect(stings()).toBe(0);
  });
});

// #3741 review (owner-approved): the result's detail line for a hand the dealer's peek settled.
describe("the result's detail after the dealer's peek", () => {
  const detail = () => screen.getByTestId("result-detail").props.children;

  it('the dealer\'s natural beats the player: "You Lose", detail "Dealer Blackjack"', async () => {
    await mountOn(betting(DEALER));
    await dealTen();
    await settle();
    expect(screen.getByTestId("result-outcome").props.children).toBe("You Lose");
    expect(detail()).toBe("Dealer Blackjack");
  });

  it('natural against natural: "Push", detail "Both Blackjack"', async () => {
    await mountOn(betting(BOTH));
    await dealTen();
    await settle();
    expect(screen.getByTestId("result-outcome").props.children).toBe("Push");
    expect(detail()).toBe("Both Blackjack");
  });

  it("any other loss keeps its totals", async () => {
    await mountOn(betting(LOSE));
    await dealTen();
    await settle();
    await press(/^Stand/);
    await settle();
    expect(detail()).toBe("15 against the dealer's 18");
  });

  it('a 3-card 21 that loses to a dealer natural reads "Dealer Blackjack"', () => {
    // A hand-built state: no game reaches it now. The peek settles a dealer natural at the deal,
    // and a save from before it is settled on load with its two dealt cards. This holds
    // `feltResultFor`'s rule (any loss to a two-card dealer 21) should such a state appear.
    const settled = stand(hit(savedAgainstNatural([card("10"), card("6", "♥")], [card("5")])));
    expect(settled.outcome).toBe("lose");
    const t = ((key: string) => i18n.t(key)) as unknown as Parameters<typeof feltResultFor>[1];
    expect(feltResultFor(toViewState(settled), t)?.detail).toBe("Dealer Blackjack");
  });
});
