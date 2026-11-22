/**
 * The lobby's read cost (#4008): the worst-case saves each game can store (a full 50-step undo
 * history) are the biggest payloads the lobby parses. Prints each save's size and the median read
 * time (`getLobbyStatus`) so the PR can report them, and holds a loose ceiling so a regression
 * (a slow parse, a second read) fails. The writes and reports are counted at zero.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

import { newGame as newYacht } from "../../yacht/engine";
import { newGame as new2048 } from "../../twenty48/engine";
import { dealGame as dealSolitaire } from "../../solitaire/engine";
import { dealGame as dealFreeCell } from "../../freecell/engine";
import { loadPuzzle } from "../../sudoku/engine";
import { UNDO_CAP } from "../undoStack";
import { UNDO_STACK_LIMIT } from "../../sudoku/types";
import { saveGame as saveYacht } from "../../yacht/storage";
import { saveGame as save2048 } from "../../twenty48/storage";
import { saveGame as saveSolitaire } from "../../solitaire/storage";
import { saveGame as saveFreeCell } from "../../freecell/storage";
import { saveGame as saveSudoku } from "../../sudoku/storage";
import { getLobbyStatus as yacht } from "../../yacht/lobbyStatus";
import { getLobbyStatus as twenty48 } from "../../twenty48/lobbyStatus";
import { getLobbyStatus as solitaire } from "../../solitaire/lobbyStatus";
import { getLobbyStatus as freecell } from "../../freecell/lobbyStatus";
import { getLobbyStatus as sudoku } from "../../sudoku/lobbyStatus";
import type { TileStatus } from "../lobbyStatus";

const RUNS = 15;

async function medianMs(read: () => Promise<TileStatus | undefined>): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    await read();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(RUNS / 2)] ?? 0;
}

describe("lobby status read cost (#4008)", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it("parses the largest saves quickly, writes nothing and reports nothing", async () => {
    const solitaireDeal = dealSolitaire(1, 7);
    const freecellDeal = dealFreeCell(11);
    const sudokuPuzzle = loadPuzzle("hard", "classic", () => 0);
    const saves: Array<{
      game: string;
      key: string;
      write: () => Promise<void>;
      read: () => Promise<TileStatus | undefined>;
    }> = [
      {
        game: "yacht",
        key: "yacht_game_v2",
        write: () => saveYacht(newYacht(), "hard", newYacht()),
        read: yacht,
      },
      {
        game: "twenty48",
        key: "twenty48_game_v2",
        write: () => save2048({ ...new2048(), score: 9 }),
        read: twenty48,
      },
      {
        game: "solitaire (50 undo)",
        key: "solitaire_game",
        write: () =>
          saveSolitaire({
            ...solitaireDeal,
            score: 5,
            undoStack: Array.from({ length: UNDO_CAP }, () => ({
              ...solitaireDeal,
              undoStack: [],
            })),
          }),
        read: solitaire,
      },
      {
        game: "freecell (50 undo)",
        key: "freecell_game",
        write: () =>
          saveFreeCell({
            ...freecellDeal,
            moveCount: 9,
            undoStack: Array.from({ length: UNDO_CAP }, () => ({ ...freecellDeal, undoStack: [] })),
          }),
        read: freecell,
      },
      {
        game: "sudoku (50 undo)",
        key: "sudoku_game",
        write: () =>
          saveSudoku({
            ...sudokuPuzzle,
            undoStack: Array.from({ length: UNDO_STACK_LIMIT }, () => ({
              ...sudokuPuzzle,
              undoStack: [],
            })),
          }),
        read: sudoku,
      },
    ];

    const report: string[] = [];
    for (const { game, key, write, read } of saves) {
      await write();
      const bytes = (await AsyncStorage.getItem(key))?.length ?? 0;
      (AsyncStorage.setItem as jest.Mock).mockClear();
      (AsyncStorage.removeItem as jest.Mock).mockClear();
      const ms = await medianMs(read);
      expect(AsyncStorage.setItem).not.toHaveBeenCalled();
      expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
      // A bound only for a regression: the real figure is a few ms (see the report below).
      expect(ms).toBeLessThan(100);
      report.push(`${game}: ${(bytes / 1024).toFixed(1)} KB, median read ${ms.toFixed(2)} ms`);
    }
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    // eslint-disable-next-line no-console -- the measurement is the point of this test
    console.log(`lobby status read cost\n${report.join("\n")}`);
  });
});
