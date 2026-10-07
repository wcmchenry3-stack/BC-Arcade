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
- **Hint** fills the selected empty editable cell with its correct solution digit.

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
- starts the puzzle timer/session if this is the first real input;
- creates a normal undo snapshot;
- does **not** add an error or carry a separate score penalty.

## Errors and completion

A normal digit entry is compared with the solved puzzle:

- a wrong digit remains on the board marked as an error;
- each wrong placement increments `errorCount`;
- a correct placement can trigger row/column/box completion feedback;
- the puzzle finishes only when every cell matches the solution.

Undo restores the previous error count, so undoing a wrong placement removes that error from the eventual score.

## Scoring

Sudoku ranks by a simple accuracy score; elapsed time does **not** affect leaderboard score.

`score = max(0, difficulty base − 10 × errors)`

| Difficulty | Base / maximum score |
| --- | ---: |
| Easy | 100 |
| Medium | 200 |
| Hard | 300 |

Hints have no direct penalty because they enter a correct digit.

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

The on-screen timer starts on the first state-changing input, including a valid hint.

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
- An untouched puzzle can be discarded without creating a meaningful played result.

Per-game creation metadata is:
- `difficulty`;
- `variant`.

For generic syncing, ranking, display-name, Stats, and result-card behavior, see [GAME-CONTRACT.md](../GAME-CONTRACT.md).

## Implementation

- Engine: `frontend/src/game/sudoku/engine.ts`
- Types/config: `frontend/src/game/sudoku/types.ts`
- Screen: `frontend/src/screens/SudokuScreen.tsx`
- Storage: `frontend/src/game/sudoku/storage.ts`
- Classic bank: `frontend/src/game/sudoku/puzzles.json`
- Mini bank: `frontend/src/game/sudoku/puzzles_mini.json`
- Packed banks (shipped): `frontend/src/game/sudoku/puzzleBanks.generated.ts`, written by `tools/generators/pack-sudoku-puzzles.ts`
- Generator: `backend/scripts/gen_sudoku_puzzles.py`
- Bank verification: `backend/tests/test_sudoku_puzzles.py`
- Backend descriptor: `backend/sudoku/module.py`
