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
import { act, fireEvent, render, screen } from "@testing-library/react-native";

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

/** Every card the engine holds is drawn, at its place in the geometry (the felt's estimate). */
function expectTableMatches(engine: EngineState) {
  const v = toViewState(engine);
  const window = Dimensions.get("window");
  const felt = estimateFeltSize({
    screenWidth: window.width,
    screenHeight: window.height,
    insetTop: 0,
    insetBottom: 0,
    headerHeight: APP_HEADER_HEIGHT,
  });
  const betting = v.phase === "betting";
  const geometry = computeTableGeometry({
    feltWidth: felt.width,
    feltHeight: felt.height,
    screenWidth: window.width,
    screenHeight: window.height,
    dealerCards: betting ? 0 : v.dealer_hand.cards.length,
    handCards: betting ? [] : v.player_hands.map((h) => h.cards.length),
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
  expect(drawn).toBe(dealerShown + v.player_hands.reduce((a, h) => a + h.cards.length, 0));
  for (let i = 0; i < dealerShown; i++) {
    const f = geometry.dealer.fan;
    expect(placeOf(`dealer-card-${i}`)).toEqual([f.x + i * f.step, f.y]);
  }
  v.player_hands.forEach((h, k) =>
    h.cards.forEach((_, i) => {
      const f = geometry.hands[k]!.fan;
      expect(placeOf(`hand-${k}-card-${i}`)).toEqual([f.x + i * f.step, f.y]);
    })
  );
  // The result shows exactly when the engine settled the round; no chip is left moving.
  expect(screen.queryByTestId("blackjack-felt-result") !== null).toBe(showsResult(v.phase));
  expect(screen.queryByTestId(/^felt-chip-/, { includeHiddenElements: true })).toBeNull();
  // The hole card is face down exactly while the player plays.
  expect(screen.queryByTestId("dealer-card-0-outline") !== null).toBe(v.phase === "player");
}

beforeEach(() => {
  mockPlayed.length = 0;
  resetReduceMotionForTests();
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
  jest.useFakeTimers({ now: 1_700_000_000_000 });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  (loadGame as jest.Mock).mockResolvedValue(null);
});

describe("fuzz: random play with taps mid-motion", () => {
  it.each(Array.from({ length: 12 }, (_, i) => i + 1))("seed %i", async (seed) => {
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
    await act(async () => {
      await Promise.resolve();
    });

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
    /** Plays out `pending`'s cues due by `cutoff` (its own clock); a tap plays a due chime once. */
    const finish = (cutoff: number, tapped: boolean) => {
      if (pending === null) return;
      const { plan } = pending;
      for (const c of plan.cues) if (c.at <= cutoff) expected.push(KEY[c.sound]);
      const chime = plan.cues.find((c) => c.at === plan.resultAt && RESULT_CUES.includes(c.sound));
      if (tapped && chime !== undefined && chime.at > cutoff) expected.push(KEY[chime.sound]);
      pending = null;
    };
    /** A tap at `t`: a running timeline lands; a result cut short holds a beat. */
    const skipAt = (t: number) => {
      if (pending === null || t < holdUntil) return;
      const elapsed = t - pending.start;
      if (elapsed >= pending.plan.endMs) return;
      const result = pending.plan.resultAt !== null;
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
      if (pick === "felt") {
        skipAt(t);
        await act(async () => {
          await fireEvent.press(screen.getByTestId("blackjack-table-area"));
        });
      } else if (pick === "chip") {
        await press("Add 10 to bet");
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
      }
      // Run the clock on, often mid-motion (0–700 ms), sometimes past it, noting when the engine
      // changes (an action now, or one that waited for the beat at its end).
      const wait = rng() < 0.2 ? 0 : Math.floor(rng() * (rng() < 0.7 ? 700 : 3000));
      const startsAt = queued ? Math.max(t, holdUntil) : t;
      const changed = () => spied.ctx!.engine! !== before;
      if (queued && startsAt > t) {
        await advance(Math.min(wait, startsAt - t));
      }
      if (changed()) {
        queued = false;
        const after = spied.ctx!.engine!;
        const plan = planMotion(toViewState(before), toViewState(after), held);
        if (showsResult(after.phase) && !showsResult(before.phase)) settledRounds++;
        finish(Infinity, false);
        pending = plan === null ? null : { plan, start: startsAt };
        held = plan === null ? [] : plan.held;
      }
      const spent = now() - t;
      if (wait > spent) await advance(wait - spent);
    }
    // An action still waiting for the beat runs at its end (its motion is planned then).
    if (queued) {
      const before = spied.ctx!.engine!;
      await advance(Math.max(0, holdUntil - now()));
      const after = spied.ctx!.engine!;
      if (after !== before) {
        const plan = planMotion(toViewState(before), toViewState(after), held);
        if (showsResult(after.phase) && !showsResult(before.phase)) settledRounds++;
        finish(Infinity, false);
        pending = plan === null ? null : { plan, start: holdUntil };
      }
    }
    await advance(6000);
    finish(Infinity, false);
    expectTableMatches(spied.ctx!.engine!);
    // Each settled round sounds its result once, whether it played out or was cut short.
    const chimes = expected.filter((n) => /^blackjack\.(win|lose|push|blackjack)$/.test(n));
    expect(chimes.length).toBeLessThanOrEqual(settledRounds);
    // Exactly the sounds due: none twice, none missing (a variation counts as its sound).
    const played = mockPlayed.map((n) => n.replace(/[23]$/, "")).sort();
    expect(played).toEqual([...expected].sort());
  });
});
