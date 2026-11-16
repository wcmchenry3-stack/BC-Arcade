/**
 * #3700 time-bonus proposal (scratch branch): play seeded Cascade games with the dev engine and
 * print one JSON line per game (outcome, merge score, time, max tier, merges, drops).
 * Usage: npx --prefix frontend tsx tools/sim/cascade-3700-worker.ts <bot> <firstSeed> <lastSeed> <hz> <maxSimMs>
 */
import { BOTS } from "../../frontend/src/game/cascade/sim/bots";
import { runGame } from "../../frontend/src/game/cascade/sim/runGame";

const [bot, a, b, hz, maxMs] = process.argv.slice(2);
for (let seed = Number(a); seed <= Number(b); seed++) {
  const m = runGame({
    seed,
    hz: Number(hz) as 60 | 120,
    bot: BOTS[bot!]!,
    maxSimMs: Number(maxMs),
  });
  const out = {
    seed,
    bot,
    hz: m.hz,
    endedBy: m.endedBy,
    outcome: m.won ? "win" : m.endedBy === "cap" ? "cap" : "loss",
    score: m.score,
    simMs: Math.round(m.simMs),
    timeToWinMs: m.timeToWinMs === null ? null : Math.round(m.timeToWinMs),
    topTier: m.topTier,
    merges: m.merges,
    drops: m.drops,
    tierFirstMs: m.tierFirstMs.map((x) => (x === null ? null : Math.round(x))),
  };
  process.stdout.write(JSON.stringify(out) + "\n");
}
