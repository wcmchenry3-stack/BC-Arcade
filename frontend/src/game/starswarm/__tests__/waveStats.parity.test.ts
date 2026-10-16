/**
 * Star Swarm per-wave stats: frontend/backend registry parity (#3252).
 *
 * The `wave_completed` v1 vocabulary is written out in
 * `backend/tests/fixtures/starswarm_wave_stats_v1_registries.json`. This test holds the app's
 * registries (`engine/registries.ts`) equal to it; the backend's
 * `tests/test_starswarm_wave_stats_parity.py` holds its `StarSwarmWaveStats` Literal sets to it.
 * Adding a power-up, enemy tier, hit cause… on one side only fails one of the two.
 * See docs/games/starswarm.md#adding-content.
 */
// resolveJsonModule is enabled via expo/tsconfig.base.
// Path: 5 levels up from __tests__/ to the repo root, then into backend/tests/fixtures/.
import fixture from "../../../../../backend/tests/fixtures/starswarm_wave_stats_v1_registries.json";
import { REGISTRIES, WAVE_STATS_VERSION } from "../engine";

const FIXTURE_FILE = "backend/tests/fixtures/starswarm_wave_stats_v1_registries.json";
const REGISTRY_FILE = "frontend/src/game/starswarm/engine/registries.ts";

/** Why a registry differs from the fixture, naming the files to edit; null when they match. */
function mismatch(
  name: string,
  app: readonly string[] | undefined,
  shared: readonly string[] | undefined
): string | null {
  if (JSON.stringify(app) === JSON.stringify(shared)) return null;
  return (
    `${name} differs between ${REGISTRY_FILE} (${JSON.stringify(app ?? null)}) and ` +
    `${FIXTURE_FILE} (${JSON.stringify(shared ?? null)}) — update ${FIXTURE_FILE} and the ` +
    `backend's StarSwarmWaveStats Literals (backend/starswarm/models.py) to match ` +
    `(see docs/games/starswarm.md#adding-content)`
  );
}

function mismatches(
  app: Readonly<Record<string, readonly string[]>>,
  shared: Readonly<Record<string, readonly string[]>>
): string[] {
  const names = [...new Set([...Object.keys(app), ...Object.keys(shared)])].sort();
  return names.flatMap((n) => mismatch(n, app[n], shared[n]) ?? []);
}

describe("wave-stats registry parity with the backend (#3252)", () => {
  it("the shared fixture is for this schema version", () => {
    expect(fixture.v).toBe(WAVE_STATS_VERSION);
  });

  it("the shared fixture lists exactly the app's registries, in order", () => {
    const gaps = mismatches(REGISTRIES, fixture.registries);
    if (gaps.length > 0) throw new Error(`\n${gaps.join("\n")}`);
  });
});

/**
 * The check checking itself, on frozen in-test registries — never the live fixture or
 * `registries.ts`, so a real mismatch fails only the real check above.
 */
describe("wave-stats registry parity check (self-test, frozen registries)", () => {
  const FROZEN: Readonly<Record<string, readonly string[]>> = Object.freeze({
    POWERUP_TYPES: Object.freeze(["pA", "pB"]),
    HIT_CAUSES: Object.freeze(["causeA"]),
  });

  it("matching registries pass", () => {
    expect(mismatches(FROZEN, { ...FROZEN })).toEqual([]);
  });

  it("a value added on the app side only fails, naming the fixture file", () => {
    const grown = { ...FROZEN, POWERUP_TYPES: [...FROZEN.POWERUP_TYPES!, "magnet"] };
    const gaps = mismatches(grown, FROZEN);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatch(/^POWERUP_TYPES differs .*"magnet"/);
    expect(gaps[0]).toContain(`update ${FIXTURE_FILE}`);
  });

  it("a reordered registry fails (the fixture lists the app's order)", () => {
    const reordered = { ...FROZEN, POWERUP_TYPES: ["pB", "pA"] };
    expect(mismatches(reordered, FROZEN)).toEqual([
      expect.stringMatching(/^POWERUP_TYPES differs /),
    ]);
  });

  it("a registry on one side only fails too", () => {
    const shared = { ...FROZEN, LOOT_TABLES: ["a"] };
    expect(mismatches(FROZEN, shared)).toEqual([
      expect.stringMatching(/^LOOT_TABLES differs .* \(null\) and .* \(\["a"\]\)/),
    ]);
  });
});
