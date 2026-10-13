/**
 * The per-wave stats contract (#3245): what `waveStats.contract.test.ts` holds every section of
 * the `wave_completed` snapshot to. Not a test file.
 *
 * Each snapshot section has a row file next to this one (`pacing.ts`, `powerUps.ts`, …) that
 * exports a `SectionContract`: rows, each a scenario that closes a wave and an expectation on its
 * snapshot, plus the registry values and fields each row proves are counted (`covers`). The
 * harness requires every value of every registry the section owns (SECTION_REGISTRIES) and every
 * top-level field of the section to be covered by a row — or listed in the section's `pending`,
 * with the story that will fill it. Counter stories add rows and delete their pending entries.
 *
 * See docs/games/starswarm.md#adding-content.
 */
import { REGISTRIES, type RegistryName, type WaveStatsSnapshot } from "../../engine";

/** The snapshot's sections — every one has a row file. */
export type ContractSection = Exclude<
  keyof WaveStatsSnapshot,
  "v" | "wave" | "difficulty" | "outcome" | "dev"
>;

/** What a row proves is counted: one registry value, or one top-level field of its section. */
export type Cover = `${RegistryName}:${string}` | `field:${string}`;

export interface ContractRow {
  readonly id: string;
  readonly covers: readonly Cover[];
  /** Plays a scenario and returns the snapshot of the wave it closed. */
  readonly scenario: () => WaveStatsSnapshot;
  readonly expect: (snapshot: WaveStatsSnapshot) => void;
}

export interface SectionContract<S extends ContractSection = ContractSection> {
  readonly section: S;
  readonly rows: readonly ContractRow[];
  /** Covers still to come, and the stories that bring them. `"all"`: the whole section. */
  readonly pending: {
    readonly stories: readonly string[];
    readonly covers: "all" | readonly Cover[];
  } | null;
}

/** The registries whose every value each section must count. */
export const SECTION_REGISTRIES: Readonly<Record<ContractSection, readonly RegistryName[]>> = {
  pacing: [],
  score: [],
  powerUps: ["POWERUP_TYPES", "POWERUP_SOURCES"],
  rocks: ["ASTEROID_KINDS", "ROCK_BREAKERS", "ENEMY_TIERS", "HIT_RESULTS"],
  buddy: ["BUDDY_HIT_CAUSES", "ENEMY_TIERS"],
  carrier: ["CARRIER_STAGES"],
  rout: [],
  combat: ["ENEMY_TIERS", "KILL_METHODS"],
  damage: ["HIT_CAUSES", "HIT_RESULTS"],
};

/** How the harness names a registry's values in its failure messages. */
export const REGISTRY_LABEL: Readonly<Record<RegistryName, string>> = {
  POWERUP_TYPES: "power-up",
  POWERUP_SOURCES: "power-up source",
  ENEMY_TIERS: "enemy tier",
  ASTEROID_KINDS: "asteroid kind",
  ROCK_BREAKERS: "rock breaker",
  HIT_CAUSES: "hit cause",
  BUDDY_HIT_CAUSES: "Buddy hit cause",
  HIT_RESULTS: "hit result",
  KILL_METHODS: "kill method",
  CARRIER_STAGES: "Carrier stage",
};

/** A registry value cover, checked against the registry. */
export function key<R extends RegistryName>(
  registry: R,
  value: (typeof REGISTRIES)[R][number]
): Cover {
  return `${registry}:${value}`;
}

/** A field cover, checked against the section's snapshot type. */
export function field<S extends ContractSection>(
  _section: S,
  name: keyof WaveStatsSnapshot[S] & string
): Cover {
  return `field:${name}`;
}
