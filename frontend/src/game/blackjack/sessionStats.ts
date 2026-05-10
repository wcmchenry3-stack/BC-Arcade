// Per-session counters that drive the Blackjack scoreboard variant. Counters
// are derived in BlackjackGameContext at hand-resolved transitions and reset
// on session boundaries (startSession + handlePlayAgain). Persistence is
// intentionally out of scope here — sessionStats are an in-memory derivation
// of the current 1000-chip allocation; restart wipes them.

export type HandOutcome = "blackjack" | "win" | "lose" | "push";

export interface SessionStats {
  /** Chips the session started with — used to compute P/L. */
  readonly startingChips: number;
  /** Latest chip balance, mirrors engine.chips at the most recent hand. */
  readonly chips: number;
  /** chips - startingChips. Positive = winning the session, negative = losing. */
  readonly plChips: number;
  readonly handsPlayed: number;
  readonly handsWon: number;
  readonly handsLost: number;
  readonly handsPushed: number;
  readonly blackjacks: number;
  /** Player-bust losses (hand > 21). Subset of handsLost. */
  readonly busts: number;
  /** Largest single positive payout delta in the session (0 if no wins). */
  readonly biggestWin: number;
  /** Current consecutive-win count; resets to 0 on any non-win outcome. */
  readonly winStreak: number;
}

export function initialSessionStats(startingChips: number): SessionStats {
  return {
    startingChips,
    chips: startingChips,
    plChips: 0,
    handsPlayed: 0,
    handsWon: 0,
    handsLost: 0,
    handsPushed: 0,
    blackjacks: 0,
    busts: 0,
    biggestWin: 0,
    winStreak: 0,
  };
}

export interface HandResolvedArgs {
  readonly outcome: HandOutcome;
  readonly payoutDelta: number;
  readonly chipsAfter: number;
  /** True when the loss was caused by the player's hand exceeding 21. */
  readonly isBust: boolean;
}

export function reduceHandResolved(prev: SessionStats, args: HandResolvedArgs): SessionStats {
  const { outcome, payoutDelta, chipsAfter, isBust } = args;
  const isWin = outcome === "win" || outcome === "blackjack";
  const isLose = outcome === "lose";
  const isPush = outcome === "push";
  const isBlackjack = outcome === "blackjack";
  return {
    ...prev,
    chips: chipsAfter,
    plChips: chipsAfter - prev.startingChips,
    handsPlayed: prev.handsPlayed + 1,
    handsWon: prev.handsWon + (isWin ? 1 : 0),
    handsLost: prev.handsLost + (isLose ? 1 : 0),
    handsPushed: prev.handsPushed + (isPush ? 1 : 0),
    blackjacks: prev.blackjacks + (isBlackjack ? 1 : 0),
    busts: prev.busts + (isLose && isBust ? 1 : 0),
    biggestWin: payoutDelta > prev.biggestWin ? payoutDelta : prev.biggestWin,
    winStreak: isWin ? prev.winStreak + 1 : 0,
  };
}
