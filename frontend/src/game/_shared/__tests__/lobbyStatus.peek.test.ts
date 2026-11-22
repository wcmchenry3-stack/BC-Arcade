/**
 * The lobby's best lookup is side-effect free (#4008): unlike `getBest`, it neither moves an older
 * save in (a write and a removal), nor deletes a corrupt record, nor reports to Sentry.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

import { getLobbyStatus as yacht } from "../../yacht/lobbyStatus";
import { getLobbyStatus as twenty48 } from "../../twenty48/lobbyStatus";
import { getLobbyStatus as solitaire } from "../../solitaire/lobbyStatus";
import { getLobbyStatus as freecell } from "../../freecell/lobbyStatus";
import { __resetPersonalBestForTests, getBest, peekBests, recordResult } from "../personalBest";

const LEGACY = [
  {
    game: "yacht",
    read: yacht,
    key: "yacht_best_score_v1",
    value: "312",
    expected: { kind: "best", value: 312, unit: "score" },
  },
  {
    game: "twenty48",
    read: twenty48,
    key: "twenty48_best_score_v1",
    value: "9000",
    expected: { kind: "best", value: 9000, unit: "score" },
  },
  {
    game: "solitaire",
    read: solitaire,
    key: "solitaire_stats_v1",
    value: JSON.stringify({ bestTimeMs: 300_000 }),
    expected: { kind: "best", value: 300_000, unit: "time" },
  },
  {
    game: "freecell",
    read: freecell,
    key: "freecell_stats_v1",
    value: JSON.stringify({ bestMoves: 90 }),
    expected: { kind: "best", value: 90, unit: "moves" },
  },
] as const;

function expectNoSideEffects() {
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
  expect(AsyncStorage.setMany).not.toHaveBeenCalled();
  expect(AsyncStorage.removeMany).not.toHaveBeenCalled();
  expect(Sentry.captureException).not.toHaveBeenCalled();
  expect(Sentry.captureMessage).not.toHaveBeenCalled();
}

describe("lobby best lookup has no side effects (#4008)", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    __resetPersonalBestForTests();
    jest.clearAllMocks();
  });

  it.each(LEGACY)("$game: reads the best from an older save, and leaves it stored", async (c) => {
    await AsyncStorage.setItem(c.key, c.value);
    jest.clearAllMocks();
    expect(await c.read()).toEqual(c.expected);
    expectNoSideEffects();
    expect(await AsyncStorage.getItem(c.key)).toBe(c.value);
    expect(await AsyncStorage.getItem(`personal_best_v1:${c.game}`)).toBeNull();
  });

  it.each(LEGACY)(
    "$game: a corrupt record reads as no best, stays stored, reports nothing",
    async (c) => {
      await AsyncStorage.setItem(`personal_best_v1:${c.game}`, "{bad");
      jest.clearAllMocks();
      expect(await c.read()).toBeUndefined();
      expectNoSideEffects();
      expect(await AsyncStorage.getItem(`personal_best_v1:${c.game}`)).toBe("{bad");
    }
  );

  it("merges an older save into the record, the better value winning", async () => {
    await AsyncStorage.setItem(
      "personal_best_v1:freecell",
      JSON.stringify({ v: 1, b: { _: 120 } })
    );
    await AsyncStorage.setItem("freecell_stats_v1", JSON.stringify({ bestMoves: 90 }));
    jest.clearAllMocks();
    expect((await peekBests("freecell"))?.["_"]).toBe(90);
    expectNoSideEffects();
  });

  it("is null for a record in a newer format, which is left alone", async () => {
    await AsyncStorage.setItem("personal_best_v1:yacht", JSON.stringify({ v: 2, b: { _: 5 } }));
    jest.clearAllMocks();
    expect(await peekBests("yacht")).toBeNull();
    expectNoSideEffects();
  });

  it("is null when storage can't be read, without reporting", async () => {
    (AsyncStorage.getMany as jest.Mock).mockRejectedValueOnce(new Error("disk"));
    expect(await peekBests("yacht")).toBeNull();
    expectNoSideEffects();
  });

  it("uses the in-memory best once a record has been read, with no storage read", async () => {
    await recordResult("yacht", 312);
    jest.clearAllMocks();
    expect((await peekBests("yacht"))?.["_"]).toBe(312);
    expect(AsyncStorage.getMany).not.toHaveBeenCalled();
  });

  it("(control) getBest does move an older save in: the difference the lobby avoids", async () => {
    await AsyncStorage.setItem("yacht_best_score_v1", "312");
    jest.clearAllMocks();
    expect(await getBest("yacht")).toBe(312);
    expect(AsyncStorage.removeMany).toHaveBeenCalled();
  });
});
