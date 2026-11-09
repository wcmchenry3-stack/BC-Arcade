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

If only non-productive/reversible moves remain, Hint reports the existing **No moves left** state rather than recommending one of those swaps.

Players may still manually make legal moves that the hint engine considers non-productive.

### Hint visuals (#3346)

Source and destination differ in shape, not only in colour (colour-blind players, `MIN_CARD_W = 36` cards). Both use the theme `bonus` token (no hard-coded colours), so they work in the light and dark themes. `components/cards/HintFrame.tsx` draws them as static, non-interactive overlays (`pointerEvents="none"`); there is no animation, so reduced-motion needs no special case.

| Role                        | Look                                                   | Where                                                                                      |
| --------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Source (what to move)       | 3-px **solid** frame + `bonus` fill tint (22% opacity) | One frame spanning the whole run (`hintRunFrom` to column bottom); a free-cell card        |
| Destination (where it goes) | 4-px **dashed** frame, no fill                         | Top card of a non-empty column or foundation; empty column, foundation or free cell border |

Frames sit partly outside the card edge (source 1 px, destination 2 px, inside the 4-px column gap of the felt, #3607), so at most 2 px of border lands on the card and the corner rank/suit index (drawn from x=5, y=2) stays legible on a 36-px card. Solitaire keeps its own 3-px hint frame and is unchanged.

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

## Felt table layout (#3607)

The board sits on the shared rounded green **felt** (`FeltTable`, `theme.table.ts` tokens) that Solitaire uses (#3606), between a one-line stat line and the tab bar: the free cells and the foundations on the felt's top row, the eight tableau columns below.

- **Stat line.** One centred line under the header, "MOVES 12 · TIME 2:14" (shared `TableStatLine`). It replaces the old "FreeCell / Moves" row (the title is in the header). Screen readers hear "Moves: 12" and "Time: 2:14". TIME is the game's own play clock (`game/freecell/playClock.ts`, `FreeCellState.clock`, set by the screen, never by the engine): it starts at the first move, pauses while the player is away (another screen, the background, or the ⋯ menu open; `usePauseWhileAway`), freezes at the win, and is saved with the game, so a resumed game carries on from its time (none of the time the app was closed counts). An undo or a hint never rewinds it. The play clock is display only (owner decision): the time reported for the game (`durationMs`) stays on `useGameSync`'s active-play window, as before, so the two can differ by a little.
- **Card size.** Cards are as wide as 8 columns allow, with 4 dp gaps and 12 dp padding inside the felt. The free cells and foundations are 0.92 of that width, each at the left edge of its column. The felt is what the screen's chrome leaves (the window less the header, the stat line, the tab bar and a 6 dp side gutter), measured with `onLayout`; until then the screen uses the same chrome constants (`estimateFeltSize`). The geometry is `freeCellGeometry` (`game/freecell/layout.ts`) over the shared `computeTableGeometry` (`game/_shared/cards/tableLayout.ts`), with `topRowScale` 0.92, no face-down cards and the tallest legal column.
- **Dynamic overlap.** A covered card shows up to 0.72 of the card height while the columns are short; the step is one value for the whole board and tightens as the tallest column grows (`faceUpStepFor`). The tallest legal FreeCell column is **19 cards** (6 dealt under a dealt King, then the Queen-to-Ace run on it), and it always fits: the board never scrolls vertically (a scroll fights the drag). FreeCell has no face-down cards, so the shared compression order has no face-down step; and when even 36 dp cards cannot give that column a 24 dp stripe, the cards stay at their widest while their stripe is within 2 dp of what 36 dp cards would give; otherwise they are 36 dp. On any felt the tallest legal column fits above the bottom band: a felt too short even for 36 dp cards at a 1 dp stripe (a phone in landscape) gets narrower cards rather than letting a column run off the felt. In landscape on a pixel_6 (a felt of about 901 x 222 dp) the cards are 36 dp and the 19-card column's stripe is 3 dp.

  | Phone     | Card       | Compression        | Stripe of the 19-card column |
  | --------- | ---------- | ------------------ | ---------------------------- |
  | 375 x 667 | 38 x 54 dp | stripe under 24 dp | 15 dp                        |
  | 390 x 844 | 40 x 57 dp | stripe under 24 dp | 22 dp                        |
  | 430 x 932 | 45 x 64 dp | none               | 25 dp                        |

  The 15 dp at 375 x 667 is an owner-approved exception to the 18 dp floor that Klondike keeps (`MIN_COVERED_STRIPE`): the covered cards draw the compact corner index (#3622: the suit beside the rank on one line, sized to the stripe), so rank and suit stay readable. FreeCell shares Solitaire's `TableauColumn`, which picks it from each card's real stripe; the top card and columns at 24 dp or more keep the stacked index. A 19-card column needs a dealt King on top of a 7-card column and the whole run built on it, so ordinary play stays far from it: a 7-card column at 390 x 844 keeps a 41 dp step.

- **Selection.** The selected card or run lifts with an accent glow (`SelectableCard`). With Reduce Motion on there is no lift or pop; the glow stays as a static highlight. The screen reads Reduce Motion once and passes it to every pile.
- **Targets.** While something is selected, every legal destination gets a green outline (`bonus` token): columns, empty free cells and the card's own foundation. They come from the engine's `validateMove` (`game/freecell/targets.ts`), so a run is offered only the columns its supermove capacity allows, and only a column's top card is offered a free cell or a foundation. The Hint frames are unchanged and still draw on top.
- **Accessibility.** Each legal destination carries the hint "Can move here" exactly once, on the element a screen reader lands on: the top card of a column or foundation, or the empty slot itself. The green outline is not announced (`accessible={false}`).
- **Empty slots** on the felt are faint outlines: dashed for the free cells (with a quiet "free" watermark), solid with the suit for the foundations, dashed for an empty column.
- **Bottom band.** The no-moves banner (with its Undo button) sits in a band at the bottom of the felt (at least 44 dp; it wraps at large font scales and is measured, and it only grows), and the tableau area ends above it, so the banner never covers a column's last cards. Its sound (`freecell.noMoves`) is unchanged.

## Controls

Cards support the shared card-game selection/drag interaction.

A **double-tap within 300 ms** on:

- a free-cell card; or
- the top card of a tableau column

moves that card directly to its foundation when the foundation move is legal.

A single tap remains selection; double-tap is an explicit convenience action, separate from Hint and the automatic endgame completion sequence.

## Large cards (#3347)

A checkable **Large cards** item in the ⋯ header menu (next to Stats and Leaderboard), for players who find the cards too small. It is a setting, not a pinch-zoom: there is no gesture to compete with drag-and-drop. **Off by default**, so the board is exactly as before.

- **Size.** Off: cards are fitted to the felt (see Felt table layout: 38 to 45 dp on the phones above). On: every card is `LARGE_CARD_WIDTH` = **64 dp** (`game/freecell/largeCards.ts`), at the felt's aspect ratio (64 x 91 dp), and never smaller than the fitted card (a tablet's felt can fit wider ones); the free cells and foundations are 0.92 of it (58 dp). The 8-column board is then 540 dp wide (548 dp with the scroller's padding), wider than a phone, so it scrolls sideways. Vertically it still never scrolls (#3607): the same geometry, with the card width fixed (`fixedCardWidth`), compresses only the step, and takes the scroller's padding and button strip off the felt's height. Large cards never compress a column below 18 dp (`MIN_COVERED_STRIPE`, owner decision): while the tallest column now on the board would get a narrower stripe with them, the board is drawn with the fitted cards instead (`freeCellBoardGeometry`; still inside the scroller, so its top and bottom padding come off the fitted height too, or a full column ran 4 dp into the bottom band, #3653), and goes back to Large cards when the columns are short again. At 390 x 844 a 10-card column keeps 31 dp with Large cards; at 375 x 667 a 12-card column already falls back. The setting itself, the menu's checkbox and the deferred resize after the menu closes (#3556) are unchanged, and the horizontal scroller stays mounted while the setting is on, so a fallback never remounts the board (its buttons hide while the board fits). Before #3607 a vertical fallback ScrollView (`freecell-board-scroll`) took over at a 19 dp floor; it is gone, and with it the overflow flip that once remounted the board (#3532). Whether the button strip shows is worked out from the felt's width (`largeBoardOverflows`), not measured, so the height it takes is right on the first frame.
- **When the board changes (#3556).** The menu item stays checked or unchecked the moment it is tapped (the ⋯ menu stays open), but the board is resized only once the menu has closed, and two frames after that (`useLargeCards`: `largeCards` is the choice, `boardLargeCards` the size the board is drawn at; the menu counts as open through the app-overlay signal, `hooks/appOverlay.ts`). Resizing re-renders every card and swaps the horizontal scroller in or out. On Android that big commit, made while the menu's native Modal (a separate dialog window) still held the toggle tap, blocked the main thread until Android killed the app ("Input dispatching timed out", CI `freecell/drag-large`). A stored "on" read at start is applied at once, so there is no flash of the fitted board. If an Android Maestro flow fails, CI prints the app's ANR thread dumps (`/data/anr` where readable, and `dumpsys dropbox --print data_app_anr`, each capped at 400 lines) in the "ANR traces for <game>" group.
- **What scrolls.** The whole board: the free cells and foundations are in the same horizontal `ScrollView` (`freecell-board-hscroll`) as the tableau, so each column stays under its own top-row slot. The ScrollView has 4 dp of padding all round, so the 1 to 4 dp hint frames on the first and last column and the tallest column are not clipped. When the board is wider than the screen, a strip of two chevron buttons (`Scroll board left` / `Scroll board right`, each 44 dp tall with extra hit slop) sits above it and moves it by 60% of the visible width. The strip is absent when the board fits (a tablet) and when the setting is off, when there is no ScrollView at all. The scroller is forced `direction: "ltr"`: in an RTL language on web (ar, he) browser scroll offsets run negative and the card order must not flip. Native is already pinned LTR (`i18n.ts` calls `I18nManager.forceRTL(false)`).
- **Drag versus scroll.** Swiping on the board never scrolls it. A swipe on a card drags it. The horizontal ScrollView is `scrollEnabled={false}` always, so there is nothing for a card's drag to compete with on iOS, Android or web, and the shared `DraggableCard` (also used by Solitaire) is untouched. The board scrolls only with the two chevron buttons (`scrollTo`), which also serve screen-reader and switch users. The remembered scroll offset follows the ScrollView's `onScroll` and is clamped when the viewport or content size changes, so a rotation or resize cannot leave a button press starting from a stale position.
  - The drag ghost lives in the `DragContainer` overlay, a sibling of the `ScrollView`, so scrolling never carries it along. Drop zones are re-measured in window coordinates at every drag start (`DragContext`), so a scrolled board needs no extra bookkeeping. There is no auto-scroll at the screen edge: scroll first, then drag.
  - `scrollTo` on a ScrollView with `scrollEnabled={false}` is programmatic and works on iOS and Android; on react-native-web it sets the element's scroll offset on an `overflow: hidden` element, which browsers allow. That web path is unverified here (no browser run).
- **Storage.** One boolean in AsyncStorage, key `freecell_large_cards` (`"1"` / `"0"`), written once per toggle. No network, no telemetry, nothing on the gesture path. A failed read means off and is reported to Sentry like the other game records.
- **Accessibility.** The menu item is announced as a checkable item ("Large cards", checked or not). Strings are in all 13 locales (`freecell.json`): `settings.largeCards`, `a11y.scrollBoardLeft`, `a11y.scrollBoardRight`. The board's labels and the hint frames are unchanged and scale with the card.

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
- Felt table (#3607): geometry `frontend/src/game/freecell/layout.ts` (over `frontend/src/game/_shared/cards/tableLayout.ts`), targets `frontend/src/game/freecell/targets.ts`, play clock `frontend/src/game/freecell/playClock.ts`; shared `FeltTable`, `TableStatLine`, `theme.table.ts`
- Screen: [`frontend/src/screens/FreeCellScreen.tsx`](../../frontend/src/screens/FreeCellScreen.tsx) (its header lists the screen's concerns; see [GAMEPLAY_STANDARDS §8](../GAMEPLAY_STANDARDS.md#8-screen-layer))
- Seed bank: `frontend/src/game/freecell/seeds.json`
- Seed generator/solver: `backend/scripts/gen_freecell_seeds.py`
- Storage: `frontend/src/game/freecell/storage.ts`
- Replay recording: `frontend/src/game/freecell/replay.ts`, `frontend/src/game/_shared/cards/moveLog.ts`
- Backend descriptor: `backend/freecell/module.py` (the `moves` validator is in `backend/freecell/models.py`)

## Sound

Registry: `frontend/src/game/freecell/sounds.ts` (`FREECELL_SOUNDS`), played through the shared `useSound` hook, which honours the player's sound setting. The effects are being replaced with original synthesized sounds shared across the card and puzzle games (#3563); the reasoning behind each is in the [arcade sound design log](arcade-sound-design.md). Volume is `useSound`'s default (1.0) unless noted.

Triggers are in `frontend/src/screens/FreeCellScreen.tsx`. A completed suit has no sound (dropped in #3563; its visual effect is removed in #3567).

| Key                                                                                        | File                                                                           | Plays when                                                                                                                                                                         | Volume |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `freecell.cardPlace` / `freecell.cardPlace2` / `freecell.cardPlace3`                       | `card-place-1/2/3.ogg` (shared with Solitaire, Hearts; synthesized)            | a single-card move (`useSoundVariants`: one of three, at random, never the same twice in a row); silent for cards moved by Auto-Complete                                           | 1.0    |
| `freecell.autoCompleteStart` / `freecell.autoCompleteLoop` / `freecell.autoCompleteSettle` | `riffle-start/loop/settle.ogg` (shared by Solitaire and FreeCell; synthesized) | Auto-Complete (`useAutoCompleteRiffle`): start + loop as the run begins, loop for the whole run, settle as the last card lands and the board is solved; a run cut short just stops | 1.0    |
| `freecell.supermove`                                                                       | `card-multi-move.ogg` (shared with Solitaire; synthesized)                     | a multi-card move                                                                                                                                                                  | 1.0    |
| `freecell.noMoves`                                                                         | `card-no-moves.ogg` (synthesized)                                              | no moves left: the engine's `noMovesAvailable`, or Hint with nothing to suggest (with the banner)                                                                                  | 1.0    |
| `freecell.invalidMove`                                                                     | `card-invalid-move.ogg` (shared with Solitaire; synthesized)                   | a refused drop (`components/freecell/FreeCellBoard.tsx`)                                                                                                                           | 1.0    |
| `freecell.gameWin`                                                                         | `card-game-won.ogg` (shared with Solitaire and Hearts)                         | the game is won; after Auto-Complete, with the riffle's settle                                                                                                                     | 1.0    |

"No moves available" has no sound. `freecell-invalid-move.mp3` is shipped but unused.
