/**
 * Yacht AI simulator smoke tests — the fast PR layer (#1601, #2245).
 *
 * Role: catch total breakage on every PR (the AI throws, produces invalid
 * scores, the dice mirroring breaks, or Hard stops beating Easy). About 140
 * games at ~1s each under Jest keeps this around two and a half minutes.
 *
 * Limits: these sample sizes can't detect balance drift, and can't order
 * Medium against Easy or Hard (a 20-game win rate has an SE of ~0.11). That is the job
 * of the scheduled calibration gate (sim/gate.ts, run nightly by
 * .github/workflows/yacht-sim-gate.yml and locally with
 * `npx tsx scripts/simulate-yacht.ts --gate`). See docs/TESTING.md.
 *
 * Both layers use the same harness (sim/harness.ts): per-player dice
 * streams, mirrored dice, and every matchup played in both turn orders.
 */

import { difficultyPolicy, runMatchup } from "../sim/harness";
import { summarize, type MatchupReport } from "../sim/stats";
import type { AiDifficulty } from "../types";

// Override via YACHT_SMOKE_BLOCKS for deeper local validation (4 games each).
const SMOKE_BLOCKS = process.env.YACHT_SMOKE_BLOCKS
  ? parseInt(process.env.YACHT_SMOKE_BLOCKS, 10)
  : 5;

// Hard vs Easy needs more games than the self-play checks to clear its
// threshold with margin — see the test below.
const ORDERING_BLOCKS = Math.max(SMOKE_BLOCKS, 25);

function smoke(a: AiDifficulty, b: AiDifficulty, seed: number, blocks: number): MatchupReport {
  return summarize(
    runMatchup({ a: difficultyPolicy(a), b: difficultyPolicy(b), blocks, mode: "paired", seed })
  );
}

describe("Yacht AI simulator smoke tests", () => {
  it("self-play completes with valid scores, and paired self-play is exactly symmetric", () => {
    for (const d of ["easy", "hard"] as const) {
      const run = runMatchup({
        a: difficultyPolicy(d),
        b: difficultyPolicy(d),
        blocks: SMOKE_BLOCKS,
        mode: "paired",
        seed: 1,
      });
      for (const g of run.blocks.flatMap((blk) => blk.games)) {
        for (const p of [g.a, g.b]) {
          expect(p.score).toBeGreaterThanOrEqual(0);
          // Max possible is 1,575 (every box maxed plus 12 joker bonuses);
          // a strong real game is well under 500.
          expect(p.score).toBeLessThan(1600);
        }
      }
      // With the same policy on both sides, game 3 of each paired block is
      // game 0 with the seats relabelled, so A's win rate is exactly 0.5.
      // Anything else means the mirroring or order swap is broken.
      expect(summarize(run).aWinRate.mean).toBe(0.5);
    }
  });

  it("Hard beats Easy", () => {
    // Measured true rate 61.9% (sim/gate.ts). Per-block SD ~0.245, so 25
    // blocks (100 games) give an SE of ~0.049 and 0.5 sits ~2.4 SE below the
    // true rate: this only fails if Hard has genuinely stopped beating Easy.
    expect(smoke("hard", "easy", 3, ORDERING_BLOCKS).aWinRate.mean).toBeGreaterThan(0.5);
  });
});
