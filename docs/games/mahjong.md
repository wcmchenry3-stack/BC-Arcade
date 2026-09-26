# Mahjong

**Category:** Puzzle
**Tier:** Premium (hidden in the v1.0 store build; swapped with Sort, owner decision 2026-09-24)
**Status:** In Development

## How to Play

Mahjong Solitaire (Shanghai-style). Remove all tiles from the board by matching identical pairs. A tile is selectable only if it has no tile on top of it and is free on at least one side (left or right).

### Layout

The default layout is the Turtle / Tortoise stack: a multi-layer pyramid of 144 tiles arranged in a traditional pattern. Additional layouts may be added over time.

### Rules

- Select two matching free tiles to remove them
- Tiles are "free" if they have no tiles above them and at least one horizontal side is open
- Joker / flower tiles match any tile of the same category (if present)
- The game is won when all tiles are removed
- The board is deadlocked when no matching free pair remains and no shuffle is left (or a shuffle cannot produce a playable board). A deadlocked board the player leaves is a lost game; see [Scoring](#scoring-persistence)

### Shuffle

When no matching free pair remains and shuffles are left, a Shuffle prompt is offered instead of a deadlock. A game has 3 shuffles (`MAX_SHUFFLES` in `frontend/src/game/mahjong/engine.ts`).

## Scoring (Persistence)

- **Metric and direction:** `final_score`, higher is better, labelled `score` (`board` in `backend/mahjong/module.py`; `BOARDS.mahjong` in `frontend/src/api/vocab.ts`). It is 10 per pair removed plus 500 for clearing the board (`SCORE_PER_PAIR`, `SCORE_COMPLETE_BONUS` in `frontend/src/game/mahjong/engine.ts`). Only a cleared board sends a score.
- **Tie-break:** none declared. Equal scores go to the earlier `completed_at`, the last tie-break on every board. Every cleared board scores 1220, so in practice the board is ordered by who cleared first.
- **Partitions:** none: all layouts share one board (#2519 decision 3).
- **Recorded, not partitioned:** creation metadata `layout` (`MahjongMetadata`), the layout id, sent since #2627; older rows have none. Result (`MahjongResult`): `won` and `pairs`.
- **Max value:** 1220 (72 pairs × 10 + 500; every layout is 144 tiles).
- **Outcomes:** `has_winner = True` (#2627).
  - A cleared board records `win` with its `final_score` and `result: { won: true, pairs }`.
  - A deadlocked board records `loss` with no score, once the player leaves it: navigates away or starts another game (#2592). The loss is not recorded at the deadlock itself, so "Undo last move" on the deadlock card can still rescue the board, and then nothing is recorded.
  - Any other exit is `abandoned`, with `result: { won: false, pairs }` and no score.
  - Builds before #2627 sent `completed`. The server stores one with `won: true` as `win` (`backend/games/legacy_outcomes.py`); the rest stay `completed`, a finish with no winner.
- **Duration:** Mahjong's own play timer (`elapsedMs` in `engine.ts`). It wins over `useGameSync`'s window. The timer stops at a win or a deadlock and pauses while the player is away: another screen covers the game (navigation `blur`, #2633) or the app is in the background (`AppState`, #2750). `usePausableClock` (built on `usePauseWhileAway`) drives `pauseGame` / `resumeGame` for both as functional updates at the event's time, and resumes only once neither holds; it also starts paused when the screen mounts away, and pauses a game loaded while the player is away (`adoptLoaded`) or a move built from a board rendered before the pause (`pauseIfAway`). The clock's paused state is its own (`paused` on `PlayClock`): a move never restarts a paused clock, only the return does, and a clock that never started still starts on the first move. The pause also saves in its own event handler, before any render; the pause is saved like any state change. The save banks the running segment into `accumulatedMs` and the load restarts the clock from the moment of loading (`clockForSave` / `clockOnLoad` in `frontend/src/game/_shared/playClock.ts`), so a relaunch keeps the play before an app kill and never counts the time the app was closed. Level Select pauses the clock (a trip to the background there doesn't resume it), and CONTINUE carries on from the board still in memory and resumes it (the save is loaded only when nothing is); a deadlocked or cleared board never resumes. Undo keeps the live clock rather than the snapshot's (`undoMove`), and undoing out of a deadlock starts the stopped clock again. A save from a build before #2750 carries a raw running `startedAt`, and the oldest have no `accumulatedMs`: when the app was closed is unknown, so that running segment is dropped and the game counts from the load, keeping only what was banked.
- **How it reaches the server:** the `useGameSync("mahjong")` session row, opened at the first tile tap. `SyncWorker` sends `POST /games` and `PATCH /games/{id}/complete`. The engine runs client-side and the board persists to AsyncStorage, so a game finished offline uploads when the device is back online. If the player has a display name (`PUT /players/me`), the row ranks with no further step. The board shows each named player's best win once. The legacy `POST /mahjong/score` was removed in #2644. Shared rules: [Leaderboard routes](../GAME-CONTRACT.md#leaderboard-routes-2618).
- **Where the player sees it:** the win card shows the rank through `sessionBoardAdapter` (`GET /games/{id}/rank`), or asks once for a display name. The deadlock card shows no rank. The card's "View leaderboard" link and the ⋯ menu open the Leaderboard screen (#2633). Stats (#2635) are in the ⋯ menu. Store builds hide Mahjong (`HIDDEN_GAMES`, `frontend/src/entitlements/gameVisibility.ts`), so there it has no leaderboard or stats entry point.

## Client-Side Engine

- Location: `frontend/src/game/mahjong/engine.ts`
- Key exports: tile matching, free-tile detection, deadlock detection, shuffle
- Rendering: `@shopify/react-native-skia` on native; Canvas2D on web

## Backend

- Module: `backend/mahjong/module.py`
- Endpoints: none of its own — the generic `/games` routes. The legacy `POST /mahjong/score` and `GET /mahjong/scores` were removed in #2644.
- Metadata model: `MahjongMetadata` — `player_name: str = ""` (max 64 chars), `layout: str | None` (layout id)
- Result model: `MahjongResult` — `won: bool`, `pairs: int`
- Scoring: see [Scoring](#scoring-persistence)

## Accessibility

Mahjong uses a Skia canvas on native. The canvas must be complemented by native accessible elements for score and game state. See [`docs/ACCESSIBILITY.md §4`](../ACCESSIBILITY.md#4-screen-readers).

## Entitlement

Premium: requires a valid entitlement JWT. Offline play continues within the
7-day grace period; see [`docs/ARCHITECTURE.md §10`](../ARCHITECTURE.md#10-premium-entitlements).

## Known Issues / Limitations

- Responsive board layout extraction pending (Epic #1331 — `calculateMahjongLayout()` to be extracted)
- Engine shipping tracked in issue #870
- #2747: every cleared board scores exactly 1220, so the board only orders players by who cleared first (see [Scoring](#scoring-persistence), Tie-break)
