/**
 * The bet rules the table's dock enforces before it offers a bet (#3580): the
 * same rules `placeBet` (engine.ts) enforces, so a button is only live when the
 * engine would take its bet. Pure; no engine change.
 */
import type { EngineState } from "./engine";

export interface BetLimits {
  readonly chips: number;
  readonly betMin: number;
  readonly betMax: number;
}

/** The smallest legal bet: the table minimum, or all-in on a short stack (chips < min). */
export function minBet(l: BetLimits): number {
  return l.chips < l.betMin ? l.chips : l.betMin;
}

/** The largest legal bet: the table maximum, or the whole stack when that is less. */
export function maxBet(l: BetLimits): number {
  return Math.min(l.betMax, l.chips);
}

/** True when `placeBet` would accept `amount`. */
export function isLegalBet(amount: number, l: BetLimits): boolean {
  return l.chips > 0 && amount > 0 && amount >= minBet(l) && amount <= maxBet(l);
}

/**
 * The chips the tray offers: the table's denominations, or one all-in chip of
 * the whole stack when it is below the table minimum (the only legal bet then).
 */
export function trayChips(denominations: readonly number[], l: BetLimits): readonly number[] {
  if (l.chips <= 0) return denominations;
  return l.chips < l.betMin ? [l.chips] : denominations;
}

/**
 * The stake the last hand was dealt with, before any double down (Rebet deals
 * this again, 2× twice this). A split keeps the opening stake in `bet`; a
 * double on a hand that was not split doubles `bet` and sets `doubled`.
 */
export function lastStake(s: Pick<EngineState, "bet" | "doubled">): number {
  return s.doubled ? Math.round(s.bet / 2) : s.bet;
}

/** Rebet and 2× after a result: their amounts, and whether the engine would take them. */
export function quickBets(
  s: Pick<EngineState, "bet" | "doubled" | "chips" | "betMin" | "betMax">
): { rebet: number; rebetAllowed: boolean; double: number; doubleAllowed: boolean } {
  const stake = lastStake(s);
  return {
    rebet: stake,
    rebetAllowed: isLegalBet(stake, s),
    double: stake * 2,
    doubleAllowed: isLegalBet(stake * 2, s),
  };
}
