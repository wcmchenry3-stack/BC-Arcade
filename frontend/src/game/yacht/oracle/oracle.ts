/**
 * Yacht runtime oracle — public API (#2243).
 *
 * Shipped, lazy-loaded: `oracleTable.generated.ts` (the precomputed ~786K-
 * entry EV table, built offline by `scripts/build-yacht-oracle.ts`) is
 * `require()`d lazily inside `loadTable()`, not imported at module top-level
 * — its multi-MB base64 payload is never parsed/decoded during app startup,
 * only when a caller actually asks the oracle something. A lazy `require()`
 * (rather than dynamic `import()`) is deliberate: it defers evaluation
 * identically, but works in both Jest (no --experimental-vm-modules needed)
 * and Metro without relying on dynamic-import support in either bundler.
 *
 * `optimalStateEV` is an O(1) table lookup. `optimalCategoryEVs` and
 * `optimalHoldEVs` evaluate a fresh per-roll micro-DP (`./microDp.ts`) —
 * the SAME shared logic the offline solver used to build the table, just
 * run for one specific dice roll instead of averaged over all 252 — so
 * these are not literally O(1), but bounded (≤252 multisets × ≤32 holds)
 * and fast; see docs/YACHT_ORACLE.md for a measured figure.
 */

import type { Category } from "../engine";
import type { GameState } from "../types";
import { keyFromGameState, legalCategoriesFor, successorAfterScore } from "./stateKey";
import { buildHoldOptions, indexOfDice, type HoldOption } from "./multisetIndex";
import { computeArr0, computeHoldLayer } from "./microDp";

// ---------------------------------------------------------------------------
// Lazy singletons — table load and hold-options build each happen at most
// once per app session, cached for every subsequent query.
// ---------------------------------------------------------------------------

let tablePromise: Promise<Float32Array> | null = null;
let holdOptionsCache: readonly (readonly HoldOption[])[] | null = null;

/**
 * Decode a base64-encoded Float32Array payload. Uses `atob` (not `Buffer`)
 * to match the app's existing cross-platform base64 convention (see
 * EntitlementContext.tsx's JWT decoding) — works identically in Jest/Node
 * and Hermes/React Native without a platform split.
 */
export function decodeFloat32Table(base64: string, length: number): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer, 0, length);
}

async function loadTable(): Promise<Float32Array> {
  if (!tablePromise) {
    tablePromise = Promise.resolve().then(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require is the point: defer eval until first real use, see module doc
      const mod = require("./oracleTable.generated") as {
        ORACLE_TABLE_SIZE: number;
        ORACLE_TABLE_BASE64: string;
      };
      return decodeFloat32Table(mod.ORACLE_TABLE_BASE64, mod.ORACLE_TABLE_SIZE);
    });
  }
  return tablePromise;
}

function getHoldOptions(): readonly (readonly HoldOption[])[] {
  if (!holdOptionsCache) holdOptionsCache = buildHoldOptions();
  return holdOptionsCache;
}

/** True once the oracle table has resolved — for UI "still loading" states. */
export function isOracleTableLoaded(): boolean {
  return tablePromise !== null;
}

/** Force-start loading the table without waiting for a query — call this
 * ahead of time (e.g. when Hard difficulty is selected) to avoid the first
 * real query paying the load latency. */
export function preloadOracleTable(): Promise<void> {
  return loadTable().then(() => undefined);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Expected FINAL total score achievable from `state`'s current scorecard
 * under optimal play. This is "value to go" — it does NOT include points
 * already scored (see stateKey.ts's module doc for why the table is
 * structured that way). O(1) once the table is loaded.
 */
export async function optimalStateEV(state: GameState): Promise<number> {
  const table = await loadTable();
  const key = keyFromGameState(state.scores);
  return table[key]!;
}

/**
 * EV of scoring each currently-legal category with `dice` (joker-aware —
 * legality and scoring both go through the same rules stateKey.ts shares
 * with the offline solver).
 */
export async function optimalCategoryEVs(
  state: GameState,
  dice: readonly number[]
): Promise<Partial<Record<Category, number>>> {
  const table = await loadTable();
  const key = keyFromGameState(state.scores);
  const legal = legalCategoriesFor(key, dice);

  const out: Partial<Record<Category, number>> = {};
  for (const category of legal) {
    const { scoreDelta, nextKey } = successorAfterScore(key, category, dice);
    out[category] = scoreDelta + table[nextKey]!;
  }
  return out;
}

export interface HoldEV {
  /** Dice values kept under this hold (sorted, length 0-5). */
  readonly hold: readonly number[];
  /** Expected value of choosing this hold, under optimal subsequent play. */
  readonly ev: number;
}

/**
 * EV of every legal hold decision on `dice`, given `rerollsLeft` (1 or 2)
 * remaining this turn.
 */
export async function optimalHoldEVs(
  state: GameState,
  dice: readonly number[],
  rerollsLeft: 1 | 2
): Promise<readonly HoldEV[]> {
  const table = await loadTable();
  const key = keyFromGameState(state.scores);
  const holdOptions = getHoldOptions();

  const arr0 = computeArr0(key, (nextKey) => table[nextKey]!);
  const source = rerollsLeft === 1 ? arr0 : computeHoldLayer(arr0, holdOptions);

  const diceIndex = indexOfDice(dice);
  if (diceIndex === undefined) {
    throw new Error(`optimalHoldEVs: ${JSON.stringify(dice)} is not a valid 5-dice roll`);
  }

  return holdOptions[diceIndex]!.map((option) => {
    let ev = 0;
    for (const t of option.transitions) ev += t.weight * source[t.targetIndex]!;
    return { hold: option.keptValues, ev };
  });
}
