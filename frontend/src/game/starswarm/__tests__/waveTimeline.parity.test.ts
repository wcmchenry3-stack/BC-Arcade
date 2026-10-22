/**
 * Star Swarm wave timeline: frontend/backend parity (#3393, after #3394).
 *
 * The `wave_timeline` v1 contract is written out in
 * `backend/tests/fixtures/starswarm_wave_timeline_v1.json`, which the backend's
 * `test_starswarm_wave_timeline.py` and `test_starswarm_wave_timeline_parity.py` read too. This
 * test holds the engine's code table, registries and limits (`engine/waveTimeline.ts`,
 * `engine/registries.ts`) and the paused-run restore's parameter ranges (`timelineSave.ts`) equal
 * to it; the fixture's valid examples measure, by the engine's byte arithmetic, exactly their
 * compact JSON; and a restore never brings back a timeline the backend would drop.
 * See docs/games/starswarm-diagnostics.md#contract-test-plan.
 */
// resolveJsonModule is enabled via expo/tsconfig.base.
// Path: 5 levels up from __tests__/ to the repo root, then into backend/tests/fixtures/.
import fixture from "../../../../../backend/tests/fixtures/starswarm_wave_timeline_v1.json";
import { CARRIER_STAGES, HIT_CAUSES, KILL_METHODS, POWERUP_TYPES } from "../engine";
import {
  TIMELINE_CODES,
  TIMELINE_ENGINE_VERSION,
  TIMELINE_MAX_BYTES,
  TIMELINE_MAX_ENTRIES,
  TIMELINE_ORDINARY_SLOTS,
  TIMELINE_OVF_MAX,
  TIMELINE_PHASES,
  TIMELINE_POWERUP_MAX,
  TIMELINE_RUN_MAX_BYTES,
  TIMELINE_RUN_MAX_WAVES,
  TIMELINE_TRANSITION_MAX,
  TIMELINE_T_MAX,
  TIMELINE_VERSION,
  TIMELINE_X_MAX,
  digits,
  entryBytes,
  timelineWireBytes,
  type TimelineCode,
  type TimelineEntry,
  type TimelineOverflowCounts,
} from "../engine/waveTimeline";
import { TIMELINE_PARAM_RANGES, isClosedTimeline } from "../timelineSave";

interface FixtureParam {
  readonly name: string;
  readonly min: number;
  readonly max: number;
  readonly registry?: string;
}
interface FixtureCode {
  readonly code: number;
  readonly name: string;
  readonly class: string;
  readonly arity: number;
  readonly params: readonly FixtureParam[];
}
interface FixturePayload {
  readonly ev: number;
  readonly wave: number;
  readonly outcome: "cleared" | "died";
  readonly dev: boolean;
  readonly ovf: TimelineOverflowCounts;
  readonly e: readonly TimelineEntry[];
}

const codes = fixture.codes as readonly FixtureCode[];

describe("wave_timeline v1: the engine matches the shared fixture (#3393)", () => {
  it("the schema version", () => {
    expect(TIMELINE_VERSION).toBe(fixture.v);
  });

  it("the registries a code's parameters index", () => {
    expect({
      HIT_CAUSES,
      POWERUP_TYPES,
      CARRIER_STAGES,
      KILL_METHODS,
      TIMELINE_PHASES,
    }).toEqual(fixture.registries);
  });

  it("the code table: every code's name, class and arity", () => {
    const app = Object.entries(TIMELINE_CODES).map(([code, c]) => ({
      code: Number(code),
      name: c.name,
      class: c.cls,
      arity: c.arity,
    }));
    expect(app).toEqual(
      codes.map((c) => ({ code: c.code, name: c.name, class: c.class, arity: c.arity }))
    );
  });

  it("each parameter's range, as the paused-run restore checks it", () => {
    for (const c of codes) {
      const app = TIMELINE_PARAM_RANGES[c.code as TimelineCode];
      expect({ code: c.name, ranges: app }).toEqual({
        code: c.name,
        ranges: c.params.map((p) => [p.min, p.max]),
      });
      expect(c.arity).toBe(2 + c.params.length);
    }
    // a registry-indexed parameter spans indices of that registry
    const registries = fixture.registries as Readonly<Record<string, readonly string[]>>;
    for (const c of codes) {
      for (const p of c.params) {
        if (p.registry === undefined) continue;
        expect(p.max).toBeLessThan(registries[p.registry]!.length);
      }
    }
  });

  it("the limits", () => {
    const { limits } = fixture;
    expect({
      maxEntries: TIMELINE_MAX_ENTRIES,
      ordinarySlots: TIMELINE_ORDINARY_SLOTS,
      lethalSlot: TIMELINE_ORDINARY_SLOTS + 1,
      terminalSlot: TIMELINE_MAX_ENTRIES,
      powerUpMax: TIMELINE_POWERUP_MAX,
      transitionMax: TIMELINE_TRANSITION_MAX,
      maxEventBytes: TIMELINE_MAX_BYTES,
      runMaxBytes: TIMELINE_RUN_MAX_BYTES,
      runMaxWaves: TIMELINE_RUN_MAX_WAVES,
      tMax: TIMELINE_T_MAX,
      xMax: TIMELINE_X_MAX,
      ovfMax: TIMELINE_OVF_MAX,
    }).toEqual({
      maxEntries: limits.maxEntries,
      ordinarySlots: limits.ordinarySlots,
      lethalSlot: limits.lethalSlot,
      terminalSlot: limits.terminalSlot,
      powerUpMax: limits.powerUpMax,
      transitionMax: limits.transitionMax,
      maxEventBytes: limits.maxEventBytes,
      runMaxBytes: limits.runMaxBytes,
      runMaxWaves: limits.runMaxWaves,
      tMax: limits.tMax,
      xMax: limits.xMax,
      ovfMax: limits.ovfMax,
    });
  });
});

describe("wave_timeline v1: the fixture's examples (#3393)", () => {
  it.each(fixture.valid.map((v) => [v.name, v] as const))(
    "%s: the engine's byte arithmetic equals its compact JSON",
    (_name, example) => {
      const p = example.payload as unknown as FixturePayload;
      let eBytes = 2;
      p.e.forEach((entry, i) => (eBytes += entryBytes(entry) + (i > 0 ? 1 : 0)));
      expect(eBytes).toBe(JSON.stringify(p.e).length);
      // the arithmetic counts this build's own `ev`; the worst case carries the widest one
      const wire =
        timelineWireBytes(p.wave, p.outcome, p.dev, p.ovf, eBytes) +
        digits(p.ev) -
        digits(TIMELINE_ENGINE_VERSION);
      expect(wire).toBe(JSON.stringify(example.payload).length);
      expect(wire).toBe(example.compactBytes);
      expect(wire).toBeLessThanOrEqual(TIMELINE_MAX_BYTES);
    }
  );

  it("every valid example (and a full wave with the lethal slot) is restorable from a save", () => {
    for (const v of fixture.valid)
      expect({ [v.name]: isClosedTimeline(v.payload) }).toEqual({ [v.name]: true });
    const lethal = fixture.invalid.find((c) => c.name === "thirty_one_ordinary_with_lethal")!;
    expect(isClosedTimeline(lethal.payload)).toBe(true);
  });

  it("a restore never brings back a timeline the backend drops", () => {
    // `*_float` cases (1.0) are Python-side: JSON.parse reads 1.0 as the integer 1, and
    // JSON.stringify sends it as 1, which the backend accepts, so JS cannot hold one
    const drops = fixture.invalid.filter(
      (c) => c.expect.startsWith("drop:") && !c.name.endsWith("_float")
    );
    expect(drops.length).toBeGreaterThan(50);
    const restorable = drops.filter((c) => isClosedTimeline(c.payload)).map((c) => c.name);
    expect(restorable).toEqual([]);
  });
});
