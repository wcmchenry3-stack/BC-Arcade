/**
 * Which rules replay a recorded game: its `engine_version` (#3912, epic #3273).
 *
 * Every game that records its play puts an integer `engine_version` in its
 * `game_started` data (#3909). Each game's `replay.ts` exports `REPLAY_ENGINES`,
 * built here: the version it records today with today's rules, and any older
 * version still supported with that version's frozen rules (`withLegacy`). The
 * registries are the contract for any frontend reader. Today two frontend
 * functions rebuild a game from its stored events, Daily Word's `rebuild` and
 * Sort's `rebuildRecorded`, and both resolve through them; the other games'
 * frontend replay code only applies single steps (their stored games are read by
 * the backend readers, `backend/games/engine_version.py`). A new frontend
 * rebuilder must resolve first. A reader resolves the game's `game_started` data
 * and gets one of three answers:
 *
 *  - `current`: today's version, replayed with today's rules;
 *  - `legacy`: an older version still supported, replayed with its frozen rules;
 *  - `incompatible`: any other value (unknown, sunset, not an integer). The
 *    reader rebuilds nothing and shows `reason` ("incompatible engine:
 *    engine_version X, this reader rebuilds Y"), never a plausible but wrong board.
 *
 * A `game_started` without the field, or no `game_started` at all, is version 1
 * (`MISSING_ENGINE_VERSION`): builds from before the field recorded version-1
 * rules. A field that is present but null is not missing: it is incompatible.
 *
 * Policy (#3908): when a rule change bumps a game's version, its old-rules path
 * stays registered (with its frozen fixture) for at least REPLAY_RETENTION_DAYS
 * (30) after the new version is the only one in production; after that it may be
 * removed, and its version then reads as incompatible.
 *
 * The backend twin is `backend/games/engine_version.py` (same cases, same
 * wording). Reading only: nothing here changes what is recorded or uploaded.
 */

/** The version of a `game_started` without `engine_version` (a build from before #3909). */
export const MISSING_ENGINE_VERSION = 1;

export type EngineResolution<R> =
  | { readonly kind: "current"; readonly version: number; readonly rules: R }
  | { readonly kind: "legacy"; readonly version: number; readonly rules: R }
  | { readonly kind: "incompatible"; readonly version: unknown; readonly reason: string };

/** One game's replayable versions: `current` and any older ones still supported. */
export interface ReplayEngines<R> {
  readonly game: string;
  readonly current: number;
  /** Every version these rules replay, ascending. */
  readonly supported: readonly number[];
  /** Which rules replay a game whose `game_started` data is `started` (null/undefined: no event). */
  resolve(started: unknown): EngineResolution<R>;
  /** A copy that also replays the older `version` with `rules`. */
  withLegacy(version: number, rules: R): ReplayEngines<R>;
}

/**
 * A version is a non-negative integer. JS has one number type, so a recorded `1.0`
 * is the integer 1 here, while the backend twin (Python) reads `1.0` as a float and
 * so as incompatible. The app always records an int, so the two never disagree on
 * a real game; tests in both twins pin the difference.
 */
const isVersion = (x: unknown): x is number =>
  typeof x === "number" && Number.isInteger(x) && x >= 0;

/** What `printable` shows for a value it cannot serialise (too deep, a cycle). */
export const UNPRINTABLE = "<unprintable>";

/** A client-supplied value, safe to print: ASCII JSON, truncated (`printable` in the backend). */
function printable(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    // A deeply nested value overflows the stack (RangeError), a cycle throws a
    // TypeError; String() of the same value can throw too, so nothing else is tried.
    return UNPRINTABLE;
  }
  // JSON.stringify already escapes control characters; escape non-ASCII as Python's json does.
  text = text.replace(
    /[\u0080-\uffff]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
  return text.length <= 40 ? text : `${text.slice(0, 40)}...`;
}

/** The recorded `engine_version` as sent; `MISSING_ENGINE_VERSION` when there is none. */
export function engineVersionOf(started: unknown): unknown {
  if (started === null || typeof started !== "object" || Array.isArray(started)) {
    return MISSING_ENGINE_VERSION;
  }
  return "engine_version" in started
    ? (started as { engine_version: unknown }).engine_version
    : MISSING_ENGINE_VERSION;
}

/** The one wording every reader uses for a version it does not rebuild. */
export function incompatibleEngineReason(version: unknown, supported: readonly number[]): string {
  const have = [...supported].sort((a, b) => a - b).join(", ");
  return `incompatible engine: engine_version ${printable(version)}, this reader rebuilds ${have}`;
}

function build<R>(game: string, current: number, rules: ReadonlyMap<number, R>): ReplayEngines<R> {
  if (!isVersion(current) || !rules.has(current)) {
    throw new Error(`${game}: no rules for the current engine_version`);
  }
  const supported = [...rules.keys()].sort((a, b) => a - b);
  return {
    game,
    current,
    supported,
    resolve(started) {
      const version = engineVersionOf(started);
      if (isVersion(version) && rules.has(version)) {
        const found = rules.get(version) as R;
        return version === current
          ? { kind: "current", version, rules: found }
          : { kind: "legacy", version, rules: found };
      }
      return {
        kind: "incompatible",
        version,
        reason: incompatibleEngineReason(version, supported),
      };
    },
    withLegacy(version, legacy) {
      if (!isVersion(version) || version === current) {
        throw new Error(`${game}: ${String(version)} cannot be a legacy engine_version`);
      }
      return build(game, current, new Map([...rules, [version, legacy]]));
    },
  };
}

/** `game`'s engines: today's version (`current`, the game's ENGINE_VERSION) replayed with `rules`. */
export function replayEngines<R>(game: string, current: number, rules: R): ReplayEngines<R> {
  return build(game, current, new Map([[current, rules]]));
}
