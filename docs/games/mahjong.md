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

### Hint, Undo, Shuffle, and Deadlock

- **Hint:** highlights one currently available matching free pair. It does not remove the pair for the player.
- **Undo:** restores the prior board snapshot. Up to 50 snapshots are retained. Undoing out of a deadlock resumes the game rather than preserving the deadlocked state.
- **Shuffle:** when no matching free pair remains and shuffles are left, the game offers Shuffle instead of immediately declaring the board dead. A game has 3 shuffles (`MAX_SHUFFLES`).
- **Deadlock:** if no matching free pair exists and no usable shuffle remains, the board is deadlocked. The player can still rescue it with Undo if history exists. A deadlocked board is recorded as a loss only when the player leaves it or starts another game; reaching the deadlock itself is not an irreversible server result.

## Scoring (Persistence)

- **Metric and direction (#2747):** fastest clear. The metric is `duration_ms` (`DURATION_METRIC`, the `games.duration_ms` column: the play time sent on completion, see **Duration** below), lower is better, labelled `time` (`board` in `backend/mahjong/module.py`; `BOARDS.mahjong` in `frontend/src/api/vocab.ts`). Only `win` rows rank (`qualifying_outcomes`): a deadlock is a `loss`, and a legacy `completed` row was never cleared. The leaderboard shows the value as a clock (`m:ss`, `h:mm:ss` from an hour) under a **Time** column, with "Lower is better".
- **Tie-break:** none declared. Equal times go to the earlier `completed_at`, the last tie-break on every board.
- **Partitions:** `layout`, one board per layout (layouts differ in difficulty). `partition_values` lists exactly the app's layout ids (`LAYOUTS` in `backend/mahjong/models.py`, kept in step with `frontend/src/game/mahjong/layouts/registry.ts` by `tests/test_board_definitions.py`), so a request for any other layout is a 400 and a row holding one never ranks. There is **no `partition_defaults` entry**: `GET /games/leaderboard/mahjong` needs `?layout=` (the Leaderboard screen opens on the layout just played, else Turtle). **Rows with no layout** (builds before #2627) rank on no board and `GET /games/{id}/rank` reports them `not_rankable`: which layout they cleared is unknown, and many builds already offered more than Turtle, so bucketing them as Turtle could put an easier layout's time on Turtle's board. They still count in `/stats/me`.
- **Floor (`min_value`):** 36,000 ms (`MIN_CLEAR_MS`: half a second per pair over the 72 pairs of every layout). A faster clear, a `0`, or a win with no `duration_ms` is stored (a 4xx on completion would dead-letter the game in the app) but never ranks and is not the stats best. There is no upper cap: the clock only counts play.
- **Score:** still recorded as `final_score` (10 per pair plus 500 for a clear, `SCORE_PER_PAIR`, `SCORE_COMPLETE_BONUS` in `engine.ts`) and shown on the result card, but it ranks nothing: every clear scored 1220, so it couldn't tell clears apart.
- **Recorded, not partitioned:** result (`MahjongResult`): `won` and `pairs`.
- **Stats best (`/stats/me` `best_value`):** the fastest qualifying clear (wins at or above the floor) over every layout, labelled `time`.
- **Outcomes:** `has_winner = True` (#2627).
  - A cleared board records `win` with its `final_score`, its `duration_ms` (the clear time that ranks) and `result: { won: true, pairs }`.
  - A deadlocked board records `loss` with no score, once the player leaves it: navigates away or starts another game (#2592). The loss is not recorded at the deadlock itself, so "Undo last move" on the deadlock card can still rescue the board, and then nothing is recorded.
  - Any other exit is `abandoned`, with `result: { won: false, pairs }` and no score.
  - Builds before #2627 sent `completed`. The server stores one with `won: true` as `win` (`backend/games/legacy_outcomes.py`); the rest stay `completed`, a finish with no winner.
- **Duration:** Mahjong's own play timer (`elapsedMs` in `engine.ts`). It wins over `useGameSync`'s window. The timer stops at a win or a deadlock and pauses while the player is away: another screen covers the game (navigation `blur`, #2633) or the app is in the background (`AppState`, #2750). `usePausableClock` (built on `usePauseWhileAway`) drives `pauseGame` / `resumeGame` for both as functional updates at the event's time, and resumes only once neither holds; it also starts paused when the screen mounts away, and pauses a game loaded while the player is away (`adoptLoaded`) and matches a move built from a board rendered before the player left or came back to their presence, pausing or resuming it (`matchPresence`). The clock's paused state is its own (`paused` on `PlayClock`): a move never restarts a paused clock, only the return does, and a clock that never started still starts on the first move. The pause also saves in its own event handler, before any render, from the latest state the screen computed; the pause is saved like any state change. The save banks the running segment into `accumulatedMs` and the load restarts the clock from the moment of loading (`clockForSave` / `clockOnLoad` in `frontend/src/game/_shared/playClock.ts`), so a relaunch keeps the play before an app kill and never counts the time the app was closed. Level Select pauses the clock (a trip to the background there doesn't resume it), and CONTINUE carries on from the board still in memory and resumes it (the save is loaded only when nothing is); a deadlocked or cleared board never resumes. Undo keeps the live clock rather than the snapshot's (`undoMove`), and undoing out of a deadlock starts the stopped clock again. A save from a build before #2750 carries a raw running `startedAt`, and the oldest have no `accumulatedMs`: when the app was closed is unknown, so that running segment is dropped and the game counts from the load, keeping only what was banked.
- **How it reaches the server:** the `useGameSync("mahjong")` session row, opened at the first tile tap. `SyncWorker` sends `POST /games` and `PATCH /games/{id}/complete`. The engine runs client-side and the board persists to AsyncStorage, so a game finished offline uploads when the device is back online. If the player has a display name (`PUT /players/me`), the row ranks with no further step. The board shows each named player's best win once. The legacy `POST /mahjong/score` was removed in #2644. Shared rules: [Leaderboard routes](../GAME-CONTRACT.md#leaderboard-routes-2618).
- **On screen (#2747):** the HUD shows the play clock as `TIME m:ss` (`PlayClockText`, `frontend/src/components/shared/PlayClockText.tsx`), in place of the in-play score (10 per pair, which `PAIRS` already shows). It reads the same `PlayClock` that is sent as `durationMs`, so it freezes while the player is away, stops at a win or a deadlock and carries across a relaunch. It owns its one-second tick, so the Skia board never re-renders for it; its screen-reader label (`mahjong:hud.elapsed`) is read on focus, not announced every second. The win card leads with the clear time (hero **Time**), then the score and the best time on the device; "New best" means faster than every earlier clear.
- **Where the player sees it:** the win card shows the rank through `sessionBoardAdapter` (`GET /games/{id}/rank`), on the board of the layout cleared, or asks once for a display name. The deadlock card shows no rank. The card's "View leaderboard" link and the ⋯ menu open the Leaderboard screen on the current layout's board (#2633, #2747), with a Layout picker for the others. Stats (#2635) are in the ⋯ menu. Store builds hide Mahjong (`HIDDEN_GAMES`, `frontend/src/entitlements/gameVisibility.ts`), so there it has no leaderboard or stats entry point.

## Responsive layout and rendering

Mahjong's responsive layout is implemented in `frontend/src/game/mahjong/layout.ts` through `calculateMahjongLayout()` and `makeBoardCamera()`. The old "responsive layout extraction pending" description is obsolete.

Native rendering uses Skia; web uses Canvas2D. Both consume the same engine/layout concepts and must keep hit-testing behavior aligned.

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

## Ranking decision (#2747)

The owner chose **fastest clear: time to clear, lower is better**, with a visible timer while playing. Every clear scored 1220, so the old score board could only order players by who cleared first. The board is split **by layout** because layouts differ in difficulty, and rows from before #2627, which carry no layout, are left off every board rather than guessed into Turtle's (see [Scoring](#scoring-persistence)). Change `board` in `backend/mahjong/module.py` and this file together if that call is revisited.

Active implementation bugs and future gameplay work stay in GitHub rather than being copied into a stale Known Issues list.
