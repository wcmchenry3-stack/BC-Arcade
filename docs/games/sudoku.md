# Sudoku

**Category:** Puzzle  
**Tier:** Free in the v1.0 store build

Sudoku is a local, offline-capable puzzle game with Classic 9×9 and Mini 6×6 variants, three difficulty tiers, notes, hints, undo, saved progress, and separate leaderboard partitions for each difficulty/variant combination.

Shared session/offline/reporting behavior is defined by [GAME-CONTRACT.md](../GAME-CONTRACT.md) and the shared leaderboard documentation. This page owns Sudoku-specific gameplay and scoring rules.

## How to Play

Fill every empty cell so every row, column, and box contains each allowed digit exactly once.

### Variants

| Variant | Grid | Digits | Box shape |
| --- | ---: | --- | --- |
| Classic | 9×9 | 1–9 | 3×3 |
| Mini | 6×6 | 1–6 | 2×3 |

Pre-filled givens cannot be changed.

## Puzzle banks and difficulty

Sudoku is **not served from the backend**. Both puzzle banks ship inside the frontend:

- `frontend/src/game/sudoku/puzzles.json` — Classic;
- `frontend/src/game/sudoku/puzzles_mini.json` — Mini.

The JSON files are the source of truth, but the app ships them packed: `frontend/src/game/sudoku/puzzleBanks.generated.ts` holds each difficulty's puzzles joined, zlib-compressed and base64-encoded (see `puzzleCodec.ts`), which keeps about 205 KB out of the JS bundle (#2869). The engine unpacks one difficulty the first time a game needs it, so Sudoku still works offline. After regenerating either JSON file, re-pack from the repo root with `npx --prefix frontend tsx tools/generators/pack-sudoku-puzzles.ts`, then run Prettier on the generated file. `puzzleBanks.test.ts` fails until the packed banks match the JSON exactly.

Each bank contains **1,000 puzzles per difficulty**, for 3,000 Classic + 3,000 Mini puzzles.

Difficulty is classified by clue count:

| Difficulty | Classic clues | Mini clues |
| --- | ---: | ---: |
| Easy | 36–44 | 14–18 |
| Medium | 28–35 | 11–13 |
| Hard | 22–27 | 8–10 |

The generator removes clues only when uniqueness is preserved. Backend puzzle-bank tests verify all 3,000 Classic puzzles have exactly one solution and the expected clue range; Mini verifies every puzzle's clue range and a 50-puzzle-per-tier uniqueness sample.

The game randomly selects a puzzle from the chosen local bank. The last **difficulty** started is remembered for the next visit; the current variant is restored when resuming a saved puzzle.

## Controls and interaction

- Tap a cell to select it. Tapping the selected cell again deselects it.
- Given cells can be selected/highlighted but cannot be edited.
- Tap a digit to enter it in the selected editable cell.
- The number pad shows how many instances of each digit remain; a digit is disabled once all instances are on the grid.
- **Erase** clears the selected editable cell's value and notes.
- **Notes** toggles pencil-mark mode.
- **Undo** restores the previous placement/erase snapshot; the history is capped at 50 entries.
- **Hint** fills the selected empty editable cell with its correct solution digit (or, on a full grid that is not the solution, corrects a wrong cell; see Errors and completion).
- **Show mistakes** switch under the grid (see Errors and completion).

### Notes

In Notes mode, tapping a digit toggles that pencil mark in the selected cell.

Notes:
- do not increment the error count;
- do not complete a cell;
- do not create an undo snapshot.

Normal digit placement clears that cell's pencil marks.

### Hints

A hint:
- works only on a selected, empty, non-given cell;
- enters the correct solution digit through the normal placement logic;
- starts the puzzle clock (if not already running) on any press, even one that does nothing such as no cell selected, and starts the sync session only when it actually places a digit;
- creates a normal undo snapshot;
- does **not** add an error or carry a separate score penalty.

## Errors and completion

Only **illegal moves** are errors (#2943). A digit is illegal when it duplicates a digit already in its row, column or box (givens included). The check is against the board, not the stored solution:

- an illegal digit stays on the board, is coloured as an error, increments `errorCount` and flashes the screen;
- a **legal but incorrect** digit (one that breaks no rule but is not the solution digit) is not an error: it is not counted, does not flash, costs no score and is not coloured, unless Show mistakes is on (below);
- the error colour follows the current board: erasing or changing the conflicting digit clears the highlight, and both cells of a conflict between two player digits are highlighted. `errorCount` counts illegal **entries** made, so removing the duplicate afterwards does not refund the error (undo does);
- a legal placement can trigger row/column/box completion feedback;
- the puzzle finishes only when every cell matches the solution (completion stays solution-based).

Undo restores the previous error count, so undoing an illegal placement removes that error from the eventual score.

### Full grid that is not the solution

When every cell is filled but the grid is not the solution, a message under the grid says that something is off, with a **Hint** button. That Hint selects a wrong cell (the selected one if it is wrong, otherwise the first in reading order) and corrects it with the solution digit, with no error and no penalty. If it was the only wrong cell the puzzle completes.

### Show mistakes

A switch under the grid colours legal-but-incorrect digits as mistakes. It is visual only: no count, no flash, no score effect. Illegal digits are always highlighted regardless of it. The default is **on for Easy, off for Medium and Hard**; once the player flips it, that choice is stored on the device (`sudoku_show_mistakes`) and applies to every puzzle, whatever its difficulty.

### Old saves

Cell `isError` is persisted, but its meaning is "currently illegal" and it is re-derived from the board when a save loads, so saves written under the old rule (flag = differs from the solution) load and render by the new rules. The saved `errorCount` is kept as is.

## Scoring

Sudoku ranks by a simple accuracy score; elapsed time does **not** affect leaderboard score.

`score = max(0, difficulty base − 10 × errors)`

| Difficulty | Base / maximum score |
| --- | ---: |
| Easy | 100 |
| Medium | 200 |
| Hard | 300 |

`errors` is the number of illegal moves (rule conflicts), not the number of digits that differ from the solution. Hints have no direct penalty because they enter a correct digit, even when it duplicates a wrong digit the player left in a peer cell.

### Leaderboard partitions

There are six separate boards:

- Easy / Classic
- Medium / Classic
- Hard / Classic
- Easy / Mini
- Medium / Mini
- Hard / Mini

Rows from older builds without a variant are treated as Classic.

Equal scores use the shared final tie rule: earlier completion ranks first.

## Timer

The on-screen timer starts on the **first interaction** (#2942): the first cell press, number pad press or hint press, whichever comes first, even one that changes nothing (for example, a digit with no cell selected). It does not start when the grid renders, so the HUD shows 0:00 until the player touches the board. The sync session still starts only on the first state-changing move, so a puzzle where the player only selected cells is discarded, not abandoned (see Session outcomes). A first interaction that lands while the player is away starts the clock paused.

It pauses while:
- the app is backgrounded; or
- another screen such as Stats/Leaderboard covers the puzzle.

A saved puzzle restores the board, notes, errors, and undo history after relaunch, but **elapsed time is not persisted**. If the restored puzzle already contains play, its timer restarts from 0 for the new process. This is current intentional behavior.

The device also keeps local best-time data for result-card presentation; server Stats/history remain authoritative for historical reporting.

## Save / resume

The complete Sudoku state is saved to AsyncStorage after state changes, including:

- chosen puzzle/solution;
- variant/difficulty;
- cell values;
- notes;
- errors;
- selection/mode state;
- undo history.

A killed app can therefore resume the exact puzzle state. Starting a new puzzle or changing settings clears/replaces the saved puzzle.

## Session outcomes

Sudoku has no competitive winner concept.

- Solving the puzzle records `completed` with the computed score and result `{ won: true, errors }`.
- Leaving/changing/restarting after play records `abandoned` with `{ won: false, errors }` and no ranked score.
- An untouched puzzle (including one where only cells were selected) can be discarded without creating a meaningful played result.

Per-game creation metadata is:
- `difficulty`;
- `variant`.

For generic syncing, ranking, display-name, Stats, and result-card behavior, see [GAME-CONTRACT.md](../GAME-CONTRACT.md).

## Implementation

- Engine: `frontend/src/game/sudoku/engine.ts`
- Types/config: `frontend/src/game/sudoku/types.ts`
- Screen: [`frontend/src/screens/SudokuScreen.tsx`](../../frontend/src/screens/SudokuScreen.tsx) (its header lists the screen's concerns; see [GAMEPLAY_STANDARDS §8](../GAMEPLAY_STANDARDS.md#8-screen-layer))
- Storage: `frontend/src/game/sudoku/storage.ts`
- Classic bank: `frontend/src/game/sudoku/puzzles.json`
- Mini bank: `frontend/src/game/sudoku/puzzles_mini.json`
- Packed banks (shipped): `frontend/src/game/sudoku/puzzleBanks.generated.ts`, written by `tools/generators/pack-sudoku-puzzles.ts`
- Generator: `backend/scripts/gen_sudoku_puzzles.py`
- Bank verification: `backend/tests/test_sudoku_puzzles.py`
- Backend descriptor: `backend/sudoku/module.py`
