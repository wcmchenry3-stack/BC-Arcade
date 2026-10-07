/**
 * Saved games keep loading across the `storageSlot` refactor (#2987).
 *
 * `__fixtures__/storageCompat.json` was recorded by running these scenarios
 * against the per-game `storage.ts` modules as they were before #2987 (each
 * one its own AsyncStorage/Sentry skeleton). Every scenario seeds the same
 * stored bytes (or builds the same state from seeded engines), runs the same
 * public calls, and compares what comes back, what is left in storage and
 * what was reported to Sentry. So a save written by an older build loads the
 * same, a new save is written byte for byte as before, and failures are
 * reported as before.
 *
 * Sort's failure paths are the one intended change (#2987: it swallowed every
 * error unreported): for those only the returned value is compared here, and
 * the new reporting is tested in `sort/__tests__/storage.test.ts`.
 *
 * Do not re-record the fixture from the current modules: it is the record of
 * the old behaviour.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

import fixture from "./__fixtures__/storageCompat.json";

import * as blackjack from "../../blackjack/storage";
import * as blackjackEngine from "../../blackjack/engine";
import * as cascade from "../../cascade/storage2";
import * as dailyWord from "../../daily_word/storage";
import { initialState as dailyWordInitial } from "../../daily_word/engine";
import * as freecell from "../../freecell/storage";
import * as freecellEngine from "../../freecell/engine";
import * as hearts from "../../hearts/storage";
import * as heartsEngine from "../../hearts/engine";
import * as mahjong from "../../mahjong/storage";
import * as mahjongEngine from "../../mahjong/engine";
import { TURTLE_LAYOUT } from "../../mahjong/layouts/turtle";
import type { MahjongState } from "../../mahjong/types";
import * as solitaire from "../../solitaire/storage";
import * as solitaireEngine from "../../solitaire/engine";
import * as sort from "../../sort/storage";
import * as sudoku from "../../sudoku/storage";
import * as sudokuEngine from "../../sudoku/engine";
import type { SudokuState } from "../../sudoku/types";
import * as twenty48 from "../../twenty48/storage";
import * as twenty48Engine from "../../twenty48/engine";
import * as yacht from "../../yacht/storage";
import * as yachtEngine from "../../yacht/engine";

const T0 = 1_700_000_000_000;
let now = T0;

type Fail = "getItem" | "setItem" | "removeItem";

interface Scenario {
  /** Stored before the scenario runs: key → raw string. */
  seed?: Record<string, string>;
  /** Storage calls that reject once (the first call of each). */
  fail?: Fail[];
  run: () => Promise<unknown>;
  /** What is compared; default everything. */
  compare?: "result";
}

/** `result` and `sentry` as JSON, so the fixture stays one line per value. */
interface Observation {
  result: string;
  storage: Record<string, string>;
  sentry: string;
}

// --- state builders (deterministic: seeded engines, pinned clock) ----------

function freecellState() {
  const s = freecellEngine.dealGame(42);
  // A nested history, which the save strips to one level.
  return { ...s, undoStack: [{ ...s, undoStack: [s] }] };
}

function solitaireState() {
  const s = solitaireEngine.dealGame(3, 42);
  const running = { ...s, startedAt: T0 - 30_000, accumulatedMs: 5_000 };
  return { ...running, undoStack: [{ ...running, undoStack: [running] }] };
}

function twenty48State() {
  twenty48Engine._resetTileIds();
  twenty48Engine.setRng(twenty48Engine.createSeededRng(7));
  let s = twenty48Engine.newGame();
  s = twenty48Engine.move(s, "left");
  s = twenty48Engine.move(s, "up");
  return { ...s, startedAt: T0 - 10_000, accumulatedMs: 2_000 };
}

function mahjongState(moves = 2): MahjongState {
  let s = mahjongEngine.createGame(TURTLE_LAYOUT, 12345);
  for (let i = 0; i < moves; i++) {
    const [a, b] = mahjongEngine.getAnyFreePair(s.tiles)!;
    s = mahjongEngine.selectTile(mahjongEngine.selectTile(s, a), b);
  }
  return s;
}

/** A version 1 Mahjong save (snapshot undo history), as pre-#2961 builds wrote it. */
function mahjongLegacyV1(): string {
  mahjongEngine.setRng(mahjongEngine.createSeededRng(11));
  let s = mahjongEngine.createGame(TURTLE_LAYOUT, 12345);
  const snapshots: unknown[] = [];
  for (let i = 0; i < 3; i++) {
    if (i === 1) {
      snapshots.push({ ...s, _v: 1, undoStack: [] });
      s = mahjongEngine.shuffleBoard(s);
    } else {
      const [a, b] = mahjongEngine.getAnyFreePair(s.tiles)!;
      snapshots.push({ ...s, _v: 1, selected: null, undoStack: [] });
      s = mahjongEngine.selectTile(mahjongEngine.selectTile(s, a), b);
    }
  }
  const { currentLayoutId: _layout, dealId: _deal, ...old } = s;
  return JSON.stringify({ ...old, _v: 1, undoStack: snapshots });
}

function sudokuState(): SudokuState {
  let s = sudokuEngine.loadPuzzle("easy", "classic", () => 0);
  let cell = { row: 0, col: 0 };
  outer: for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (!s.grid[r]![c]!.given) {
        cell = { row: r, col: c };
        break outer;
      }
    }
  }
  s = sudokuEngine.toggleNotesMode(s);
  s = sudokuEngine.selectCell(s, cell.row, cell.col);
  s = sudokuEngine.enterDigit(s, 7);
  s = sudokuEngine.enterDigit(s, 3);
  return s;
}

function heartsState() {
  heartsEngine.setRng(heartsEngine.createSeededRng(9));
  return { ...heartsEngine.dealGame("daring"), accumulatedMs: 61_000 };
}

function blackjackState() {
  blackjackEngine.setRng(blackjackEngine.createSeededRng(5));
  return blackjackEngine.newGame();
}

function yachtState() {
  yachtEngine.setRng(yachtEngine.createSeededRng(3));
  return yachtEngine.newGame();
}

const cascadeSave = {
  version: 3 as const,
  pieces: [
    { tier: 0, x: 10.5, y: 20.25 },
    { tier: 3, x: 140, y: 300 },
  ],
  score: 120,
  savedAt: T0,
  queue: { current: 1, next: 2 },
  playedMs: 45_000,
};

// --- scenarios --------------------------------------------------------------

const BAD_PAYLOADS: Record<string, string> = {
  "corrupt json": "{not json",
  "json null": "null",
  "json number": "5",
  "wrong shape": '{"_v":99}',
};

interface GameModule {
  key: string;
  save: () => Promise<unknown>;
  load: () => Promise<unknown>;
  clear: () => Promise<unknown>;
}

const GAME_MODULES: Record<string, GameModule> = {
  blackjack: {
    key: "blackjack_game_v2",
    save: () => blackjack.saveGame(blackjackState()),
    load: () => blackjack.loadGame(),
    clear: () => blackjack.clearGame(),
  },
  cascade: {
    key: "cascade_game_v3",
    save: () => cascade.saveGame(cascadeSave),
    load: () => cascade.loadGame(),
    clear: () => cascade.clearGame(),
  },
  daily_word: {
    key: "daily_word_state_v1",
    save: () => dailyWord.saveState(dailyWordInitial("2026-10-07:en", 5, "en")),
    load: () => dailyWord.loadState(),
    clear: () => dailyWord.clearState(),
  },
  freecell: {
    key: "freecell_game",
    save: () => freecell.saveGame(freecellState()),
    load: () => freecell.loadGame(),
    clear: () => freecell.clearGame(),
  },
  hearts: {
    key: "hearts_game",
    save: () => hearts.saveGame(heartsState()),
    load: () => hearts.loadGame(),
    clear: () => hearts.clearGame(),
  },
  mahjong: {
    key: "mahjong_game",
    save: () => mahjong.saveGame(mahjongState()),
    load: () => mahjong.loadGame(),
    clear: () => mahjong.clearGame(),
  },
  solitaire: {
    key: "solitaire_game",
    save: () => solitaire.saveGame(solitaireState()),
    load: () => solitaire.loadGame(),
    clear: () => solitaire.clearGame(),
  },
  sudoku: {
    key: "sudoku_game",
    save: () => sudoku.saveGame(sudokuState()),
    load: () => sudoku.loadGame(),
    clear: () => sudoku.clearGame(),
  },
  twenty48: {
    key: "twenty48_game_v2",
    save: () => twenty48.saveGame(twenty48State()),
    load: () => twenty48.loadGame(),
    clear: () => twenty48.clearGame(),
  },
  yacht: {
    key: "yacht_game_v2",
    save: () => yacht.saveGame(yachtState(), "hard", yachtState(), "game-123"),
    load: () => yacht.loadGame(),
    clear: () => yacht.clearGame(),
  },
};

function laterLoad(load: () => Promise<unknown>) {
  return async () => {
    now = T0 + 7_000; // reopened later: the clock must not count the gap
    return load();
  };
}

const scenarios: Record<string, Scenario> = {};

for (const [game, m] of Object.entries(GAME_MODULES)) {
  scenarios[`${game}: save writes`] = { run: m.save };
  scenarios[`${game}: save then load`] = {
    run: async () => {
      await m.save();
      return laterLoad(m.load)();
    },
  };
  scenarios[`${game}: nothing stored`] = { run: m.load };
  scenarios[`${game}: empty string stored`] = { seed: { [m.key]: "" }, run: m.load };
  for (const [name, raw] of Object.entries(BAD_PAYLOADS)) {
    scenarios[`${game}: ${name}`] = { seed: { [m.key]: raw }, run: m.load };
  }
  scenarios[`${game}: read fails`] = { fail: ["getItem"], run: m.load };
  scenarios[`${game}: write fails`] = { fail: ["setItem"], run: m.save };
  scenarios[`${game}: clear`] = {
    run: async () => {
      await m.save();
      return m.clear();
    },
  };
  scenarios[`${game}: clear fails`] = {
    seed: { [m.key]: "{}" },
    fail: ["removeItem"],
    run: m.clear,
  };
}

// Older formats, per game.
Object.assign(scenarios, {
  "blackjack: pre-split save": {
    seed: {
      blackjack_game_v2: JSON.stringify({
        chips: 900,
        bet: 100,
        phase: "player",
        deck: [{ rank: "2", suit: "hearts" }],
        player_hand: [{ rank: "K", suit: "spades" }],
        dealer_hand: [{ rank: "9", suit: "clubs" }],
        outcome: null,
        payout: 0,
      }),
    },
    run: blackjack.loadGame,
  },
  "cascade: save without playedMs": {
    seed: { cascade_game_v3: JSON.stringify({ ...cascadeSave, playedMs: undefined }) },
    run: cascade.loadGame,
  },
  "cascade: best score": {
    run: async () => {
      await cascade.saveBestScore(1234.9);
      return cascade.loadBestScore();
    },
  },
  "cascade: best score junk": { seed: { cascade_best_score: "abc" }, run: cascade.loadBestScore },
  "cascade: best score read fails": { fail: ["getItem"], run: cascade.loadBestScore },
  "cascade: best score write fails": { fail: ["setItem"], run: () => cascade.saveBestScore(5) },
  "daily_word: bad puzzle id": {
    seed: { daily_word_state_v1: JSON.stringify({ _v: 1, puzzle_id: "today", rows: [] }) },
    run: dailyWord.loadState,
  },
  "freecell: stats": {
    run: async () => {
      await freecell.saveStats({ bestMoves: 80, gamesPlayed: 3, gamesWon: 2 });
      return freecell.loadStats();
    },
  },
  "freecell: stats partial": {
    seed: { freecell_stats_v1: '{"gamesWon":4,"bestMoves":"x"}' },
    run: freecell.loadStats,
  },
  "freecell: stats none": { run: freecell.loadStats },
  "freecell: stats corrupt": { seed: { freecell_stats_v1: "{x" }, run: freecell.loadStats },
  "freecell: stats null": { seed: { freecell_stats_v1: "null" }, run: freecell.loadStats },
  "freecell: stats write fails": {
    fail: ["setItem"],
    run: () => freecell.saveStats({ bestMoves: 1, gamesPlayed: 1, gamesWon: 1 }),
  },
  "hearts: v2 save with an old persona": {
    seed: {
      hearts_game: JSON.stringify({
        ...heartsState(),
        _v: 2,
        aiDifficulty: undefined,
        accumulatedMs: undefined,
      }),
    },
    run: hearts.loadGame,
  },
  "hearts: v3 save with an old persona": {
    seed: { hearts_game: JSON.stringify({ ...heartsState(), aiDifficulty: "easy" }) },
    run: hearts.loadGame,
  },
  "hearts: bad play time": {
    seed: { hearts_game: JSON.stringify({ ...heartsState(), accumulatedMs: -4 }) },
    run: hearts.loadGame,
  },
  "hearts: invalid scores": {
    seed: { hearts_game: JSON.stringify({ ...heartsState(), handScores: [0, 0, 0, 99] }) },
    run: hearts.loadGame,
  },
  "hearts: clear forgets the finished game id": {
    seed: { hearts_pending_submission: "{}" },
    run: async () => {
      await hearts.saveGame(heartsState());
      await hearts.saveFinishedGameId("g-1");
      await hearts.clearGame();
      return hearts.loadFinishedGameId();
    },
  },
  "mahjong: v1 save (snapshot undo)": {
    seed: { mahjong_game: mahjongLegacyV1() },
    run: laterLoad(mahjong.loadGame),
  },
  "mahjong: v2 save with a bad undo entry": {
    seed: {
      mahjong_game: (() => {
        const s = mahjongState(3);
        return JSON.stringify({ ...s, undoStack: [s.undoStack[0], { bad: true }, s.undoStack[2]] });
      })(),
    },
    run: laterLoad(mahjong.loadGame),
  },
  "mahjong: finished board": {
    seed: {
      mahjong_game: JSON.stringify({ ...mahjongState(), isComplete: true, startedAt: T0 - 9_000 }),
    },
    run: laterLoad(mahjong.loadGame),
  },
  "mahjong: stats": {
    run: async () => {
      await mahjong.saveStats({
        bestScore: 300,
        bestTimeMsByLayout: { turtle: 300_000 },
        gamesPlayed: 4,
        gamesWon: 1,
      });
      return mahjong.loadStats();
    },
  },
  "mahjong: stats pre-#2747": {
    seed: {
      mahjong_stats_v1:
        '{"bestScore":5,"bestTimeMs":1000,"bestTimeMsByLayout":{"turtle":1,"fort":"x","pyramid":400000}}',
    },
    run: mahjong.loadStats,
  },
  "mahjong: stats none": { run: mahjong.loadStats },
  "mahjong: stats corrupt": { seed: { mahjong_stats_v1: "{x" }, run: mahjong.loadStats },
  "mahjong: stats write fails": {
    fail: ["setItem"],
    run: () =>
      mahjong.saveStats({ bestScore: 0, bestTimeMsByLayout: {}, gamesPlayed: 0, gamesWon: 0 }),
  },
  "mahjong: progress": {
    run: async () => {
      await mahjong.saveProgress({
        unlockedLayouts: ["turtle", "fort"],
        currentLayoutId: "fort",
        currentState: null,
      });
      return mahjong.loadProgress();
    },
  },
  "mahjong: progress partial": {
    seed: { "@mahjong/progress": '{"unlockedLayouts":"x","currentLayoutId":3}' },
    run: mahjong.loadProgress,
  },
  "mahjong: progress none": { run: mahjong.loadProgress },
  "mahjong: progress corrupt": { seed: { "@mahjong/progress": "{x" }, run: mahjong.loadProgress },
  "mahjong: progress write fails": {
    fail: ["setItem"],
    run: () => mahjong.saveProgress(mahjong.DEFAULT_PROGRESS),
  },
  "solitaire: save without timer fields": {
    seed: {
      solitaire_game: JSON.stringify({
        ...solitaireEngine.dealGame(1, 8),
        startedAt: undefined,
        accumulatedMs: undefined,
      }),
    },
    run: laterLoad(solitaire.loadGame),
  },
  "solitaire: stats": {
    run: async () => {
      await solitaire.saveStats({ bestTimeMs: 99_000 });
      return solitaire.loadStats();
    },
  },
  "solitaire: stats with old counters": {
    seed: { solitaire_stats_v1: '{"bestTimeMs":5000,"bestMoves":80,"gamesPlayed":4}' },
    run: async () => {
      const stats = await solitaire.loadStats();
      await solitaire.saveStats(stats);
      return stats;
    },
  },
  "solitaire: stats null": { seed: { solitaire_stats_v1: "null" }, run: solitaire.loadStats },
  "solitaire: stats corrupt": { seed: { solitaire_stats_v1: "{x" }, run: solitaire.loadStats },
  "solitaire: stats write fails": {
    fail: ["setItem"],
    run: () => solitaire.saveStats({ bestTimeMs: 1 }),
  },
  "sudoku: save without variant": {
    seed: {
      sudoku_game: (() => {
        const s = sudokuEngine.loadPuzzle("medium", "classic", () => 0);
        const grid = s.grid.map((row) =>
          row.map((c) => ({ value: c.value, given: c.given, notes: [], isError: c.isError }))
        );
        return JSON.stringify({
          _v: 1,
          difficulty: "medium",
          puzzle: s.puzzle,
          solution: s.solution,
          grid,
          selectedRow: null,
          selectedCol: null,
          notesMode: false,
          errorCount: 0,
          isComplete: false,
          undoStack: [],
        });
      })(),
    },
    run: sudoku.loadGame,
  },
  "sudoku: stats": {
    run: async () => {
      const stats = {
        classic: { easy: { bestTimeS: 100 }, medium: { bestTimeS: 0 }, hard: { bestTimeS: 0 } },
        mini: { easy: { bestTimeS: 40 }, medium: { bestTimeS: 0 }, hard: { bestTimeS: 9 } },
      };
      await sudoku.saveStats(stats);
      return sudoku.loadStats();
    },
  },
  "sudoku: stats pre-#748 flat": {
    seed: { sudoku_stats_v1: '{"easy":{"bestTimeS":50,"gamesSolved":3},"hard":null}' },
    run: sudoku.loadStats,
  },
  "sudoku: stats none": { run: sudoku.loadStats },
  "sudoku: stats corrupt": { seed: { sudoku_stats_v1: "{x" }, run: sudoku.loadStats },
  "sudoku: stats null": { seed: { sudoku_stats_v1: "null" }, run: sudoku.loadStats },
  "sudoku: stats write fails": {
    fail: ["setItem"],
    run: () => sudoku.saveStats(sudoku.EMPTY_SUDOKU_STATS),
  },
  "twenty48: save without tiles (pre-#570)": {
    seed: {
      twenty48_game_v2: JSON.stringify({
        board: [
          [2, 0, 0, 4],
          [0, 8, 0, 0],
          [0, 0, 0, 0],
          [16, 0, 0, 2],
        ],
        score: 36,
      }),
    },
    run: async () => {
      twenty48Engine._resetTileIds();
      const loaded = await laterLoad(twenty48.loadGame)();
      // The tile-id counter was re-seeded above the restored ids.
      twenty48Engine.setRng(twenty48Engine.createSeededRng(1));
      return { loaded, next: twenty48Engine.move(loaded as never, "right").tiles };
    },
  },
  "twenty48: best score": {
    run: async () => {
      await twenty48.saveBestScore(2048);
      return twenty48.loadBestScore();
    },
  },
  "twenty48: best score junk": {
    seed: { twenty48_best_score_v1: "abc" },
    run: twenty48.loadBestScore,
  },
  "twenty48: best score read fails": { fail: ["getItem"], run: twenty48.loadBestScore },
  "twenty48: best score write fails": { fail: ["setItem"], run: () => twenty48.saveBestScore(8) },
  "yacht: bad finished-game id": {
    seed: {
      yacht_game_v2: JSON.stringify({
        state: yachtState(),
        aiDifficulty: null,
        aiState: null,
        finishedGameId: "",
      }),
    },
    run: yacht.loadGame,
  },
  "yacht: solo save": { run: () => yacht.saveGame(yachtState()) },
  // Sort: saved progress, cache and bests keep their bytes and load the same.
  "sort: progress": {
    run: async () => {
      await sort.saveProgress({
        unlockedLevel: 4,
        currentLevelId: 3,
        currentState: {
          bottles: [["red", "blue"], []],
          moveCount: 2,
          undosUsed: 0,
          isComplete: false,
          selectedBottleIndex: null,
        },
      });
      return sort.loadProgress();
    },
  },
  "sort: progress none": { run: sort.loadProgress },
  "sort: levels cache": {
    run: async () => {
      await sort.saveLevelsCache({ levels: [{ id: 1, bottles: [["red"], []] }] } as never);
      return sort.loadLevelsCache();
    },
  },
  "sort: levels cache none": { run: sort.loadLevelsCache },
  "sort: best moves": {
    run: async () => {
      await sort.saveBestMoves({ "1": 8, "2": 11 });
      return sort.loadBestMoves();
    },
  },
  "sort: best moves filtered": {
    seed: { "@sort/best_moves": '{"1":5,"2":"x","3":-1}' },
    run: sort.loadBestMoves,
  },
  "sort: clear": {
    run: async () => {
      await sort.saveBestMoves({ "1": 8 });
      await sort.saveProgress({ unlockedLevel: 2, currentLevelId: null, currentState: null });
      return sort.clearGame();
    },
  },
  // Sort failure paths: the value returned is unchanged; reporting is new.
  "sort: progress corrupt": {
    seed: { "@sort/progress": "{x" },
    run: sort.loadProgress,
    compare: "result",
  },
  "sort: progress read fails": { fail: ["getItem"], run: sort.loadProgress, compare: "result" },
  "sort: levels cache corrupt": {
    seed: { "@sort/levels_cache": "oops" },
    run: sort.loadLevelsCache,
    compare: "result",
  },
  "sort: levels cache read fails": {
    fail: ["getItem"],
    run: sort.loadLevelsCache,
    compare: "result",
  },
  "sort: best moves corrupt": {
    seed: { "@sort/best_moves": "{x" },
    run: sort.loadBestMoves,
    compare: "result",
  },
  "sort: best moves read fails": { fail: ["getItem"], run: sort.loadBestMoves, compare: "result" },
  "sort: best moves write fails": {
    fail: ["setItem"],
    run: () => sort.saveBestMoves({ "1": 2 }),
    compare: "result",
  },
} satisfies Record<string, Scenario>);

// --- harness ----------------------------------------------------------------

/** As JSON, with Sets (Sudoku notes), errors and `undefined` made comparable. */
function json(value: unknown): string {
  if (value === undefined) return '"__undefined"';
  return JSON.stringify(value, (_k, v: unknown) => {
    if (v instanceof Set) return { __set: [...(v as Set<unknown>)] };
    if (v instanceof Error) return { __error: String(v) };
    return v;
  });
}

async function observe(s: Scenario): Promise<Observation> {
  await AsyncStorage.clear();
  for (const [k, v] of Object.entries(s.seed ?? {})) await AsyncStorage.setItem(k, v);
  jest.clearAllMocks();
  for (const f of s.fail ?? []) {
    jest.spyOn(AsyncStorage, f).mockRejectedValueOnce(new Error(`${f} failed`));
  }
  now = T0;
  const result = await s.run();
  const sentry = [
    ...(Sentry.captureException as jest.Mock).mock.calls.map((a) => ["captureException", ...a]),
    ...(Sentry.captureMessage as jest.Mock).mock.calls.map((a) => ["captureMessage", ...a]),
    ...(Sentry.addBreadcrumb as jest.Mock).mock.calls.map((a) => ["addBreadcrumb", ...a]),
  ];
  const keys = [...(await AsyncStorage.getAllKeys())].sort();
  const storage: Record<string, string> = {};
  for (const k of keys) storage[k] = (await AsyncStorage.getItem(k)) as string;
  return { result: json(result), storage, sentry: json(sentry) };
}

beforeEach(() => {
  jest.restoreAllMocks();
  jest.spyOn(Date, "now").mockImplementation(() => now);
});

const recorded = fixture as Record<string, Observation>;

describe("saved games load the same after #2987 (fixtures from the old modules)", () => {
  it("has a recording for every scenario, and a scenario for every recording", () => {
    expect(Object.keys(scenarios).sort()).toEqual(Object.keys(recorded).sort());
  });

  it.each(Object.keys(scenarios))("%s", async (name) => {
    const scenario = scenarios[name]!;
    const got = await observe(scenario);
    const want = recorded[name]!;
    expect(JSON.parse(got.result)).toEqual(JSON.parse(want.result));
    if (scenario.compare === "result") return;
    // Stored bytes are compared exactly: the on-disk format must not move.
    expect(got.storage).toEqual(want.storage);
    expect(JSON.parse(got.sentry)).toEqual(JSON.parse(want.sentry));
  });
});
