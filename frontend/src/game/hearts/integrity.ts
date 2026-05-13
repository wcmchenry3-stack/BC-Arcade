/**
 * Hearts state-integrity validators (#745).
 *
 * Pure checks over a HeartsState that catch impossibilities — score
 * conservation, accumulator drift, spurious Game Over — and emit Sentry
 * warnings so silent corruption doesn't ship past us. Tab-switch state loss
 * (the same issue this module accompanies) was caught by exactly this kind
 * of cross-check after the fact.
 *
 * Pure module: no React, no AsyncStorage. Sentry is the only side effect.
 */

import * as Sentry from "@sentry/react-native";
import { detectMoon } from "./engine";
import type { HeartsState } from "./types";

const HAND_TOTAL_POINTS = 26;

/**
 * Stable string keys for each invariant. Used by the dedupe layer in
 * createIntegrityReporter so a single corrupt game logs each class once
 * instead of once per state update.
 */
type CheckKey =
  | "round_sum_ne_26"
  | "round_player_over_26"
  | "totals_vs_rounds_mismatch"
  | "rounds_vs_handnumber_mismatch"
  | "spurious_game_over";

interface Finding {
  readonly key: CheckKey;
  readonly message: string;
  readonly extra: Record<string, unknown>;
}

/**
 * Run all integrity checks and return any findings. Pure — caller decides
 * whether to report (createIntegrityReporter dedupes per-mount).
 *
 * Note on moon shots: a moon round's applied delta is [0,26,26,26] (or rotated),
 * which sums to 78, not 26. We detect that case via wonCards and skip the
 * "row sum != 26" / "row entry > 26" checks for the most-recent round when
 * the wonCards still reflect a moon. We can't retroactively classify older
 * rows, so we accept any row whose entries are exactly one 0 and three 26s
 * as a moon row.
 */
export function checkHeartsIntegrity(state: HeartsState): readonly Finding[] {
  const findings: Finding[] = [];
  const { scoreHistory, cumulativeScores, handNumber, phase, handScores } = state;

  // ── Per-round checks ────────────────────────────────────────────────────
  for (let r = 0; r < scoreHistory.length; r++) {
    const row = scoreHistory[r] ?? [];
    if (row.length !== 4) continue;
    const sum = row.reduce<number>((s, v) => s + v, 0);
    const isMoon =
      sum === 78 &&
      row.filter((v) => v === 0).length === 1 &&
      row.filter((v) => v === 26).length === 3;
    if (!isMoon) {
      if (sum !== HAND_TOTAL_POINTS) {
        findings.push({
          key: "round_sum_ne_26",
          message: "hearts.integrity: round-row sum != 26 (and not a moon)",
          extra: { round: r + 1, row, sum, handNumber },
        });
      }
      for (let i = 0; i < row.length; i++) {
        const v = row[i] ?? 0;
        if (v > HAND_TOTAL_POINTS) {
          findings.push({
            key: "round_player_over_26",
            message: "hearts.integrity: per-player round score > 26",
            // handScores reflects the current hand's accumulated points; when the
            // corrupt row is the most-recently completed hand (before dealNextHand
            // resets it), this captures the raw accumulator that produced the bad delta.
            extra: {
              round: r + 1,
              playerIndex: i,
              score: v,
              handNumber,
              handScores: [...(handScores ?? [])],
            },
          });
          break; // one per round
        }
      }
    }
  }

  // ── Totals-vs-rounds reconciliation ────────────────────────────────────
  // sum(scoreHistory[*][i]) MUST equal cumulativeScores[i] for every player.
  // This is the check that would have caught the original tab-switch bug.
  const computed = [0, 0, 0, 0];
  for (const row of scoreHistory) {
    for (let i = 0; i < 4; i++) {
      computed[i] = (computed[i] ?? 0) + (row[i] ?? 0);
    }
  }
  const mismatches: number[] = [];
  for (let i = 0; i < cumulativeScores.length; i++) {
    if ((cumulativeScores[i] ?? 0) !== (computed[i] ?? 0)) mismatches.push(i);
  }
  if (mismatches.length > 0) {
    findings.push({
      key: "totals_vs_rounds_mismatch",
      message: "hearts.integrity: totals-vs-rounds mismatch",
      extra: {
        cumulativeScores: [...cumulativeScores],
        computedFromHistory: computed,
        mismatchPlayerIndexes: mismatches,
        roundsRecorded: scoreHistory.length,
        handNumber,
      },
    });
  }

  // ── scoreHistory length vs handNumber ──────────────────────────────────
  // Once a hand finishes (phase: dealing|game_over), scoreHistory.length should
  // equal handNumber. After dealNextHand bumps handNumber, length === handNumber - 1.
  // Allow either, but flag clear divergence (e.g. handNumber 14 with 0 rows).
  if (phase === "playing" || phase === "passing") {
    const expected = handNumber - 1;
    if (scoreHistory.length !== expected) {
      findings.push({
        key: "rounds_vs_handnumber_mismatch",
        message: "hearts.integrity: scoreHistory length vs handNumber mismatch",
        extra: { scoreHistoryLength: scoreHistory.length, handNumber, expected },
      });
    }
  }

  // ── Spurious Game Over ─────────────────────────────────────────────────
  if (
    phase === "game_over" &&
    handNumber === 1 &&
    scoreHistory.length === 0 &&
    cumulativeScores.some((s) => s >= 100)
  ) {
    findings.push({
      key: "spurious_game_over",
      message: "hearts.integrity: game_over on hand 1 with empty scoreHistory",
      extra: {
        cumulativeScores: [...cumulativeScores],
        handNumber,
        moonShooter: detectMoon(state.wonCards),
      },
    });
  }

  return findings;
}

/**
 * Per-mount reporter. Returns a function that runs the validators and emits
 * Sentry warnings, deduped so each invariant logs at most once per mount.
 *
 * Player names are intentionally not included in `extra` — they may be user-
 * entered and are not needed to diagnose state drift.
 */
export function createIntegrityReporter(): (state: HeartsState) => void {
  const fired = new Set<CheckKey>();

  return (state: HeartsState) => {
    const findings = checkHeartsIntegrity(state);
    for (const f of findings) {
      if (fired.has(f.key)) continue;
      fired.add(f.key);
      Sentry.captureMessage(f.message, {
        level: "warning",
        tags: { subsystem: "hearts.integrity", check: f.key },
        extra: f.extra,
      });
    }
  };
}
