// Pure helpers for the Blackjack scorecard (live view). Mirrors yachtScorecardModel.ts
// — no React/theme imports so the formatting + colour logic is unit-testable.

import type { SessionStats } from "../../game/blackjack/sessionStats";

interface PLColors {
  readonly bonus: string;
  readonly error: string;
  readonly text: string;
}

/** Sign-driven colour for the hero P/L number. */
export function plColor(plChips: number, colors: PLColors): string {
  if (plChips > 0) return colors.bonus;
  if (plChips < 0) return colors.error;
  return colors.text;
}

/** Signed thousands-separated chip delta. "+1,240" / "−320" / "0". */
export function formatPL(plChips: number): string {
  if (plChips === 0) return "0";
  const abs = Math.abs(plChips).toLocaleString("en-US");
  return plChips > 0 ? `+${abs}` : `−${abs}`;
}

/**
 * Win rate as a 0–100 percentage (rounded). Returns null when no hands have
 * been played, so callers can render a zero-state instead of "NaN%" / "0%".
 */
export function winRatePct(stats: SessionStats): number | null {
  if (stats.handsPlayed === 0) return null;
  return Math.round((stats.handsWon / stats.handsPlayed) * 100);
}
