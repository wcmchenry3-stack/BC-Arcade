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

Live deals come from `frontend/src/game/solitaire/seeds.json`, a bank of **provably solvable** seeds generated offline by `backend/scripts/gen_solitaire_seeds.py`. A seed reproduces the same deal deterministically.

**Recorded deal (#3281).** The `game_started` event data carries `seed`, `seed_index` (its place in the draw mode's bank), `draw_mode` and `engine_version` (`ENGINE_VERSION` in `engine.ts`, bumped when a deal change would break a recorded seed), under 100 bytes (asserted in `dealSeed.test.ts`). `dealGame(draw_mode, seed)` rebuilds the opening from them. The screen draws the seed with `drawDealSeed` and passes it to `dealGame`. A saved game does not store its seed, so a restored game that opens a fresh session sends only `draw_mode` and `engine_version`.

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
- stock draws;
- foundation → tableau retreats.

If there is no productive hint, the Hint control is disabled.

Each hint use costs **20 points**, floored at 0.

## Undo

Undo restores the board and score snapshot from before the previous state-changing move.

- history cap: **50** snapshots;
- timer continues according to the current presence state rather than rewinding to an old clock;
- the screen's displayed move count is also decremented when Undo is used;
- unavailable while auto-complete is running.

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

## Scoring

The leaderboard ranks final score, higher is better.

| Event | Score |
| --- | ---: |
| Waste → tableau | +5 |
| Waste → foundation | +10 |
| Tableau → foundation | +10 |
| Reveal a face-down tableau card | +5 |
| Foundation → tableau | −15 |
| Recycle after the first | −50 |
| Use Hint | −20 |
| Complete all foundations | +500 |

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

| Kind | Action              | Meaning                                                    |
| ---- | ------------------- | ---------------------------------------------------------- |
| 0    | `[0]`               | draw from the stock (1 or 3 cards by the draw mode)        |
| 1    | `[1]`               | recycle the waste back to the stock                        |
| 2    | `[2]`               | undo                                                       |
| 3    | `[3]`               | hint (costs points, so it is part of the score)            |
| 4    | `[4, to]`           | waste to tableau column `to`                               |
| 5    | `[5]`               | waste to foundation                                        |
| 6    | `[6, from, to, n]`  | the top `n` cards of column `from` to column `to`          |
| 7    | `[7, from]`         | tableau column `from` to its foundation                    |
| 8    | `[8, suit, to]`     | foundation `suit` (index into `SUITS`) back to column `to` |

An **Auto Complete** step is the action it took plus 16 (`[23, 2]`: auto, column 2 to its foundation; `[16]`: auto, a stock draw). The screen reads the step from the engine (`nextAutoStep`) before it applies it, so a replay rebuilds each step from its move and does not depend on the engine's auto-complete order. A hint asked for before the first action is not recorded (the game has not started).

Replaying an action is calling the engine function it names (`applyAction` in `replay.ts`: `applyMove`, `drawFromStock`, `recycleWaste`, `undo`, `applyHint`), so the score, the +5 for a revealed card, the recycle penalty, the undo stack and the stock cycle all rebuild exactly.

**A `moves` event** is `{ v: 1, unit, t_ms, s, m: [action, ...] }` (the recorder's envelope plus `s`, the index of the chunk's first action in the game, and `m`): up to **25** actions, one recorder unit per chunk (`MOVES_PER_CHUNK`, `_shared/cards/moveLog.ts`). Nothing is saved per tap, drag or Auto Complete step: an action is one in-memory array append (`createMoveLog`), the recorder saves a closed chunk at an idle moment, and every recording call from a handler runs inside `guardRecording` (a failure is reported once, throttled, and never reaches play). A partial chunk is handed to the recorder, and saved at once, when the app goes to the background or becomes inactive (`useFlushOnBackground`: `moveLog.flush()` then `useGameRecorder().flush()`, synchronous); when the game is won; when a new deal starts or the game is closed; and on unmount, always before the session's `game_ended`. The game's session is opened before its first action is recorded, so nothing recorded is waiting for a game (a Hearts review found units buffered before the session opened were lost).

**Resumed games.** The saved game carries `recorded`, the number of actions handed to the log (the screen stamps it after every action; an undo does not take it back). A game restored after a kill resets its log to that count, so the next chunk's `s` and unit number (`floor(s / 25) + 1`, passed to `beginUnit(n)`) carry on. The actions in the chunk a kill cut short are never stored (at most 24): the next chunk's `s` is past the end of the stored ones, which shows the hole. A save from before #3289 has no count and restarts at 0.

**Validation** (`backend/solitaire/models.py`, `validate_moves`): a `SolitaireMoves` pydantic model, `extra="forbid"`, `v == 1`, 1..32 actions each a known kind with exactly its arguments in range (columns 0..6, run length 1..13, suit 0..3; undo, hint, recycle and waste-to-tableau are never auto), and 512 B of compact JSON (`MAX_MOVES_BYTES`, the same figure as the app's `CARD_MOVES_MAX_BYTES`; a test holds the two equal). A bad event is dropped, not the batch, with one Sentry report per reason per five minutes, by reason and error types only. The type is seeded by `0044_card_game_moves_events`, which must be deployed before the app that sends it.

### Size against the budget (about 40 KB per uploaded game)

Row cost on the server is the JSON as Postgres stores it (`jsonb::text`, a space after each `,` and `:`) plus `ROW_OVERHEAD_BYTES` (200). The overhead is why actions go in chunks of 25 and not one event each: 300 rows would be 60 KB of overhead alone.

- A typical action is 6 to 8 B; a worst-case Auto Complete run move `[22,6,5,13]` is 11 B. A worst-case full chunk with its envelope is about 350 B JSON (the event cap is 512 B).
- A typical 300-action game: 12 events, 2,606 B of JSON, **5,850 B stored** (with overhead). A long 787-action game: 32 events, 7,931 B, **17,064 B stored**.
- The device's session cap for the game is `CARD_MOVES_SESSION_MAX_BYTES` (20 KB of JSON, about 2,200 typical actions): a game past it is cut as a clean prefix, reported once. Even 4,000 worst-case actions keep 59 events, 20,210 B, **38,382 B stored**, under 40 KB. The server's per-game cap is the default (`DEFAULT_CAP`, 500 events / 160 KB); a game stays far below it.
- Kill switch: the recorder reads `isRecordingEnabled` once per session and does no work when it is off (the replay tests build a recorder with `enabled: false` and spy on the sink and the idle scheduler).

Why 25: a chunk is also the most a kill can lose (24 actions); 25 keeps a row near 220 B of JSON, so the 200 B overhead is under half of the row; a game of 100 actions still saves every 25 taps.

### Measured (`solitaire/__tests__/replay.bench.test.ts`)

A seeded 298-action game over the real GameEventClient → EventStore → AsyncStorage mock, an idle moment after every action, against one event and one save per action:

|                                          | One event per action | Chunks of 25 |
| ---------------------------------------- | -------------------- | ------------ |
| Queue saves                              | 298                  | **12**       |
| AsyncStorage writes                      | 596                  | **24**       |
| Bytes written to storage                 | 2,755,766            | **38,229**   |
| Events                                   | 298                  | 12           |
| Recorded JSON (sum of `data`)            | 13,263 B             | **2,606 B**  |
| Stored on the server (jsonb + overhead)  | 75,399 B             | **5,850 B**  |
| `fetch` calls while the game was played  | n/a                  | **0**        |

## Implementation

- Engine: `frontend/src/game/solitaire/engine.ts`
- Screen: [`frontend/src/screens/SolitaireScreen.tsx`](../../frontend/src/screens/SolitaireScreen.tsx) (its header lists the screen's concerns; see [GAMEPLAY_STANDARDS §8](../GAMEPLAY_STANDARDS.md#8-screen-layer))
- Seed bank: `frontend/src/game/solitaire/seeds.json`
- Seed generator/solver: `backend/scripts/gen_solitaire_seeds.py`
- Storage: `frontend/src/game/solitaire/storage.ts`
- Replay recording: `frontend/src/game/solitaire/replay.ts`, `frontend/src/game/_shared/cards/moveLog.ts`
- Backend descriptor: `backend/solitaire/module.py` (the `moves` validator is in `backend/solitaire/models.py`)
