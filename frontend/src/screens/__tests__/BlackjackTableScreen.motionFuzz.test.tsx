/**
 * #3581: a seeded fuzz of Blackjack's motion on the screen, like Solitaire's and FreeCell's. Each
 * seed plays rounds with random actions at random times, many of them mid-motion (input stays
 * live: a tap lands the motion and goes on). Once the last motion settles, every card the engine
 * holds is drawn at its place in the table's geometry and nothing is left moving. The sounds
 * played are exactly those due (#3720 review): from each action's own plan, every cue due before
 * the next tap, plus, for a round cut short by a tap before its result, its chime once at the tap.
 * So a duplicate chime, flip or deal, or a missing one, fails.
 */
import React, { useEffect } from "react";
import { AccessibilityInfo, Dimensions, StyleSheet } from "react-native";
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";

import BlackjackTableScreen from "../BlackjackTableScreen";
import { BlackjackGameProvider, useBlackjackGame } from "../../game/blackjack/BlackjackGameContext";
import { ThemeProvider } from "../../theme/ThemeContext";
import { loadGame } from "../../game/blackjack/storage";
import { newGame, toViewState, type Card, type EngineState } from "../../game/blackjack/engine";
import { computeTableGeometry, estimateFeltSize, showsResult } from "../../game/blackjack/layout";
import { APP_HEADER_HEIGHT } from "../../components/shared/AppHeader";
import { resetReduceMotionForTests } from "../../components/shared/useReduceMotion";
import { createSeededRng } from "../../game/_shared/seededRng";
import {
  naturalEdges,
  planMotion,
  RESULT_CUES,
  SKIP_HOLD_MS,
  type SoundCue,
  type Timeline,
} from "../../components/blackjack/blackjackMotion";

/** Each cue's sound key (its first variation). */
const KEY: Record<SoundCue, string> = {
  deal: "blackjack.cardDeal",
  flip: "blackjack.cardFlip",
  chipBet: "blackjack.chipBet",
  win: "blackjack.win",
  lose: "blackjack.lose",
  bust: "blackjack.bust",
  push: "blackjack.push",
  blackjack: "blackjack.blackjack",
  payout: "blackjack.chipPayout",
  collect: "blackjack.chipCollect",
  nudge: "blackjack.chipNudge",
};

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

const mockPlayed: string[] = [];
jest.mock("../../game/_shared/useSound", () => mockScreenDeps().mockSoundByName(() => mockPlayed));

const spied: { ctx?: ReturnType<typeof useBlackjackGame> } = {};
function Spy() {
  const value = useBlackjackGame();
  useEffect(() => {
    spied.ctx = value;
  });
  return null;
}

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
/** A seeded shoe, pairs of 8s made likely so splits come up. */
function shoe(rng: () => number): Card[] {
  return Array.from({ length: 400 }, () => ({
    rank: rng() < 0.25 ? "8" : RANKS[Math.floor(rng() * RANKS.length)]!,
    suit: ["♠", "♥", "♦", "♣"][Math.floor(rng() * 4)]!,
  }));
}

const press = (label: string | RegExp) =>
  act(async () => {
    await fireEvent.press(screen.getByLabelText(label));
  });
const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });
const live = (label: RegExp) => {
  const node = screen.queryByLabelText(label);
  return node !== null && node.props.accessibilityState?.disabled !== true;
};

/**
 * Every card the engine holds is drawn, at its place in the geometry (the felt's estimate), except
 * the cards `held` (the motion's own count per hand, `Timeline.held`): a split hand's second card
 * stays back until that hand is the one to play (owner decision, #3720). The exemption is exact: a
 * held card is only ever the last card of a split hand that comes after the active one, in the
 * player's phase, at most one per hand. Every other card must be drawn.
 */
function expectTableMatches(engine: EngineState, held: readonly number[]) {
  const v = toViewState(engine);
  const heldOf = (k: number) => held[k] ?? 0;
  v.player_hands.forEach((h, k) => {
    if (heldOf(k) === 0) return;
    expect(v.phase).toBe("player");
    expect(k).toBeGreaterThan(v.active_hand_index);
    expect(heldOf(k)).toBe(1);
    expect(h.cards.length).toBeGreaterThanOrEqual(2);
  });
  expect(held.length).toBeLessThanOrEqual(v.player_hands.length);
  const window = Dimensions.get("window");
  const felt = estimateFeltSize({
    screenWidth: window.width,
    screenHeight: window.height,
    insetTop: 0,
    insetBottom: 0,
    headerHeight: APP_HEADER_HEIGHT,
  });
  const betting = v.phase === "betting";
  const drawnCards = (k: number) => v.player_hands[k]!.cards.length - heldOf(k);
  const geometry = computeTableGeometry({
    feltWidth: felt.width,
    feltHeight: felt.height,
    screenWidth: window.width,
    screenHeight: window.height,
    dealerCards: betting ? 0 : v.dealer_hand.cards.length,
    handCards: betting ? [] : v.player_hands.map((_, k) => drawnCards(k)),
    activeHandIndex: v.phase === "player" ? v.active_hand_index : null,
    showResult: showsResult(v.phase),
  });
  const placeOf = (testID: string) => {
    const s = StyleSheet.flatten(screen.getByTestId(testID).props.style) as {
      left: number;
      top: number;
    };
    return [s.left, s.top];
  };
  const drawn = screen.queryAllByTestId(/^(dealer|hand-\d)-card-\d+$/).length;
  if (betting) {
    expect(drawn).toBe(0);
    return;
  }
  const dealerShown = geometry.dealer.collapsed ? 0 : v.dealer_hand.cards.length;
  expect(drawn).toBe(dealerShown + v.player_hands.reduce((a, _, k) => a + drawnCards(k), 0));
  for (let i = 0; i < dealerShown; i++) {
    const f = geometry.dealer.fan;
    expect(placeOf(`dealer-card-${i}`)).toEqual([f.x + i * f.step, f.y]);
  }
  v.player_hands.forEach((h, k) => {
    for (let i = 0; i < h.cards.length; i++) {
      if (i >= drawnCards(k)) {
        // The held card is not on the table.
        expect(screen.queryByTestId(`hand-${k}-card-${i}`)).toBeNull();
        continue;
      }
      const f = geometry.hands[k]!.fan;
      expect(placeOf(`hand-${k}-card-${i}`)).toEqual([f.x + i * f.step, f.y]);
    }
  });
  // A natural's moment (#3621) has ended, nothing of it left moving, and its edges are exactly the
  // settled round's (the gold on a one-hand natural, the silver on the dealer's that decided it).
  const hidden = { includeHiddenElements: true };
  expect(screen.queryByTestId("natural-sweep", hidden)).toBeNull();
  expect(screen.queryAllByTestId(/-natural-sheen$/, hidden)).toHaveLength(0);
  const edges = naturalEdges(v);
  expect(screen.queryAllByTestId(/^hand-\d-card-\d+-natural-gold$/, hidden)).toHaveLength(
    edges.player ? 2 : 0
  );
  expect(screen.queryAllByTestId(/^dealer-card-\d+-natural-silver$/, hidden)).toHaveLength(
    edges.dealer && dealerShown > 0 ? 2 : 0
  );
  // The result shows exactly when the engine settled the round; no chip is left moving.
  expect(screen.queryByTestId("blackjack-felt-result") !== null).toBe(showsResult(v.phase));
  expect(screen.queryByTestId(/^felt-chip-/, { includeHiddenElements: true })).toBeNull();
  // The hole card is face down exactly while the player plays.
  expect(within(screen.getByTestId("dealer-card-0")).queryByTestId("minimal-back") !== null).toBe(
    v.phase === "player"
  );
  expect(screen.queryByTestId("dealer-card-0-outline")).toBeNull();
}

beforeEach(() => {
  mockPlayed.length = 0;
  resetReduceMotionForTests();
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
  jest.useFakeTimers({ now: 1_700_000_000_000 });
});

/**
 * The seed running now. A seed that outlives its test (jest's timeout, under load) must stop: its
 * loop would drive the next seed's render and fake clock through the shared `spied.ctx` and
 * `screen`. `afterEach` moves this on; each seed checks it after every await (`alive()`).
 */
let seedRun = 0;

afterEach(() => {
  seedRun++;
  jest.useRealTimers();
  jest.restoreAllMocks();
  (loadGame as jest.Mock).mockResolvedValue(null);
});

/**
 * Seeds 1-12, plus ones that end mid-split with a card held back (#3747: 40, 64, 74, 79, 85) and
 * ones where a Rebet's deal is decided at once by the dealer's peek (#3741: 41, 49, 50). All of
 * 13-87 pass; the full range takes ~70 s, so only these run in CI.
 */
describe("fuzz: random play with taps mid-motion", () => {
  it.each([...Array.from({ length: 12 }, (_, i) => i + 1), 40, 41, 49, 50, 64, 74, 79, 85])(
    "seed %i",
    async (seed) => {
      const mine = ++seedRun;
      const alive = () => {
        if (seedRun !== mine) throw new Error(`seed ${seed} outlived its test: stopped`);
      };
      const rng = createSeededRng(seed * 104729);
      const start = newGame(shoe(rng), {
        startingChips: 5000,
        runGoal: 100000,
        betMin: 5,
        betMax: 25,
      });
      (loadGame as jest.Mock).mockResolvedValue(start);
      await render(
        <ThemeProvider>
          <BlackjackGameProvider>
            <BlackjackTableScreen
              navigation={
                {
                  navigate: jest.fn(),
                  goBack: jest.fn(),
                  replace: jest.fn(),
                  popToTop: jest.fn(),
                } as never
              }
            />
            <Spy />
          </BlackjackGameProvider>
        </ThemeProvider>
      );
      alive();
      await act(async () => {
        await Promise.resolve();
      });
      alive();

      // Every sound the motion must play, worked out from each action's own plan and the owner's
      // rules (#3720): a tap (an action, or on the felt) mid-motion lands it, playing the cues already
      // due and, for a result not yet shown, its chime once; a result cut short holds SKIP_HOLD_MS,
      // and an action tapped then waits for the beat (one; any more are dropped).
      const expected: string[] = [];
      const t0 = Date.now();
      const now = () => Date.now() - t0;
      let pending: { plan: Timeline; start: number } | null = null;
      let holdUntil = -1;
      let queued = false;
      let held: readonly number[] = [];
      let settledRounds = 0;
      /**
       * An action that leaves the engine at a result settles a round, also from a result: a Rebet
       * whose deal is decided at once (the dealer's peek, #3741) goes result -> result.
       */
      const settles = (before: EngineState, after: EngineState) =>
        showsResult(after.phase) && (!showsResult(before.phase) || after !== before);
      /** Cards the engine dealt (a split's second card moves; it is not dealt again). */
      let dealt = 0;
      // Per round too: a round's deal sounds never outnumber the cards it dealt (a skip only drops
      // sounds). Its sounds are those from its first action to the next round's.
      let roundStart = 0;
      let roundDealt = 0;
      let pressIdx = 0;
      const endRound = () => {
        const sounds = mockPlayed
          .slice(roundStart, pressIdx)
          .filter((n) => /^blackjack\.cardDeal\d?$/.test(n));
        expect(sounds.length).toBeLessThanOrEqual(roundDealt);
      };
      const count = (before: EngineState, after: EngineState) => {
        const n = cardsOf(after) - (before.phase === "player" ? cardsOf(before) : 0);
        dealt += n;
        if (before.phase !== "player") {
          endRound();
          roundStart = pressIdx;
          roundDealt = 0;
        }
        roundDealt += n;
      };
      const cardsOf = (e: EngineState) =>
        e.dealer_hand.length +
        (e.split_count > 0
          ? e.player_hands.reduce((a, h) => a + h.length, 0)
          : e.player_hand.length);
      /** Plays out `pending`'s cues due by `cutoff` (its own clock); a tap plays a due chime once. */
      const finish = (cutoff: number, tapped: boolean) => {
        if (pending === null) return;
        const { plan } = pending;
        for (const c of plan.cues) if (c.at <= cutoff) expected.push(KEY[c.sound]);
        // The result's chime: a natural's sting comes before its result (`chimeAt`, #3621).
        const chime = plan.cues.find((c) => c.at === plan.chimeAt && RESULT_CUES.includes(c.sound));
        if (tapped && chime !== undefined && chime.at > cutoff) expected.push(KEY[chime.sound]);
        pending = null;
      };
      /** A tap at `t`: a running timeline lands; a result cut short holds a beat. */
      const skipAt = (t: number) => {
        if (pending === null || t < holdUntil) return;
        const elapsed = t - pending.start;
        if (elapsed >= pending.plan.endMs) return;
        // A beat only for a result not yet shown (#3720 round 2).
        const { resultAt } = pending.plan;
        const result = resultAt !== null && elapsed < resultAt;
        finish(elapsed, true);
        if (result) holdUntil = t + SKIP_HOLD_MS;
      };
      for (let step = 0; step < 50; step++) {
        // The beat over, a queued action has run: its plan started then.
        const before = spied.ctx!.engine!;
        const options: (RegExp | "felt" | "chip")[] = ["felt"];
        if (live(/^Rebet —/)) options.push(/^Rebet —/, /^Rebet —/);
        if (live(/^Hit/)) options.push(/^Hit/, /^Stand/);
        if (live(/^Double down —/)) options.push(/^Double down —/);
        if (live(/^Split —/)) options.push(/^Split —/, /^Split —/);
        if (live(/deal cards with 10-chip bet/i)) options.push(/deal cards with 10-chip bet/i);
        // A chip in the betting dock (the result's tray chips are actions, like Rebet).
        else if (live(/^Add 10 to bet/) && screen.queryByLabelText(/^Rebet —/) === null) {
          options.push("chip");
        }
        const pick = options[Math.floor(rng() * options.length)]!;
        const t = now();
        pressIdx = mockPlayed.length;
        if (pick === "felt") {
          skipAt(t);
          await act(async () => {
            await fireEvent.press(screen.getByTestId("blackjack-table-area"));
          });
          alive();
        } else if (pick === "chip") {
          await press("Add 10 to bet");
          alive();
          expected.push("blackjack.chipBet");
        } else {
          const holding = t < holdUntil;
          if (holding && queued) {
            // A second action during the beat is dropped.
            await press(pick);
          } else {
            skipAt(t);
            if (t < holdUntil) queued = true;
            await press(pick);
          }
          alive();
        }
        // Run the clock on, often mid-motion (0–700 ms), sometimes past it, noting when the engine
        // changes (an action now, or one that waited for the beat at its end).
        const wait = rng() < 0.2 ? 0 : Math.floor(rng() * (rng() < 0.7 ? 700 : 3000));
        const startsAt = queued ? Math.max(t, holdUntil) : t;
        const changed = () => spied.ctx!.engine! !== before;
        if (queued && startsAt > t) {
          await advance(Math.min(wait, startsAt - t));
          alive();
        }
        if (changed()) {
          queued = false;
          const after = spied.ctx!.engine!;
          const plan = planMotion(toViewState(before), toViewState(after), held);
          if (settles(before, after)) settledRounds++;
          count(before, after);
          finish(Infinity, false);
          pending = plan === null ? null : { plan, start: startsAt };
          held = plan === null ? [] : plan.held;
        }
        const spent = now() - t;
        if (wait > spent) await advance(wait - spent);
        alive();
      }
      // An action still waiting for the beat runs at its end (its motion is planned then).
      if (queued) {
        const before = spied.ctx!.engine!;
        await advance(Math.max(0, holdUntil - now()));
        alive();
        const after = spied.ctx!.engine!;
        if (after !== before) {
          const plan = planMotion(toViewState(before), toViewState(after), held);
          if (settles(before, after)) settledRounds++;
          count(before, after);
          finish(Infinity, false);
          pending = plan === null ? null : { plan, start: holdUntil };
          held = plan === null ? [] : plan.held;
        }
      }
      await advance(6000);
      alive();
      finish(Infinity, false);
      expectTableMatches(spied.ctx!.engine!, held);
      // Each settled round sounds its result once, whether it played out or was cut short.
      // Bounds that do not come from the plan (no Reduce Motion, never away): no more deal sounds
      // than cards dealt, and every settled round heard (a split hand's own bust aside).
      const playedOf = (re: RegExp) => mockPlayed.filter((n) => re.test(n)).length;
      expect(playedOf(/^blackjack\.cardDeal\d?$/)).toBeLessThanOrEqual(dealt);
      pressIdx = mockPlayed.length;
      endRound();
      const chimes = playedOf(/^blackjack\.(win|lose|push|blackjack)$/);
      expect(chimes).toBeLessThanOrEqual(settledRounds);
      expect(chimes + playedOf(/^blackjack\.bust$/)).toBeGreaterThanOrEqual(settledRounds);
      // Exactly the sounds due: none twice, none missing (a variation counts as its sound).
      const played = mockPlayed.map((n) => n.replace(/[23]$/, "")).sort();
      expect(played).toEqual([...expected].sort());
      // Its own timeout: a seed takes ~2 s alone, many times that in a full parallel run.
    },
    60_000
  );
});
