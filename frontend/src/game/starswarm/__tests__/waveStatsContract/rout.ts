/**
 * Wave-stats contract rows: `rout` (#3249). See ./contract.ts.
 */
import { bombedSnapshot, caughtAndEscapedSnapshot } from "../helpers/carrierRoutScenarios";
import { field, type SectionContract } from "./contract";

export const contract: SectionContract<"rout"> = {
  section: "rout",
  pending: null,
  rows: [
    {
      id: "triggered, atMs and grunts record the rout; caught and escaped split the grunts",
      covers: [
        field("rout", "triggered"),
        field("rout", "atMs"),
        field("rout", "grunts"),
        field("rout", "caught"),
        field("rout", "escaped"),
      ],
      scenario: () => caughtAndEscapedSnapshot().snapshot,
      expect: (snap) => {
        const r = snap.rout;
        expect(r.triggered).toBe(true);
        expect(r.atMs).toBeGreaterThan(0);
        expect(r.atMs).toBeLessThanOrEqual(snap.pacing.durationMs);
        expect(r.grunts).toBeGreaterThan(1);
        expect(r.caught).toBe(1); // shot
        expect(r.escaped).toBe(r.grunts - 1); // off the top
        expect(r.caught + r.escaped).toBeLessThanOrEqual(r.grunts);
      },
    },
    {
      id: "a Smart Bomb catches every fleeing grunt",
      covers: [field("rout", "caught")],
      scenario: () => bombedSnapshot().snapshot,
      expect: (snap) => {
        expect(snap.rout.caught).toBe(snap.rout.grunts);
        expect(snap.rout.escaped).toBe(0);
      },
    },
  ],
};
