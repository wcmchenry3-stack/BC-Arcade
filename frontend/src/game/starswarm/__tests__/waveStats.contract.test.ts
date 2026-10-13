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

function requiredCovers(section: ContractSection, snap: WaveStatsSnapshot): Required[] {
  const out: Required[] = [];
  for (const registry of SECTION_REGISTRIES[section]) {
    for (const value of REGISTRIES[registry]) {
      out.push({ cover: `${registry}:${value}`, label: `${REGISTRY_LABEL[registry]} "${value}"` });
    }
  }
  for (const name of Object.keys(snap[section])) {
    out.push({ cover: `field:${name}`, label: `field "${section}.${name}"` });
  }
  return out;
}

/** Every way the contracts fall short, as messages naming the file to fix. */
function contractGaps(contracts: Contracts, snap: WaveStatsSnapshot): string[] {
  const gaps: string[] = [];
  const sections = Object.keys(SECTION_REGISTRIES) as ContractSection[];

  const owned = new Set(sections.flatMap((s) => SECTION_REGISTRIES[s]));
  for (const registry of Object.keys(REGISTRIES) as RegistryName[]) {
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
    const required = requiredCovers(section, snap);
    const known = new Set(required.map((r) => r.cover));
    const covered = new Set(c.rows.flatMap((r) => r.covers));
    const pendingAll = c.pending?.covers === "all";
    const pendingList = new Set(c.pending && c.pending.covers !== "all" ? c.pending.covers : []);

    if (c.section !== section) gaps.push(`${file} declares section "${c.section}"`);
    if (pendingAll && c.rows.length > 0) {
      gaps.push(
        `${file} has rows but its pending is "all" — list only the covers still to come, or ` +
          `set pending to null`
      );
    }
    for (const r of required) {
      if (covered.has(r.cover)) {
        if (pendingList.has(r.cover)) {
          gaps.push(
            `${r.label} has a row in ${file} but is still pending — remove it from pending`
          );
        }
      } else if (!pendingAll && !pendingList.has(r.cover)) {
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

  it("names the row file a missing row belongs in", () => {
    const snap = emptySnapshot();
    const noPowerUps = { ...CONTRACTS, powerUps: { ...powerUps, pending: null } };
    expect(contractGaps(noPowerUps, snap)).toContain(
      `power-up "lightning" has no wave-stats contract row — add one in ` +
        `__tests__/waveStatsContract/powerUps.ts (see docs/games/starswarm.md#adding-content)`
    );
    const noPacingRows = { ...CONTRACTS, pacing: { ...pacing, rows: [] } };
    expect(contractGaps(noPacingRows, snap)).toContain(
      `field "pacing.durationMs" has no wave-stats contract row — add one in ` +
        `__tests__/waveStatsContract/pacing.ts (see docs/games/starswarm.md#adding-content)`
    );
  });

  it("flags a pending entry that a row already covers, and a cover that names nothing", () => {
    const snap = emptySnapshot();
    const stale = {
      ...CONTRACTS,
      pacing: {
        ...pacing,
        pending: { stories: ["#0"], covers: ["field:durationMs", "field:nope"] as Cover[] },
      },
    };
    const gaps = contractGaps(stale, snap);
    expect(gaps).toContain(
      `field "pacing.durationMs" has a row in __tests__/waveStatsContract/pacing.ts but is ` +
        `still pending — remove it from pending`
    );
    expect(gaps).toContain(
      `__tests__/waveStatsContract/pacing.ts covers "field:nope", which isn't a pacing registry ` +
        `value or field`
    );
  });

  it("pending entries name the stories that fill them", () => {
    for (const c of Object.values(CONTRACTS) as SectionContract[]) {
      if (c.pending) expect(c.pending.stories.length).toBeGreaterThan(0);
    }
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
