/**
 * The shared personal best (#3757): format, comparators, variants, fail-safes, and moving every
 * game's save from before #3757 in without losing or lowering a best.
 *
 * The legacy fixtures are the bytes each game's own storage wrote before #3757 (the same strings
 * `storageCompat.test.ts` seeded for those keys).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

import {
  DEFAULT_VARIANT,
  getBest,
  getBests,
  judgeResult,
  mergeBests,
  recordResult,
  storageKey,
} from "../personalBest";
import { MAX_YACHT_SCORE, sudokuVariant, type PersonalBestGame } from "../personalBestGames";

const record = (b: Record<string, number>) => JSON.stringify({ v: 1, b });

async function stored(game: PersonalBestGame): Promise<unknown> {
  const raw = await AsyncStorage.getItem(storageKey(game));
  return raw === null ? null : JSON.parse(raw);
}

const setItem = jest.mocked(AsyncStorage.setItem);
const getMany = jest.mocked(AsyncStorage.getMany);

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe("judgeResult: per-game comparator", () => {
  it("higher is better (Cascade, Star Swarm, 2048, Yacht)", () => {
    for (const game of ["cascade", "starswarm", "twenty48", "yacht"] as const) {
      expect(judgeResult(game, 100, 120)).toEqual({ best: 120, improved: true, isNewBest: true });
      expect(judgeResult(game, 100, 80)).toEqual({ best: 100, improved: false, isNewBest: false });
      expect(judgeResult(game, 100, 100)).toEqual({ best: 100, improved: false, isNewBest: false });
    }
  });

  it("lower is better (FreeCell, Solitaire, Sudoku, Mahjong)", () => {
    for (const game of ["freecell", "solitaire", "sudoku"] as const) {
      expect(judgeResult(game, 100, 80)).toEqual({ best: 80, improved: true, isNewBest: true });
      expect(judgeResult(game, 100, 120)).toEqual({ best: 100, improved: false, isNewBest: false });
    }
    expect(judgeResult("mahjong", 300_000, 200_000)).toEqual({
      best: 200_000,
      improved: true,
      isNewBest: true,
    });
  });

  it("the first result sets the best but is not a new best (bestOf's rule)", () => {
    expect(judgeResult("cascade", 0, 50)).toEqual({ best: 50, improved: true, isNewBest: false });
    expect(judgeResult("freecell", 0, 90)).toEqual({ best: 90, improved: true, isNewBest: false });
  });

  it("a value that can't be a best changes nothing", () => {
    // A 0 score never set a Cascade or Star Swarm best.
    expect(judgeResult("cascade", 0, 0)).toEqual({ best: 0, improved: false, isNewBest: false });
    expect(judgeResult("starswarm", 40, 0)).toEqual({
      best: 40,
      improved: false,
      isNewBest: false,
    });
    // A Mahjong clear under the floor is a broken clock.
    expect(judgeResult("mahjong", 300_000, 1_000)).toEqual({
      best: 300_000,
      improved: false,
      isNewBest: false,
    });
    expect(judgeResult("yacht", 0, MAX_YACHT_SCORE + 1).improved).toBe(false);
    expect(judgeResult("twenty48", 0, Number.NaN).improved).toBe(false);
  });

  it("a prior that can't be a best counts as none", () => {
    expect(judgeResult("mahjong", 1_000, 200_000)).toEqual({
      best: 200_000,
      improved: true,
      isNewBest: false,
    });
  });
});

describe("mergeBests", () => {
  it("keeps the better value per variant, by the game's comparator", () => {
    expect(mergeBests("freecell", { a: 90, b: 70 }, { a: 80, b: 75, c: 60 })).toEqual({
      a: 80,
      b: 70,
      c: 60,
    });
    expect(mergeBests("cascade", { _: 500 }, { _: 400 })).toEqual({ _: 500 });
  });
});

describe("recordResult / getBest", () => {
  it("stores the first result, then only an improvement", async () => {
    await expect(getBest("cascade")).resolves.toBe(0);
    await expect(recordResult("cascade", 500)).resolves.toEqual({
      best: 500,
      improved: true,
      isNewBest: false,
    });
    await expect(recordResult("cascade", 700)).resolves.toEqual({
      best: 700,
      improved: true,
      isNewBest: true,
    });
    await expect(getBest("cascade")).resolves.toBe(700);
    expect(await stored("cascade")).toEqual({ v: 1, b: { _: 700 } });
  });

  it("writes nothing when the result doesn't improve the best", async () => {
    await recordResult("freecell", 80);
    setItem.mockClear();
    await expect(recordResult("freecell", 95)).resolves.toEqual({
      best: 80,
      improved: false,
      isNewBest: false,
    });
    await expect(recordResult("freecell", 80)).resolves.toMatchObject({ improved: false });
    await getBest("freecell");
    expect(setItem).not.toHaveBeenCalled();
  });

  it("writes nothing for a value that can't be a best", async () => {
    setItem.mockClear();
    await recordResult("starswarm", 0);
    await recordResult("mahjong", "turtle", 1_000);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("keeps a best per variant", async () => {
    await recordResult("sudoku", sudokuVariant("classic", "easy"), 120);
    await recordResult("sudoku", sudokuVariant("mini", "easy"), 40);
    await recordResult("sudoku", sudokuVariant("classic", "easy"), 100);
    await expect(getBest("sudoku", "classic.easy")).resolves.toBe(100);
    await expect(getBest("sudoku", "mini.easy")).resolves.toBe(40);
    await expect(getBest("sudoku", "classic.hard")).resolves.toBe(0);
    await expect(getBests("sudoku")).resolves.toEqual({ "classic.easy": 100, "mini.easy": 40 });
  });

  it("a game without variants uses the default variant", async () => {
    await recordResult("twenty48", undefined, 2048);
    await expect(getBest("twenty48", DEFAULT_VARIANT)).resolves.toBe(2048);
    await expect(getBests("twenty48")).resolves.toEqual({ _: 2048 });
  });

  it("keeps games apart", async () => {
    await recordResult("cascade", 500);
    await recordResult("starswarm", 900);
    await expect(getBest("cascade")).resolves.toBe(500);
    await expect(getBest("starswarm")).resolves.toBe(900);
  });

  it("results finishing together never lower the best", async () => {
    await Promise.all([
      recordResult("cascade", 300),
      recordResult("cascade", 900),
      recordResult("cascade", 600),
    ]);
    await expect(getBest("cascade")).resolves.toBe(900);
  });
});

describe("fail-safe", () => {
  it("reads a corrupt record as no best, reports it once and removes it", async () => {
    for (const raw of ["{x", "null", "[1]", '{"v":2,"b":{"_":5}}', '{"v":1,"b":[5]}']) {
      jest.clearAllMocks();
      await AsyncStorage.setItem(storageKey("cascade"), raw);
      await expect(getBest("cascade")).resolves.toBe(0);
      expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
      await expect(AsyncStorage.getItem(storageKey("cascade"))).resolves.toBeNull();
    }
  });

  it("drops stored values that can't be a best and keeps the rest", async () => {
    await AsyncStorage.setItem(
      storageKey("mahjong"),
      JSON.stringify({ v: 1, b: { turtle: 200_000, fort: 5, pyramid: "x", "": 300_000 } })
    );
    await expect(getBests("mahjong")).resolves.toEqual({ turtle: 200_000 });
  });

  it("never rejects, and never writes when storage can't be read", async () => {
    await recordResult("cascade", 900);
    getMany.mockRejectedValueOnce(new Error("disk")).mockRejectedValueOnce(new Error("disk"));
    setItem.mockClear();
    await expect(getBest("cascade")).resolves.toBe(0);
    await expect(recordResult("cascade", 100)).resolves.toMatchObject({ best: 100 });
    expect(setItem).not.toHaveBeenCalled();
    expect(Sentry.captureException).toHaveBeenCalled();
    await expect(getBest("cascade")).resolves.toBe(900);
  });

  it("a failed write resolves and is reported", async () => {
    setItem.mockRejectedValueOnce(new Error("full"));
    await expect(recordResult("cascade", 100)).resolves.toMatchObject({ improved: true });
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { subsystem: "personalBest", op: "save" },
    });
  });
});

/** Each game's save from before #3757, and the bests it holds. */
const LEGACY: ReadonlyArray<{
  game: PersonalBestGame;
  key: string;
  raw: string;
  bests: Record<string, number>;
}> = [
  { game: "cascade", key: "cascade_best_score", raw: "1234", bests: { _: 1234 } },
  { game: "starswarm", key: "starswarm.bestScore", raw: "8150", bests: { _: 8150 } },
  { game: "twenty48", key: "twenty48_best_score_v1", raw: "2048", bests: { _: 2048 } },
  { game: "yacht", key: "yacht_best_score_v1", raw: "245", bests: { _: 245 } },
  { game: "freecell", key: "freecell_stats_v1", raw: '{"bestMoves":80}', bests: { _: 80 } },
  {
    game: "solitaire",
    key: "solitaire_stats_v1",
    raw: '{"bestTimeMs":5000,"bestMoves":80,"gamesPlayed":4}',
    bests: { _: 5000 },
  },
  {
    game: "mahjong",
    key: "mahjong_stats_v1",
    raw: '{"bestScore":5,"bestTimeMs":1000,"bestTimeMsByLayout":{"turtle":1,"fort":"x","pyramid":400000}}',
    bests: { pyramid: 400_000 },
  },
  {
    game: "sudoku",
    key: "sudoku_stats_v1",
    raw: JSON.stringify({
      classic: { easy: { bestTimeS: 100 }, medium: { bestTimeS: 0 }, hard: { bestTimeS: 0 } },
      mini: { easy: { bestTimeS: 40 }, medium: { bestTimeS: 0 }, hard: { bestTimeS: 9 } },
    }),
    bests: { "classic.easy": 100, "mini.easy": 40, "mini.hard": 9 },
  },
  {
    game: "sudoku",
    key: "sudoku_stats_v1",
    // Before #748: the classic difficulties at the top level.
    raw: '{"easy":{"bestTimeS":50,"gamesSolved":3},"hard":null}',
    bests: { "classic.easy": 50 },
  },
];

describe.each(LEGACY)(
  "moving $game's save from before #3757 in ($key)",
  ({ game, key, raw, bests }) => {
    it("reads the old best, writes it in the new format and removes the old key", async () => {
      await AsyncStorage.setItem(key, raw);
      await expect(getBests(game)).resolves.toEqual(bests);
      expect(await stored(game)).toEqual({ v: 1, b: bests });
      await expect(AsyncStorage.getItem(key)).resolves.toBeNull();
    });

    it("is idempotent: a second read changes nothing", async () => {
      await AsyncStorage.setItem(key, raw);
      await getBests(game);
      setItem.mockClear();
      await expect(getBests(game)).resolves.toEqual(bests);
      expect(setItem).not.toHaveBeenCalled();
    });

    it("the old best counts for the next result (a new best only when beaten)", async () => {
      await AsyncStorage.setItem(key, raw);
      const [variant, best] = Object.entries(bests)[0];
      const lower =
        game === "freecell" || game === "solitaire" || game === "sudoku" || game === "mahjong";
      const worse = lower ? best + 1000 : best - 1;
      await expect(recordResult(game, variant, worse)).resolves.toEqual({
        best,
        improved: false,
        isNewBest: false,
      });
    });

    it("never lowers a best already in the new format", async () => {
      const [variant, best] = Object.entries(bests)[0];
      const lower =
        game === "freecell" || game === "solitaire" || game === "sudoku" || game === "mahjong";
      const better = lower ? best - 1 : best + 1;
      await AsyncStorage.setItem(storageKey(game), record({ [variant]: better }));
      await AsyncStorage.setItem(key, raw);
      await expect(getBest(game, variant)).resolves.toBe(better);
      await expect(AsyncStorage.getItem(key)).resolves.toBeNull();
    });

    it("keeps the old key when the new record can't be written, and moves it in next time", async () => {
      await AsyncStorage.setItem(key, raw);
      setItem.mockRejectedValueOnce(new Error("full"));
      await expect(getBests(game)).resolves.toEqual(bests);
      await expect(AsyncStorage.getItem(key)).resolves.toBe(raw);
      await expect(getBests(game)).resolves.toEqual(bests);
      await expect(AsyncStorage.getItem(key)).resolves.toBeNull();
    });
  }
);

describe("removing an older save fails", () => {
  it("keeps the moved best, reports it, and moves it in again (idempotently) next read", async () => {
    await AsyncStorage.setItem("cascade_best_score", "500");
    jest.mocked(AsyncStorage.removeMany).mockRejectedValueOnce(new Error("disk"));
    await expect(getBest("cascade")).resolves.toBe(500);
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { subsystem: "personalBest", op: "migrate" },
    });
    await recordResult("cascade", 800);
    await expect(getBest("cascade")).resolves.toBe(800);
    await expect(AsyncStorage.getItem("cascade_best_score")).resolves.toBeNull();
  });
});

describe("older saves that hold no best", () => {
  it.each([
    ["cascade", "cascade_best_score", "abc"],
    ["cascade", "cascade_best_score", "0"],
    ["starswarm", "starswarm.bestScore", "-5"],
    ["twenty48", "twenty48_best_score_v1", "abc"],
    ["yacht", "yacht_best_score_v1", String(MAX_YACHT_SCORE + 1)],
    ["freecell", "freecell_stats_v1", "{x"],
    ["freecell", "freecell_stats_v1", "null"],
    ["freecell", "freecell_stats_v1", '{"gamesWon":4,"bestMoves":"x"}'],
    ["solitaire", "solitaire_stats_v1", "null"],
    ["mahjong", "mahjong_stats_v1", "{x"],
    ["sudoku", "sudoku_stats_v1", "null"],
  ] as const)("%s: %s = %s reads as no best and is cleaned up", async (game, key, raw) => {
    await AsyncStorage.setItem(key, raw);
    await expect(getBests(game)).resolves.toEqual({});
    await expect(AsyncStorage.getItem(key)).resolves.toBeNull();
    await expect(AsyncStorage.getItem(storageKey(game))).resolves.toBeNull();
  });

  it("floors a fractional score as the old Cascade and Star Swarm reads did", async () => {
    await AsyncStorage.setItem("cascade_best_score", "1234.9");
    await expect(getBest("cascade")).resolves.toBe(1234);
  });
});
