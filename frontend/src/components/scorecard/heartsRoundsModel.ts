// Pure helpers powering the Hearts scorecard (live view). Kept independent of
// React + theme so the rendering logic can be unit-tested without a tree.

export interface SeatStanding {
  /** Index of the player with the lowest cumulative score (Hearts: low = good). */
  readonly leaderIndex: number;
  /** Index of the player with the highest cumulative score. */
  readonly losingIndex: number;
}

export function computeStandings(cumulativeScores: readonly number[]): SeatStanding {
  let leaderIndex = 0;
  let losingIndex = 0;
  for (let i = 1; i < cumulativeScores.length; i++) {
    const v = cumulativeScores[i] ?? 0;
    if (v < (cumulativeScores[leaderIndex] ?? 0)) leaderIndex = i;
    if (v > (cumulativeScores[losingIndex] ?? 0)) losingIndex = i;
  }
  return { leaderIndex, losingIndex };
}

export function progressFraction(total: number): number {
  return Math.max(0, Math.min(1, total / 100));
}

interface ScoreColors {
  readonly bonus: string;
  readonly error: string;
  readonly text: string;
}

/** Score text color per spec: bonus for leader, error for losing seat, text otherwise. */
export function scoreColor(index: number, standing: SeatStanding, colors: ScoreColors): string {
  if (index === standing.leaderIndex) return colors.bonus;
  if (index === standing.losingIndex) return colors.error;
  return colors.text;
}

interface BarColors {
  readonly error: string;
  readonly bonus: string;
  readonly accent: string;
}

/** Bar fill per spec: error wins ≥80, then bonus for leader, else accent. */
export function barColor(
  index: number,
  total: number,
  standing: SeatStanding,
  colors: BarColors
): string {
  if (total >= 80) return colors.error;
  if (index === standing.leaderIndex) return colors.bonus;
  return colors.accent;
}

/**
 * Detect a moon-shot row. We expect the *applied* per-round delta where the
 * shooter scored 0 and the other three scored 26. Unambiguous: any other
 * score combination is impossible for a four-player Hearts moon.
 */
export function detectMoonInRow(row: readonly number[]): { shooterIndex: number } | null {
  if (row.length !== 4) return null;
  let zeroIndex = -1;
  let zeros = 0;
  let twentySixes = 0;
  for (let i = 0; i < 4; i++) {
    const v = row[i] ?? 0;
    if (v === 0) {
      zeros++;
      zeroIndex = i;
    } else if (v === 26) {
      twentySixes++;
    } else {
      return null;
    }
  }
  return zeros === 1 && twentySixes === 3 ? { shooterIndex: zeroIndex } : null;
}
