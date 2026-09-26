// Pure helpers for the Yacht scorecard (live view). Mirrors heartsRoundsModel.ts
// — kept independent of React + theme so layout-free logic is unit-testable.

export const UPPER_BONUS_THRESHOLD = 63;
export const UPPER_BONUS_VALUE = 35;

const UPPER_CATEGORIES = ["ones", "twos", "threes", "fours", "fives", "sixes"] as const;

export function upperSum(scores: Readonly<Record<string, number | null>>): number {
  let sum = 0;
  for (const cat of UPPER_CATEGORIES) {
    const v = scores[cat];
    if (v != null) sum += v;
  }
  return sum;
}

/** How many more points are needed to earn the +35 upper bonus. Clamps to 0. */
export function bonusCountdown(currentUpperSum: number): number {
  return Math.max(0, UPPER_BONUS_THRESHOLD - currentUpperSum);
}

/** Whether the +35 upper bonus has been earned at the current upper sum. */
export function bonusEarned(currentUpperSum: number): boolean {
  return currentUpperSum >= UPPER_BONUS_THRESHOLD;
}

export type WinnerColumn = "you" | "opp" | "tie";

/** Which side's total wins — drives `colors.bonus` highlighting on the totals. */
export function winnerColumn(youTotal: number, oppTotal: number): WinnerColumn {
  if (youTotal > oppTotal) return "you";
  if (oppTotal > youTotal) return "opp";
  return "tie";
}
