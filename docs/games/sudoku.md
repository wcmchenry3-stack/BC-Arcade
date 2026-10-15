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
- **Show mistakes** is a checkable item in the ⋯ header menu (see Errors and completion).

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
- places the digit even in Notes mode (it never toggles a pencil mark, and Notes mode stays on);
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

When every cell is filled but the grid is not the solution, a message says that something is off and points to the **Hint** button. It replaces the number pad's digit row (every digit is used up by then, so the row is disabled anyway), so the layout keeps its height; the pad's own **Hint** button (Erase, Notes, Hint row) stays in place and is the action. The message is announced to screen readers (live region on Android, an announcement on iOS). That Hint selects a wrong cell (the selected one if it is wrong, otherwise the first in reading order) and corrects it with the solution digit, with no error and no penalty. If it was the only wrong cell the puzzle completes.

### Show mistakes

A checkable item in the ⋯ header menu (it adds no height to the play layout) colours legal-but-incorrect digits as mistakes. It is visual only: no count, no flash, no score effect. Illegal digits are always highlighted regardless of it. The default is **on for Easy, off for Medium and Hard**; once the player flips it, that choice is stored on the device (`sudoku_show_mistakes`) and applies to every puzzle, whatever its difficulty.

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

Equal scores use the shared final tie rule: the completion the server received first (`received_at`) ranks first.

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
- undo history;
- the number of replay entries recorded so far (`entryCount`, [Replay recording](#replay-recording)).

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

## Replay recording

_(#3288, epic #3273; the shared recorder is [GAME-CONTRACT §2.10](../GAME-CONTRACT.md#210-recording-gameplay).)_

The puzzle is recorded once, in `game_started`: `{ difficulty, variant, puzzle }`, with `puzzle` the **givens** as one digit per cell (81 characters for Classic, 36 for Mini, `0` = empty, row by row; the string the bank holds). It is not a bank index or a seed: the banks can change between app versions, the string cannot. It rides in the event only (`syncStart(eventData, metadata)`): `SudokuMetadata` forbids unknown keys, so the metadata stays `{ difficulty, variant }`. The givens (`puzzle`) plus the **`entries` events** in `event_index` order rebuild the final grid.

**One entry** is a short list of numbers (`cell` = `row * size + col`, 0..80; 0..35 for Mini):

| Entry                  | Meaning                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `[0, cell, digit]`     | a digit placed; a 4th number, `1`, is the **wrong-entry flag**: the digit duplicated one in its row, column or box (what `errors` counts) |
| `[1, cell, digit]`     | a pencil note toggled (on or off)                                                                                                    |
| `[2, cell]`            | the cell erased (value and notes)                                                                                                    |
| `[3]`                  | undo                                                                                                                                 |
| `[4, cell, digit]`     | a hint: the solution digit placed (never flagged: a hint costs no error)                                                             |

Not recorded: selecting a cell, switching pencil mode, and any action that changes nothing (a digit on a given or with nothing selected, an erase of an empty cell, an undo with nothing to undo, a hint with nothing to give). `applyRecorded` (`game/sudoku/replay.ts`) runs the engine and returns the entry only when the state changed, and the screen and the golden test both go through it.

To replay: start from the givens; a digit, a hint or an erase pushes an undo snapshot (50 at most, the engine's `UNDO_STACK_LIMIT`) and a digit or hint clears the cell's notes; a note toggles one digit and pushes nothing; an undo restores the last snapshot, notes and error count with it. The golden test's reader (`__tests__/helpers/rebuild.ts`) and the backend test's (`tests/test_sudoku_replay_events.py`) are exactly this.

**An `entries` event** is `{ v: 1, unit, t_ms, i, e: [entry, ...] }`: the recorder's envelope plus `i`, the ordinal of the chunk's first entry in the game, and `e`, up to **32** entries (`ENTRIES_PER_CHUNK`). A chunk is one recorder unit, numbered by where it starts (`unitOfEntry(i)` = `⌊i / 32⌋ + 1`). Chunks end at multiples of 32, so a chunk saved early (below) is finished by the next event under the same unit. The type is registered `REPLAY`, with a 512 B cap (`SUDOKU_ENTRIES_MAX_BYTES`, the backend's `MAX_ENTRIES_BYTES`) and **no `chunkField`**: it is never split into parts, because `i` has to stay unique. A chunk is at most 411 B, so the cap never bites.

**Hot path.** A tap does the engine call it always did, builds one small array (`push` is an in-memory append) and bumps `entryCount` on the state it was saving anyway. No `JSON.stringify`, no storage, no timer, no Sentry. The chunk goes to the recorder once per 32 entries and the recorder saves it at an idle moment (`scheduleIdle`), never in a tap handler. Nothing is uploaded while the puzzle is on screen (§2.10 "Uploads").

**When a partial chunk is saved.** The screen hands the partial chunk to the recorder and calls `useGameRecorder().flush()` (hands the waiting units to the queue now, synchronously) when the app goes to the background or becomes inactive, and when another screen covers the puzzle (`usePauseWhileAway`'s `onLeave`; the ⋯ menu does not count). It is handed over, without the flush, when the puzzle is solved, a new puzzle starts, the player changes difficulty and on unmount, always before the session's `game_ended`. So a kill after the app left the foreground loses nothing; a crash while playing loses at most the 31 entries since the last full chunk.

**Resumed games.** The saved game carries `entryCount` (`SudokuState.entryCount`, written by the screen on every recorded entry, kept by `storage.ts`; absent on a game from before this). A game resumed after a kill restarts the log from it (`createEntryLog.reset(entryCount)`): its next entries are numbered `i = entryCount, ...` and its recorder units are `unitOfEntry(i)`, never 1 again. The recorder cannot know which units were saved before the kill, so the numbering lives in the saved state. A chunk a kill did lose shows as a gap in `i` (the readers above refuse a gap). A game restored whose session could not be resumed opens a new one before its first entry is recorded (an erase or an undo opens it, like a digit), so the entry is never recorded into a game with no session; the replay then starts at `i = entryCount`, not 0, and its `game_started` carries the givens but not the moves before the kill.

**Backend** (`backend/sudoku/models.py`, `validate_entries`): the `SudokuEntries` pydantic model, `extra="forbid"`, `v == 1`, `unit`/`t_ms`/`i` strict ints in int32 range, 1..64 entries each of a known op with its length (`[0,c,d]`/`[0,c,d,1]`, `[1,c,d]`, `[2,c]`, `[3]`, `[4,c,d]`), `cell` 0..80, `digit` 1..9, strict ints (no bool, no float), and at most 512 B of compact JSON. A bad event is dropped, not the batch, with one Sentry report by reason and error types, never values. Seeded by migration `0043_sudoku_replay_events` (`event_types` row `entries` for Sudoku), which has to be deployed before the app that sends it. `game_started` and `game_ended` stay stored as sent. Sudoku sent no per-entry events before, so there is nothing to retire.

### Size and cost

Byte arithmetic (stored size is the JSON as Postgres keeps it, `jsonb::text`, which adds a space after each `,` and `:`; plus `ROW_OVERHEAD_BYTES` = 200 per row):

- A typical entry (a note, `[1,40,5],`) is 9 B on the wire, 13.6 B as `jsonb`; the longest, `[0,80,9,1],`, is 11 B.
- A full typical chunk of 32 with its envelope (`{"v":1,"unit":5,"t_ms":600000,"i":128,"e":[...]}`) is 332 B compact, 436 B as `jsonb`, **636 B per row** with overhead (the overhead is 31% of the row, 6 B an entry; at one entry per event it would be 200 B an entry).
- The worst chunk possible (32 × `[0,80,9,1]`, 10-digit `unit`/`t_ms`/`i`) is 411 B compact, 547 B as `jsonb`, 747 B per row, under the 512 B cap with 20% to spare.
- A **heavy hard game** (315 entries: every empty cell pencilled four times, then filled, with erases and undos) is 10 rows = **6,296 B stored**, 16% of the epic's ~40 KB per game. The two games in `backend/tests/fixtures/sudoku_entries_v1.json` (67 and 30 entries) are 1,512 B and 580 B, plus a `game_started` of about 140 B.
- A heavy player's day, 10 such games: about 63 KB stored.
- The ceiling: the device stops recording at 64 KB of JSON a session (`DEFAULT_RECORDING_CONFIG.sessionMaxBytes`, a clean prefix), which is at most 159 worst-case rows and **118,773 B** stored, inside the default game cap (`DEFAULT_CAP`: 500 events / 160 KB), so Sudoku needs no cap of its own (`replay_caps.py`).
- Storage dial: recording off per game, and the sample rate, without an app release, through `isRecordingEnabled("sudoku")` (read once per session, #3279). With it off the recorder does no work: the entry log still builds the small arrays (a few comparisons per tap), but nothing reaches the recorder's queue, the store or storage (`replay.test.ts` "kill switch" builds a recorder with `enabled: false` and spies on the store). The screen never reads the dial itself; and a recorder call that throws is caught, reported once an hour through `sentryThrottle`, and play goes on (`SudokuScreen.replay.test.tsx`).

### Measured (`game/sudoku/__tests__/replay.bench.test.ts`)

The heavy hard game above (315 entries) over the real GameEventClient → EventStore → AsyncStorage mock, an idle moment between taps (the worst case for one event per entry):

|                                                               | One event per entry | `entries`, 32 per chunk |
| ------------------------------------------------------------- | ------------------- | ----------------------- |
| Queue saves (`EventStore.enqueueEvent` / `enqueueMany` calls) | 315                 | **10**                  |
| AsyncStorage writes                                           | 630                 | **20**                  |
| Bytes written to storage                                      | 3,123,311           | **33,534**              |
| Events                                                        | 315                 | 10                      |
| Recorded JSON (sum of `data`)                                 | 16,924 B            | **3,149 B**             |

## Implementation

- Replay recording: `frontend/src/game/sudoku/replay.ts` (entries, `applyRecorded`, the chunked entry log); backend `backend/sudoku/models.py` (`validate_entries`), migration `backend/alembic/versions/0043_sudoku_replay_events.py`
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
