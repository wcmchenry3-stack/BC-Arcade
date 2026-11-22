/** #3578: a Yacht score plays one sound, its top milestone, else the commit or zero. */
import { renderHook } from "@testing-library/react-native";
import { scoreSoundFor, useScoreSound } from "../useScoreSound";
import type { GameEvent } from "../types";

const scored = (value: number): GameEvent => ({ type: "scored", category: "x", value });

describe("scoreSoundFor", () => {
  it.each([
    [[scored(16)], "commit"],
    [[scored(0)], "zero"],
    [[scored(30), { type: "smallStraight" }], "smallStraight"],
    [[scored(40), { type: "largeStraight" }], "largeStraight"],
    [[scored(25), { type: "fullHouse" }], "fullHouse"],
    [[scored(30), { type: "upperBonus" }], "upperBonus"],
    [[scored(50), { type: "yacht" }], "yacht"],
    // a joker straight: the joker outranks the straight (one sound per score)
    [[scored(40), { type: "joker" }, { type: "largeStraight" }], "joker"],
  ] as [GameEvent[], string][])("%j plays %s", (events, sound) => {
    expect(scoreSoundFor(events)).toBe(sound);
  });

  it("is null for actions that are not scores", () => {
    expect(scoreSoundFor(undefined)).toBeNull();
    expect(scoreSoundFor([{ type: "diceRoll", rolledIndices: [0] }])).toBeNull();
    expect(scoreSoundFor([{ type: "dieHold", index: 0 }])).toBeNull();
  });
});

describe("useScoreSound", () => {
  it("plays once per new events array and skips the events it mounts with", async () => {
    const commit = jest.fn();
    const zero = jest.fn();
    const restored = [scored(16)];
    const { rerender } = await renderHook(
      ({ events }: { events: readonly GameEvent[] | undefined }) =>
        useScoreSound(events, { commit, zero }),
      { initialProps: { events: restored as readonly GameEvent[] | undefined } }
    );
    expect(commit).not.toHaveBeenCalled(); // a restored save doesn't replay its last score

    const next = [scored(0)];
    await rerender({ events: next });
    await rerender({ events: next }); // same array: no replay
    expect(zero).toHaveBeenCalledTimes(1);

    await rerender({ events: undefined });
    await rerender({ events: [scored(12)] });
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("stays silent for a sound with no player", async () => {
    const { rerender } = await renderHook(
      ({ events }: { events: readonly GameEvent[] | undefined }) => useScoreSound(events, {}),
      { initialProps: { events: undefined as readonly GameEvent[] | undefined } }
    );
    await expect(rerender({ events: [scored(16)] })).resolves.not.toThrow();
  });
});
