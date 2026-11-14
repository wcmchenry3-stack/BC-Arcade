/**
 * #3904 proposals (scratch branch): play seeded Cascade games with the variant in
 * CASCADE_VARIANT (JSON, see frontend/src/game/cascade/variant.ts) and print one JSON line per
 * game. Usage: CASCADE_VARIANT='{...}' npx tsx tools/sim/cascade-3904-worker.ts \
 *   <bot> <firstSeed> <lastSeed> <hz> <maxSimMs> <stopOnWin 0|1>
 */
import { BOTS } from "../../frontend/src/game/cascade/sim/bots";
import { runGame } from "../../frontend/src/game/cascade/sim/runGame";

const [bot, a, b, hz, maxMs, stop] = process.argv.slice(2);
for (let seed = Number(a); seed <= Number(b); seed++) {
  const m = runGame({
    seed,
    hz: Number(hz) as 60 | 120,
    bot: BOTS[bot!]!,
    maxSimMs: Number(maxMs),
    stopOnWin: stop === "1",
  });
  const lat = [...m.feel.chainLatencyMs].sort((x, y) => x - y);
  const out = {
    seed,
    bot,
    hz: m.hz,
    simMs: m.simMs,
    endedBy: m.endedBy,
    won: m.won,
    timeToWinMs: m.timeToWinMs,
    topTier: m.topTier,
    drops: m.drops,
    merges: m.merges,
    capstoneFirstMs: m.tierFirstMs[11],
    tierFirstMs: m.tierFirstMs,
    maxPieces: m.maxPieces,
    packing: m.feel.packingDensity,
    gapMean: m.feel.gapMeanPx,
    gapMax: m.feel.gapMaxPx,
    overlapMax: m.feel.overlapMaxPx,
    settleDrop: m.feel.settleAfterDropMs,
    settleChain: m.feel.settleAfterChainMs,
    jitter: m.feel.jitterPxPerS,
    guardRails: m.feel.guardRailEvents,
    wallDepthMax: m.feel.wallDepthMaxPx,
    chainLatP90: lat.length ? lat[Math.floor(lat.length * 0.9)] : null,
    chainLatMax: lat.length ? lat[lat.length - 1] : null,
    chainN: lat.length,
    chainMisses: m.feel.chainMisses,
    cost: m.cost,
  };
  process.stdout.write(JSON.stringify(out) + "\n");
}
