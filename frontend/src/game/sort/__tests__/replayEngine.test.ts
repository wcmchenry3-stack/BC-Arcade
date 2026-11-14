/**
 * Sort's version-aware reader entry point, `rebuildRecorded` (#3912): the current
 * version and a `game_started` without the field rebuild with today's pour rules,
 * an older version registered with `withLegacy` (a test-only fake) rebuilds with
 * its own rules and not today's, and an unknown version rebuilds nothing.
 */

import { initState } from "../engine";
import {
  REPLAY_ENGINES,
  SORT_REPLAY_ENGINE_VERSION,
  pourEntry,
  rebuild,
  rebuildRecorded,
  type Action,
  type RebuildResult,
} from "../replay";
import type { SortState } from "../types";

/** red red red / red / (empty): one pour 1 -> 0 solves it. */
const OPENING: SortState = initState([["red", "red", "red"], ["red"], []]);
const ACTIONS: readonly Action[] = [pourEntry(1, 0)];
const START = { level: 1, catalog: 1 };

describe("sort rebuildRecorded by engine_version (#3912)", () => {
  it.each([[{ ...START, engine_version: SORT_REPLAY_ENGINE_VERSION }], [START], [undefined]])(
    "rebuilds with today's rules for the current version or a missing one (%j)",
    (started) => {
      const r = rebuildRecorded(started, OPENING, ACTIONS);
      expect(r.incompatible).toBeUndefined();
      expect(r).toEqual(rebuild(OPENING, ACTIONS));
      expect(r.incompatible === undefined && r.state.bottles[0]).toHaveLength(4);
    }
  );

  it("rebuilds an older, still-supported version with its frozen rules, not today's", () => {
    const calls: unknown[] = [];
    const frozen: RebuildResult = { state: OPENING, history: [] };
    const engines = REPLAY_ENGINES.withLegacy(0, {
      rebuild: (opening, actions) => {
        calls.push([opening, actions]);
        return frozen;
      },
    });
    expect(rebuildRecorded({ ...START, engine_version: 0 }, OPENING, ACTIONS, engines)).toBe(
      frozen
    );
    expect(calls).toEqual([[OPENING, ACTIONS]]);
    const today = rebuildRecorded({ ...START, engine_version: 1 }, OPENING, ACTIONS, engines);
    expect(today).not.toBe(frozen);
    expect(calls).toHaveLength(1);
  });

  it.each([2, 0, "1", null, true])(
    "rebuilds nothing for engine_version %j and says why",
    (version) => {
      const r = rebuildRecorded({ ...START, engine_version: version }, OPENING, ACTIONS);
      expect(r.incompatible).toMatch(
        /^incompatible engine: engine_version .*, this reader rebuilds 1$/
      );
      expect(r).not.toHaveProperty("state");
      expect(r).not.toHaveProperty("history");
    }
  );
});
