# Solitaire

**Category:** Card
**Tier:** TBD
**Status:** In Development

## How to Play

Klondike Solitaire. The objective is to move all 52 cards onto the 4 foundation piles, sorted by suit from Ace to King.

### Layout

- **Stock** (draw pile): undealt cards; tap to draw
- **Waste**: face-up cards drawn from stock
- **Tableau** (7 columns): alternating-color sequences in descending rank; only face-up cards can be moved; can place any card or sequence on an empty column (Kings only to open column)
- **Foundations** (4 piles, one per suit): built up from Ace to King

### Draw Mode

The player picks **Draw-1** or **Draw-3** before each deal (`PreGameModal` in `frontend/src/screens/SolitaireScreen.tsx`). In Draw-3, tapping the stock deals 3 cards to the waste. Only the top waste card is playable. Turning the waste back into the stock is free the first time; every later recycle costs 50 points (see [Scoring](#scoring-persistence)).

### Undo

Undo steps back through the last 50 moves (`UNDO_CAP`). An undo restores the board and the score as they were before that move; the play timer keeps running.

## Scoring (Persistence)

- **Metric and direction:** `final_score`, higher is better, labelled `score` (`board` in `backend/solitaire/module.py`; `BOARDS.solitaire` in `frontend/src/api/vocab.ts`). It is the engine's score at the win (`frontend/src/game/solitaire/engine.ts`). There is **no time bonus**: +5 waste to tableau, +10 to a foundation, +5 for each card turned face up, −15 foundation to tableau, −50 for each recycle after the first, −20 per hint, +500 on the win. The score never drops below 0.
- **Tie-break:** none declared. Equal scores go to the earlier `completed_at`, the last tie-break on every board.
- **Partitions:** none: Draw-1 and Draw-3 share one board (#591).
- **Recorded, not partitioned:** creation metadata `draw_mode` (`1` | `3`, `SolitaireMetadata`, #2632); older builds send none. Result (`SolitaireResult`): `won` and `moves`.
- **Max value:** 1245, recomputed from the engine's scoring constants in `backend/tests/test_board_definitions.py`.
- **Outcomes:** `has_winner = False`. Only a won game records `completed`: there is no loss. A new deal during a game, or leaving the screen, records `abandoned` with `{ won: false, moves }` and no score, once a move has been made.
- **Duration:** Solitaire's own timer (`startedAt` / `accumulatedMs` on the engine state, `applyTimer` in `engine.ts`). It wins over `useGameSync`'s window. It is **wall-clock time** from the first move to the win: nothing pauses it when the app goes to the background or another screen covers the game, and a relaunch restores the saved `startedAt` unchanged (`loadGame` in `frontend/src/game/solitaire/storage.ts`), so a two-day break counts as two days of play (#2735).
- **How it reaches the server:** the `useGameSync("solitaire")` session row, one per deal, with `draw_mode` as creation metadata. `SyncWorker` sends `POST /games` once the first move is made, and `PATCH /games/{id}/complete`. If the player has a display name (`PUT /players/me`), the row ranks with no further step. The board shows each named player's best win once. The app no longer calls the legacy `POST /solitaire/score`. Shared rules: [Leaderboard routes](../GAME-CONTRACT.md#leaderboard-routes-2618).
- **Where the player sees it:** the win card shows the rank through `sessionBoardAdapter` (`GET /games/{id}/rank`), or asks once for a display name. The card's "View leaderboard" link and the ⋯ menu open the Leaderboard screen (#2633). Stats (#2635) are in the ⋯ menu.

## Client-Side Engine

- Location: `frontend/src/game/solitaire/engine.ts`
- Key exports: `validateMove(state, move) → boolean`, `applyMove(state, move) → GameState`, auto-complete detection, recycle penalty logic

## Backend

- Module: `backend/solitaire/module.py`
- Endpoints: `backend/solitaire/router.py`, legacy. `POST /solitaire/score` and `GET /solitaire/scores` stay for installed builds until #2644; the app no longer calls them.
- Metadata model: `SolitaireMetadata` — `player_name: str = ""` (max 64 chars), `draw_mode: 1 | 3 | None`
- Result model: `SolitaireResult` — `won: bool`, `moves: int`
- Scoring: see [Scoring](#scoring-persistence)

## Entitlement

Tier TBD. If free: no entitlement check.

## Known Issues / Limitations

- #2735: the play timer counts backgrounded time and breaks across relaunches (see [Scoring](#scoring-persistence), Duration)
