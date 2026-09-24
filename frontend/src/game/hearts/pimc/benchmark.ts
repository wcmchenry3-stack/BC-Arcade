/**
 * On-device latency benchmark for the PIMC engine (#2587, step 1).
 *
 * The #2240 spike timed PIMC in Node on a dev machine only; the engine has
 * to fit a phone's budget (under 1 s per move, aiming for under 250 ms).
 * This collects real decision points from seeded all-Schemer games and times
 * the engine on each at several sample counts, reporting the median, p95
 * and worst case. It is reachable from the Hearts debug panel in dev and
 * internal test builds, so it can run under Hermes on real hardware.
 *
 * Async: it yields to the event loop between moves so the UI stays live.
 */

import { selectCardToPlay, selectCardsToPass } from "../ai";
import {
  commitPass,
  createSeededRng,
  dealGame,
  dealNextHand,
  getRng,
  playCard,
  selectPassCard,
  setRng,
} from "../engine";
import type { HeartsState } from "../types";
import { pimcChooseCard, type PimcConfig } from "./engine";

export interface LatencyRow {
  readonly samples: number;
  readonly decisions: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

export interface BenchmarkOptions {
  /** Sample counts to time. */
  readonly sampleCounts?: readonly number[];
  /** Decision points timed per sample count. */
  readonly decisions?: number;
  readonly horizon?: PimcConfig["horizon"];
  readonly seed?: number;
  /** Called after each timed move, with (done, total). */
  readonly onProgress?: (done: number, total: number) => void;
  /** Clock in ms (injectable for tests). */
  readonly now?: () => number;
  /** Polled between moves: return true to stop early (rows so far are returned). */
  readonly cancelled?: () => boolean;
}

const clock = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

/**
 * Decision points from seeded all-Schemer games: every seat-1 play with at
 * least two legal cards, until `count` are collected.
 */
export function collectDecisions(count: number, seed = 2587): HeartsState[] {
  const outer = getRng();
  const out: HeartsState[] = [];
  try {
    setRng(createSeededRng(seed));
    let state = dealGame("schemer");
    while (out.length < count) {
      if (state.phase === "passing") {
        for (let seat = 0; seat < 4; seat++) {
          const hand = [...(state.playerHands[seat] ?? [])];
          for (const card of selectCardsToPass(hand, state.passDirection, "schemer", seat)) {
            state = selectPassCard(state, seat, card);
          }
        }
        state = commitPass(state);
      } else if (state.phase === "playing") {
        const seat = state.currentPlayerIndex;
        const hand = [...(state.playerHands[seat] ?? [])];
        if (seat === 1 && hand.length > 1) out.push(state);
        state = playCard(
          state,
          seat,
          selectCardToPlay(hand, [...state.currentTrick], state, seat, "schemer")
        );
      } else if (state.phase === "dealing") {
        state = dealNextHand(state);
      } else {
        state = dealGame("schemer");
      }
    }
  } finally {
    setRng(outer);
  }
  return out;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, i)]!;
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Time the engine per sample count; one row per count (fewer if cancelled). */
export async function runPimcBenchmark(options: BenchmarkOptions = {}): Promise<LatencyRow[]> {
  const counts = options.sampleCounts ?? [16, 32, 64];
  const n = options.decisions ?? 30;
  const now = options.now ?? clock;
  const states = collectDecisions(n, options.seed);
  const total = counts.length * states.length;
  const rows: LatencyRow[] = [];
  let done = 0;
  for (const samples of counts) {
    const config: PimcConfig = {
      samples,
      horizon: options.horizon ?? "hand",
      inference: true,
      rolloutPersona: "schemer",
    };
    const times: number[] = [];
    for (const [i, state] of states.entries()) {
      if (options.cancelled?.()) return rows;
      const rng = createSeededRng(samples * 1000 + i);
      const t0 = now();
      pimcChooseCard(state, config, rng);
      times.push(now() - t0);
      options.onProgress?.(++done, total);
      await yieldToUi();
    }
    times.sort((a, b) => a - b);
    rows.push({
      samples,
      decisions: times.length,
      p50: percentile(times, 0.5),
      p95: percentile(times, 0.95),
      max: times[times.length - 1] ?? 0,
    });
  }
  return rows;
}
