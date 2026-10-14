/**
 * Wave-stats contract rows: `carrier` (#3249). See ./contract.ts.
 *
 * Every Carrier stage has a row that proves its time is recorded; every counter has a row that
 * drives the engine to it.
 */
import { closeWave } from "../../engine";
import {
  attackRunWave,
  beamFiredWave,
  beamHitWave,
  deflectWave,
  reinforcedWave,
  stagesSnapshot,
} from "../helpers/carrierRoutScenarios";
import { field, key, type ContractRow, type SectionContract } from "./contract";

/** A row whose wave is closed from the scenario's open state. */
const open = (build: () => ReturnType<typeof reinforcedWave>) => () =>
  closeWave(build(), "cleared");

const stageRow = (stage: "protected" | "exposed" | "finalStand"): ContractRow => ({
  id: `stageReachedMs records when the Carrier first reached ${stage}`,
  covers: [key("CARRIER_STAGES", stage), field("carrier", "stageReachedMs")],
  scenario: () => stagesSnapshot().snapshot,
  expect: (snap) => {
    const t = snap.carrier.stageReachedMs;
    expect(t[stage]).toBeGreaterThan(0);
    expect(t[stage]).toBeLessThanOrEqual(snap.pacing.durationMs);
    // the others are recorded later, never earlier (protected < exposed < finalStand)
    if (stage === "exposed") expect(t.exposed!).toBeGreaterThan(t.protected!);
    if (stage === "finalStand") expect(t.finalStand!).toBeGreaterThan(t.exposed!);
  },
});

export const contract: SectionContract<"carrier"> = {
  section: "carrier",
  pending: null,
  rows: [
    stageRow("protected"),
    stageRow("exposed"),
    stageRow("finalStand"),
    {
      id: "gruntsLaunched counts the grunts a reinforcement launch sends",
      covers: [field("carrier", "gruntsLaunched")],
      scenario: open(reinforcedWave),
      expect: (snap) => {
        expect(snap.carrier.gruntsLaunched).toBeGreaterThan(0);
      },
    },
    {
      id: "armorDeflects counts shots turned away by the Carrier's field",
      covers: [field("carrier", "armorDeflects")],
      scenario: open(deflectWave),
      expect: (snap) => {
        expect(snap.carrier.armorDeflects).toBe(1);
      },
    },
    {
      id: "beamsFired counts released beams, beamHits only the ones that land",
      covers: [field("carrier", "beamsFired")],
      scenario: open(beamFiredWave),
      expect: (snap) => {
        expect(snap.carrier.beamsFired).toBe(1);
        expect(snap.carrier.beamHits).toBe(0);
      },
    },
    {
      id: "beamHits counts a beam that lands on the ship",
      covers: [field("carrier", "beamHits")],
      scenario: open(beamHitWave),
      expect: (snap) => {
        expect(snap.carrier.beamHits).toBe(1);
      },
    },
    {
      id: "attackRuns counts a run leaving station",
      covers: [field("carrier", "attackRuns")],
      scenario: open(attackRunWave),
      expect: (snap) => {
        expect(snap.carrier.attackRuns).toBe(1);
      },
    },
  ],
};
