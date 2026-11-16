/**
 * #3700 plausibility floor (scratch branch): the skilled bot's placement with no patience, dropping
 * as fast as the screen allows (its 200 ms cooldown, gated only by the lid), to bound the fastest
 * win a human could make. Also prints the queue's mean drop value (2^tier) for the theory bound.
 * Usage: npx --prefix frontend tsx tools/sim/cascade-3700-fast.ts <firstSeed> <lastSeed> <gapMs>
 */
import { BOTS, type Bot } from "../../frontend/src/game/cascade/sim/bots";
import { runGame } from "../../frontend/src/game/cascade/sim/runGame";
import { sampleQueue } from "../../frontend/src/game/cascade/sim/queueSampler";

const [a, b, gap] = process.argv.slice(2);
const gapMs = Number(gap);
const fast: Bot = {
  name: `fast${gapMs}`,
  nextDelayMs: () => gapMs,
  shouldTap: (view) => view.canDrop,
  chooseX: BOTS.skilled!.chooseX,
};
if (a === "queue") {
  const s = sampleQueue(200, 2000, false);
  const mean = s.share.reduce((acc, p, t) => acc + p * 2 ** t, 0);
  process.stdout.write(JSON.stringify({ share: s.share, meanValue: mean }) + "\n");
} else {
  for (let seed = Number(a); seed <= Number(b); seed++) {
    const m = runGame({ seed, hz: 60, bot: fast, maxSimMs: 600_000 });
    process.stdout.write(
      JSON.stringify({
        seed,
        bot: fast.name,
        outcome: m.won ? "win" : m.endedBy === "cap" ? "cap" : "loss",
        score: m.score,
        simMs: Math.round(m.simMs),
        timeToWinMs: m.timeToWinMs === null ? null : Math.round(m.timeToWinMs),
        topTier: m.topTier,
        merges: m.merges,
        drops: m.drops,
        dropsByTier: m.dropsByTier,
      }) + "\n"
    );
  }
}
