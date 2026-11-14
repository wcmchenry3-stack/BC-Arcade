/**
 * Every game's replay rules are chosen by `engine_version` (#3912). For each game
 * with a replay: its `REPLAY_ENGINES` replays the version it records today with
 * today's engine, a `game_started` without the field replays as version 1, an
 * older version registered with `withLegacy` (a test-only fake: no game has a
 * second version yet) replays with its own rules, and an unknown version is
 * incompatible, with no rules to rebuild anything with.
 */

import * as blackjackEngine from "../../blackjack/engine";
import * as blackjack from "../../blackjack/replay";
import * as dailyWordEngine from "../../daily_word/engine";
import * as dailyWord from "../../daily_word/replay";
import * as freecellEngine from "../../freecell/engine";
import * as freecell from "../../freecell/replay";
import * as heartsEngine from "../../hearts/engine";
import * as hearts from "../../hearts/replay";
import * as mahjongEngine from "../../mahjong/engine";
import * as mahjong from "../../mahjong/replay";
import * as solitaireEngine from "../../solitaire/engine";
import * as solitaire from "../../solitaire/replay";
import * as sort from "../../sort/replay";
import * as sudokuEngine from "../../sudoku/engine";
import * as sudoku from "../../sudoku/replay";
import * as twenty48Engine from "../../twenty48/engine";
import * as twenty48 from "../../twenty48/replay";
import * as yachtEngine from "../../yacht/engine";
import * as yacht from "../../yacht/replay";
import type { ReplayEngines } from "../replayEngine";

interface Case {
  readonly game: string;
  readonly engines: ReplayEngines<object>;
  readonly version: number;
  /** The engine functions today's rules must be. */
  readonly rules: Record<string, unknown>;
  /** What a game_started from this game looks like, without the version. */
  readonly started: Record<string, unknown>;
}

const CASES: readonly Case[] = [
  {
    game: "solitaire",
    engines: solitaire.REPLAY_ENGINES,
    version: solitaireEngine.ENGINE_VERSION,
    rules: { dealGame: solitaireEngine.dealGame, applyAction: solitaire.applyAction },
    started: { seed: 10, draw_mode: 1 },
  },
  {
    game: "freecell",
    engines: freecell.REPLAY_ENGINES,
    version: freecellEngine.ENGINE_VERSION,
    rules: { dealGame: freecellEngine.dealGame, applyAction: freecell.applyAction },
    started: { seed: 116 },
  },
  {
    game: "mahjong",
    engines: mahjong.REPLAY_ENGINES,
    version: mahjongEngine.ENGINE_VERSION,
    rules: {
      createGame: mahjongEngine.createGame,
      selectTile: mahjongEngine.selectTile,
      undoMove: mahjongEngine.undoMove,
      shuffleBoard: mahjongEngine.shuffleBoard,
    },
    started: { layout: "turtle", seed: 42 },
  },
  {
    game: "sort",
    engines: sort.REPLAY_ENGINES,
    version: sort.SORT_REPLAY_ENGINE_VERSION,
    rules: { rebuild: sort.rebuild },
    started: { level: 1, catalog: 1 },
  },
  {
    game: "sudoku",
    engines: sudoku.REPLAY_ENGINES,
    version: sudokuEngine.ENGINE_VERSION,
    rules: {
      enterDigit: sudokuEngine.enterDigit,
      eraseCell: sudokuEngine.eraseCell,
      undo: sudokuEngine.undo,
      applyHint: sudokuEngine.applyHint,
    },
    started: { difficulty: "easy", variant: "classic", puzzle: "0".repeat(81) },
  },
  {
    game: "hearts",
    engines: hearts.REPLAY_ENGINES,
    version: heartsEngine.ENGINE_VERSION,
    rules: {
      dealGame: heartsEngine.dealGame,
      dealNextHand: heartsEngine.dealNextHand,
      commitPass: heartsEngine.commitPass,
      playCard: heartsEngine.playCard,
      detectMoon: heartsEngine.detectMoon,
    },
    started: { initial_score: 0, preset: "conservative", target: 100 },
  },
  {
    game: "yacht",
    engines: yacht.REPLAY_ENGINES,
    version: yachtEngine.ENGINE_VERSION,
    rules: {
      calculateScore: yachtEngine.calculateScore,
      calculateJokerScore: yachtEngine.calculateJokerScore,
      jokerActive: yachtEngine.jokerActive,
    },
    started: { v: 1, mode: "solo" },
  },
  {
    game: "twenty48",
    engines: twenty48.REPLAY_ENGINES,
    version: twenty48Engine.ENGINE_VERSION,
    rules: { slideAndMerge: twenty48Engine.slideAndMerge },
    started: { initial_board: new Array(16).fill(0) },
  },
  {
    game: "blackjack",
    engines: blackjack.REPLAY_ENGINES,
    version: blackjackEngine.ENGINE_VERSION,
    rules: { handValue: blackjackEngine.handValue },
    started: { starting_chips: 1000 },
  },
  {
    game: "daily_word",
    engines: dailyWord.REPLAY_ENGINES,
    version: dailyWordEngine.ENGINE_VERSION,
    rules: {}, // its rules are rebuildV1, private: daily_word/__tests__/replayEngine.test.ts replays it
    started: { puzzle_id: "2026-05-03:en" },
  },
];

describe.each(CASES)("$game replay engines (#3912)", (c) => {
  it("is keyed by the game and the version it records today", () => {
    expect(c.engines.game).toBe(c.game);
    expect(c.engines.current).toBe(c.version);
    expect(c.engines.supported).toEqual([c.version]);
  });

  it("replays the current version with today's engine", () => {
    const r = c.engines.resolve({ ...c.started, engine_version: c.version });
    expect(r.kind).toBe("current");
    if (r.kind === "incompatible") return;
    for (const [name, fn] of Object.entries(c.rules)) {
      expect((r.rules as Record<string, unknown>)[name]).toBe(fn);
    }
  });

  it("replays a game_started without engine_version (an older build) as version 1", () => {
    expect(c.version).toBe(1); // the day this changes, missing must still mean 1: register v1 as legacy
    const r = c.engines.resolve(c.started);
    expect(r).toMatchObject({ kind: "current", version: 1 });
  });

  it("replays a still-supported older version with its frozen rules, not today's", () => {
    const frozen = { frozen: true };
    const reg = c.engines.withLegacy(0, frozen);
    expect(reg.resolve({ ...c.started, engine_version: 0 })).toEqual({
      kind: "legacy",
      version: 0,
      rules: frozen,
    });
    expect(reg.resolve({ ...c.started, engine_version: c.version }).kind).toBe("current");
  });

  it.each([c.version + 1, 0, "1", null, true])(
    "reads engine_version %j as incompatible, with nothing to rebuild with",
    (version) => {
      const r = c.engines.resolve({ ...c.started, engine_version: version });
      expect(r.kind).toBe("incompatible");
      expect(r).not.toHaveProperty("rules");
      expect(r.kind === "incompatible" && r.reason).toContain(`this reader rebuilds ${c.version}`);
    }
  );
});
