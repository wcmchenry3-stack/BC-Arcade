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
 * FreeCell's and Mahjong's stats scenarios are the other intended change (#3140): the retired
 * play, win and score counters are no longer kept, so those nine recorded results were edited
 * by hand to drop those fields (nothing else in them moved).
 *
 * Daily Word's board moved from the one `daily_word_state_v1` slot to one key
 * per puzzle (#3230): its recorded scenarios were edited by hand to the new
 * key, `daily_word_board_2026-10-07:en` (the bytes, results and reports are
 * unchanged). "read fails" keeps the old key, because the first read is now
 * the migration's read of the old slot, and "bad puzzle id" seeds the old slot.
 *
 * Sort's level cache (`@sort/levels_cache`) is gone (#2761): the levels ship
 * in the app, so its four recorded scenarios were removed with it.
 *
 * Cascade's save moved to the 12-tier ladder (#3695): its recorded scenarios were edited by hand
 * to the new key, `cascade_game_v4`, and `"version":4` (the bytes and results are otherwise
 * unchanged). Discarding an old `cascade_game_v3` save is tested in `cascade/__tests__/storage.test.ts`.
 * #3697 (the lively ladder on planck.js) moved it again, to `cascade_game_v5` and `"version":5`,
 * edited by hand the same way; discarding a v4 save is tested in the same file.
 *
 * The best scores moved to the shared personal best (#3757, `personalBest.ts`): the scenarios of
 * each game's old best-score record were removed with it (Cascade, FreeCell, Mahjong, Solitaire,
 * Sudoku, 2048). Reading those old bytes is tested in `personalBest.test.ts`, which moves them in.
 * Sort's best moves followed (#3821): its five best-moves scenarios were removed the same way, and
 * their recorded bytes are the old-format fixtures of `sort/__tests__/bestMovesMigration.test.ts`.
 * "sort: clear" seeds its old bests (the same bytes) instead of writing them through the module.
 *
 * Do not re-record the fixture from the current modules: it is the record of
 * the old behaviour.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

import fixture from "./__fixtures__/storageCompat.json";

import * as blackjack from "../../blackjack/storage";
import * as blackjackEngine from "../../blackjack/engine";
import * as cascade from "../../cascade/storage";
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
  version: 5 as const,
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
    key: "cascade_game_v5",
    save: () => cascade.saveGame(cascadeSave),
    load: () => cascade.loadGame(),
    clear: () => cascade.clearGame(),
  },
  // One board per puzzle since #3230: the same bytes under the puzzle's key.
  daily_word: {
    key: "daily_word_board_2026-10-07:en",
    save: () => dailyWord.saveState(dailyWordInitial("2026-10-07:en", 5, "en")),
    load: () => dailyWord.loadState("2026-10-07:en"),
    clear: () => dailyWord.clearState("2026-10-07:en"),
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
    seed: { cascade_game_v5: JSON.stringify({ ...cascadeSave, playedMs: undefined }) },
    run: cascade.loadGame,
  },
  "daily_word: bad puzzle id": {
    seed: { daily_word_state_v1: JSON.stringify({ _v: 1, puzzle_id: "today", rows: [] }) },
    run: () => dailyWord.loadState("2026-10-07:en"),
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
  // Sort: saved progress and bests keep their bytes and load the same.
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
  "sort: clear": {
    // The old bests are seeded in the bytes the old `saveBestMoves` wrote (#3821: the app now
    // writes them to the shared personal best); clearing the game must still leave them alone.
    seed: { "@sort/best_moves": '{"1":8}' },
    run: async () => {
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
} satisfies Record<string, Scenario>);

// --- harness ----------------------------------------------------------------

/** As JSON, with Sets (Sudoku notes), errors and `undefined` made comparable. */
function json(value: unknown): string {
  if (value === undefined) return '"__undefined"';
  return JSON.stringify(value, (_k, v: unknown) => {
    if (v instanceof Set) return { __set: [...(v as Set<unknown>)] };
    if (v instanceof Error) return { __error: String(v) };
    return v;
  }).replace(V8_JSON_ERROR_POSITION, "");
}

/**
 * Newer V8 appends " (line L column C)" to JSON.parse error messages, whether
 * they surface as an Error or as a string in Sentry extras; drop it so the
 * recording compares equal across Node versions.
 */
const V8_JSON_ERROR_POSITION = / \(line \d+ column \d+\)/g;

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
