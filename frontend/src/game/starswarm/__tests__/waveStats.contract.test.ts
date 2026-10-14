/**
 * Star Swarm per-wave stats contract (#3245): every registry value and every snapshot field is
 * counted by some scenario, or is explicitly pending on the story that will count it.
 *
 * The rows live in `waveStatsContract/<section>.ts` (one file per snapshot section, so counter
 * stories don't edit the same file) and the rules in `waveStatsContract/contract.ts`. Add a
 * power-up, enemy tier, cause or field and this test names the row file it needs.
 * See docs/games/starswarm.md#adding-content.
 */
import { CANVAS_H, CANVAS_W, REGISTRIES, _resetIds, closeWave, initStarSwarm } from "../engine";
import type { RegistryName, WaveStatsSnapshot } from "../engine";
import {
  REGISTRY_LABEL,
  SECTION_REGISTRIES,
  type ContractSection,
  type Cover,
  type SectionContract,
} from "./waveStatsContract/contract";
import { contract as buddy } from "./waveStatsContract/buddy";
import { contract as carrier } from "./waveStatsContract/carrier";
import { contract as combat } from "./waveStatsContract/combat";
import { contract as damage } from "./waveStatsContract/damage";
import { contract as pacing } from "./waveStatsContract/pacing";
import { contract as powerUps } from "./waveStatsContract/powerUps";
import { contract as rocks } from "./waveStatsContract/rocks";
import { contract as rout } from "./waveStatsContract/rout";
import { contract as score } from "./waveStatsContract/score";

type Contracts = { readonly [S in ContractSection]: SectionContract<S> };

const CONTRACTS: Contracts = {
  pacing,
  score,
  powerUps,
  rocks,
  buddy,
  carrier,
  rout,
  combat,
  damage,
};

const ROW_DIR = "__tests__/waveStatsContract";
const DOCS = "docs/games/starswarm.md#adding-content";

/** A closed snapshot of an untouched wave: its sections' fields are what rows must cover. */
function emptySnapshot(): WaveStatsSnapshot {
  return closeWave(initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "Commander"), "cleared");
}

interface Required {
  readonly cover: Cover;
  readonly label: string;
}

/** The registry lists the harness checks against — the real ones, or a test's variant. */
type Registries = Readonly<Record<RegistryName, readonly string[]>>;

function requiredCovers(
  section: ContractSection,
  snap: WaveStatsSnapshot,
  registries: Registries
): Required[] {
  const out: Required[] = [];
  for (const registry of SECTION_REGISTRIES[section]) {
    for (const value of registries[registry]) {
      out.push({ cover: `${registry}:${value}`, label: `${REGISTRY_LABEL[registry]} "${value}"` });
    }
  }
  for (const name of Object.keys(snap[section])) {
    out.push({ cover: `field:${name}`, label: `field "${section}.${name}"` });
  }
  return out;
}

/** Every way the contracts fall short, as messages naming the file to fix. */
function contractGaps(
  contracts: Contracts,
  snap: WaveStatsSnapshot,
  registries: Registries = REGISTRIES
): string[] {
  const gaps: string[] = [];
  const sections = Object.keys(SECTION_REGISTRIES) as ContractSection[];

  const owned = new Set(sections.flatMap((s) => SECTION_REGISTRIES[s]));
  for (const registry of Object.keys(registries) as RegistryName[]) {
    if (!owned.has(registry)) {
      gaps.push(
        `registry ${registry} isn't owned by any section — add it to SECTION_REGISTRIES in ` +
          `${ROW_DIR}/contract.ts (see ${DOCS})`
      );
    }
  }

  for (const section of sections) {
    const c = contracts[section] as SectionContract;
    const file = `${ROW_DIR}/${section}.ts`;
    const required = requiredCovers(section, snap, registries);
    const known = new Set(required.map((r) => r.cover));
    const covered = new Set(c.rows.flatMap((r) => r.covers));
    const pendingList = new Set(c.pending?.covers ?? []);

    if (c.section !== section) gaps.push(`${file} declares section "${c.section}"`);
    if (c.pending && c.pending.covers.length === 0) {
      gaps.push(`${file} has an empty pending list — set pending to null`);
    }
    for (const r of required) {
      if (covered.has(r.cover)) {
        if (pendingList.has(r.cover)) {
          gaps.push(
            `${r.label} has a row in ${file} but is still pending — remove it from pending`
          );
        }
      } else if (!pendingList.has(r.cover)) {
        gaps.push(`${r.label} has no wave-stats contract row — add one in ${file} (see ${DOCS})`);
      }
    }
    for (const cover of [...covered, ...pendingList]) {
      if (!known.has(cover)) {
        gaps.push(`${file} covers "${cover}", which isn't a ${section} registry value or field`);
      }
    }
  }
  return gaps;
}

beforeEach(() => _resetIds());

describe("wave-stats contract (#3245)", () => {
  it("every registry value and snapshot field has a contract row or is pending", () => {
    const gaps = contractGaps(CONTRACTS, emptySnapshot());
    if (gaps.length > 0) throw new Error(`\n${gaps.join("\n")}`);
  });

  it("pending entries name the stories that fill them", () => {
    for (const c of Object.values(CONTRACTS) as SectionContract[]) {
      if (c.pending) expect(c.pending.stories.length).toBeGreaterThan(0);
    }
  });
});

/**
 * The harness checking itself, against a fixed registries fixture and contracts built to cover it
 * exactly — never the real registries or row files, so adding a real power-up fails only the
 * real check above.
 */
describe("wave-stats contract harness (self-test, fixture registries)", () => {
  const FIXTURE: Registries = {
    POWERUP_TYPES: ["pA", "pB"],
    POWERUP_SOURCES: ["srcA"],
    ENEMY_TIERS: ["tierA"],
    ASTEROID_KINDS: ["kindA"],
    ROCK_BREAKERS: ["breakerA"],
    HIT_CAUSES: ["causeA"],
    BUDDY_HIT_CAUSES: ["buddyCauseA"],
    HIT_RESULTS: ["resultA"],
    KILL_METHODS: ["methodA"],
    CARRIER_STAGES: ["stageA"],
  };
  const SECTIONS = Object.keys(SECTION_REGISTRIES) as ContractSection[];
  const ADDING = "(see docs/games/starswarm.md#adding-content)";

  /** Every section fully pending against FIXTURE; pacing instead fully covered by one row. */
  function fixtureContracts(snap: WaveStatsSnapshot): Contracts {
    const out: Partial<Record<ContractSection, SectionContract>> = {};
    for (const section of SECTIONS) {
      const covers = requiredCovers(section, snap, FIXTURE).map((r) => r.cover);
      out[section] =
        section === "pacing"
          ? {
              section,
              pending: null,
              rows: [{ id: "all of pacing", covers, scenario: () => snap, expect: () => {} }],
            }
          : { section, rows: [], pending: { stories: ["#0"], covers } };
    }
    return out as Contracts;
  }

  const snap = emptySnapshot();
  const base = fixtureContracts(snap);

  it("the fixture contracts cover the fixture registries exactly", () => {
    expect(contractGaps(base, snap, FIXTURE)).toEqual([]);
  });

  it("fails on a registry value added later: pending lists the values it had", () => {
    const grown: Registries = {
      ...FIXTURE,
      POWERUP_TYPES: [...FIXTURE.POWERUP_TYPES, "magnet"],
      HIT_CAUSES: [...FIXTURE.HIT_CAUSES, "laser"],
    };
    expect(contractGaps(base, snap, grown)).toEqual([
      `power-up "magnet" has no wave-stats contract row — add one in ` +
        `__tests__/waveStatsContract/powerUps.ts ${ADDING}`,
      `hit cause "laser" has no wave-stats contract row — add one in ` +
        `__tests__/waveStatsContract/damage.ts ${ADDING}`,
    ]);
  });

  it("fails on a section field added later", () => {
    const grown = { ...snap, rout: { ...snap.rout, rallied: 0 } } as WaveStatsSnapshot;
    expect(contractGaps(base, grown, FIXTURE)).toEqual([
      `field "rout.rallied" has no wave-stats contract row — add one in ` +
        `__tests__/waveStatsContract/rout.ts ${ADDING}`,
    ]);
  });

  it("names the row file a missing row belongs in", () => {
    const noRows = { ...base, pacing: { ...base.pacing, rows: [] } };
    expect(contractGaps(noRows, snap, FIXTURE)).toEqual(
      Object.keys(snap.pacing).map(
        (f) =>
          `field "pacing.${f}" has no wave-stats contract row — add one in ` +
          `__tests__/waveStatsContract/pacing.ts ${ADDING}`
      )
    );
  });

  it("flags a registry no section owns", () => {
    const grown = { ...FIXTURE, LOOT_TABLES: ["a"] } as unknown as Registries;
    expect(contractGaps(base, snap, grown)).toEqual([
      `registry LOOT_TABLES isn't owned by any section — add it to SECTION_REGISTRIES in ` +
        `__tests__/waveStatsContract/contract.ts ${ADDING}`,
    ]);
  });

  it("flags a pending entry that a row already covers, and a cover that names nothing", () => {
    const stale = {
      ...base,
      pacing: {
        ...base.pacing,
        pending: { stories: ["#0"], covers: ["field:durationMs", "field:nope"] as Cover[] },
      },
    };
    expect(contractGaps(stale, snap, FIXTURE)).toEqual([
      `field "pacing.durationMs" has a row in __tests__/waveStatsContract/pacing.ts but is ` +
        `still pending — remove it from pending`,
      `__tests__/waveStatsContract/pacing.ts covers "field:nope", which isn't a pacing registry ` +
        `value or field`,
    ]);
  });

  it("flags an empty pending list", () => {
    const empty = { ...base, pacing: { ...base.pacing, pending: { stories: ["#0"], covers: [] } } };
    expect(contractGaps(empty, snap, FIXTURE)).toEqual([
      `__tests__/waveStatsContract/pacing.ts has an empty pending list — set pending to null`,
    ]);
  });
});

describe.each(Object.values(CONTRACTS).filter((c) => c.rows.length > 0) as SectionContract[])(
  "wave-stats contract rows: $section",
  (c) => {
    it.each(c.rows.map((r) => [r.id, r] as const))("%s", (_id, row) => {
      row.expect(row.scenario());
    });
  }
);
