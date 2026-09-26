# FreeCell

**Category:** Card
**Tier:** TBD
**Status:** In Development

## How to Play

FreeCell is a solitaire variant where nearly every deal is winnable with correct play. The full 52-card deck is dealt face-up into 8 tableau columns at the start — there is no hidden information.

### Layout

- **Tableau** (8 columns): all cards dealt face-up at start; move cards to build in descending rank, alternating colors
- **Free cells** (4): temporary holding spots for individual cards; each can hold one card at a time
- **Foundations** (4, one per suit): built up from Ace to King

### Rules

- Move a single card (or a sequence, if enough free cells + empty columns exist) from one tableau column to another
- A card may be placed on the tableau if it is one rank lower and opposite color from the top card
- Free cells can hold any single card temporarily
- Empty tableau columns act as extended free cells (can hold any card or sequence)
- Win by moving all 52 cards to the foundations

### Supermove

The maximum number of cards moveable as a sequence is `(free cells + 1) × 2^(empty columns)`.

### Double-Tap

Double-tapping a card (within a 300 ms window) triggers auto-move to foundation if a valid foundation move exists.

## Scoring (Persistence)

- **Metric and direction:** `final_score`, **lower is better**, labelled `moves` (`board` in `backend/freecell/module.py`; `BOARDS.freecell` in `frontend/src/api/vocab.ts`). A win sends the engine's `moveCount` (`FreeCellScreen.tsx`). Each move counts 1, taking a card back off a foundation counts 2, and Undo restores the earlier count (`frontend/src/game/freecell/engine.ts`).
- **Tie-break:** none declared. Equal move counts go to the earlier `completed_at`, the last tie-break on every board.
- **Partitions:** none: one board.
- **Recorded, not partitioned:** result (`FreeCellResult`): `won` and `moves`. Creation metadata is empty (`FreeCellMetadata`).
- **Max value:** none (`max_value` unset).
- **Outcomes:** `has_winner = False`. A won deal records `completed`: FreeCell has no loss, so every non-abandoned row is a win. New Game during a deal, or leaving the screen, records `abandoned` with `{ won: false, moves }` and no score. The daily challenge still counts an abandon's moves.
- **Duration:** `useGameSync`'s active-play window; FreeCell sends no duration of its own. New Game restarts the window (`resetPlayWindow`), so time on the previous board is not counted.
- **How it reaches the server:** the `useGameSync("freecell")` session row, opened at the first move of a deal. `SyncWorker` sends `POST /games` and `PATCH /games/{id}/complete`. If the player has a display name (`PUT /players/me`), the row ranks with no further step. The board shows each named player's best (fewest-move) win once. Installed builds from before #2632 send no `final_score`, so their rows never rank. The app no longer calls the legacy `POST /freecell/score`. Rows it wrote (`freecell-anon`) never rank on the generic board. Shared rules: [Leaderboard routes](../GAME-CONTRACT.md#leaderboard-routes-2618).
- **Where the player sees it:** the win card shows the rank through `sessionBoardAdapter` (`GET /games/{id}/rank`), or asks once for a display name. The card's "View leaderboard" link and the ⋯ menu open the Leaderboard screen (#2633). Stats (#2635) are in the ⋯ menu; "Best" there is the fewest moves.

## Client-Side Engine

- Location: `frontend/src/game/freecell/engine.ts`
- Key exports: `validateMove`, `applyMove`, `autoMoveCandidates`, supermove calculation

## Backend

- Module: `backend/freecell/module.py` (#2452), registered in `backend/games/registry.py`
- Endpoints: `backend/freecell/router.py`, legacy. `POST /freecell/score` and `GET /freecell/leaderboard` stay for installed builds until #2644; the app no longer calls them.
- Metadata model: `FreeCellMetadata` — empty (extra keys forbidden)
- Result model: `FreeCellResult` — `won: bool`, `moves: int`
- Scoring: see [Scoring](#scoring-persistence)

## Entitlement

Tier TBD. If free: no entitlement check.

## Known Issues / Limitations

- Tracked in issue #893 (in-memory leaderboard migration)
