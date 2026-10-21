# FreeCell

**Category:** Card  
**Tier:** Free in the v1.0 store build

BC Arcade FreeCell deals only from a bank of solver-verified solvable layouts and ranks completed deals by **fewest moves**. It includes hints, supermoves, undo, and automatic foundation completion.

Shared session/offline/reporting behavior is defined by [GAME-CONTRACT.md](../GAME-CONTRACT.md). This page owns FreeCell-specific gameplay and scoring.

## Objective and layout

Move all 52 cards to four suit foundations, Ace through King.

A new deal places the entire deck face-up across eight tableau columns:

- columns 1–4: 7 cards each;
- columns 5–8: 6 cards each.

There are:

- **4 free cells**, each holding at most one card;
- **4 foundations**, one per suit;
- **8 tableau columns**.

There is no stock/waste and no hidden information.

## Deals

Live deals come from `frontend/src/game/freecell/seeds.json`, a bank of **provably solvable** seeds produced offline by `backend/scripts/gen_freecell_seeds.py`.

The engine selects a bank seed and deterministically shuffles the deck. Explicit seeds remain available for tests/E2E.

**Recorded deal (#3281).** The `game_started` event data carries `seed`, `seed_index` (its place in the bank) and `engine_version` (`ENGINE_VERSION` in `engine.ts`, bumped when a deal change would break a recorded seed), under 100 bytes (asserted in `dealSeed.test.ts`). `dealGame(seed)` rebuilds the opening from them. The screen draws the seed with `drawDealSeed` and passes it to `dealGame`. A saved game does not store its seed, so a restored game that opens a fresh session sends only `engine_version`.

## Tableau and foundations

Tableau sequences build:

- descending by rank;
- alternating red/black.

An empty tableau column accepts a King or King-led movable run.

Foundations build upward by suit from Ace.

A top foundation card can be moved back to tableau when legal.

## Free cells

Any exposed single tableau card can move to an empty free cell.

A card in a free cell can move:

- to a legal tableau destination; or
- to its foundation.

Free cells also increase the size of a run that can be moved as one player action.

## Supermoves

A legal alternating-color descending tableau run can move as one action when enough temporary workspace exists.

Maximum movable run length:

`(1 + empty free cells) × 2^(empty tableau columns)`

The destination column is excluded from the empty-column multiplier when it is itself empty.

A supermove counts as **one move**, regardless of the number of cards transferred.

## Move count and ranking

FreeCell's ranked metric is move count: **lower is better**.

Normal legal moves count **1**, including:

- tableau → tableau (single card or supermove);
- tableau → free cell;
- tableau → foundation;
- free cell → tableau;
- free cell → foundation.

Moving a card **from foundation back to tableau costs 2 moves** as a progress penalty.

Undo restores the earlier move count.

There is one global FreeCell board with no partition and no declared maximum. Equal move totals use the shared final tie rule: the completion the server received first (`received_at`) ranks first.

## Hint

Hint highlights a recommended productive move; it does not execute it and has no score/move penalty.

The engine orders hints roughly as:

1. tableau/free-cell → foundation;
2. productive tableau → tableau runs;
3. free-cell → tableau;
4. tableau → free cell as a parking move.

Obvious reversible tableau oscillations are filtered from the hint list.

### Hint visuals (#3346)

Source and destination differ in shape, not only in colour (colour-blind players, `MIN_CARD_W = 36` cards). Both use the theme `bonus` token (no hard-coded colours), so they work in the light and dark themes. `components/cards/HintFrame.tsx` draws them as static, non-interactive overlays (`pointerEvents="none"`); there is no animation, so reduced-motion needs no special case.

| Role                        | Look                                                   | Where                                                                                                            |
| --------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Source (what to move)       | 3-px **solid** frame + `bonus` fill tint (22% opacity) | One frame spanning the whole run (`hintRunFrom` → column bottom); a free-cell card                               |
| Destination (where it goes) | 4-px **dashed** frame, no fill                         | Top card of a non-empty column or foundation; an empty column, foundation or free cell uses a 4-px dashed border |

Solitaire keeps its own 3-px hint frame and is unchanged. Widths in FreeCell are never below Solitaire's 3.

If only non-productive/reversible moves remain, Hint reports the existing **No moves left** state rather than recommending one of those swaps.

Players may still manually make legal moves that the hint engine considers non-productive.

## Auto-complete

When every remaining card can reach a foundation through direct foundation plays alone, FreeCell automatically begins completion.

The engine proves this with a greedy simulation before starting.

The automatic sequence:

- prefers free-cell → foundation;
- then tableau-top → foundation;
- runs one move at a time.

It does **not** perform rearrangement during auto-complete. If direct foundation draining cannot finish the board, auto-complete is not enabled yet.

Each automated foundation move is a real move and increments the move count.

## Undo

Undo restores the most recent engine snapshot, including the earlier move count.

It is disabled:

- with no undo history;
- after completion;
- while auto-complete is running.

## Win / no-loss model

The deal is complete when all 52 cards reach the foundations.

FreeCell has no formal loss outcome in the shared reporting model. A position with no productive hint can still be escaped through Undo or other legal play if available.

A won deal records:

- `completed`;
- `final_score = moveCount`;
- result `{ won: true, moves }`.

Starting a new deal or leaving after a move records `abandoned` with no ranked score.

## Save / resume and duration

Board state is persisted locally after changes and restores after relaunch.

A killed app can therefore continue the same deal/session.

FreeCell does not maintain its own persisted play clock. Duration comes from the shared `useGameSync` active-play window; starting a new deal resets that window.

The local device also caches lightweight best-moves/game counters for immediate UI presentation; server Stats/history are authoritative for shared reporting.

## Controls

Cards support the shared card-game selection/drag interaction.

A **double-tap within 300 ms** on:

- a free-cell card; or
- the top card of a tableau column

moves that card directly to its foundation when the foundation move is legal.

A single tap remains selection; double-tap is an explicit convenience action, separate from Hint and the automatic endgame completion sequence.

## Replay recording

_(#3289, epic #3273; the shared recorder is [GAME-CONTRACT §2.10](../GAME-CONTRACT.md#210-recording-gameplay).)_

**The deal is recorded once**, in `game_started` (#3281): `seed` and `engine_version` (under 100 B). `dealGame(seed)` rebuilds the shuffled deck order and the opening layout, so no card is ever sent. Everything after it is a list of **actions**; opening + the `moves` rows in `event_index` order rebuild the final tableau, free cells, foundations and move count.

**One action** is a small array of integers, the first is the kind (`freecell/replay.ts`):

| Kind | Action             | Meaning                                                                    |
| ---- | ------------------ | -------------------------------------------------------------------------- |
| 0    | `[0, from, to, n]` | the top `n` cards of column `from` to column `to` (a supermove if `n > 1`) |
| 1    | `[1, from, cell]`  | column `from` to free cell `cell`                                          |
| 2    | `[2, from]`        | column `from` to its foundation                                            |
| 3    | `[3, cell, to]`    | free cell `cell` to column `to`                                            |
| 4    | `[4, cell]`        | free cell `cell` to its foundation                                         |
| 5    | `[5, suit, to]`    | foundation `suit` (index into `SUITS`) back to column `to`                 |
| 6    | `[6]`              | undo                                                                       |
| 7    | `[7]`              | hint (no score effect; a sign the player asked for help)                   |

An **Auto Complete** step is the action it took plus 16 (`[18, 0]`: auto, column 0 to its foundation; `[20, 3]`: auto, free cell 3 to its foundation). The screen reads the move from the engine (`nextAutoMove`) before it applies the step, so a replay rebuilds each step from its move. A hint asked for before the first action is not recorded (the game has not started).

Replaying an action is calling the engine function it names (`applyAction` in `replay.ts`: `applyMove`, `undoMove`, `applyHint`), so the move count and the undo stack rebuild exactly.

**A `moves` event** is `{ v: 1, unit, t_ms, s, m: [action, ...] }` (the recorder's envelope plus `s`, the index of the chunk's first action in the game, and `m`): up to **25** actions, one recorder unit per chunk (`MOVES_PER_CHUNK`, `_shared/cards/moveLog.ts`). Nothing is saved per drag, tap or Auto Complete step: an action is one in-memory array append (`createMoveLog`), the recorder saves a closed chunk at an idle moment, and every recording call from a handler runs inside `guardRecording` (a failure is reported once, throttled, and never reaches play). A partial chunk is handed to the recorder, and saved at once, when the app goes to the background or the screen loses focus, not on `inactive` (`useFlushOnBackground`: `moveLog.flush()` then `useGameRecorder().flush()`, synchronous); when the game is won; when New Game is pressed; and on unmount, always before the session's `game_ended`. The game's session is opened before its first action is recorded (`ensureSessionOpen`), so nothing recorded is waiting for a game (a Hearts review found units buffered before the session opened were lost).

**Resumed games.** The saved game carries `recorded`, the number of actions handed to the log (the screen stamps it after every action; an undo does not take it back). A game restored after a kill resets its log to that count, so the next chunk's `s` and unit number (`floor(s / 25) + 1`, passed to `beginUnit(n)`) carry on. The actions in the chunk a kill cut short are never stored (at most 24): the next chunk's `s` is past the end of the stored ones, which shows the hole. A unit number can repeat after a resume (a chunk cut short by the background and the chunk after it, or the first chunk of a resumed game, can share `floor(s / 25) + 1`): **`s` is authoritative**, the unit number is only the recorder's grouping. **A restored game is recorded only if it can be replayed.** If its original session was not resumed (the player left, the session was abandoned, the save was kept) the next action opens a session whose `game_started` has no seed, so its `moves` could never be rebuilt: nothing is recorded for that game (the session itself opens as before). The same holds for a save from before #3289 that has no count (or a corrupt one) and some history: its earlier actions were never recorded, and a log starting at 0 would rebuild the wrong board. A save with no count and no history is recorded from 0.

**Validation** (`backend/freecell/models.py`, `validate_moves`): a `FreeCellMoves` pydantic model, `extra="forbid"`, `v == 1`, 1..32 actions each a known kind with exactly its arguments in range (columns 0..7, cells 0..3, run length 1..13, suit 0..3; only foundation moves are auto), and 512 B of compact JSON (`MAX_MOVES_BYTES`, the same figure as the app's `CARD_MOVES_MAX_BYTES`). A bad event is dropped, not the batch, with one Sentry report per reason per five minutes, by reason and error types only. The type is seeded by `0044_card_game_moves_events`, which must be deployed before the app that sends it.

### Size against the budget (about 40 KB per uploaded game)

Row cost on the server is the JSON as Postgres stores it (`jsonb::text`) plus `ROW_OVERHEAD_BYTES` (200), which is why actions go in chunks of 25.

- A typical action is 6 to 9 B; a worst-case run move `[0,7,6,13]` is 10 B. A worst-case full chunk with its envelope is about 340 B JSON (the event cap is 512 B).
- A 196-action game: 8 events, 1,819 B of JSON, **4,026 B stored**. A 358-action game: 15 events, 3,343 B, **7,464 B stored**.
- **A game's recording is bounded across kills.** The byte cap `CARD_MOVES_SESSION_MAX_BYTES` (20 KB of JSON) restarts with every resume, so it bounds a process, not a game. The game bounds itself with counts saved in its state, `recorded` (actions) and `recordedRows` (rows handed over, partial chunks from flushes included): at `MAX_RECORDED_ACTIONS` (1,200) or `MAX_RECORDED_ROWS` (60) the log stops collecting, and a game resumed at the limit starts capped. The worst mix (60 rows of 20 worst-size actions, a flush after each) measures **34,209 B stored** (jsonb text + 200 B a row), 61 events, under 40 KB and far under the 500 of `DEFAULT_CAP`; flushing after every action stops at 60 rows (15.8 KB); 1,200 actions without flushes are 48 rows, 31.2 KB. Typical games (300 actions) never reach it.
- Kill switch: the recorder reads `isRecordingEnabled` once per session and does no work when it is off (tests build a recorder with `enabled: false`).

### Measured (`freecell/__tests__/replay.bench.test.ts`)

A seeded 358-action game over the real GameEventClient → EventStore → AsyncStorage mock, an idle moment after every action, against one event and one save per action:

|                                         | One event per action | Chunks of 25 |
| --------------------------------------- | -------------------- | ------------ |
| Queue saves                             | 358                  | **15**       |
| AsyncStorage writes                     | 716                  | **30**       |
| Bytes written to storage                | 3,334,781            | **60,969**   |
| Events                                  | 358                  | 15           |
| Recorded JSON (sum of `data`)           | 16,152 B             | **3,343 B**  |
| Stored on the server (jsonb + overhead) | 90,901 B             | **7,464 B**  |
| `fetch` calls while the game was played | n/a                  | **0**        |

## Implementation

- Engine: `frontend/src/game/freecell/engine.ts`
- Screen: [`frontend/src/screens/FreeCellScreen.tsx`](../../frontend/src/screens/FreeCellScreen.tsx) (its header lists the screen's concerns; see [GAMEPLAY_STANDARDS §8](../GAMEPLAY_STANDARDS.md#8-screen-layer))
- Seed bank: `frontend/src/game/freecell/seeds.json`
- Seed generator/solver: `backend/scripts/gen_freecell_seeds.py`
- Storage: `frontend/src/game/freecell/storage.ts`
- Replay recording: `frontend/src/game/freecell/replay.ts`, `frontend/src/game/_shared/cards/moveLog.ts`
- Backend descriptor: `backend/freecell/module.py` (the `moves` validator is in `backend/freecell/models.py`)
