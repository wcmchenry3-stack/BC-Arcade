import { recordedOutcome } from "../recordedOutcome";
import { GAME_OUTCOMES } from "../../../api/vocab";

describe("recordedOutcome (#2517)", () => {
  it.each([
    ["win", "win"],
    ["loss", "loss"],
    ["draw", "push"],
    ["ended", "completed"],
  ] as const)("records a %s card as %s", (card, recorded) => {
    expect(recordedOutcome(card)).toBe(recorded);
  });

  it("only ever records a value the backend accepts", () => {
    for (const card of ["win", "loss", "draw", "ended"] as const) {
      expect(GAME_OUTCOMES).toContain(recordedOutcome(card));
    }
  });
});
