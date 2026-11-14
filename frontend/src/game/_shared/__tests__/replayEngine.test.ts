/**
 * The shared engine-version resolver (#3912): the current version replays, an
 * older version registered with `withLegacy` replays with its own rules, and any
 * other value is incompatible, worded as the backend (`games/engine_version.py`)
 * and Sort's reader word it. A missing field (or no `game_started`) is version 1.
 */

import {
  MISSING_ENGINE_VERSION,
  engineVersionOf,
  incompatibleEngineReason,
  replayEngines,
} from "../replayEngine";

const TODAY = { name: "today" };
const OLD = { name: "frozen v0" };
const engines = () => replayEngines("demo", 1, TODAY);

describe("replayEngines (#3912)", () => {
  it("replays the current version with today's rules", () => {
    expect(engines().resolve({ engine_version: 1 })).toEqual({
      kind: "current",
      version: 1,
      rules: TODAY,
    });
  });

  it("reads a missing field, or no game_started, as version 1", () => {
    expect(MISSING_ENGINE_VERSION).toBe(1);
    for (const started of [{}, { seed: 4 }, undefined, null]) {
      const r = engines().resolve(started);
      expect(r.kind).toBe("current");
      expect(r.kind !== "incompatible" && r.rules).toBe(TODAY);
    }
    expect(engineVersionOf({ engine_version: null })).toBeNull(); // present but null: not missing
  });

  it("replays an older version registered as legacy with its own rules", () => {
    const reg = engines().withLegacy(0, OLD);
    expect(reg.supported).toEqual([0, 1]);
    expect(reg.resolve({ engine_version: 0 })).toEqual({ kind: "legacy", version: 0, rules: OLD });
    expect(reg.resolve({ engine_version: 1 })).toEqual({
      kind: "current",
      version: 1,
      rules: TODAY,
    });
    expect(engines().supported).toEqual([1]); // withLegacy returns a copy
  });

  it.each([2, 0, -1, "1", null, true, false, 1.5, [1], { v: 1 }])(
    "reads engine_version %j as incompatible, with no rules",
    (version) => {
      const r = engines().resolve({ engine_version: version });
      expect(r.kind).toBe("incompatible");
      expect(r).not.toHaveProperty("rules");
      expect(r.version).toEqual(version);
      expect(r.kind === "incompatible" && r.reason).toMatch(
        /^incompatible engine: engine_version /
      );
    }
  );

  it("reads a sunset version (its rules removed) as incompatible", () => {
    expect(engines().withLegacy(0, OLD).resolve({ engine_version: 0 }).kind).toBe("legacy");
    expect(engines().resolve({ engine_version: 0 }).kind).toBe("incompatible");
  });

  it("words the reason as the backend and Sort's reader do", () => {
    const r = engines().resolve({ engine_version: 2 });
    expect(r.kind === "incompatible" && r.reason).toBe(
      "incompatible engine: engine_version 2, this reader rebuilds 1"
    );
    const s = engines().withLegacy(0, OLD).resolve({ engine_version: "x" });
    expect(s.kind === "incompatible" && s.reason).toBe(
      'incompatible engine: engine_version "x", this reader rebuilds 0, 1'
    );
    const long = incompatibleEngineReason("é".repeat(60), [1]);
    expect(long).toMatch(/^[\x20-\x7e]*$/); // client text is escaped (ASCII only) ...
    expect(long.endsWith("..., this reader rebuilds 1")).toBe(true); // ... and truncated
  });

  it("refuses bad registrations", () => {
    expect(() => engines().withLegacy(1, OLD)).toThrow(); // the current version is not legacy
    expect(() => engines().withLegacy(1.5, OLD)).toThrow();
    expect(() => replayEngines("demo", -1, TODAY)).toThrow();
  });
});
