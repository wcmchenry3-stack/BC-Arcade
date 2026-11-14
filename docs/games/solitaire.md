# Solitaire

**Category:** Card  
**Tier:** Free in the v1.0 store build

BC Arcade Solitaire is Klondike with Draw-1 / Draw-3, a proven-solvable deal bank, hints, undo, auto-complete, local save/resume, and score-based ranking.

Shared session/offline/reporting behavior is defined by [GAME-CONTRACT.md](../GAME-CONTRACT.md). This page owns Solitaire-specific gameplay and scoring.

## Objective and layout

Move all 52 cards to the four suit foundations, Ace through King.

- **Tableau:** seven columns; descending rank, alternating colors.
- **Stock:** undealt face-down cards.
- **Waste:** cards drawn from the stock; only the top waste card is playable.
- **Foundations:** one per suit, built Ace → King.

The tableau starts with 1–7 cards by column, with only each column's top card face-up. The remaining 24 cards start in the stock.

An empty tableau column accepts only a King or a King-led valid run.

## Deals and draw modes

Before a new deal the player chooses:

- **Draw-1:** draw one stock card at a time.
- **Draw-3:** draw up to three; only the top waste card is playable.

Draw-1 and Draw-3 share one public leaderboard.

**Test builds** (`EXPO_PUBLIC_TEST_HOOKS=1`) always deal each draw mode's first seed-bank entry, and on native skip the picker and deal draw-1; the test-only button `solitaire-test-deal-draw3` (native) and `globalThis.__solitaire_deal(drawMode)` (web) deal the fixed draw-3 game instead (`game/solitaire/testHooks.ts`, #3532; see `docs/TESTING.md`).

Live deals come from `frontend/src/game/solitaire/seeds.json`, a bank of **provably solvable** seeds generated offline by `backend/scripts/gen_solitaire_seeds.py`. A seed reproduces the same deal deterministically.

**Recorded deal (#3281).** The `game_started` event data carries `seed`, `seed_index` (its place in the draw mode's bank), `draw_mode` and `engine_version` (`ENGINE_VERSION` in `engine.ts`, bumped when a rule change would make a recorded game replay differently, see [replay compatibility](../TESTING.md#replay-compatibility-and-sunset)), under 100 bytes (asserted in `dealSeed.test.ts`). `dealGame(draw_mode, seed)` rebuilds the opening from them. The screen draws the seed with `drawDealSeed` and passes it to `dealGame`. A saved game does not store its seed, so a restored game that opens a fresh session sends only `draw_mode` and `engine_version`.

### Recycling the stock

When stock is empty, the waste can be recycled back into stock.

- first recycle: free;
- every later recycle: −50 points.

Score is floored at 0.

## Legal card movement

### Tableau

A face-up card/run can move onto a card exactly one rank higher and the opposite color.

A moved tableau run itself must already be a valid alternating-color descending sequence.

When a move uncovers a face-down tableau card, that newly exposed card flips face-up automatically.

### Foundation

Foundations build by suit from Ace upward.

The top card of:

- waste; or
- a tableau column

can move to its matching foundation when legal.

A top foundation card can also be moved back to tableau when it fits; that retreat costs points.

## Felt table layout (#3606)

The board sits on a rounded green **felt** (shared `FeltTable`, `theme.table.ts` tokens, light and dark) between a one-line stat line and the tab bar: stock, waste and the four foundations on top, the seven tableau columns below. FreeCell reuses the felt, the stat line and the geometry helper (#3607).

- **Stat line.** One centred line under the header, "MOVES 12 · SCORE 45 · TIME 2:14" (shared `TableStatLine`): Manrope capital labels, Space Grotesk values. The time is the game's own play clock (`PlayClockText`), so it freezes while the game is paused. It replaces the old Score / Moves row; screen readers still hear "Moves: 12" and "Score: 45".
- **Card size.** Cards are as wide as the 7 columns allow, with 4 dp gaps and 12 dp padding inside the felt. The felt is what the screen's chrome leaves: the window less the header, the stat line, the tab bar and a 6 dp side gutter. The screen measures it with `onLayout`; until then it uses the same chrome constants (`estimateFeltSize`).
- **Dynamic overlap** (`game/_shared/cards/tableLayout.ts`, pure and unit-tested). Face-down cards step 0.2 of the card height. Face-up cards step up to 0.72 of it while columns are short, so the centre pip shows; the step is one value for the whole board and tightens as the tallest column grows. The tallest legal column (6 face-down + 13 face-up) always fits, compressed in this order, and the table never scrolls (a scroll would fight the drag):
  1. the cards narrow (never under 36 dp wide) until a 24 dp face-up stripe fits;
  2. the face-down step shortens, down to 8 dp;
  3. the face-up stripe goes below 24 dp, down to 18 dp (`MIN_COVERED_STRIPE`, the rank's height). Under 24 dp a covered face-up card draws a compact corner index (#3622): the suit beside the rank on one line, sized to fit the stripe, so at 18 dp both the rank and the suit (and its red/black colour, even on Neon's white rank) are readable on every deck. `TableauColumn` picks it from each card's real stripe (`compactIndexFor`, `decks/cornerIndex.ts`) and passes it as `compactIndex` through `CardView` / `SelectableCard` and the drag ghost to the deck's face; the top card, uncompressed columns, the waste and the foundations keep the stacked index. Arcade, Parlor and Synthwave keep their bigger stacked index while it fits the stripe (`bcStackedIndexFits`); below it their compact row stays above the top pips and the court frame. The 18 dp stripe holds at 375 x 667 and up at font scale 1; a smaller felt (360 x 640 with 3-button navigation, or a large font scale) gets the fitted step, which may be under 18 dp.

  At 375 x 667 the board is compressed to step 3 (36 dp cards, 8 dp face-down, a stripe of about 20 dp); at 390 x 844 and 430 x 932 a 24 dp stripe or more fits with no step compressed. The geometry also keeps the bottom band clear and subtracts the felt's 1 dp rim.

- **Selection.** The selected card or run lifts 6 dp with an accent glow. With Reduce Motion on there is no lift or pop; the glow stays as a static highlight (`SelectableCard`'s `reduceMotion`).
- **Targets.** While something is selected, each legal destination (`game/solitaire/targets.ts`, built on `validateMove`) gets a green outline (`bonus` token) and the accessibility hint "Can move here". The Hint highlight is unchanged and still draws on top.
- **Empty columns** show a faint "K" marker, because only a King can go there.
- **Bottom band.** The selection label and the Auto-Complete pill (the shared `components/shared/AutoCompleteButton.tsx`, also used by FreeCell, #3566) share a band at the bottom of the felt (at least 44 dp; it wraps and is measured like the stat line), and the tableau area ends above it, so neither covers a column's last cards.
- **Accessibility.** A legal destination's top card carries the hint "Can move here" (an empty slot carries it itself); the green outline is not announced. The screen reads Reduce Motion once and passes it to every pile.

## Input

Cards can be moved through the shared card-selection/drag interaction.

The current UI uses tap-to-select. The older smart-single-tap auto-move experiment (`resolveAutoMove`, #2039) was removed in #2970.

A quick second activation on eligible cards can use the screen's explicit double-tap path where implemented, but ordinary legal selection/drag remains the core interaction.

## Hint

Hint highlights a productive legal move. It does **not** execute the move.

Hint priority is:

1. waste/tableau → foundation;
2. tableau → tableau that reveals a face-down card;
3. waste → tableau;
4. other productive tableau → tableau moves.

The hint engine filters obvious reversible tableau oscillations and excludes:

- moving a whole column onto another column unless a king (in the stock, waste, or above a tableau base) can then use the emptied column, and moving a whole column into an empty column (the pile only changes column; #3362);
- stock draws;
- foundation → tableau retreats.

If there is no productive hint, the Hint control is disabled.

Each hint use costs **20 points**, floored at 0.

## Undo

Undo restores the board and score snapshot from before the previous state-changing move.

- history cap: **50** snapshots;
- timer continues according to the current presence state rather than rewinding to an old clock;
- the move count (stock draws, card moves, auto-complete steps; hints do not count) is stored in the saved game as an optional `moves` field, so a resumed game keeps it (old saves without it count from 0); Undo decrements it (floored at 0);
- unavailable while auto-complete is running;
- the cards fly back, with card place on their landing (#3572, [Motion and sound timing](#motion-and-sound-timing-3572)).

## Auto-complete

An Auto Complete action appears only when the engine can prove its own stepper can finish the deal.

The proof requires all tableau cards to be face-up and simulates the exact auto-complete sequence to completion before offering the action.

The stepper can:

1. move waste → foundation;
2. draw stock batches to waste;
3. move tableau tops → foundation;
4. make a narrow single-card tableau relocation only when it immediately exposes a foundation-ready card.

It deliberately refuses deeper speculative rearrangements. If the stepper cannot prove the finish, Auto Complete is not offered.

Auto-complete performs real game moves one step at a time, so:

- normal scoring applies;
- normal move counting applies;
- the game timer/session behaves as if those moves were made normally.

The steps stay 120 ms apart; each card flies 220 ms to its foundation, and the riffle, the win and the result card wait for the last landing (#3572, [Motion and sound timing](#motion-and-sound-timing-3572)).

## Scoring

The leaderboard ranks final score, higher is better.

| Event                           | Score |
| ------------------------------- | ----: |
| Waste → tableau                 |    +5 |
| Waste → foundation              |   +10 |
| Tableau → foundation            |   +10 |
| Reveal a face-down tableau card |    +5 |
| Foundation → tableau            |   −15 |
| Recycle after the first         |   −50 |
| Use Hint                        |   −20 |
| Complete all foundations        |  +500 |

Score never falls below 0.

There is **no time bonus**.

The backend's declared maximum rankable score is **1245**.

Equal scores use the shared final tie rule: the completion the server received first (`received_at`) ranks first.

## Timer and save/resume

The active-play timer starts on the first real move and stops at the win.

It pauses while:

- the app backgrounds; or
- another screen covers the game.

The full deal state and banked active-play time are saved locally. Relaunching:

- restores the board;
- keeps previously accumulated active time;
- does not count time while the app was closed.

A save from an older pre-#2750 build cannot reconstruct an unbanked running segment, so that unknown segment is discarded on load.

## Session outcome

Solitaire has no loss outcome in the reporting contract.

- Win → `completed`, with engine score as `final_score` and `{ won: true, moves }`.
- Leaving or starting a new deal after play → `abandoned`, with no ranked score.
- An untouched deal can be discarded without a meaningful played result.

Creation metadata records `draw_mode` (1 or 3).

For generic syncing, rank lookup, display names, Stats, and result-card behavior, see [GAME-CONTRACT.md](../GAME-CONTRACT.md).

## Replay recording

_(#3289, epic #3273; the shared recorder is [GAME-CONTRACT §2.10](../GAME-CONTRACT.md#210-recording-gameplay).)_

**The deal is recorded once**, in `game_started` (#3281): `seed`, `draw_mode`, `engine_version` (under 100 B). `dealGame(draw_mode, seed)` rebuilds the shuffled deck order and the opening layout, so no card is ever sent. Everything after it is a list of **actions**; opening + the `moves` rows in `event_index` order rebuild the final tableau, foundations, stock, waste and score.

**One action** is a small array of integers, the first is the kind (`solitaire/replay.ts`):

| Kind | Action             | Meaning                                                    |
| ---- | ------------------ | ---------------------------------------------------------- |
| 0    | `[0]`              | draw from the stock (1 or 3 cards by the draw mode)        |
| 1    | `[1]`              | recycle the waste back to the stock                        |
| 2    | `[2]`              | undo                                                       |
| 3    | `[3]`              | hint (costs points, so it is part of the score)            |
| 4    | `[4, to]`          | waste to tableau column `to`                               |
| 5    | `[5]`              | waste to foundation                                        |
| 6    | `[6, from, to, n]` | the top `n` cards of column `from` to column `to`          |
| 7    | `[7, from]`        | tableau column `from` to its foundation                    |
| 8    | `[8, suit, to]`    | foundation `suit` (index into `SUITS`) back to column `to` |

An **Auto Complete** step is the action it took plus 16 (`[23, 2]`: auto, column 2 to its foundation; `[16]`: auto, a stock draw). The screen reads the step from the engine (`autoCompleteStepOf`) before it applies it, so a replay rebuilds each step from its move and does not depend on the engine's auto-complete order. A hint asked for before the first action is not recorded (the game has not started).

Replaying an action is calling the engine function it names (`applyAction` in `replay.ts`: `applyMove`, `drawFromStock`, `recycleWaste`, `undo`, `applyHint`), so the score, the +5 for a revealed card, the recycle penalty, the undo stack and the stock cycle all rebuild exactly.

**A `moves` event** is `{ v: 1, unit, t_ms, s, m: [action, ...] }` (the recorder's envelope plus `s`, the index of the chunk's first action in the game, and `m`): up to **25** actions, one recorder unit per chunk (`MOVES_PER_CHUNK`, `_shared/cards/moveLog.ts`). Nothing is saved per tap, drag or Auto Complete step: an action is one in-memory array append (`createMoveLog`), the recorder saves a closed chunk at an idle moment, and every recording call from a handler runs inside `guardRecording` (a failure is reported once, throttled, and never reaches play). A partial chunk is handed to the recorder, and saved at once, when the app goes to the background or the screen loses focus, not on `inactive` (`useFlushOnBackground`: `moveLog.flush()` then `useGameRecorder().flush()`, synchronous); when the game is won; when a new deal starts or the game is closed; and on unmount, always before the session's `game_ended`. The game's session is opened before its first action is recorded, so nothing recorded is waiting for a game (a Hearts review found units buffered before the session opened were lost).

**Resumed games.** The saved game carries `recorded`, the number of actions handed to the log (the screen stamps it after every action; an undo does not take it back). A game restored after a kill resets its log to that count, so the next chunk's `s` and unit number (`floor(s / 25) + 1`, passed to `beginUnit(n)`) carry on. The actions in the chunk a kill cut short are never stored (at most 24): the next chunk's `s` is past the end of the stored ones, which shows the hole. A unit number can repeat after a resume (a chunk cut short by the background and the chunk after it, or the first chunk of a resumed game, can share `floor(s / 25) + 1`): **`s` is authoritative**, the unit number is only the recorder's grouping. **A restored game is recorded only if it can be replayed.** If its original session was not resumed (the player left, the session was abandoned, the save was kept) the next action opens a session whose `game_started` has no seed, so its `moves` could never be rebuilt: nothing is recorded for that game (the session itself opens as before). The same holds for a save from before #3289 that has no count (or a corrupt one) and some history: its earlier actions were never recorded, and a log starting at 0 would rebuild the wrong board. A save with no count and no history is recorded from 0.

**Validation** (`backend/solitaire/models.py`, `validate_moves`): a `SolitaireMoves` pydantic model, `extra="forbid"`, `v == 1`, 1..32 actions each a known kind with exactly its arguments in range (columns 0..6, run length 1..13, suit 0..3; undo, hint, recycle and waste-to-tableau are never auto), and 512 B of compact JSON (`MAX_MOVES_BYTES`, the same figure as the app's `CARD_MOVES_MAX_BYTES`; a test holds the two equal). A bad event is dropped, not the batch, with one Sentry report per reason per five minutes, by reason and error types only. The type is seeded by `0044_card_game_moves_events`, which must be deployed before the app that sends it.

### Size against the budget (about 40 KB per uploaded game)

Row cost on the server is the JSON as Postgres stores it (`jsonb::text`, a space after each `,` and `:`) plus `ROW_OVERHEAD_BYTES` (200). The overhead is why actions go in chunks of 25 and not one event each: 300 rows would be 60 KB of overhead alone.

- A typical action is 6 to 8 B; a worst-case Auto Complete run move `[22,6,5,13]` is 11 B. A worst-case full chunk with its envelope is about 350 B JSON (the event cap is 512 B).
- A typical 300-action game: 12 events, 2,606 B of JSON, **5,850 B stored** (with overhead). A long 787-action game: 32 events, 7,931 B, **17,064 B stored**.
- **A game's recording is bounded across kills.** The byte cap `CARD_MOVES_SESSION_MAX_BYTES` (20 KB of JSON) restarts with every resume, so it bounds a process, not a game. The game bounds itself with counts saved in its state, `recorded` (actions) and `recordedRows` (rows handed over, partial chunks from flushes included): at `MAX_RECORDED_ACTIONS` (1,200) or `MAX_RECORDED_ROWS` (60) the log stops collecting, and a game resumed at the limit starts capped. The worst mix (60 rows of 20 worst-size actions, a flush after each) measures **34,209 B stored** (jsonb text + 200 B a row), 61 events, under 40 KB and far under the 500 of `DEFAULT_CAP`; flushing after every action stops at 60 rows (15.8 KB); 1,200 actions without flushes are 48 rows, 31.2 KB. Typical games (300 actions) never reach it.
- Kill switch: the recorder reads `isRecordingEnabled` once per session and does no work when it is off (the replay tests build a recorder with `enabled: false` and spy on the sink and the idle scheduler).

Why 25: a chunk is also the most a kill can lose (24 actions); 25 keeps a row near 220 B of JSON, so the 200 B overhead is under half of the row; a game of 100 actions still saves every 25 taps.

### Measured (`solitaire/__tests__/replay.bench.test.ts`)

A seeded 298-action game over the real GameEventClient → EventStore → AsyncStorage mock, an idle moment after every action, against one event and one save per action:

|                                         | One event per action | Chunks of 25 |
| --------------------------------------- | -------------------- | ------------ |
| Queue saves                             | 298                  | **12**       |
| AsyncStorage writes                     | 596                  | **24**       |
| Bytes written to storage                | 2,755,766            | **38,229**   |
| Events                                  | 298                  | 12           |
| Recorded JSON (sum of `data`)           | 13,263 B             | **2,606 B**  |
| Stored on the server (jsonb + overhead) | 75,399 B             | **5,850 B**  |
| `fetch` calls while the game was played | n/a                  | **0**        |

## Motion and sound timing (#3572)

Cards move instead of snapping, and each sound lands on its card's contact or turn. The owner picked direction **A. Brisk** (design audition, 2026-11-09); the reasoning is in the [sound design log](arcade-sound-design.md#solitaire-card-motion-timed-to-the-sounds-3572). Every value is a named constant: the ones shared with FreeCell (#3573: the tap, run, drop and Auto-Complete flights, the sound peaks and the cue table) in `frontend/src/components/cards/cardMotion.ts`, Solitaire's own (the reveal, the draws, the recycle) in `frontend/src/components/solitaire/solitaireMotion.ts`.

| Moment              | Motion                                                                                                       | Sound                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tap-move, 1 card    | 200 ms flight, out-cubic                                                                                     | card place 40 ms before contact (160 ms)                                                                                                                |
| Tap-move, a run     | 220 ms per card, 15 ms apart down the run                                                                    | multi-card move, its 237 ms peak on the last card's contact                                                                                             |
| Drop                | 110 ms settle from where the ghost was let go (finger − grab − `GHOST_LIFT`); no flight from the old slot    | card place on contact (70 ms); a dropped run plays card place too, not the multi-card move                                                              |
| Reveal              | the uncovered card turns over in 140 ms, starting as the moved card lands                                    | card flip, its 28 ms peak on the turn's edge-on point                                                                                                   |
| Draw 1              | 200 ms slide from the stock to the waste, turning on the way                                                 | card flip on the edge-on point (72 ms)                                                                                                                  |
| Draw 3              | the same, the three cards 36 ms apart                                                                        | the fan, its first hit (27 ms) on the first card's edge-on point (73 ms)                                                                                |
| Recycle             | the waste slides back to the stock in 220 ms, turning face down                                              | the riffle's settle, its 77 ms peak on contact (143 ms)                                                                                                 |
| Undo                | the cards fly back (a tap-move's flight; a run's for two or more cards); a re-covered card turns at once     | card place on the landing                                                                                                                               |
| Auto-Complete       | the steps stay 120 ms apart (the JS timer is unchanged); each card flies 220 ms, so about two are in the air | the riffle plays until the last card lands; its settle (77 ms peak) and the win on that last contact                                                    |
| Input during motion | no lock: a new action re-targets a card in flight from where, and with the face, it is shown                 | cues of other actions already scheduled still play; the earlier action of a card moved again goes quiet (its cues and its pending turns are called off) |
| Reduce Motion       | nothing flies or turns                                                                                       | every cue at the instant of the action                                                                                                                  |

The win (its cascade, then the result card) waits for the winning card's landing, and the board is still meanwhile: no selection, move, draw, drag or Undo, and no invalid-move sound (a won game is over).

How it works:

- **The engine stays instant.** An action commits its state at once (score, timer, moves, replay recording and saves are unchanged); the screen then plans the motion by comparing every card's slot before and after it (`planMotion`). A card flies when it changed pile and is drawn where it lands; a card that stayed but turned over turns in place.
- **Positions come from the table geometry** (`tableLayout`: the column x, the face-down and face-up steps, the foundation, stock and waste slots), never from a measurement. A drop's start is the ghost's offset from where it was picked up, which `DraggableCard` hands to the drop zone (`DropOffset`).
- **The flight layer** (`frontend/src/components/cards/cardFlights.tsx`, shared with FreeCell since #3573; a flight's testID is `card-flight-<suit>-<rank>`) is the board's last child, so a card in flight draws above every pile. Each flight is one linear Reanimated timing on the UI thread, eased and turned in a worklet; JS sees one launch per action and one landing per card, never a frame. While a card is in flight its real view stays in its pile (label, testID, touch target), transparent: only the view inside its gesture view (`TransparentFace`), since iOS and Android skip a nearly transparent view when they hit-test, so the card can still be tapped or dragged mid-flight. A foundation draws the card under its top meanwhile, and the waste its collapsed fan; the stock hides its back only while every card in it is flying in, and keeps its count.
- **Landings** come back from the UI thread through `runOnJS`, with a JS backstop 250 ms after the flight's end (`FLIGHT_BACKSTOP_MS`), so a card is never left hidden and the result card is never left waiting.
- **Sound cues** are timed from the action's own clock (`cueTimes`), not from the landing callback. Every pending cue and hold (the riffle, the result card) is cancelled on a new deal, on leaving the game (the clock's pause) and on unmount; a cue due while the player is away is not played, and the riffle's hold ending while away stops the loop without its settle. Reduce Motion turned on mid-flight lands every card at once. A card moved again mid-flight (a re-target, an Undo) calls its earlier action off: that action's cues are cancelled, and a turn it planned is planned again from the face shown, so an Undo before a reveal's turn leaves the card face down, with no flip.
- **Nothing replays.** Flights come only from actions; the flight store is empty at mount (a restore) and emptied on every deal.

## Implementation

- Engine: `frontend/src/game/solitaire/engine.ts`
- Motion: `frontend/src/components/solitaire/solitaireMotion.ts` (Solitaire's planner and its own constants), over the stack shared with FreeCell (#3573) in `frontend/src/components/cards/`: `cardMotion.ts` (shared constants, cues and the planners' core), `cardFlights.tsx` (flight store and layer), `launchMotion.ts`, `useCueClock.ts`, `FoundationUnderTop.tsx`
- Screen: [`frontend/src/screens/SolitaireScreen.tsx`](../../frontend/src/screens/SolitaireScreen.tsx) (its header lists the screen's concerns; see [GAMEPLAY_STANDARDS §8](../GAMEPLAY_STANDARDS.md#8-screen-layer))
- Felt table: `frontend/src/components/shared/FeltTable.tsx`, `TableStatLine.tsx`; geometry `frontend/src/game/_shared/cards/tableLayout.ts`; targets `frontend/src/game/solitaire/targets.ts`; tokens `frontend/src/theme/theme.table.ts`
- Seed bank: `frontend/src/game/solitaire/seeds.json`
- Seed generator/solver: `backend/scripts/gen_solitaire_seeds.py`
- Storage: `frontend/src/game/solitaire/storage.ts`
- Replay recording: `frontend/src/game/solitaire/replay.ts`, `frontend/src/game/_shared/cards/moveLog.ts`
- Backend descriptor: `backend/solitaire/module.py` (the `moves` validator is in `backend/solitaire/models.py`)

## Sound

Registry: `frontend/src/game/solitaire/sounds.ts` (`SOLITAIRE_SOUNDS`), played through the shared `useSound` hook, which honours the player's sound setting. The effects are being replaced with original synthesized sounds shared across the card and puzzle games (#3563); the reasoning behind each is in the [arcade sound design log](arcade-sound-design.md). Volume is `useSound`'s default (1.0) unless noted.

Triggers are in `frontend/src/screens/SolitaireScreen.tsx`. A completed suit has no sound and no effect: the card lands like any other (dropped in #3563 and #3567).

| Key                                                                                           | File                                                                           | Plays when                                                                                                                                                                                                                                 | Volume |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| `solitaire.cardPlace` / `solitaire.cardPlace2` / `solitaire.cardPlace3`                       | `card-place-1/2/3.ogg` (shared with FreeCell, Hearts; synthesized)             | a card lands, 40 ms before its contact (`useSoundVariants`: one of three, at random, never the same twice in a row); a dropped run; an Undo's landing; silent for cards moved by Auto-Complete                                             | 1.0    |
| `solitaire.autoCompleteStart` / `solitaire.autoCompleteLoop` / `solitaire.autoCompleteSettle` | `riffle-start/loop/settle.ogg` (shared by Solitaire and FreeCell; synthesized) | Auto-Complete (`useAutoCompleteRiffle`): start + loop as the run begins, loop until the last card lands, settle on that contact when the board is solved; a run cut short just stops. The settle also plays on a recycle's contact (#3572) | 1.0    |
| `solitaire.cardFlip` / `solitaire.cardFlip2` / `solitaire.cardFlip3`                          | `card-flip-1/2/3.ogg` (synthesized)                                            | a Draw-1 card's turn, or the turn of a face-down card revealed by a move, its peak on the edge-on point (`useSoundVariants`); silent for stock draws made by Auto-Complete                                                                 | 1.0    |
| `solitaire.cardFan` / `solitaire.cardFan2` / `solitaire.cardFan3`                             | `card-fan-1/2/3.ogg` (synthesized)                                             | a Draw-3 stock draw that turns more than one card (engine event `cardFan`) (`useSoundVariants`); silent during Auto-Complete                                                                                                               | 1.0    |
| `solitaire.invalidMove`                                                                       | `card-invalid-move.ogg` (shared with FreeCell)                                 | an illegal tap or a refused drop, except during Auto-Complete                                                                                                                                                                              | 1.0    |
| `solitaire.multiCardMove`                                                                     | `card-multi-move.ogg` (shared with FreeCell; synthesized)                      | a run of two or more cards tapped tableau to tableau (engine event `multiCardMove`), instead of card place, its peak on the last contact; a dropped run plays card place; silent during Auto-Complete                                      | 1.0    |
| `solitaire.gameWin`                                                                           | `card-game-won.ogg` (shared with FreeCell, Hearts)                             | the game is won, on the winning card's contact; after Auto-Complete, with the riffle's settle                                                                                                                                              | 1.0    |
