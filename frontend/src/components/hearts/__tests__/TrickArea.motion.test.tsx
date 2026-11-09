/**
 * TrickArea's card play and trick motion (#3574, "A. Brisk"): a played card's flight and the
 * card-place cue it drives, the "seen" guard, the hold and the sweep with the trick-gathered cue
 * at its start, Reduce Motion, and the completion the screen's AI loop waits on (no timeout)
 * firing exactly once per trick in every path.
 */
import React from "react";
import { AccessibilityInfo } from "react-native";
import { render } from "@testing-library/react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import TrickArea from "../TrickArea";
import { computeHeartsGeometry } from "../../../game/hearts/layout";
import type { Card, TrickCard } from "../../../game/hearts/types";
import {
  FLIGHT_EASING,
  FLIGHT_MS,
  SOUND_LEAD_MS,
  SWEEP_BACKSTOP_MS,
  SWEEP_EASING,
  SWEEP_FADE_FROM,
  SWEEP_MS,
  TRICK_GATHER_PEAK_MS,
  TRICK_HOLD_MS,
  sweepOpacity,
} from "../trickMotion";
import {
  advanceBy,
  flushReduceMotion,
  mockReduceMotion,
  timeReanimatedEnds,
} from "./helpers/animationFixtures";
import { resetReduceMotionForTests } from "../../shared/useReduceMotion";

const reanimated = jest.requireMock<{ withTiming: jest.Mock | ((...a: unknown[]) => unknown) }>(
  "react-native-reanimated"
);

const GEOMETRY = computeHeartsGeometry({ width: 390, height: 708 }).trick;
const c = (suit: Card["suit"], rank: Card["rank"]): Card => ({ suit, rank });
// The human leads; West, North and East follow. The human's 10♠ takes it.
const PLAYS: TrickCard[] = [
  { card: c("spades", 10), playerIndex: 0 },
  { card: c("spades", 3), playerIndex: 1 },
  { card: c("spades", 8), playerIndex: 2 },
  { card: c("spades", 5), playerIndex: 3 },
];
const upTo = (n: number) => PLAYS.slice(0, n);

type Callbacks = {
  onCardPlace: jest.Mock;
  onCardLanded: jest.Mock;
  onSweepStart: jest.Mock;
  onAnimationComplete: jest.Mock;
};
const callbacks = (): Callbacks => ({
  onCardPlace: jest.fn(),
  onCardLanded: jest.fn(),
  onSweepStart: jest.fn(),
  onAnimationComplete: jest.fn(),
});

const ui = (cb: Callbacks, trick: TrickCard[], winnerIndex: number | null, holdSweep = false) => (
  <ThemeProvider>
    <TrickArea
      trick={trick}
      playerIndex={0}
      winnerIndex={winnerIndex}
      geometry={GEOMETRY}
      holdSweep={holdSweep}
      {...cb}
    />
  </ThemeProvider>
);

/** Mounts on `trick`; `show` then plays the table on to another trick, as the screen does. */
async function mount(trick: TrickCard[], winnerIndex: number | null = null, cb = callbacks()) {
  const view = await render(ui(cb, trick, winnerIndex));
  return {
    cb,
    view,
    show: (next: TrickCard[], winner: number | null = null, hold = false) =>
      view.rerender(ui(cb, next, winner, hold)),
  };
}

/** The `withTiming` calls made with this duration (the flight's, or the sweep's). */
const timingsOf = (duration: number) =>
  (reanimated.withTiming as jest.Mock).mock.calls.filter(
    ([, config]) => (config as { duration?: number } | undefined)?.duration === duration
  );

beforeEach(() => {
  jest.useFakeTimers();
  timeReanimatedEnds();
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("a played card's flight", () => {
  it("flies in, cues card place SOUND_LEAD_MS before contact and reports the landing at contact", async () => {
    const { cb, show } = await mount(upTo(1));
    await show(upTo(2)); // West plays the 3♠
    expect(timingsOf(FLIGHT_MS)).toHaveLength(1);
    expect(timingsOf(FLIGHT_MS)[0]?.[1]).toEqual({ duration: FLIGHT_MS, easing: FLIGHT_EASING });

    await advanceBy(FLIGHT_MS - SOUND_LEAD_MS - 1);
    expect(cb.onCardPlace).not.toHaveBeenCalled();
    await advanceBy(1);
    expect(cb.onCardPlace).toHaveBeenCalledTimes(1);
    expect(cb.onCardPlace).toHaveBeenCalledWith(c("spades", 3));
    expect(cb.onCardLanded).not.toHaveBeenCalled();

    await advanceBy(SOUND_LEAD_MS - 1);
    expect(cb.onCardLanded).not.toHaveBeenCalled();
    await advanceBy(1);
    expect(cb.onCardLanded).toHaveBeenCalledTimes(1);
    expect(cb.onCardLanded).toHaveBeenCalledWith(c("spades", 3));

    // Each card cues once: re-renders do not fly it again.
    await show(upTo(2));
    await advanceBy(2000);
    expect(cb.onCardPlace).toHaveBeenCalledTimes(1);
    expect(timingsOf(FLIGHT_MS)).toHaveLength(1);
  });

  it("does not fly or sound the cards already on the table at mount (a restored trick)", async () => {
    const { cb } = await mount(upTo(3));
    await advanceBy(2000);
    expect(cb.onCardPlace).not.toHaveBeenCalled();
    expect(cb.onCardLanded).not.toHaveBeenCalled();
    expect(timingsOf(FLIGHT_MS)).toHaveLength(0);
  });

  it("does not fly the trick in again when it remounts mid-flight", async () => {
    const first = await mount(upTo(1));
    await first.show(upTo(2));
    await advanceBy(100); // West's card is in the air
    await first.view.unmount();
    await advanceBy(2000);
    // The flight that was cut short cues nothing after its card left the screen.
    expect(first.cb.onCardPlace).not.toHaveBeenCalled();
    expect(first.cb.onCardLanded).not.toHaveBeenCalled();

    const again = await mount(upTo(2));
    await advanceBy(2000);
    expect(again.cb.onCardPlace).not.toHaveBeenCalled();
    expect(timingsOf(FLIGHT_MS)).toHaveLength(1); // only the first mount's
  });

  it("shows several cards that arrive at once in place: a jump in state, not a play", async () => {
    const { cb, show } = await mount([]);
    await show(upTo(3));
    await advanceBy(2000);
    expect(cb.onCardPlace).not.toHaveBeenCalled();
    expect(timingsOf(FLIGHT_MS)).toHaveLength(0);
  });
});

describe("the sweep", () => {
  it("waits for the last flight and the hold, cues trick gathered at its start, completes at its end, once", async () => {
    const { cb, show } = await mount(upTo(3));
    await show(upTo(4), 0); // East's card completes the trick; the human won it

    await advanceBy(FLIGHT_MS + TRICK_HOLD_MS - 1);
    expect(cb.onSweepStart).not.toHaveBeenCalled();
    expect(timingsOf(SWEEP_MS)).toHaveLength(0);
    await advanceBy(1);
    expect(cb.onSweepStart).toHaveBeenCalledTimes(1);
    expect(timingsOf(SWEEP_MS)).toHaveLength(1);
    expect(timingsOf(SWEEP_MS)[0]?.[1]).toEqual({ duration: SWEEP_MS, easing: SWEEP_EASING });
    expect(cb.onAnimationComplete).not.toHaveBeenCalled();

    await advanceBy(SWEEP_MS - 1);
    expect(cb.onAnimationComplete).not.toHaveBeenCalled();
    await advanceBy(1);
    expect(cb.onAnimationComplete).toHaveBeenCalledTimes(1);

    // The JS backstop that follows does not report the trick a second time.
    await advanceBy(5000);
    expect(cb.onAnimationComplete).toHaveBeenCalledTimes(1);
    expect(cb.onSweepStart).toHaveBeenCalledTimes(1);
  });

  it("constants check: the trick-gathered thump lands on the cards' arrival", () => {
    // Cued at the sweep's start, its 193 ms peak falls within a frame of the 200 ms sweep's end.
    expect(SWEEP_MS - TRICK_GATHER_PEAK_MS).toBeGreaterThanOrEqual(0);
    expect(SWEEP_MS - TRICK_GATHER_PEAK_MS).toBeLessThan(17);
  });

  it("fades the cards only over the sweep's last 40%", () => {
    expect(SWEEP_FADE_FROM).toBe(0.6);
    expect(sweepOpacity(0)).toBe(1);
    expect(sweepOpacity(SWEEP_FADE_FROM)).toBe(1);
    expect(sweepOpacity(0.8)).toBeCloseTo(0.5, 5);
    expect(sweepOpacity(1)).toBe(0);
  });

  it("completes once from the JS backstop if the UI thread never reports the end", async () => {
    jest.restoreAllMocks(); // the Jest mock drops the timing's callback, as a lost one would
    const { cb } = await mount(upTo(4), 0);
    await advanceBy(TRICK_HOLD_MS);
    expect(cb.onSweepStart).toHaveBeenCalledTimes(1);
    await advanceBy(SWEEP_BACKSTOP_MS - 1);
    expect(cb.onAnimationComplete).not.toHaveBeenCalled();
    await advanceBy(1);
    expect(cb.onAnimationComplete).toHaveBeenCalledTimes(1);
    await advanceBy(5000);
    expect(cb.onAnimationComplete).toHaveBeenCalledTimes(1);
  });

  it("completes once from the backstop when the sweep is cut short (finished: false)", async () => {
    (reanimated.withTiming as jest.Mock).mockImplementation(
      (value: unknown, config?: { duration?: number }, done?: (finished: boolean) => void) => {
        if (done) setTimeout(() => done(false), config?.duration ?? 0);
        return value;
      }
    );
    const { cb } = await mount(upTo(4), 0);
    await advanceBy(TRICK_HOLD_MS + SWEEP_MS);
    expect(cb.onAnimationComplete).not.toHaveBeenCalled();
    await advanceBy(SWEEP_BACKSTOP_MS - SWEEP_MS);
    expect(cb.onAnimationComplete).toHaveBeenCalledTimes(1);
    await advanceBy(5000);
    expect(cb.onAnimationComplete).toHaveBeenCalledTimes(1);
  });

  it("neither cues nor completes while held; on release the hold starts again, then once", async () => {
    const { cb, show } = await mount(upTo(3));
    await show(upTo(4), 0, true); // hearts broken on the last card: the moment holds the trick
    await advanceBy(5000);
    expect(cb.onSweepStart).not.toHaveBeenCalled();
    expect(cb.onAnimationComplete).not.toHaveBeenCalled();

    await show(upTo(4), 0, false);
    await advanceBy(TRICK_HOLD_MS - 1);
    expect(cb.onSweepStart).not.toHaveBeenCalled();
    await advanceBy(1);
    expect(cb.onSweepStart).toHaveBeenCalledTimes(1);
    await advanceBy(SWEEP_MS);
    expect(cb.onAnimationComplete).toHaveBeenCalledTimes(1);
    await advanceBy(5000);
    expect(cb.onSweepStart).toHaveBeenCalledTimes(1);
    expect(cb.onAnimationComplete).toHaveBeenCalledTimes(1);
  });

  it("a hold that comes as the card lands (the Q♠ moment) stops the cue already scheduled", async () => {
    const { cb, show } = await mount(upTo(3));
    await show(upTo(4), 0);
    await advanceBy(FLIGHT_MS); // the last card lands; its moment starts and holds the trick
    await show(upTo(4), 0, true);
    await advanceBy(5000);
    expect(cb.onSweepStart).not.toHaveBeenCalled();
    expect(cb.onAnimationComplete).not.toHaveBeenCalled();
    await show(upTo(4), 0, false);
    await advanceBy(TRICK_HOLD_MS + SWEEP_MS);
    expect(cb.onSweepStart).toHaveBeenCalledTimes(1);
    expect(cb.onAnimationComplete).toHaveBeenCalledTimes(1);
  });

  it("a hold arriving mid-sweep neither replays trick gathered nor snaps the cards back", async () => {
    const { cb, show } = await mount(upTo(4), 0);
    await advanceBy(TRICK_HOLD_MS + 50); // 50 ms into the sweep
    expect(cb.onSweepStart).toHaveBeenCalledTimes(1);
    await show(upTo(4), 0, true);
    // The sweep under way runs to its end: completion on its own clock.
    await advanceBy(SWEEP_MS - 50);
    expect(cb.onAnimationComplete).toHaveBeenCalledTimes(1);
    await show(upTo(4), 0, false);
    await advanceBy(5000);
    expect(cb.onSweepStart).toHaveBeenCalledTimes(1);
    expect(cb.onAnimationComplete).toHaveBeenCalledTimes(1);
    expect(timingsOf(SWEEP_MS)).toHaveLength(1);
  });

  it("a hold arriving mid-sweep and released before its end still completes once", async () => {
    const { cb, show } = await mount(upTo(4), 0);
    await advanceBy(TRICK_HOLD_MS + 50);
    await show(upTo(4), 0, true);
    await show(upTo(4), 0, false);
    await advanceBy(5000);
    expect(cb.onSweepStart).toHaveBeenCalledTimes(1);
    expect(cb.onAnimationComplete).toHaveBeenCalledTimes(1);
  });

  it("the same four cards in a later trick sweep and complete again", async () => {
    const { cb, show } = await mount(upTo(4), 0);
    await advanceBy(TRICK_HOLD_MS + SWEEP_MS);
    await show([]);
    await show(upTo(4), 0);
    await advanceBy(TRICK_HOLD_MS + SWEEP_MS);
    expect(cb.onSweepStart).toHaveBeenCalledTimes(2);
    expect(cb.onAnimationComplete).toHaveBeenCalledTimes(2);
  });

  it("a remount mid-sweep completes the trick exactly once", async () => {
    const onAnimationComplete = jest.fn();
    const first = await mount(upTo(4), 0, { ...callbacks(), onAnimationComplete });
    await advanceBy(TRICK_HOLD_MS + SWEEP_MS / 2); // mid-sweep
    await first.view.unmount();

    const again = await mount(upTo(4), 0, { ...callbacks(), onAnimationComplete });
    await advanceBy(5000);
    expect(onAnimationComplete).toHaveBeenCalledTimes(1);
    // The remounted trick is on the table again: it sweeps (and cues) from there, no flight.
    expect(again.cb.onSweepStart).toHaveBeenCalledTimes(1);
    expect(again.cb.onCardPlace).not.toHaveBeenCalled();
  });

  it("an unmount mid-sweep or mid-hold reports nothing afterwards", async () => {
    const midSweep = await mount(upTo(4), 0);
    await advanceBy(TRICK_HOLD_MS + SWEEP_MS / 2);
    await midSweep.view.unmount();
    await advanceBy(5000);
    expect(midSweep.cb.onAnimationComplete).not.toHaveBeenCalled();

    const midHold = await mount(upTo(4), 0);
    await advanceBy(TRICK_HOLD_MS / 2);
    await midHold.view.unmount();
    await advanceBy(5000);
    expect(midHold.cb.onSweepStart).not.toHaveBeenCalled();
    expect(midHold.cb.onAnimationComplete).not.toHaveBeenCalled();
  });

  it("starts the next trick's cards fresh: they fly and the next trick completes once too", async () => {
    const { cb, show } = await mount(upTo(3));
    await show(upTo(4), 0);
    await advanceBy(FLIGHT_MS + TRICK_HOLD_MS + SWEEP_MS);
    expect(cb.onAnimationComplete).toHaveBeenCalledTimes(1);
    await show([]); // the screen clears the trick
    const next: TrickCard[] = [
      { card: c("hearts", 2), playerIndex: 0 },
      { card: c("hearts", 9), playerIndex: 1 },
      { card: c("hearts", 4), playerIndex: 2 },
      { card: c("hearts", 5), playerIndex: 3 },
    ];
    for (let n = 1; n <= 4; n++) {
      await show(next.slice(0, n), n === 4 ? 1 : null);
      await advanceBy(FLIGHT_MS);
    }
    // East's card before it was the trick's 4th, plus the four of this one.
    expect(cb.onCardPlace).toHaveBeenCalledTimes(5);
    await advanceBy(TRICK_HOLD_MS + SWEEP_MS);
    expect(cb.onAnimationComplete).toHaveBeenCalledTimes(2);
  });
});

describe("with Reduce Motion on", () => {
  beforeEach(() => {
    resetReduceMotionForTests();
    mockReduceMotion(true);
  });
  afterEach(() => {
    // React Native's Jest setup already mocks it, so the spy is that mock: put its answer back.
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(false);
    resetReduceMotionForTests();
  });

  it("a played card appears in place: card place and the landing at once, no flight", async () => {
    const { cb, show } = await mount(upTo(1));
    await flushReduceMotion();
    await show(upTo(2));
    expect(cb.onCardPlace).toHaveBeenCalledTimes(1);
    expect(cb.onCardLanded).toHaveBeenCalledTimes(1);
    expect(timingsOf(FLIGHT_MS)).toHaveLength(0);
  });

  it("no sweep: after the hold the trick clears at once, with trick gathered at that instant", async () => {
    const { cb, show } = await mount(upTo(3));
    await flushReduceMotion();
    await show(upTo(4), 0);
    await advanceBy(TRICK_HOLD_MS - 1);
    expect(cb.onSweepStart).not.toHaveBeenCalled();
    expect(cb.onAnimationComplete).not.toHaveBeenCalled();
    await advanceBy(1);
    expect(cb.onSweepStart).toHaveBeenCalledTimes(1);
    expect(cb.onAnimationComplete).toHaveBeenCalledTimes(1);
    expect(timingsOf(SWEEP_MS)).toHaveLength(0);
    await advanceBy(5000);
    expect(cb.onAnimationComplete).toHaveBeenCalledTimes(1);
  });

  it("a held trick still clears once, the hold's length after it lets go", async () => {
    const { cb, show } = await mount(upTo(3));
    await flushReduceMotion();
    await show(upTo(4), 0, true);
    await advanceBy(3000);
    expect(cb.onAnimationComplete).not.toHaveBeenCalled();
    await show(upTo(4), 0, false);
    await advanceBy(TRICK_HOLD_MS);
    expect(cb.onSweepStart).toHaveBeenCalledTimes(1);
    expect(cb.onAnimationComplete).toHaveBeenCalledTimes(1);
  });
});
